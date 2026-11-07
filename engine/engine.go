// Package engine indexes a repository and answers the questions the Map asks:
// which Modules exist at a level, how big they are, and what changed between
// two States. It is the only public surface of whimc's analysis; the CLI and
// the HTTP layer are thin shells over Workspace.
package engine

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/TristanShz/whimc/internal/gitrepo"
	"github.com/TristanShz/whimc/internal/index"
	"github.com/TristanShz/whimc/internal/modules"
	"github.com/TristanShz/whimc/internal/parse"
)

var (
	// ErrGitNotFound reports that no git executable is on PATH.
	ErrGitNotFound = gitrepo.ErrGitNotFound
	// ErrNotARepository reports that the path given to Open is not inside a git work tree.
	ErrNotARepository = gitrepo.ErrNotARepository
	// ErrUnknownRef reports a State whose ref names no commit, branch or tag.
	ErrUnknownRef = gitrepo.ErrUnknownRef
)

// State is a state of the codebase: a commit, branch or tag, or the working
// tree when Ref is empty. The working tree holds the Files as on disk, tracked
// and untracked-but-not-ignored.
type State struct{ Ref string }

// Workspace is an opened repository.
type Workspace interface {
	// Map returns the Modules of one level, with their frozen positions.
	Map(ctx context.Context, at State, q MapQuery) (MapView, error)
	// Compare returns what differs between two States, File by File,
	// aggregated per Directory and Package.
	Compare(ctx context.Context, base, target State, q CompareQuery) (Comparison, error)
	// Changes streams index updates (first run progress, working-tree edits).
	Changes(ctx context.Context) (<-chan Update, error)
	// Refs lists the branches, tags and recent commits a Comparison can
	// pick.
	Refs(ctx context.Context) (Refs, error)
	// Stats reports the work the Workspace did since it was opened.
	Stats() Stats
	// Close releases the git processes and the index held by the Workspace.
	Close() error
}

// Stats counts the work a Workspace did, to observe what the index saves.
type Stats struct {
	// ParsedBlobs is the number of blobs parsed: the ones the index did not
	// know yet.
	ParsedBlobs int
	// DiffedCommits is the number of commits whose touched paths were read
	// from git for Churn: the ones the index did not know yet.
	DiffedCommits int
	// HashedFiles is the number of working-tree Files read and hashed: the
	// ones new, or written since they were last hashed.
	HashedFiles int
}

// Options tunes a Workspace. The zero value is the default.
type Options struct {
	// ChurnWindow is how far back Churn counts commits: 90 days when zero.
	ChurnWindow time.Duration
	// Now is the clock the Churn window ends at: time.Now when nil.
	Now func() time.Time
	// CacheDir is where the indexes of repositories are kept, one directory
	// per repository: whimc's folder in the user cache directory when empty.
	CacheDir string
	// Debounce is how long the Watcher waits for a burst of writes to end
	// before it reports them in one Update: DefaultDebounce when zero.
	Debounce time.Duration
}

// DefaultDebounce is the Watcher's quiet time when Options leaves it zero.
const DefaultDebounce = 250 * time.Millisecond

// DefaultChurnWindow is the Churn window when Options leaves it zero.
const DefaultChurnWindow = 90 * 24 * time.Hour

// Level is a level of the Module hierarchy.
type Level int

const (
	Packages Level = iota
	Directories
	Files
)

func (l Level) String() string {
	switch l {
	case Packages:
		return "packages"
	case Directories:
		return "directories"
	case Files:
		return "files"
	}
	return fmt.Sprintf("Level(%d)", int(l))
}

// ParseLevel reads a Level from its name: packages, directories or files.
func ParseLevel(name string) (Level, error) {
	for l := Packages; l <= Files; l++ {
		if name == l.String() {
			return l, nil
		}
	}
	return 0, fmt.Errorf("unknown level %q: want packages, directories or files", name)
}

// MarshalText encodes the Level as its name.
func (l Level) MarshalText() ([]byte, error) { return []byte(l.String()), nil }

// UnmarshalText decodes a Level name.
func (l *Level) UnmarshalText(text []byte) (err error) {
	*l, err = ParseLevel(string(text))
	return err
}

