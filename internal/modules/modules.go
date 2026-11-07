// Package modules turns the Files of a codebase State into the Module
// hierarchy: Packages declared by a manifest, the Directories inside them, and
// their Files. It also holds the path and content rules that decide which
// Files are part of the Map.
package modules

import (
	"path"
	"sort"
	"strings"
)

// Level is a level of the hierarchy.
type Level int

const (
	Packages Level = iota
	Directories
	Files
)

// ID prefixes, one per Level.
const (
	PackagePrefix   = "pkg:"
	DirectoryPrefix = "dir:"
	FilePrefix      = "file:"
)

// Manifest is a manifest File found in the State: the folder it declares a
// Package for, and the Package name it gives (possibly empty).
type Manifest struct {
	Dir  string
	Name string
}

// File is a source File kept on the Map.
type File struct {
	Path string
	Size int
	Test bool
	// Commits identifies the commits of the Churn window that touched the
	// File, each by a number unique within the State.
	Commits []int
}

// Node is a Module as the Map shows it.
type Node struct {
	ID     string
	Level  Level
	Name   string
	Path   string
	Parent string
	Size   int
	// Churn is the number of distinct commits that touched the Module's Files.
	Churn    int
	Children int
	Test     bool
}

// Tree is the Module hierarchy of one State.
type Tree struct {
	packages map[string]*pkg // by folder path
	files    []placedFile    // sorted by path
	byPath   map[string]int  // index in files
}

type pkg struct {
	path string
	name string
}

type placedFile struct {
	File
	dir string // the Directory's folder path
	pkg string // the Package's folder path
}

// Build places every File in its Package and Directory. A File belongs to
// the Package of the nearest enclosing folder holding a manifest; Files
// outside every Package go into an implicit Package at the repository root,
// named rootName.
func Build(rootName string, manifests []Manifest, files []File) *Tree {
	t := &Tree{packages: map[string]*pkg{}}
	sorted := append([]Manifest(nil), manifests...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Dir < sorted[j].Dir })
	for _, m := range sorted {
		p := t.packages[m.Dir]
		if p == nil {
			p = &pkg{path: m.Dir}
			t.packages[m.Dir] = p
		}
		if p.name == "" {
			p.name = m.Name
		}
	}
	for _, f := range files {
		dir := path.Dir(f.Path)
		owner := t.owner(dir)
		if owner == nil {
			owner = &pkg{path: "."}
			t.packages["."] = owner
		}
		t.files = append(t.files, placedFile{File: f, dir: dir, pkg: owner.path})
	}
	for _, p := range t.packages {
		if p.name == "" {
			p.name = path.Base(p.path)
			if p.path == "." {
				p.name = rootName
			}
		}
	}
	sort.Slice(t.files, func(i, j int) bool { return t.files[i].Path < t.files[j].Path })
	t.byPath = make(map[string]int, len(t.files))
	for i, f := range t.files {
		t.byPath[f.Path] = i
	}
	return t
}

// Locate returns the folders of the Directory and the Package holding the
// File at p, and whether the File is in the Tree.
func (t *Tree) Locate(p string) (dir, pkg string, ok bool) {
	i, ok := t.byPath[p]
	if !ok {
		return "", "", false
	}
	return t.files[i].dir, t.files[i].pkg, true
}

func (t *Tree) owner(dir string) *pkg {
	for {
		if p := t.packages[dir]; p != nil {
			return p
		}
		if dir == "." {
			return nil
		}
		dir = path.Dir(dir)
	}
}

// Query selects Nodes of one Level.
type Query struct {
	Level Level
	// Within is a Module ID or a bare path (the Package at that path if there
	// is one, the Directory otherwise); empty means the whole State.
	Within string
	Tests  bool
}

// Nodes returns the Modules of q.Level, sorted by ID. Sizes and child counts
// only count the Files q keeps, and Modules left without Files are dropped.
func (t *Tree) Nodes(q Query) []Node {
	withinPkg, withinDir, scoped := t.resolveWithin(q.Within)

	type dirAgg struct {
		pkg     string
		size    int
		files   int
		commits map[int]bool
	}
	type pkgAgg struct {
		size    int
		dirs    map[string]bool
		commits map[int]bool
	}
	dirs := map[string]*dirAgg{}
	pkgs := map[string]*pkgAgg{}
	var fileNodes []Node
	for _, f := range t.files {
		if f.Test && !q.Tests {
			continue
		}
		d := dirs[f.dir]
		if d == nil {
			d = &dirAgg{pkg: f.pkg, commits: map[int]bool{}}
			dirs[f.dir] = d
		}
		d.size += f.Size
		d.files++
		p := pkgs[f.pkg]
		if p == nil {
			p = &pkgAgg{dirs: map[string]bool{}, commits: map[int]bool{}}
			pkgs[f.pkg] = p
		}
		p.size += f.Size
		p.dirs[f.dir] = true
		for _, c := range f.Commits {
			d.commits[c] = true
			p.commits[c] = true
		}
		if q.Level == Files && (!scoped || f.pkg == withinPkg || f.dir == withinDir) {
			fileNodes = append(fileNodes, Node{
				ID: FilePrefix + f.Path, Level: Files, Name: path.Base(f.Path), Path: f.Path,
				Parent: DirectoryPrefix + f.dir, Size: f.Size, Churn: len(f.Commits), Test: f.Test,
			})
		}
	}

	var nodes []Node
	switch q.Level {
	case Packages:
		if scoped {
			return nil // Packages have no ancestor in the hierarchy
		}
		for p, agg := range pkgs {
			nodes = append(nodes, Node{
				ID: PackagePrefix + p, Level: Packages, Name: t.packages[p].name, Path: p,
				Size: agg.size, Churn: len(agg.commits), Children: len(agg.dirs),
			})
		}
	case Directories:
		for d, agg := range dirs {
			if scoped && agg.pkg != withinPkg {
				continue
			}
			nodes = append(nodes, Node{
				ID: DirectoryPrefix + d, Level: Directories, Name: t.directoryName(d, agg.pkg), Path: d,
				Parent: PackagePrefix + agg.pkg, Size: agg.size, Churn: len(agg.commits), Children: agg.files,
			})
		}
	case Files:
		nodes = fileNodes
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	return nodes
}

// resolveWithin returns the Package or Directory folder named by within. An
// unknown Module scopes the query to nothing.
func (t *Tree) resolveWithin(within string) (pkgPath, dirPath string, scoped bool) {
	const none = "\x00" // matches no folder
	switch {
	case within == "":
		return none, none, false
	case strings.HasPrefix(within, PackagePrefix):
		return strings.TrimPrefix(within, PackagePrefix), none, true
	case strings.HasPrefix(within, DirectoryPrefix):
		return none, strings.TrimPrefix(within, DirectoryPrefix), true
	case strings.HasPrefix(within, FilePrefix):
		return none, none, true // a File has no descendants
	}
	if _, ok := t.packages[within]; ok {
		return within, none, true
	}
	return none, within, true
}

// directoryName is the Directory's path relative to its Package; a Package's
// root Directory takes the Package's name.
func (t *Tree) directoryName(dir, pkgPath string) string {
	if dir == pkgPath {
		return t.packages[pkgPath].name
	}
	if pkgPath == "." {
		return dir
	}
	return strings.TrimPrefix(dir, pkgPath+"/")
}
