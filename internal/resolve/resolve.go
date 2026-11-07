// Package resolve turns the parse Results of a whole State into File
// Dependencies. Unlike parsing, resolution depends on the whole State: which
// Files exist, the manifests and the tsconfig Files.
package resolve

import (
	"path"
	"sort"
	"strings"

	"github.com/TristanShz/whimc/internal/parse"
)

// Snapshot is what resolution reads from one State.
type Snapshot struct {
	// Files are the parse Results of the Files on the Map, by path.
	Files map[string]parse.Result
	// Configs are the contents of the `package.json`, `go.mod` and
	// tsconfig Files of the State, by path.
	Configs map[string][]byte
}

// Dependency is a File Dependency: From imports what To defines.
type Dependency struct {
	From, To string
	Kind     parse.Kind
}

// Resolve returns the File Dependencies of a Snapshot, one per pair of Files,
// sorted by From then To. The kind of a pair imported several ways is the
// strongest: runtime, then type-only, then dynamic.
func Resolve(s Snapshot) []Dependency {
	r := newResolver(s)
	kinds := map[[2]string]parse.Kind{}
	add := func(from, to string, kind parse.Kind) {
		if from == to {
			return
		}
		key := [2]string{from, to}
		if k, ok := kinds[key]; !ok || kind < k {
			kinds[key] = kind
		}
	}
	for p, res := range s.Files {
		if res.Failed {
			continue
		}
		switch res.Language {
		case parse.TypeScript:
			r.tsDependencies(p, res, add)
		case parse.Go:
			r.goDependencies(p, res, add)
		}
	}
	deps := make([]Dependency, 0, len(kinds))
	for key, kind := range kinds {
		deps = append(deps, Dependency{From: key[0], To: key[1], Kind: kind})
	}
	sort.Slice(deps, func(i, j int) bool {
		if deps[i].From != deps[j].From {
			return deps[i].From < deps[j].From
		}
		return deps[i].To < deps[j].To
	})
	return deps
}

type resolver struct {
	s Snapshot
	// configs caches the tsconfig governing each folder (nil: none).
	configs map[string]*tsconfig
	// packages are the workspace packages, by name.
	packages map[string]*workspacePackage
	// goPackages are the Go packages by folder, loaded on first use, and
	// goModules the go.mod Files, longest module path first.
	goPackages map[string]*goPackage
	goModules  []goModule
}

func newResolver(s Snapshot) *resolver {
	r := &resolver{s: s, configs: map[string]*tsconfig{}}
	r.loadWorkspacePackages()
	return r
}

// isRelative reports whether a TS specifier is a path from the importer.
func isRelative(spec string) bool {
	return spec == "." || spec == ".." || strings.HasPrefix(spec, "./") || strings.HasPrefix(spec, "../")
}

// joinRepo joins a folder and a relative path; ok is false when the result
// leaves the repository.
func joinRepo(dir, rel string) (string, bool) {
	p := path.Join(dir, rel)
	if p == ".." || strings.HasPrefix(p, "../") || strings.HasPrefix(p, "/") {
		return "", false
	}
	return p, true
}
