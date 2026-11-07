package resolve

import (
	"encoding/json"
	"path"
	"sort"
	"strings"
)

// workspacePackage is a `package.json` of the State that declares a name,
// so that other Files can import it by that name.
type workspacePackage struct {
	dir     string
	exports json.RawMessage
	entries []string // types, typings, module, main
}

// conditions are the `exports` conditions tried, in order. `types` comes
// first: it usually names the TS source in a monorepo.
var conditions = []string{"types", "import", "module", "require", "node", "default", "browser"}

// fallbackEntries are tried when no declared entry point is a File of the
// State, as `main` often names a build output that is not on the Map.
var fallbackEntries = []string{"src/index", "index"}

func (r *resolver) loadWorkspacePackages() {
	r.packages = map[string]*workspacePackage{}
	for p, content := range r.s.Configs {
		if path.Base(p) != "package.json" {
			continue
		}
		var pj struct {
			Name    string          `json:"name"`
			Exports json.RawMessage `json:"exports"`
			Types   string          `json:"types"`
			Typings string          `json:"typings"`
			Module  string          `json:"module"`
			Main    string          `json:"main"`
		}
		if json.Unmarshal(content, &pj) != nil || pj.Name == "" {
			continue
		}
		wp := &workspacePackage{dir: path.Dir(p), exports: pj.Exports}
		for _, e := range []string{pj.Types, pj.Typings, pj.Module, pj.Main} {
			if e != "" {
				wp.entries = append(wp.entries, e)
			}
		}
		if prev := r.packages[pj.Name]; prev == nil || wp.dir < prev.dir {
			r.packages[pj.Name] = wp // two Packages with one name: the first path wins
		}
	}
}

// splitPackageSpec splits a bare specifier into a package name and a
// subpath: `@scope/name/sub/path` gives `@scope/name` and `sub/path`.
func splitPackageSpec(spec string) (name, subpath string) {
	parts := strings.SplitN(spec, "/", 3)
	if strings.HasPrefix(spec, "@") && len(parts) >= 2 {
		name = parts[0] + "/" + parts[1]
		if len(parts) == 3 {
			subpath = parts[2]
		}
		return name, subpath
	}
	name, subpath, _ = strings.Cut(spec, "/")
	return name, subpath
}

// resolvePackage resolves a bare specifier naming a workspace package.
func (r *resolver) resolvePackage(spec string) (string, bool) {
	name, subpath := splitPackageSpec(spec)
	wp := r.packages[name]
	if wp == nil {
		return "", false
	}
	key := "."
	if subpath != "" {
		key = "./" + subpath
	}
	for _, target := range exportTargets(wp.exports, key) {
		if p, ok := joinRepo(wp.dir, target); ok {
			if f, ok := r.resolveFile(p); ok {
				return f, true
			}
		}
	}
	var candidates []string
	if subpath == "" {
		candidates = append(append(candidates, wp.entries...), fallbackEntries...)
	} else {
		candidates = []string{subpath, path.Join("src", subpath)}
	}
	for _, c := range candidates {
		if p, ok := joinRepo(wp.dir, c); ok {
			if f, ok := r.resolveFile(p); ok {
				return f, true
			}
		}
	}
	return "", false
}

// exportTargets returns the paths the `exports` field of a package.json maps
// a subpath key ("." or "./sub") to, in condition order.
func exportTargets(exports json.RawMessage, key string) []string {
	if len(exports) == 0 {
		return nil
	}
	var str string
	if json.Unmarshal(exports, &str) == nil {
		if key == "." {
			return []string{str}
		}
		return nil
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(exports, &obj) != nil {
		return nil
	}
	subpaths := false
	for k := range obj {
		if strings.HasPrefix(k, ".") {
			subpaths = true
			break
		}
	}
	if !subpaths { // the object is the conditions of "."
		if key == "." {
			return conditionTargets(exports)
		}
		return nil
	}
	if v, ok := obj[key]; ok {
		return conditionTargets(v)
	}
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	// the longest pattern wins, as Node picks the most specific one
	sort.Slice(keys, func(i, j int) bool {
		return len(keys[i]) > len(keys[j]) || (len(keys[i]) == len(keys[j]) && keys[i] < keys[j])
	})
	for _, k := range keys { // "./*": "./src/*.ts"
		v := obj[k]
		prefix, suffix, wild := strings.Cut(k, "*")
		if wild && strings.HasPrefix(key, prefix) && strings.HasSuffix(key, suffix) && len(key) >= len(prefix)+len(suffix) {
			star := key[len(prefix) : len(key)-len(suffix)]
			var out []string
			for _, t := range conditionTargets(v) {
				out = append(out, strings.ReplaceAll(t, "*", star))
			}
			return out
		}
	}
	return nil
}

// conditionTargets flattens an `exports` value — a path, an array, or nested
// conditions — into paths in condition order.
func conditionTargets(v json.RawMessage) []string {
	var str string
	if json.Unmarshal(v, &str) == nil {
		return []string{str}
	}
	var arr []json.RawMessage
	if json.Unmarshal(v, &arr) == nil {
		var out []string
		for _, e := range arr {
			out = append(out, conditionTargets(e)...)
		}
		return out
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(v, &obj) != nil {
		return nil
	}
	var out []string
	for _, c := range conditions {
		if e, ok := obj[c]; ok {
			out = append(out, conditionTargets(e)...)
		}
	}
	return out
}
