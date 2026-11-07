package engine_test

import (
	"os"
	"testing"
	"time"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// settle dates every File of files an hour back, as Files written long before
// whimc runs: their stat is then trusted to tell whether they changed.
func settle(t *testing.T, r *testrepo.Repo, files map[string]string) {
	t.Helper()
	past := time.Now().Add(-time.Hour)
	for rel := range files {
		if err := os.Chtimes(r.Path(rel), past, past); err != nil {
			t.Fatalf("chtimes %s: %v", rel, err)
		}
	}
}

func hashed(ws engine.Workspace) int { return ws.Stats().HashedFiles }

func TestASecondMapOfAnUnchangedWorkingTreeHashesNoFile(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.CommitAt("initial", daysAgo(3))
	settle(t, r, shop)
	ws := openAt(t, r, engine.Options{})

	want := everything(t, ws, worktree)
	if got := hashed(ws); got != len(shop) {
		t.Fatalf("the first Map hashed %d Files, want %d", got, len(shop))
	}
	assertLines(t, everything(t, ws, worktree), want...)
	if got := hashed(ws); got != len(shop) {
		t.Errorf("Maps of an unchanged working tree hashed %d Files, want %d", got, len(shop))
	}
}

func TestAnEditOfTheWorkingTreeIsSeenWithoutTheWatcher(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.CommitAt("initial", daysAgo(3))
	settle(t, r, shop)
	ws := openAt(t, r, engine.Options{})
	mapOf(t, ws, worktree, fileLevel)

	r.Write("src/price.ts", "export const price = 1\nexport const tax = 2\n")
	r.Write("src/new.ts", "export const fresh = 1\n")
	r.Remove("src/checkout.ts")
	assertLines(t, mapOf(t, ws, worktree, fileLevel),
		"file:src/cart.ts name=cart.ts parent=dir:src size=2 children=0",
		"file:src/new.ts name=new.ts parent=dir:src size=1 children=0",
		"file:src/price.ts name=price.ts parent=dir:src size=2 children=0",
	)
	if got := hashed(ws); got != len(shop)+2 {
		t.Errorf("hashed %d Files, want %d: only the edited and the new one again", got, len(shop)+2)
	}
	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)
	assertLines(t, changesOf(t, c, engine.Files),
		"removed file:src/checkout.ts +0 ~0 -1",
		"added file:src/new.ts +1 ~0 -0",
		"modified file:src/price.ts +0 ~1 -0",
	)
}

func TestWhileTheWatcherRunsAMapOfAnUnchangedWorkingTreeHashesNoFile(t *testing.T) {
	r := liveRepo(t)
	ws := openAt(t, r, engine.Options{})
	updates := subscribe(t, ws)
	untilIndexed(t, updates)
	mapOf(t, ws, worktree, fileLevel)
	before := hashed(ws)

	mapOf(t, ws, worktree, fileLevel)
	compare(t, ws, engine.State{Ref: "HEAD"}, worktree)
	if got := hashed(ws); got != before {
		t.Errorf("Maps of an unchanged working tree hashed %d Files", got-before)
	}

	r.Write("src/a.ts", "export const a = 1\nexport const z = 2\n")
	changedFiles(t, updates, "src/a.ts")
	assertLines(t, mapOf(t, ws, worktree, engine.MapQuery{Level: engine.Files, Within: "pkg:."}),
		"file:src/a.ts name=a.ts parent=dir:src size=2 children=0",
	)
}
