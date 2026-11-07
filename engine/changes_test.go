package engine_test

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// patience bounds every wait on Changes: generous, as the Watcher depends on
// the machine's file events.
const patience = 15 * time.Second

// subscribe returns the Updates of ws, until the end of the test.
func subscribe(t *testing.T, ws engine.Workspace) <-chan engine.Update {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	updates, err := ws.Changes(ctx)
	if err != nil {
		t.Fatalf("Changes: %v", err)
	}
	return updates
}

// next returns the next Update.
func next(t *testing.T, updates <-chan engine.Update) engine.Update {
	t.Helper()
	select {
	case u, ok := <-updates:
		if !ok {
			t.Fatal("Changes closed")
		}
		return u
	case <-time.After(patience):
		t.Fatalf("no Update within %s", patience)
	}
	return engine.Update{}
}

// untilIndexed returns the Updates up to the end of the first run.
func untilIndexed(t *testing.T, updates <-chan engine.Update) []engine.Update {
	t.Helper()
	var got []engine.Update
	for {
		u := next(t, updates)
		got = append(got, u)
		if u.Kind == engine.Indexed {
			return got
		}
	}
}

// changedFiles returns the FilesChanged Updates until every path of want was
// reported.
func changedFiles(t *testing.T, updates <-chan engine.Update, want ...string) []engine.Update {
	t.Helper()
	missing := map[string]bool{}
	for _, p := range want {
		missing[p] = true
	}
	var got []engine.Update
	for len(missing) > 0 {
		u := next(t, updates)
		if u.Kind != engine.FilesChanged {
			continue
		}
		got = append(got, u)
		for _, p := range u.Paths {
			delete(missing, p)
		}
	}
	return got
}

func liveRepo(t *testing.T) *testrepo.Repo {
	t.Helper()
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		".gitignore":            "secret/\n*.gen.ts\n",
		"package.json":          `{"name":"root"}`,
		"src/a.ts":              "export const a = 1\n",
		"apps/web/package.json": `{"name":"web"}`,
		"apps/web/main.ts":      "import { a } from '../../src/a'\nconsole.log(a)\n",
		"libs/ui/package.json":  `{"name":"ui"}`,
		"libs/ui/button.ts":     "export const b = 2\n",
	})
	r.CommitAt("init", daysAgo(1))
	return r
}

func TestTheFirstRunReportsTheStructureThenEachPackageInOrder(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})

	got := untilIndexed(t, subscribe(t, ws))

	var lines []string
	for _, u := range got {
		lines = append(lines, string(u.Kind)+" "+u.Package+" "+strconv.Itoa(u.Done)+"/"+strconv.Itoa(u.Total))
	}
	assertLines(t, lines,
		"structure  0/3",
		"package pkg:. 1/3",
		"package pkg:apps/web 2/3",
		"package pkg:libs/ui 3/3",
		"indexed  3/3",
	)
	if deps := depsOf(t, ws, engine.State{}, engine.MapQuery{Level: engine.Files}); len(deps) != 1 {
		t.Errorf("Dependencies after the first run = %q, want the one import", deps)
	}
}

func TestALateSubscriberLearnsWhereTheFirstRunIs(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})
	untilIndexed(t, subscribe(t, ws))

	if u := next(t, subscribe(t, ws)); u.Kind != engine.Indexed || u.Done != 3 {
		t.Errorf("first Update of a late subscriber = %+v, want the end of the first run", u)
	}
}

