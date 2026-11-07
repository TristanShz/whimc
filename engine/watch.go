package engine

import (
	"context"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/TristanShz/whimc/internal/modules"
)

// maxDelayFactor bounds how long a stream of writes that never pauses holds
// its Update back: this many debounce periods after its first write.
const maxDelayFactor = 8

// watcher is the Watcher: it watches the folders of the working tree
// (recursively, leaving the git directory, ignored and vendored folders out)
// and the HEAD of the repository, and reports bursts of writes in one
// Update each.
type watcher struct {
	ws      *workspace
	fs      *fsnotify.Watcher
	gitDir  string
	watched map[string]bool // repository-relative folders
}

// watch starts watching the working tree.
func (w *workspace) watch(ctx context.Context) (*watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	gitDir, err := w.repo.GitDir(ctx)
	if err != nil {
		fsw.Close()
		return nil, err
	}
	wt := &watcher{ws: w, fs: fsw, gitDir: gitDir, watched: map[string]bool{}}
	paths, err := w.repo.ListWorkTree(ctx)
	if err != nil {
		fsw.Close()
		return nil, err
	}
	dirs := map[string]bool{".": true}
	for _, p := range paths {
		for d := path.Dir(p); !dirs[d]; d = path.Dir(d) {
			dirs[d] = true
		}
	}
	for d := range dirs {
		wt.add(d)
	}
	// HEAD moves are written to the HEAD file (a checkout) and to its log
	// (a commit, a reset); the rest of the git directory is left alone.
	fsw.Add(gitDir)
	fsw.Add(filepath.Join(gitDir, "logs"))
	return wt, nil
}

// add watches a repository-relative folder, unless it holds nothing for the
// Map.
func (wt *watcher) add(dir string) bool {
	if wt.watched[dir] || dir != "." && modules.ExcludedFolder(dir) {
		return false
	}
	// A folder that cannot be watched (gone, or out of file descriptors) is
	// left out: the rest of the working tree is still watched.
	if err := wt.fs.Add(wt.abs(dir)); err != nil {
		return false
	}
	wt.watched[dir] = true
	return true
}

func (wt *watcher) abs(rel string) string {
	return filepath.Join(wt.ws.repo.Root(), filepath.FromSlash(rel))
}

// rel returns the repository-relative slash path of an absolute one, or false
// when it is outside the working tree.
func (wt *watcher) rel(abs string) (string, bool) {
	r, err := filepath.Rel(wt.ws.repo.Root(), abs)
	if err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(r), true
}

// run reports the writes until ctx ends.
func (wt *watcher) run(ctx context.Context) {
	defer wt.fs.Close()
	debounce := wt.ws.opts.Debounce
	pending := map[string]bool{}
	headMoved := false
	var first time.Time
	timer := time.NewTimer(time.Hour)
	timer.Stop()
	arm := func() {
		now := time.Now()
		if first.IsZero() {
			first = now
		}
		wait := min(debounce, first.Add(maxDelayFactor*debounce).Sub(now))
		timer.Reset(max(wait, 0))
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-wt.fs.Errors:
			// An overflowing event queue loses events: the next ones still
			// come, and a Map always reads the working tree as it is.
		case e, ok := <-wt.fs.Events:
			if !ok {
				return
			}
			if wt.head(e) {
				headMoved = true
				arm()
				continue
			}
			if wt.note(e, pending) {
				arm()
			}
		case <-timer.C:
			first = time.Time{}
			paths := wt.flush(ctx, pending)
			pending = map[string]bool{}
			if len(paths) > 0 {
				wt.ws.hub.publish(Update{Kind: FilesChanged, Paths: paths})
			}
			if headMoved {
				headMoved = false
				wt.ws.hub.publish(Update{Kind: HeadMoved})
			}
		}
	}
}

// head reports whether an event of the git directory moved HEAD.
func (wt *watcher) head(e fsnotify.Event) bool {
	dir, base := filepath.Split(e.Name)
	dir = filepath.Clean(dir)
	if dir != wt.gitDir && dir != filepath.Join(wt.gitDir, "logs") {
		return false
	}
	return base == "HEAD" && !e.Has(fsnotify.Chmod)
}

// note records an event of the working tree among the pending paths, and
// reports whether it matters to the Map.
func (wt *watcher) note(e fsnotify.Event, pending map[string]bool) bool {
	if e.Op == fsnotify.Chmod {
		return false
	}
	p, ok := wt.rel(e.Name)
	if !ok || p == "." {
		return false
	}
	if e.Has(fsnotify.Create) {
		if info, err := os.Lstat(e.Name); err == nil && info.IsDir() {
			return wt.addTree(p, pending)
		}
	}
	if wt.watched[p] && (e.Has(fsnotify.Remove) || e.Has(fsnotify.Rename)) {
		// A watched folder gone: the Files under it went with it.
		for d := range wt.watched {
			if d == p || strings.HasPrefix(d, p+"/") {
				delete(wt.watched, d)
			}
		}
		pending[p] = true
		return true
	}
	if modules.Classify(p) == modules.Ignored {
		return false
	}
	pending[p] = true
	return true
}

// addTree watches a folder just created and every folder under it, and
// records the Files already in it: they may have been written before the
// watch began.
func (wt *watcher) addTree(dir string, pending map[string]bool) bool {
	if !wt.add(dir) {
		return false
	}
	found := false
	filepath.WalkDir(wt.abs(dir), func(abs string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		p, ok := wt.rel(abs)
		if !ok {
			return nil
		}
		if d.IsDir() {
			if p != dir && !wt.add(p) {
				return filepath.SkipDir
			}
			return nil
		}
		if modules.Classify(p) != modules.Ignored {
			pending[p] = true
			found = true
		}
		return nil
	})
	return found
}

// flush drops the pending paths git ignores, parses the Files written so
// that the next Map finds them in the index, and returns the paths left,
// sorted.
func (wt *watcher) flush(ctx context.Context, pending map[string]bool) []string {
	paths := make([]string, 0, len(pending))
	for p := range pending {
		paths = append(paths, p)
	}
	slices.Sort(paths)
	if ignored, err := wt.ws.repo.Ignored(ctx, paths); err == nil {
		paths = slices.DeleteFunc(paths, func(p string) bool { return ignored[p] })
	}
	// While the first run is under way, it parses each Package in turn.
	if len(paths) > 0 && wt.ws.warm.reached() == nil {
		wt.ws.parseWorkTree(ctx, paths)
	}
	return paths
}
