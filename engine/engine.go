// Package engine indexes a repository and answers the questions the Map asks:
// which Modules exist at a level, how big they are, and what changed between
// two States. It is the only public surface of whimc's analysis; the CLI and
// the HTTP layer are thin shells over Workspace.
package engine

import (
	"context"
	"errors"
	"fmt"

	"github.com/TristanShz/whimc/internal/gitrepo"
	"github.com/TristanShz/whimc/internal/modules"
)

var (
	// ErrGitNotFound reports that no git executable is on PATH.
	ErrGitNotFound = gitrepo.ErrGitNotFound
	// ErrNotARepository reports that the path given to Open is not inside a git work tree.
	ErrNotARepository = gitrepo.ErrNotARepository
	// ErrNotImplemented reports a part of the engine that is not built yet.
	ErrNotImplemented = errors.New("not implemented yet")
)

// State is a state of the codebase: a commit, branch or tag, or the working
// tree when Ref is empty. The working tree holds the Files as on disk, tracked
// and untracked-but-not-ignored.
type State struct{ Ref string }

// Workspace is an opened repository.
type Workspace interface {
	// Map returns the Modules of one level.
	Map(ctx context.Context, at State, q MapQuery) (MapView, error)
	// Compare returns what differs between two States, File by File,
	// aggregated per Directory and Package.
	Compare(ctx context.Context, base, target State) (Comparison, error)
	// Changes streams index updates (first run progress, working-tree edits).
	Changes(ctx context.Context) (<-chan Update, error)
	// Close releases the git processes held by the Workspace.
	Close() error
}

// Options tunes a Workspace. The zero value is the default.
type Options struct{}

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

// Rect is an area of the Map, in map coordinates.
type Rect struct{ X0, Y0, X1, Y1 float64 }

// MapQuery selects the Modules a Map call returns.
type MapQuery struct {
	Level Level
	// Within is an optional Module, given by ID (`pkg:…`, `dir:…`) or by path:
	// only its descendants are returned. A bare path names the Package at that
	// path when there is one, the Directory otherwise.
	Within string
	// Viewport optionally keeps only what is in view, for very large levels.
	Viewport *Rect
	// Tests includes test Files; when false, test Files are left out of every
	// Module, and Modules left without Files disappear.
	Tests bool
}

// MapView is the answer to a Map call.
type MapView struct {
	Level   Level
	Modules []Module
}

// Module is a node of the Map: a Package, a Directory or a File.
type Module struct {
	// ID is unique across levels: `pkg:<path>`, `dir:<path>` or `file:<path>`.
	ID    string
	Level Level
	Name  string
	// Path is the repository-relative slash path; "." is the repository root.
	Path string
	// Parent is the ID of the enclosing Module, empty for a Package.
	Parent string
	// Size is the number of non-blank lines, summed over the Module's Files.
	Size int
	// Children is the number of Modules one level down.
	Children int
	// Test is set on test Files.
	Test bool
}

// Comparison is what differs between two States.
type Comparison struct {
	Base, Target State
}

// Update is a change of the index pushed by Changes.
type Update struct{}

// Open opens the repository containing repoPath.
func Open(ctx context.Context, repoPath string, opts Options) (Workspace, error) {
	repo, err := gitrepo.Open(ctx, repoPath)
	if err != nil {
		return nil, err
	}
	return &workspace{repo: repo, opts: opts}, nil
}

type workspace struct {
	repo *gitrepo.Repo
	opts Options
}

func (w *workspace) Map(ctx context.Context, at State, q MapQuery) (MapView, error) {
	if q.Level < Packages || q.Level > Files {
		return MapView{}, fmt.Errorf("map: unknown level %v", q.Level)
	}
	if q.Viewport != nil {
		return MapView{}, fmt.Errorf("map: viewport filtering comes with the layout: %w", ErrNotImplemented)
	}
	tree, err := w.tree(ctx, at)
	if err != nil {
		return MapView{}, fmt.Errorf("map: %w", err)
	}
	nodes := tree.Nodes(modules.Query{Level: modules.Level(q.Level), Within: q.Within, Tests: q.Tests})
	view := MapView{Level: q.Level, Modules: make([]Module, len(nodes))}
	for i, n := range nodes {
		view.Modules[i] = Module{
			ID: n.ID, Level: Level(n.Level), Name: n.Name, Path: n.Path, Parent: n.Parent,
			Size: n.Size, Children: n.Children, Test: n.Test,
		}
	}
	return view, nil
}

func (w *workspace) Compare(ctx context.Context, base, target State) (Comparison, error) {
	return Comparison{}, fmt.Errorf("compare: %w", ErrNotImplemented)
}

func (w *workspace) Changes(ctx context.Context) (<-chan Update, error) {
	return nil, fmt.Errorf("changes: %w", ErrNotImplemented)
}

func (w *workspace) Close() error { return w.repo.Close() }
