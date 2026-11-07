package engine

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sync"

	"github.com/TristanShz/whimc/internal/index"
	"github.com/TristanShz/whimc/internal/modules"
	"github.com/TristanShz/whimc/internal/parse"
)

// UpdateKind is what an Update reports.
type UpdateKind string

const (
	// StructureIndexed: the first run knows the Packages, Directories and
	// Files of the working tree, and their Size. Total is the number of
	// Packages it goes on to index.
	StructureIndexed UpdateKind = "structure"
	// PackageIndexed: the first run resolved the Dependencies and counted
	// the Churn of one more Package. Done Packages of Total are indexed.
	PackageIndexed UpdateKind = "package"
	// Indexed: the first run is over, every Package is indexed and the
	// layout is frozen.
	Indexed UpdateKind = "indexed"
	// FilesChanged: Files of the working tree were written, created or
	// removed.
	FilesChanged UpdateKind = "files"
	// HeadMoved: HEAD points at another commit (a commit, a checkout, a
	// reset), so the history behind the working tree changed.
	HeadMoved UpdateKind = "head"
)

// Update is a change of the index pushed by Changes: progress of the first
// run, or an edit of the working tree. Whatever the kind, a Map or a
// Comparison asked for after it reflects it.
type Update struct {
	Kind UpdateKind `json:"kind"`
	// Package is the ID of the Package a PackageIndexed Update is about.
	Package string `json:"package,omitempty"`
	// Done and Total count the Packages indexed by the first run, on its
	// Updates.
	Done  int `json:"done,omitempty"`
	Total int `json:"total,omitempty"`
	// Paths are the repository-relative paths a FilesChanged Update is
	// about, sorted: Files, or folders created or removed whole.
	Paths []string `json:"paths,omitempty"`
}

// progress reports whether the Update is about the first run.
func (u Update) progress() bool {
	return u.Kind == StructureIndexed || u.Kind == PackageIndexed || u.Kind == Indexed
}

// firstRun tracks the first run: which Packages it reached.
type firstRun struct {
	mu      sync.Mutex
	running bool
	done    map[string]bool // by Package folder
}

// reached returns which Packages are indexed as of now: nil (all of them)
// unless the first run is under way.
func (f *firstRun) reached() reached {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.running {
		return nil
	}
	done := maps.Clone(f.done)
	return func(pkg string) bool { return done[pkg] }
}

func (f *firstRun) begin() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.running, f.done = true, map[string]bool{}
}

func (f *firstRun) reach(pkg string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.done[pkg] = true
}

func (f *firstRun) end() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.running, f.done = false, nil
}

// Changes streams the Updates of the index until ctx ends or the Workspace
// closes. The first call starts the first run and the Watcher; a later
// subscriber first receives the latest progress of the first run.
func (w *workspace) Changes(ctx context.Context) (<-chan Update, error) {
	w.live.Do(func() { w.liveErr = w.startLive() })
	if w.liveErr != nil {
		return nil, fmt.Errorf("changes: %w", w.liveErr)
	}
	return w.hub.subscribe(ctx), nil
}

// startLive starts the Watcher and, behind it, the first run.
func (w *workspace) startLive() error {
	ctx := w.closing
	wt, err := w.watch(ctx)
	if err != nil {
		return err
	}
	w.background.Go(func() { wt.run(ctx) })
	w.background.Go(func() { w.index(ctx) })
	return nil
}

