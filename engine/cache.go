package engine

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sync"
	"time"

	"github.com/TristanShz/whimc/internal/gitrepo"
	"github.com/TristanShz/whimc/internal/modules"
)

// The snapshots of States are kept in memory once built, so that a Map, a
// pan of its viewport or a Comparison does not list, read, hash and resolve
// the whole State again:
//
//   - a commit State never changes once its ref is resolved to a commit: its
//     snapshot is kept by commit hash, for the few commits last asked for;
//   - the working tree is revalidated File by File against the size and
//     modification time it had when last hashed, so that only the Files
//     written since are read and hashed again, and the snapshot is rebuilt
//     only when a File, the set of Files or HEAD changed. While the Watcher
//     runs, its Updates say which Files changed, and the working tree is not
//     even listed when nothing did.
//
// Both kinds are refreshed when the Churn clock moved by churnTolerance, as
// commits leave the Churn window. Snapshots of a first run under way are
// never kept: they lack Packages the first run has not reached.

// commitCacheSize is how many commit snapshots are kept.
const commitCacheSize = 4

// churnTolerance is how far the Churn clock may move before a kept snapshot
// counts its Churn again.
const churnTolerance = time.Hour

// racyWindow is how close to the moment it was hashed a File may have been
// modified for its stat to be trusted: a write landing within the timestamp
// granularity of the file system after the hash would go unseen otherwise.
const racyWindow = 2 * time.Second

// snapshotCache keeps the snapshots already built.
type snapshotCache struct {
	mu      sync.Mutex
	commits []keptSnapshot // the most recently used last

	worktree worktreeCache
}

type keptSnapshot struct {
	commit string
	snap   *snapshot
	at     time.Time // the Churn clock when it was built
}

func fresh(at, now time.Time) bool {
	d := now.Sub(at)
	return d < churnTolerance && d > -churnTolerance
}

// commit returns the kept snapshot of a commit, if fresh.
func (c *snapshotCache) commit(commit string, now time.Time) *snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, k := range c.commits {
		if k.commit == commit && fresh(k.at, now) {
			c.commits = append(slices.Delete(c.commits, i, i+1), k)
			return k.snap
		}
	}
	return nil
}

// keepCommit keeps the snapshot of a commit, forgetting the least recently
// used one beyond commitCacheSize.
func (c *snapshotCache) keepCommit(commit string, snap *snapshot, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.commits = slices.DeleteFunc(c.commits, func(k keptSnapshot) bool { return k.commit == commit })
	c.commits = append(c.commits, keptSnapshot{commit: commit, snap: snap, at: now})
	if len(c.commits) > commitCacheSize {
		c.commits = slices.Delete(c.commits, 0, len(c.commits)-commitCacheSize)
	}
}

// worktreeCache keeps what is known of the working tree.
type worktreeCache struct {
	// build lets one working-tree snapshot be built at a time, and guards
	// the kept snapshot.
	build   sync.Mutex
	snap    *snapshot
	blobs   map[string]string // the blob of every File snap was built from, configs included
	head    string            // the HEAD snap counted Churn from
	builtAt time.Time         // the Churn clock when snap was built

	// files holds the Files last hashed, by path.
	filesMu sync.Mutex
	files   map[string]hashedFile

	// marks are the Watcher's.
	marksMu  sync.Mutex
	watching bool            // the Watcher runs
	trusted  bool            // the Watcher ran since the last revalidation and lost no event
	dirty    map[string]bool // paths written since the last revalidation
	stale    bool            // HEAD moved, or an event was lost
}

// hashedFile is a working-tree File as last hashed.
type hashedFile struct {
	size, modTime int64
	hashedAt      int64 // Unix nanoseconds, wall clock
	blob          string
	// content is kept for the Files the snapshot needs the content of
	// (manifests and configs), which may be in no commit.
	content []byte
}

// unchanged reports whether the File still has the stat it had when hashed,
// and was modified long enough before that for the stat to tell.
func (h hashedFile) unchanged(f gitrepo.WorkTreeFile) bool {
	return h.size == f.Size && h.modTime == f.ModTime && h.hashedAt-f.ModTime >= int64(racyWindow)
}

// watch records that the Watcher runs: once the working tree is revalidated,
// its Updates are trusted to tell every change.
func (c *worktreeCache) watch() {
	c.marksMu.Lock()
	defer c.marksMu.Unlock()
	c.watching = true
}

// written marks paths the Watcher saw written, created or removed.
func (c *worktreeCache) written(paths []string) {
	c.marksMu.Lock()
	defer c.marksMu.Unlock()
	if c.dirty == nil {
		c.dirty = map[string]bool{}
	}
	for _, p := range paths {
		c.dirty[p] = true
	}
}

// invalidate marks the whole working tree for revalidation: HEAD moved, or
// the Watcher lost events.
func (c *worktreeCache) invalidate(lost bool) {
	c.marksMu.Lock()
	defer c.marksMu.Unlock()
	c.stale = true
	if lost {
		c.trusted = false
	}
}

// take returns and clears the marks, and whether the kept snapshot is
// trusted as it is.
func (c *worktreeCache) take() (dirty map[string]bool, trusted, watching bool) {
	c.marksMu.Lock()
	defer c.marksMu.Unlock()
	dirty, c.dirty = c.dirty, nil
	trusted = c.trusted && !c.stale && len(dirty) == 0
	c.stale = false
	return dirty, trusted, c.watching
}

