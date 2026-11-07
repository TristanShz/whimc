package engine

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/TristanShz/whimc/internal/modules"
)

// WorktreeRef is the ref that names the working tree on the command line and
// in the HTTP API, like an empty ref.
const WorktreeRef = "worktree"

// ParseState reads a ref as given on the command line or in the HTTP API: a
// commit, branch or tag, or the working tree when it is empty or
// "worktree". Surrounding spaces are ignored.
func ParseState(ref string) State {
	ref = strings.TrimSpace(ref)
	if ref == WorktreeRef {
		ref = ""
	}
	return State{Ref: ref}
}

// String returns the State's ref, "worktree" for the working tree: what
// ParseState reads back.
func (s State) String() string {
	if s.Ref == "" {
		return WorktreeRef
	}
	return s.Ref
}

// MarshalText encodes the State as its ref, "worktree" for the working tree.
func (s State) MarshalText() ([]byte, error) { return []byte(s.String()), nil }

// UnmarshalText decodes a ref with ParseState.
func (s *State) UnmarshalText(text []byte) error {
	*s = ParseState(string(text))
	return nil
}

// CompareQuery tunes a Comparison.
type CompareQuery struct {
	// Tests includes test Files; when false, their changes and the
	// Dependencies touching them are left out, as on the Map.
	Tests bool
}

// Change is how a Module or a Dependency differs from the base State to the
// target State.
type Change string

const (
	// Unchanged Modules are the same in both States; a Comparison does not
	// list them.
	Unchanged Change = "unchanged"
	// Added Modules and Dependencies exist in the target State only.
	Added Change = "added"
	// Modified Files have another content in the target State; modified
	// Directories and Packages contain changed Files; modified Dependencies
	// gain or lose File Dependencies, or change kind.
	Modified Change = "modified"
	// Removed Modules and Dependencies exist in the base State only.
	Removed Change = "removed"
)

// Comparison is what differs between two States, at each level of the Map.
type Comparison struct {
	Base    State   `json:"base"`
	Target  State   `json:"target"`
	Summary Summary `json:"summary"`

	Packages    LevelComparison `json:"packages"`
	Directories LevelComparison `json:"directories"`
	Files       LevelComparison `json:"files"`
}

// Summary sizes a Comparison in a few numbers.
type Summary struct {
	FilesChanged  int `json:"filesChanged"`
	FilesAdded    int `json:"filesAdded"`
	FilesModified int `json:"filesModified"`
	FilesRemoved  int `json:"filesRemoved"`
	// PackagesTouched is the number of Packages added, removed or holding a
	// changed File.
	PackagesTouched int `json:"packagesTouched"`
	// DependenciesAdded and DependenciesRemoved count File Dependencies.
	DependenciesAdded   int `json:"dependenciesAdded"`
	DependenciesRemoved int `json:"dependenciesRemoved"`
}

// LevelComparison is the Comparison at one level of the Map.
type LevelComparison struct {
	Level Level `json:"level"`
	// Modules are the changed Modules of the level, sorted by ID; every
	// Module not listed is unchanged.
	Modules []ModuleChange `json:"modules"`
	// Dependencies are the changed Dependencies of the level, sorted by From
	// then To.
	Dependencies []DependencyChange `json:"dependencies"`
}

// ModuleChange is a Module that differs between the two States.
type ModuleChange struct {
	ID     string `json:"id"`
	Level  Level  `json:"level"`
	Name   string `json:"name"`
	Path   string `json:"path"`
	Parent string `json:"parent,omitempty"`
	Change Change `json:"change"`
	Test   bool   `json:"test,omitempty"`
	// Changed is the number of changed Files in the Module, Added + Modified
	// + Removed: 1 for a changed File.
	Changed  int `json:"changed"`
	Added    int `json:"added"`
	Modified int `json:"modified"`
	Removed  int `json:"removed"`
	// Size is the Module's Size in the target State, in the base State for a
	// removed Module.
	Size int `json:"size"`
	// X, Y and Radius place the Module on the Map: a removed Module keeps its
	// last position, where the Map draws its ghost.
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Radius float64 `json:"radius"`
}

// DependencyChange is a Dependency of one level that differs between the two
// States.
type DependencyChange struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Change Change `json:"change"`
	// Kind and Weight are the Dependency's in the target State, in the base
	// State for a removed Dependency.
	Kind   DependencyKind `json:"kind"`
	Weight int            `json:"weight"`
	// Added and Removed count the File Dependencies added and removed under
	// this Dependency.
	Added   int `json:"added"`
	Removed int `json:"removed"`
}

// At returns the Comparison at a level.
func (c Comparison) At(level Level) LevelComparison {
	switch level {
	case Packages:
		return c.Packages
	case Directories:
		return c.Directories
	}
	return c.Files
}

