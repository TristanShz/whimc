package resolve

import (
	"path"
	"slices"
	"strings"

	"github.com/TristanShz/whimc/internal/parse"
)

// extensions are tried, in order, after a specifier without one, and after
// the `index` of a folder.
var extensions = []string{".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}

// jsToTS maps a JS extension written in a specifier to the TS sources it may
// stand for, as TS resolves `./x.js` to `./x.ts`.
var jsToTS = map[string][]string{
	".js":  {".ts", ".tsx", ".d.ts"},
	".jsx": {".tsx"},
	".mjs": {".mts"},
	".cjs": {".cts"},
}

// tsDependencies adds the Dependencies of a TS File: its imports and its
// re-exports, each followed through Barrels to the defining Files.
func (r *resolver) tsDependencies(from string, res parse.Result, add func(from, to string, kind parse.Kind)) {
	for _, imp := range res.Imports {
		target, ok := r.resolveTS(from, imp.Spec)
		if !ok {
			continue
		}
		names := imp.Names
		if len(names) == 0 {
			names = []string{parse.Whole}
		}
		for _, name := range names {
			for _, to := range r.definers(target, name) {
				add(from, to, imp.Kind)
			}
		}
	}
	for _, re := range res.ReExports {
		target, ok := r.resolveTS(from, re.Spec)
		if !ok {
			continue
		}
		kind := parse.Runtime
		if re.TypeOnly {
			kind = parse.TypeOnly
		}
		name := re.From
		if re.Star {
			name = parse.Whole
		}
		for _, to := range r.definers(target, name) {
			add(from, to, kind)
		}
	}
}

// definers returns the Files that define name as imported from file: the
// File declaring it, found through re-exports, or file itself when it is
// not found. The Whole module of a Barrel is every File it re-exports from.
func (r *resolver) definers(file, name string) []string {
	if name == parse.Whole {
		return r.expand(file, map[string]bool{})
	}
	if f, ok := r.lookup(file, name, map[string]bool{}); ok {
		return []string{f}
	}
	return []string{file}
}

// lookup finds the File declaring name as exported by file, following named
// and `export *` re-exports.
func (r *resolver) lookup(file, name string, visited map[string]bool) (string, bool) {
	res := r.s.Files[file]
	if visited[file] || res.Failed {
		return "", false
	}
	visited[file] = true
	if slices.Contains(res.Declares, name) {
		return file, true
	}
	for _, re := range res.ReExports {
		if re.Star || re.Name != name {
			continue
		}
		target, ok := r.resolveTS(file, re.Spec)
		if !ok {
			return file, true // re-exported from outside the project
		}
		if re.From == parse.Whole {
			return target, true
		}
		if f, ok := r.lookup(target, re.From, visited); ok {
			return f, true
		}
		return target, true
	}
	if name == "default" {
		return "", false // `export *` leaves the default export out
	}
	for _, re := range res.ReExports {
		if !re.Star {
			continue
		}
		if target, ok := r.resolveTS(file, re.Spec); ok {
			if f, ok := r.lookup(target, name, visited); ok {
				return f, true
			}
		}
	}
	return "", false
}

// expand returns the Files a whole-module import of file depends on: file
// itself, or for a Barrel every File its re-exports lead to.
func (r *resolver) expand(file string, visited map[string]bool) []string {
	res := r.s.Files[file]
	if !isBarrel(res) {
		return []string{file}
	}
	if visited[file] {
		return nil
	}
	visited[file] = true
	var out []string
	for _, re := range res.ReExports {
		target, ok := r.resolveTS(file, re.Spec)
		switch {
		case !ok:
			out = append(out, file) // re-exported from outside the project
		case re.Star || re.From == parse.Whole:
			out = append(out, r.expand(target, visited)...)
		default:
			out = append(out, r.definers(target, re.From)...)
		}
	}
	return out
}

// isBarrel reports whether a File only re-exports what other modules define.
func isBarrel(res parse.Result) bool {
	return !res.Failed && len(res.Declares) == 0 && len(res.ReExports) > 0
}

// resolveTS returns the File a specifier imported from the File at from
// names, before any re-export is followed.
func (r *resolver) resolveTS(from, spec string) (string, bool) {
	if isRelative(spec) {
		p, ok := joinRepo(path.Dir(from), spec)
		if !ok {
			return "", false
		}
		return r.resolveFile(p)
	}
	if c := r.configFor(from); c != nil {
		for _, p := range c.candidates(spec) {
			if target, ok := r.resolveFile(p); ok {
				return target, true
			}
		}
	}
	return r.resolvePackage(spec)
}

// resolveFile resolves a path without extension, with a JS extension
// standing for a TS source, or naming a folder with an index File.
func (r *resolver) resolveFile(p string) (string, bool) {
	if r.isTSFile(p) {
		return p, true
	}
	if ext := path.Ext(p); jsToTS[ext] != nil {
		stem := strings.TrimSuffix(p, ext)
		for _, alt := range jsToTS[ext] {
			if r.isTSFile(stem + alt) {
				return stem + alt, true
			}
		}
	}
	for _, ext := range extensions {
		if r.isTSFile(p + ext) {
			return p + ext, true
		}
	}
	for _, ext := range extensions {
		if index := path.Join(p, "index"+ext); r.isTSFile(index) {
			return index, true
		}
	}
	return "", false
}

func (r *resolver) isTSFile(p string) bool {
	res, ok := r.s.Files[p]
	return ok && res.Language == parse.TypeScript
}