// revalidated records a revalidation of the working tree; when the Watcher
// ran since it began, its Updates are trusted from now on.
func (c *worktreeCache) revalidated(watching bool) {
	c.marksMu.Lock()
	defer c.marksMu.Unlock()
	if watching {
		c.trusted = true
	}
}

// requeue puts marks taken by a revalidation that failed back.
func (c *worktreeCache) requeue(dirty map[string]bool) {
	c.marksMu.Lock()
	defer c.marksMu.Unlock()
	c.stale = true
	if c.dirty == nil {
		c.dirty = map[string]bool{}
	}
	maps.Copy(c.dirty, dirty)
}

// worktreeSnapshot returns the snapshot of the working tree, from the cache
// when nothing changed since it was built.
func (w *workspace) worktreeSnapshot(ctx context.Context, done reached) (*snapshot, error) {
	c := &w.cache.worktree
	c.build.Lock()
	defer c.build.Unlock()
	now := w.opts.Now()
	dirty, trusted, watching := c.take()
	keep := done == nil
	if keep && trusted && c.snap != nil && fresh(c.builtAt, now) {
		return c.snap, nil
	}
	snap, err := func() (*snapshot, error) {
		head, err := w.repo.Head(ctx)
		if err != nil {
			return nil, err
		}
		listed, err := w.repo.ListWorkTree(ctx)
		if err != nil {
			return nil, err
		}
		src, err := w.revalidate(ctx, listed, dirty)
		if err != nil {
			return nil, err
		}
		if keep && c.snap != nil && head == c.head && fresh(c.builtAt, now) && maps.Equal(src.blobs, c.blobs) {
			return c.snap, nil
		}
		snap, err := w.build(ctx, src, head, done)
		if err != nil {
			return nil, err
		}
		if keep && !snap.partial {
			c.snap, c.blobs, c.head, c.builtAt = snap, src.blobs, head, now
		}
		return snap, nil
	}()
	if err != nil {
		c.requeue(dirty)
		return nil, err
	}
	c.revalidated(watching)
	return snap, nil
}

// revalidate returns the source of the listed working-tree Files, hashing
// again only the Files whose stat changed since they were last hashed, and
// the dirty ones.
func (w *workspace) revalidate(ctx context.Context, listed []gitrepo.WorkTreeFile, dirty map[string]bool) (*worktreeSource, error) {
	src := &worktreeSource{
		repo: w.repo, cache: &w.cache.worktree,
		blobs: make(map[string]string, len(listed)), contents: map[string][]byte{},
	}
	for _, f := range listed {
		kind := modules.Classify(f.Path)
		if kind == modules.Ignored {
			continue
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		h, content, err := w.hashWorkTree(f, dirty[f.Path])
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", f.Path, err)
		}
		if content == nil {
			content = h.content
		}
		src.order = append(src.order, f.Path)
		src.blobs[f.Path] = h.blob
		if content != nil {
			src.contents[f.Path] = content
		}
	}
	w.forgetGone(src.blobs)
	return src, nil
}

// hashWorkTree returns a working-tree File as hashed, hashing it again when
// its stat changed since, or when force is set. The content is returned when
// the File was read.
func (w *workspace) hashWorkTree(f gitrepo.WorkTreeFile, force bool) (hashedFile, []byte, error) {
	c := &w.cache.worktree
	c.filesMu.Lock()
	h, ok := c.files[f.Path]
	c.filesMu.Unlock()
	if ok && !force && h.unchanged(f) {
		return h, nil, nil
	}
	hashedAt := time.Now().UnixNano()
	content, blob, err := w.repo.ReadWorkTree(f.Path)
	if err != nil {
		return hashedFile{}, nil, err
	}
	w.hashedFiles.Add(1)
	h = hashedFile{size: f.Size, modTime: f.ModTime, hashedAt: hashedAt, blob: blob}
	if modules.Classify(f.Path) != modules.SourceFile {
		h.content = content
	}
	c.filesMu.Lock()
	if c.files == nil {
		c.files = map[string]hashedFile{}
	}
	c.files[f.Path] = h
	c.filesMu.Unlock()
	return h, content, nil
}

// forgetGone forgets the hashed Files no longer in the working tree.
func (w *workspace) forgetGone(present map[string]string) {
	c := &w.cache.worktree
	c.filesMu.Lock()
	defer c.filesMu.Unlock()
	maps.DeleteFunc(c.files, func(p string, _ hashedFile) bool {
		_, ok := present[p]
		return !ok
	})
}

// commitSnapshot returns the snapshot of a commit State, from the cache when
// it was built recently.
func (w *workspace) commitSnapshot(ctx context.Context, ref string, done reached) (*snapshot, error) {
	commit, err := w.repo.ResolveCommit(ctx, ref)
	if err != nil {
		return nil, err
	}
	now := w.opts.Now()
	if done == nil {
		if snap := w.cache.commit(commit, now); snap != nil {
			return snap, nil
		}
	}
	src, err := newCommitSource(ctx, w.repo, commit)
	if err != nil {
		return nil, err
	}
	snap, err := w.build(ctx, src, commit, done)
	if err != nil {
		return nil, err
	}
	if done == nil && !snap.partial {
		w.cache.keepCommit(commit, snap, now)
	}
	return snap, nil
}