// Module returns how the Module with this ID changed. A Module the Comparison
// does not list, unknown ones included, is Unchanged.
func (c Comparison) Module(id string) ModuleChange {
	level := Files
	switch {
	case strings.HasPrefix(id, modules.PackagePrefix):
		level = Packages
	case strings.HasPrefix(id, modules.DirectoryPrefix):
		level = Directories
	}
	ms := c.At(level).Modules
	i := sort.Search(len(ms), func(i int) bool { return ms[i].ID >= id })
	if i < len(ms) && ms[i].ID == id {
		return ms[i]
	}
	return ModuleChange{ID: id, Level: level, Change: Unchanged}
}

func (w *workspace) Compare(ctx context.Context, base, target State, q CompareQuery) (Comparison, error) {
	// Both States are read as far as the first run reached when the
	// Comparison started, so that they differ only where the code does.
	done := w.warm.reached()
	bs, err := w.snapshot(ctx, base, done)
	if err != nil {
		return Comparison{}, fmt.Errorf("compare: base %v: %w", base, err)
	}
	ts, err := w.snapshot(ctx, target, done)
	if err != nil {
		return Comparison{}, fmt.Errorf("compare: target %v: %w", target, err)
	}
	// Placing the base State gives a position to the Files it removes, even
	// when it was never on the Map.
	for _, s := range []*snapshot{bs, ts} {
		if err := w.place(s); err != nil {
			return Comparison{}, fmt.Errorf("compare: layout: %w", err)
		}
	}
	d := diff{base: bs, target: ts, tests: q.Tests}
	d.files()
	d.edges()
	c := Comparison{
		Base: base, Target: target,
		Packages:    d.level(w, Packages),
		Directories: d.level(w, Directories),
		Files:       d.level(w, Files),
	}
	for _, m := range c.Files.Modules {
		c.Summary.FilesAdded += m.Added
		c.Summary.FilesModified += m.Modified
		c.Summary.FilesRemoved += m.Removed
	}
	c.Summary.FilesChanged = c.Summary.FilesAdded + c.Summary.FilesModified + c.Summary.FilesRemoved
	c.Summary.PackagesTouched = len(c.Packages.Modules)
	for _, dc := range c.Files.Dependencies {
		c.Summary.DependenciesAdded += dc.Added
		c.Summary.DependenciesRemoved += dc.Removed
	}
	return c, nil
}

// diff compares the snapshots of two States.
type diff struct {
	base, target *snapshot
	tests        bool

	changed []fileChange // sorted by path
	// addedEdges and removedEdges are the File Dependencies of one State only.
	addedEdges, removedEdges []modules.Edge
}

type fileChange struct {
	path   string
	change Change
}

// keeps reports whether the File at p is part of the Comparison.
func (d *diff) keeps(p string) bool { return d.tests || !modules.IsTest(p) }

// files finds the Files added, modified and removed.
func (d *diff) files() {
	for p, blob := range d.target.blobs {
		if !d.keeps(p) {
			continue
		}
		if was, ok := d.base.blobs[p]; !ok {
			d.changed = append(d.changed, fileChange{p, Added})
		} else if was != blob {
			d.changed = append(d.changed, fileChange{p, Modified})
		}
	}
	for p := range d.base.blobs {
		if _, ok := d.target.blobs[p]; !ok && d.keeps(p) {
			d.changed = append(d.changed, fileChange{p, Removed})
		}
	}
	sort.Slice(d.changed, func(i, j int) bool { return d.changed[i].path < d.changed[j].path })
}

// edges finds the File Dependencies added and removed. A File Dependency is
// identified by the Files it joins; a change of kind adds or removes none.
func (d *diff) edges() {
	pairs := func(edges []modules.Edge) map[[2]string]bool {
		set := make(map[[2]string]bool, len(edges))
		for _, e := range edges {
			set[[2]string{e.From, e.To}] = true
		}
		return set
	}
	only := func(edges []modules.Edge, other map[[2]string]bool) []modules.Edge {
		var out []modules.Edge
		for _, e := range edges {
			if !other[[2]string{e.From, e.To}] && d.keeps(e.From) && d.keeps(e.To) {
				out = append(out, e)
			}
		}
		return out
	}
	d.addedEdges = only(d.target.deps, pairs(d.base.deps))
	d.removedEdges = only(d.base.deps, pairs(d.target.deps))
}

// moduleID returns the ID of the Module of level holding the File at p in
// tree, and false when the File is not in tree.
func moduleID(tree *modules.Tree, level Level, p string) (string, bool) {
	dir, pkg, ok := tree.Locate(p)
	switch {
	case !ok:
		return "", false
	case level == Packages:
		return modules.PackagePrefix + pkg, true
	case level == Directories:
		return modules.DirectoryPrefix + dir, true
	}
	return modules.FilePrefix + p, true
}

