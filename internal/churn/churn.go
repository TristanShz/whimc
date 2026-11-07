// Package churn attributes the commits of a window to the Files of a State,
// following renames, so that each File's Churn and the distinct-commit Churn
// of Directories and Packages can be counted.
package churn

import "github.com/TristanShz/whimc/internal/gitrepo"

// Commit is a commit of the window and the paths it touched.
type Commit struct {
	Hash    string
	Changes []gitrepo.Change
}

// Attribute maps each of paths to the indexes, in commits, of the commits
// that touched it or one of its former paths. commits are ordered children
// before parents, as `git rev-list --topo-order` lists them.
func Attribute(commits []Commit, paths []string) map[string][]int {
	// owner maps a path, as it was named at the point of history being
	// walked, to the File of the State it later became.
	owner := make(map[string]string, len(paths))
	for _, p := range paths {
		owner[p] = p
	}
	touched := map[string][]int{}
	for i, c := range commits {
		for _, ch := range c.Changes {
			file, ok := owner[ch.Path]
			if !ok {
				continue
			}
			if n := len(touched[file]); n == 0 || touched[file][n-1] != i {
				touched[file] = append(touched[file], i)
			}
			switch ch.Status {
			case 'A', 'C':
				// Before this commit the path did not exist (a copy starts
				// a File too): an older File at the same path is another.
				delete(owner, ch.Path)
			case 'R':
				delete(owner, ch.Path)
				owner[ch.From] = file
			}
		}
	}
	return touched
}
