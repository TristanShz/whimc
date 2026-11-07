package engine_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// now is the clock of the Churn tests: every commit date is relative to it.
var now = time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

func daysAgo(n int) time.Time { return now.AddDate(0, 0, -n) }

// openAt opens the fixture repository with the Churn clock set to now.
func openAt(t *testing.T, r *testrepo.Repo, opts engine.Options) engine.Workspace {
	t.Helper()
	opts.Now = func() time.Time { return now }
	return openWith(t, r, opts)
}

// churnOf returns the Churn of a level as one "<id> churn=<n>" line per Module.
func churnOf(t *testing.T, ws engine.Workspace, at engine.State, q engine.MapQuery) []string {
	t.Helper()
	view, err := ws.Map(context.Background(), at, q)
	if err != nil {
		t.Fatalf("Map(%+v, %+v): %v", at, q, err)
	}
	lines := []string{}
	for _, m := range view.Modules {
		lines = append(lines, fmt.Sprintf("%s churn=%d", m.ID, m.Churn))
	}
	return lines
}

func TestChurnCountsTheCommitsWithinTheLast90Days(t *testing.T) {
	r := testrepo.New(t)
	r.Write("package.json", `{"name": "app"}`)
	r.Write("src/cart.ts", "v1\n")
	r.Write("src/quiet.ts", "quiet\n")
	r.CommitAt("long ago", daysAgo(200))
	r.Write("src/cart.ts", "v2\n")
	r.CommitAt("just outside the window", daysAgo(91))
	r.Write("src/cart.ts", "v3\n")
	r.CommitAt("just inside the window", daysAgo(89))
	r.Write("src/cart.ts", "v4\n")
	r.CommitAt("yesterday", daysAgo(1))
	r.Write("package.json", `{"name": "app", "version": "1.0.0"}`)
	r.CommitAt("a commit touching no File", daysAgo(1))

	ws := openAt(t, r, engine.Options{})
	assertLines(t, churnOf(t, ws, worktree, fileLevel),
		"file:src/cart.ts churn=2",
		"file:src/quiet.ts churn=0",
	)

	short := openAt(t, r, engine.Options{ChurnWindow: 30 * 24 * time.Hour})
	assertLines(t, churnOf(t, short, worktree, fileLevel),
		"file:src/cart.ts churn=1",
		"file:src/quiet.ts churn=0",
	)
}

func TestChurnOfACommitStateCountsTheHistoryBehindIt(t *testing.T) {
	r := testrepo.New(t)
	r.Write("src/cart.ts", "v1\n")
	r.CommitAt("first", daysAgo(10))
	r.Write("src/cart.ts", "v2\n")
	second := r.CommitAt("second", daysAgo(5))
	r.Write("src/cart.ts", "v3\n")
	r.CommitAt("third", daysAgo(2))
	r.Write("src/cart.ts", "uncommitted\n")

	ws := openAt(t, r, engine.Options{})
	assertLines(t, churnOf(t, ws, engine.State{Ref: second}, fileLevel), "file:src/cart.ts churn=2")
	assertLines(t, churnOf(t, ws, engine.State{Ref: "main"}, fileLevel), "file:src/cart.ts churn=3")
	// Uncommitted edits are not commits: the working tree counts HEAD's history.
	assertLines(t, churnOf(t, ws, worktree, fileLevel), "file:src/cart.ts churn=3")
}

func TestChurnFollowsRenames(t *testing.T) {
	r := testrepo.New(t)
	body := "export function total(items: number[]): number {\n\treturn items.reduce((a, b) => a + b, 0)\n}\n"
	r.Write("src/sum.ts", body)
	r.CommitAt("add sum", daysAgo(30))
	r.Write("src/sum.ts", body+"export const zero = 0\n")
	r.CommitAt("edit sum", daysAgo(20))
	r.Rename("src/sum.ts", "src/total.ts")
	r.CommitAt("rename sum to total", daysAgo(10))
	r.Write("src/total.ts", body+"export const zero = 0\nexport const one = 1\n")
	r.CommitAt("edit total", daysAgo(5))
	// A new File reusing the old path has a history of its own.
	r.Write("src/sum.ts", "export const sum = 1\n")
	r.CommitAt("a new sum", daysAgo(1))

	ws := openAt(t, r, engine.Options{})
	assertLines(t, churnOf(t, ws, worktree, fileLevel),
		"file:src/sum.ts churn=1",
		"file:src/total.ts churn=4",
	)
}

func TestDirectoryAndPackageChurnCountDistinctCommits(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":       `{"name": "app"}`,
		"src/cart/a.ts":      "a1\n",
		"src/cart/b.ts":      "b1\n",
		"src/cart/c.ts":      "c1\n",
		"src/user/u.ts":      "u1\n",
		"src/cart/a.test.ts": "t1\n",
	})
	r.CommitAt("one commit touching every File", daysAgo(40))
	r.Write("src/cart/a.ts", "a2\n")
	r.CommitAt("touch a", daysAgo(30))
	r.Write("src/user/u.ts", "u2\n")
	r.CommitAt("touch u", daysAgo(20))
	r.Write("src/cart/a.test.ts", "t2\n")
	r.CommitAt("touch a test", daysAgo(10))

	ws := openAt(t, r, engine.Options{})
	assertLines(t, churnOf(t, ws, worktree, engine.MapQuery{Level: engine.Files}),
		"file:src/cart/a.ts churn=2",
		"file:src/cart/b.ts churn=1",
		"file:src/cart/c.ts churn=1",
		"file:src/user/u.ts churn=2",
	)
	assertLines(t, churnOf(t, ws, worktree, engine.MapQuery{Level: engine.Directories}),
		"dir:src/cart churn=2",
		"dir:src/user churn=2",
	)
	assertLines(t, churnOf(t, ws, worktree, engine.MapQuery{Level: engine.Packages}),
		"pkg:. churn=3",
	)
	// With test Files shown, their commits count too.
	assertLines(t, churnOf(t, ws, worktree, engine.MapQuery{Level: engine.Directories, Tests: true}),
		"dir:src/cart churn=3",
		"dir:src/user churn=2",
	)
	assertLines(t, churnOf(t, ws, worktree, engine.MapQuery{Level: engine.Packages, Tests: true}),
		"pkg:. churn=4",
	)
}

func TestChurnIsZeroInARepositoryWithoutCommits(t *testing.T) {
	r := testrepo.New(t)
	r.Write("src/app.ts", "app()\n")

	ws := openAt(t, r, engine.Options{})
	assertLines(t, churnOf(t, ws, worktree, fileLevel), "file:src/app.ts churn=0")
}