// level compares the Modules and Dependencies of one level.
func (d *diff) level(w *workspace, level Level) LevelComparison {
	mq := modules.Query{Level: modules.Level(level), Tests: d.tests}
	baseNodes := d.base.tree.Nodes(mq)
	targetNodes := d.target.tree.Nodes(mq)
	out := LevelComparison{Level: level, Modules: []ModuleChange{}, Dependencies: []DependencyChange{}}

	type counts struct{ added, modified, removed int }
	inside := map[string]*counts{}
	for _, fc := range d.changed {
		tree := d.target.tree
		if fc.change == Removed {
			tree = d.base.tree
		}
		id, ok := moduleID(tree, level, fc.path)
		if !ok {
			continue
		}
		c := inside[id]
		if c == nil {
			c = &counts{}
			inside[id] = c
		}
		switch fc.change {
		case Added:
			c.added++
		case Modified:
			c.modified++
		default:
			c.removed++
		}
	}

	before := byID(baseNodes)
	after := byID(targetNodes)
	for _, id := range unionKeys(before, after, strings.Compare) {
		b, inBase := before[id]
		n, inTarget := after[id]
		c := inside[id]
		if c == nil {
			c = &counts{}
		}
		var change Change
		switch {
		case !inBase:
			change = Added
		case !inTarget:
			change, n = Removed, b
		case c.added+c.modified+c.removed > 0:
			change = Modified
		default:
			continue
		}
		p, _ := w.position(id)
		out.Modules = append(out.Modules, ModuleChange{
			ID: id, Level: level, Name: n.Name, Path: n.Path, Parent: n.Parent, Change: change, Test: n.Test,
			Changed: c.added + c.modified + c.removed, Added: c.added, Modified: c.modified, Removed: c.removed,
			Size: n.Size, X: p.X, Y: p.Y, Radius: Radius(level, n.Size),
		})
	}

	type edgeCounts struct{ added, removed int }
	underneath := map[[2]string]*edgeCounts{}
	tally := func(tree *modules.Tree, edges []modules.Edge, added bool) {
		for _, e := range edges {
			from, ok1 := moduleID(tree, level, e.From)
			to, ok2 := moduleID(tree, level, e.To)
			if !ok1 || !ok2 || from == to {
				continue
			}
			key := [2]string{from, to}
			c := underneath[key]
			if c == nil {
				c = &edgeCounts{}
				underneath[key] = c
			}
			if added {
				c.added++
			} else {
				c.removed++
			}
		}
	}
	tally(d.target.tree, d.addedEdges, true)
	tally(d.base.tree, d.removedEdges, false)

	depsBefore := depsByPair(d.base.tree.Dependencies(mq, baseNodes, d.base.deps))
	depsAfter := depsByPair(d.target.tree.Dependencies(mq, targetNodes, d.target.deps))
	for _, key := range unionKeys(depsBefore, depsAfter, comparePairs) {
		b, inBase := depsBefore[key]
		a, inTarget := depsAfter[key]
		c := underneath[key]
		if c == nil {
			c = &edgeCounts{}
		}
		var change Change
		switch {
		case !inBase:
			change = Added
		case !inTarget:
			change, a = Removed, b
		case c.added+c.removed > 0 || a.Kind != b.Kind:
			change = Modified
		default:
			continue
		}
		out.Dependencies = append(out.Dependencies, DependencyChange{
			From: key[0], To: key[1], Change: change, Kind: DependencyKind(a.Kind), Weight: a.Weight,
			Added: c.added, Removed: c.removed,
		})
	}
	return out
}

func byID(nodes []modules.Node) map[string]modules.Node {
	m := make(map[string]modules.Node, len(nodes))
	for _, n := range nodes {
		m[n.ID] = n
	}
	return m
}

func depsByPair(deps []modules.Dependency) map[[2]string]modules.Dependency {
	m := make(map[[2]string]modules.Dependency, len(deps))
	for _, d := range deps {
		m[[2]string{d.From, d.To}] = d
	}
	return m
}

// unionKeys returns the keys of a and b, sorted by compare.
func unionKeys[K comparable, V any](a, b map[K]V, compare func(K, K) int) []K {
	keys := make([]K, 0, len(a)+len(b))
	for k := range a {
		keys = append(keys, k)
	}
	for k := range b {
		if _, ok := a[k]; !ok {
			keys = append(keys, k)
		}
	}
	slices.SortFunc(keys, compare)
	return keys
}

func comparePairs(a, b [2]string) int {
	return cmp.Or(strings.Compare(a[0], b[0]), strings.Compare(a[1], b[1]))
}