// index is the first run: the structure of the working tree, then its
// Packages one by one, each with its Dependencies and Churn, reported on
// Changes as it goes. Maps asked for meanwhile show what it reached.
func (w *workspace) index(ctx context.Context) {
	w.warm.begin()
	total, done := 0, 0
	defer func() {
		// Also when it failed: the Maps asked for then parse what they show,
		// and report what fails.
		w.warm.end()
		w.dropDraft()
		if ctx.Err() == nil {
			w.hub.publish(Update{Kind: Indexed, Done: done, Total: total})
		}
	}()
	nothing := func(string) bool { return false }
	snap, err := w.snapshot(ctx, State{}, nothing)
	if err != nil {
		return // the Maps asked for will report it
	}
	if err := w.place(snap); err != nil {
		return
	}
	pkgs := snap.tree.Nodes(modules.Query{Level: modules.Packages, Tests: true})
	total = len(pkgs)
	w.hub.publish(Update{Kind: StructureIndexed, Total: len(pkgs)})
	byPkg := map[string][]string{}
	for _, f := range snap.unparsed {
		byPkg[f.pkg] = append(byPkg[f.pkg], f.path)
	}
	for i, p := range pkgs {
		if err := w.parseWorkTree(ctx, byPkg[p.Path]); err != nil {
			return
		}
		w.warm.reach(p.Path)
		done = i + 1
		w.hub.publish(Update{Kind: PackageIndexed, Package: p.ID, Done: i + 1, Total: len(pkgs)})
	}
	w.warm.end()
	// Every Dependency known, the layout is frozen.
	full, err := w.snapshot(ctx, State{}, nil)
	if err != nil {
		return
	}
	w.dropDraft()
	w.place(full) // a failure shows on the next Map, which places again
}

// parseWorkTree parses the working-tree Files at paths whose blob the index
// does not know yet, and stores them in the index. Files gone are skipped.
func (w *workspace) parseWorkTree(ctx context.Context, paths []string) error {
	type read struct {
		path    string
		key     index.BlobKey
		content []byte
	}
	var reads []read
	keys := make([]index.BlobKey, 0, len(paths))
	for _, p := range paths {
		if modules.Classify(p) != modules.SourceFile {
			continue
		}
		content, blob, err := w.repo.ReadWorkTree(p)
		if err != nil {
			continue // removed or unreadable since: the next Map tells
		}
		k := index.BlobKey{Blob: blob, Grammar: parse.Grammar(p)}
		reads = append(reads, read{p, k, content})
		keys = append(keys, k)
	}
	known, err := w.ix.Blobs(keys)
	if err != nil {
		return fmt.Errorf("index: %w", err)
	}
	learnt := map[index.BlobKey]index.Blob{}
	for _, r := range reads {
		if _, ok := known[r.key]; ok {
			continue
		}
		if _, ok := learnt[r.key]; ok {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		facts := modules.Analyze(r.content)
		b := index.Blob{Size: facts.Size, Generated: facts.Generated}
		if !facts.Generated {
			res := parse.File(r.path, r.content)
			w.parsedBlobs.Add(1)
			b.Parse = &res
		}
		learnt[r.key] = b
	}
	if err := w.ix.PutBlobs(learnt); err != nil {
		return fmt.Errorf("index: %w", err)
	}
	return nil
}

// hub fans the Updates out to every subscriber of Changes, each with its own
// unbounded queue, so that a slow reader never holds the engine up nor
// misses the end of the first run.
type hub struct {
	mu        sync.Mutex
	subs      map[*subscriber]bool
	latest    *Update // the latest progress of the first run
	closed    chan struct{}
	closeOnce sync.Once
}

type subscriber struct {
	queue []Update
	wake  chan struct{}
}

func newHub() *hub { return &hub{subs: map[*subscriber]bool{}, closed: make(chan struct{})} }

func (h *hub) publish(u Update) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if u.progress() {
		h.latest = &u
	}
	for s := range h.subs {
		s.queue = append(s.queue, u)
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
}

func (h *hub) subscribe(ctx context.Context) <-chan Update {
	s := &subscriber{wake: make(chan struct{}, 1)}
	h.mu.Lock()
	if h.latest != nil {
		s.queue = append(s.queue, *h.latest)
	}
	h.subs[s] = true
	h.mu.Unlock()

	out := make(chan Update)
	go func() {
		defer close(out)
		defer func() {
			h.mu.Lock()
			delete(h.subs, s)
			h.mu.Unlock()
		}()
		for {
			h.mu.Lock()
			var next *Update
			if len(s.queue) > 0 {
				u := s.queue[0]
				s.queue = slices.Delete(s.queue, 0, 1)
				next = &u
			}
			h.mu.Unlock()
			if next == nil {
				select {
				case <-s.wake:
					continue
				case <-ctx.Done():
					return
				case <-h.closed:
					return
				}
			}
			select {
			case out <- *next:
			case <-ctx.Done():
				return
			case <-h.closed:
				return
			}
		}
	}()
	return out
}

func (h *hub) close() { h.closeOnce.Do(func() { close(h.closed) }) }
