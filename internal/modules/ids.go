package modules

import (
	"path"
	"strings"
)

// prefixes are the ID prefixes, one per Level: a Module ID is its Level's
// prefix followed by its path.
var prefixes = [...]string{Packages: "pkg:", Directories: "dir:", Files: "file:"}

// ID returns the ID of the Module of a level at a repository-relative path:
// the folder of a Package or a Directory, the path of a File.
func ID(level Level, p string) string { return prefixes[level] + p }

// ParseID returns the level and the path of a Module ID, and false when id is
// not one.
func ParseID(id string) (Level, string, bool) {
	for level, prefix := range prefixes {
		if rest, ok := strings.CutPrefix(id, prefix); ok && rest != "" {
			return Level(level), rest, true
		}
	}
	return 0, "", false
}

// DirectoryOf returns the folder of the Directory holding the File at p: the
// folder the File is in.
func DirectoryOf(p string) string { return path.Dir(p) }
