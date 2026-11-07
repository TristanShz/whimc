package resolve

import (
	"path"
	"sort"
	"strings"

	"github.com/TristanShz/whimc/internal/modules"
	"github.com/TristanShz/whimc/internal/parse"
)

// goModule is a `go.mod` of the State.
type goModule struct {
	dir, path string
}

// goPackage is a Go package of the State: the non-test Files of one folder.
type goPackage struct {
	name string
	// declarer maps each top-level Symbol to the File declaring it.
	declarer map[string]string
}

func (r *resolver) loadGo() {
	r.goPackages = map[string]*goPackage{}
	for p, res := range r.s.Files {
		if res.Language != parse.Go || res.Failed || strings.HasSuffix(p, "_test.go") {
			continue
		}
		dir := path.Dir(p)
		gp := r.goPackages[dir]
		if gp == nil {
			gp = &goPackage{declarer: map[string]string{}}
			r.goPackages[dir] = gp
		}
		if gp.name == "" || res.GoPackage < gp.name {
			gp.name = res.GoPackage // deterministic when a folder mixes packages
		}
		for _, sym := range res.Declares {
			if prev, ok := gp.declarer[sym]; !ok || p < prev {
				gp.declarer[sym] = p
			}
		}
	}
	for p, content := range r.s.Configs {
		if path.Base(p) != "go.mod" {
			continue
		}
		if mod := modules.ManifestName(p, content); mod != "" {
			r.goModules = append(r.goModules, goModule{dir: path.Dir(p), path: mod})
		}
	}
	// the longest module path wins, so nested modules shadow their parent
	sort.Slice(r.goModules, func(i, j int) bool { return len(r.goModules[i].path) > len(r.goModules[j].path) })
}

// goDir returns the folder of the State an import path names.
func (r *resolver) goDir(importPath string) (string, bool) {
	for _, m := range r.goModules {
		if importPath == m.path {
			return m.dir, true
		}
		if rest, ok := strings.CutPrefix(importPath, m.path+"/"); ok {
			return joinRepo(m.dir, rest)
		}
	}
	return "", false
}

// goDependencies adds the Dependencies of a Go File: for each import of a
// package of the State, the Files declaring the Symbols it selects.
func (r *resolver) goDependencies(from string, res parse.Result, add func(from, to string, kind parse.Kind)) {
	if r.goPackages == nil {
		r.loadGo()
	}
	for _, imp := range res.Imports {
		if imp.Alias == "_" || imp.Alias == "." {
			continue // no selector names a blank or dot import
		}
		dir, ok := r.goDir(imp.Spec)
		if !ok {
			continue
		}
		gp := r.goPackages[dir]
		if gp == nil {
			continue
		}
		alias := imp.Alias
		if alias == "" {
			alias = gp.name
		}
		for _, sel := range res.Selectors {
			if sel.Pkg != alias {
				continue
			}
			if to, ok := gp.declarer[sel.Symbol]; ok {
				add(from, to, parse.Runtime)
			}
		}
	}
}