func TestAnEditOfTheWorkingTreeIsPushedAndTheNextMapShowsIt(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})
	updates := subscribe(t, ws)
	untilIndexed(t, updates)
	parsed := ws.Stats().ParsedBlobs

	r.Write("libs/ui/button.ts", "export const b = 2\nexport const c = 3\n")
	r.Write("libs/ui/new/icon.ts", "import { b } from '../button'\n")
	got := changedFiles(t, updates, "libs/ui/button.ts", "libs/ui/new/icon.ts")

	if u := got[len(got)-1]; !slices.IsSorted(u.Paths) {
		t.Errorf("paths %q are not sorted", u.Paths)
	}
	if ws.Stats().ParsedBlobs == parsed {
		t.Error("the Watcher parsed no File written")
	}
	assertLines(t, mapOf(t, ws, engine.State{}, engine.MapQuery{Level: engine.Files, Within: "pkg:libs/ui"}),
		"file:libs/ui/button.ts name=button.ts parent=dir:libs/ui size=2 children=0",
		"file:libs/ui/new/icon.ts name=icon.ts parent=dir:libs/ui/new size=1 children=0",
	)
	before := ws.Stats().ParsedBlobs
	depsOf(t, ws, engine.State{}, engine.MapQuery{Level: engine.Files})
	if after := ws.Stats().ParsedBlobs; after != before {
		t.Errorf("the Map parsed %d blobs the Watcher had parsed already", after-before)
	}
}

func TestABurstOfWritesComesInFewerUpdates(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})
	updates := subscribe(t, ws)
	untilIndexed(t, updates)

	const writes = 30
	var paths []string
	for i := range writes {
		p := "src/burst" + strconv.Itoa(i%10) + ".ts"
		r.Write(p, strings.Repeat("export const x = 1\n", i+1))
		paths = append(paths, p)
	}
	got := changedFiles(t, updates, paths...)

	if len(got) >= writes {
		t.Errorf("%d writes came in %d Updates, want fewer", writes, len(got))
	}
}

func TestIgnoredAndVendoredWritesAreNotReported(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})
	updates := subscribe(t, ws)
	untilIndexed(t, updates)

	r.Write("src/types.gen.ts", "export {}\n")
	r.Write("secret/key.ts", "export {}\n")
	r.Write("node_modules/dep/index.js", "module.exports = 1\n")
	r.Write("src/notes.txt", "not a source File\n")
	r.Write("src/b.ts", "export const b = 1\n")
	got := changedFiles(t, updates, "src/b.ts")

	for _, u := range got {
		for _, p := range u.Paths {
			if p != "src/b.ts" {
				t.Errorf("reported %s, which the Map leaves out", p)
			}
		}
	}
}

func TestARemovedFileIsReported(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})
	updates := subscribe(t, ws)
	untilIndexed(t, updates)

	r.Remove("libs/ui/button.ts")
	changedFiles(t, updates, "libs/ui/button.ts")

	if ms := ids(t, ws, engine.State{}, engine.MapQuery{Level: engine.Files}); slices.Contains(ms, "file:libs/ui/button.ts") {
		t.Errorf("Map after the removal = %q", ms)
	}
}

func TestACommitMovesHEAD(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})
	updates := subscribe(t, ws)
	untilIndexed(t, updates)

	r.Write("src/a.ts", "export const a = 2\n")
	r.CommitAt("edit", daysAgo(0))
	for u := next(t, updates); u.Kind != engine.HeadMoved; u = next(t, updates) {
	}
}

func TestChangesEndsWithItsContext(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})
	ctx, cancel := context.WithCancel(context.Background())
	updates, err := ws.Changes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	deadline := time.After(patience)
	for {
		select {
		case _, ok := <-updates:
			if !ok {
				return
			}
		case <-deadline:
			t.Fatal("Changes still open after its context ended")
		}
	}
}

func TestTheFirstRunFreezesTheLayoutTheDependenciesGive(t *testing.T) {
	plain := testrepo.New(t)
	plain.WriteFiles(monorepo)
	plain.Commit("init")
	live := testrepo.New(t)
	live.WriteFiles(monorepo)
	live.Commit("init")
	direct := layoutOf(t, open(t, plain), engine.State{})

	ws := open(t, live)
	untilIndexed(t, subscribe(t, ws))

	assertUnmoved(t, direct, layoutOf(t, ws, engine.State{}))
}