// Rect is an area of the Map, in map coordinates.
type Rect struct{ X0, Y0, X1, Y1 float64 }

// MapQuery selects the Modules a Map call returns.
type MapQuery struct {
	Level Level
	// Within is an optional Module, given by ID (`pkg:…`, `dir:…`) or by path:
	// only its descendants are returned. A bare path names the Package at that
	// path when there is one, the Directory otherwise.
	Within string
	// Viewport optionally keeps only the Modules whose disc meets it, for
	// very large levels; Dependencies are kept between those Modules only.
	Viewport *Rect
	// Tests includes test Files; when false, test Files are left out of every
	// Module, and Modules left without Files disappear.
	Tests bool
}

// MapView is the answer to a Map call.
type MapView struct {
	Level   Level    `json:"level"`
	Modules []Module `json:"modules"`
	// Dependencies are the Dependencies between the Modules of the view,
	// aggregated to its level, sorted by From then To.
	Dependencies []Dependency `json:"dependencies"`
}

// DependencyKind is how a Dependency is imported.
type DependencyKind int

const (
	// Runtime Dependencies load the imported module when the importer runs.
	Runtime DependencyKind = DependencyKind(parse.Runtime)
	// TypeOnly Dependencies vanish at runtime (`import type`).
	TypeOnly DependencyKind = DependencyKind(parse.TypeOnly)
	// Dynamic Dependencies load the module lazily (`import()`).
	Dynamic DependencyKind = DependencyKind(parse.Dynamic)
)

func (k DependencyKind) String() string {
	switch k {
	case Runtime:
		return "runtime"
	case TypeOnly:
		return "type-only"
	case Dynamic:
		return "dynamic"
	}
	return fmt.Sprintf("DependencyKind(%d)", int(k))
}

// MarshalText encodes the kind as its name: runtime, type-only or dynamic.
func (k DependencyKind) MarshalText() ([]byte, error) { return []byte(k.String()), nil }

// UnmarshalText decodes a kind name.
func (k *DependencyKind) UnmarshalText(text []byte) error {
	for _, kind := range []DependencyKind{Runtime, TypeOnly, Dynamic} {
		if string(text) == kind.String() {
			*k = kind
			return nil
		}
	}
	return fmt.Errorf("unknown dependency kind %q", text)
}

// KindCounts counts the File Dependencies of an aggregate by kind.
type KindCounts struct {
	Runtime  int `json:"runtime"`
	TypeOnly int `json:"typeOnly"`
	Dynamic  int `json:"dynamic"`
}

// Dependency is an edge of the Map: From imports what To defines. Between
// Files, it stands for every import of one File resolving to the other;
// between Directories or Packages, it aggregates the File Dependencies from
// one Module's Files to the other's.
type Dependency struct {
	From string `json:"from"` // Module IDs
	To   string `json:"to"`
	// Kind is runtime if any aggregated File Dependency is runtime, else
	// type-only if any is, else dynamic.
	Kind DependencyKind `json:"kind"`
	// Weight is the number of File Dependencies aggregated: 1 between Files.
	Weight int        `json:"weight"`
	Counts KindCounts `json:"counts"`
}

// Module is a node of the Map: a Package, a Directory or a File.
type Module struct {
	// ID is unique across levels: `pkg:<path>`, `dir:<path>` or `file:<path>`.
	ID    string `json:"id"`
	Level Level  `json:"level"`
	Name  string `json:"name"`
	// Path is the repository-relative slash path; "." is the repository root.
	Path string `json:"path"`
	// Parent is the ID of the enclosing Module, empty for a Package.
	Parent string `json:"parent,omitempty"`
	// Size is the number of non-blank lines, summed over the Module's Files.
	Size int `json:"size"`
	// Churn is the number of commits that touched the Module within the
	// Churn window, renames followed. For a Directory or a Package, a commit
	// touching several of its Files counts once.
	Churn int `json:"churn"`
	// Children is the number of Modules one level down.
	Children int `json:"children"`
	// Test is set on test Files.
	Test bool `json:"test,omitempty"`
	// X and Y are the Module's frozen position on the Map, in map
	// coordinates shared by every level: a child sits inside its parent's
	// disc. Radius is the radius of its disc, from its Size (see Radius).
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Radius float64 `json:"radius"`
}

// Open opens the repository containing repoPath.
func Open(ctx context.Context, repoPath string, opts Options) (Workspace, error) {
	repo, err := gitrepo.Open(ctx, repoPath)
	if err != nil {
		return nil, err
	}
	if opts.ChurnWindow <= 0 {
		opts.ChurnWindow = DefaultChurnWindow
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	ix, err := openIndex(ctx, repo, opts.CacheDir)
	if err != nil {
		repo.Close()
		return nil, err
	}
	if opts.Debounce <= 0 {
		opts.Debounce = DefaultDebounce
	}
	w := &workspace{repo: repo, ix: ix, opts: opts, hub: newHub()}
	w.closing, w.stop = context.WithCancel(context.Background())
	return w, nil
}

// openIndex opens the index of repo, shared by all its worktrees.
func openIndex(ctx context.Context, repo *gitrepo.Repo, cacheDir string) (*index.Index, error) {
	if cacheDir == "" {
		var err error
		if cacheDir, err = index.DefaultCacheDir(); err != nil {
			return nil, err
		}
	}
	common, err := repo.CommonDir(ctx)
	if err != nil {
		return nil, err
	}
	return index.Open(index.Dir(cacheDir, common))
}

type workspace struct {
	repo *gitrepo.Repo
	ix   *index.Index
	opts Options

	layout frozenLayout
	cache  snapshotCache

	// warm is the first run, started with the Watcher by the first call
	// to Changes; both run until closing ends.
	warm       firstRun
	live       sync.Once
	liveErr    error
	hub        *hub
	closing    context.Context
	stop       context.CancelFunc
	background sync.WaitGroup

	parsedBlobs   atomic.Int64
	diffedCommits atomic.Int64
	hashedFiles   atomic.Int64
}

func (w *workspace) Stats() Stats {
	return Stats{
		ParsedBlobs: int(w.parsedBlobs.Load()), DiffedCommits: int(w.diffedCommits.Load()),
		HashedFiles: int(w.hashedFiles.Load()),
	}
}

func (w *workspace) Map(ctx context.Context, at State, q MapQuery) (MapView, error) {
	if q.Level < Packages || q.Level > Files {
		return MapView{}, fmt.Errorf("map: unknown level %v", q.Level)
	}
	snap, err := w.snapshot(ctx, at, w.warm.reached())
	if err != nil {
		return MapView{}, fmt.Errorf("map: %w", err)
	}
	if err := w.place(snap); err != nil {
		return MapView{}, fmt.Errorf("map: layout: %w", err)
	}
	mq := modules.Query{Level: modules.Level(q.Level), Within: q.Within, Tests: q.Tests}
	view := MapView{Level: q.Level, Modules: []Module{}, Dependencies: []Dependency{}}
	var nodes []modules.Node
	for _, n := range snap.tree.Nodes(mq) {
		p, _ := w.position(n.ID)
		m := Module{
			ID: n.ID, Level: Level(n.Level), Name: n.Name, Path: n.Path, Parent: n.Parent,
			Size: n.Size, Churn: n.Churn, Children: n.Children, Test: n.Test,
			X: p.X, Y: p.Y, Radius: Radius(Level(n.Level), n.Size),
		}
		if q.Viewport != nil && !inView(m, *q.Viewport) {
			continue
		}
		view.Modules = append(view.Modules, m)
		nodes = append(nodes, n)
	}
	for _, d := range snap.tree.Dependencies(mq, nodes, snap.deps) {
		view.Dependencies = append(view.Dependencies, Dependency{
			From: d.From, To: d.To, Kind: DependencyKind(d.Kind), Weight: d.Weight,
			Counts: KindCounts(d.Counts),
		})
	}
	return view, nil
}

func (w *workspace) Close() error {
	w.stop()
	w.background.Wait()
	w.hub.close()
	return errors.Join(w.repo.Close(), w.ix.Close())
}
