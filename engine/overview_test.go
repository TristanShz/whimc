package engine_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// overviewRepo is a TS Package and a Go Package, with a test File, whose
// commits fall inside and outside the Churn window:
//
//	200 days ago  everything (outside the window)
//	 30 days ago  money.ts and main.go, one commit across both Packages
//	 10 days ago  money.test.ts only
//	  5 days ago  app.ts
//	  1 day ago   money.ts
func overviewRepo(t *testing.T) *testrepo.Repo {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"web/package.json":      `{"name": "web"}`,
		"web/src/money.ts":      "export const cents = (n: number) => n * 100\n",
		"web/src/app.ts":        "import { cents } from './money'\n",
		"web/src/money.test.ts": "import { cents } from './money'\n",
		"api/go.mod":            "module example.com/api\n\ngo 1.22\n",
		"api/main.go":           "package main\n\nfunc main() {}\n",
		"api/store/store.go":    "package store\n\nfunc Open() {}\n",
	})
	r.CommitAt("initial", daysAgo(200))
	r.Write("web/src/money.ts", "export const cents = (n: number) => n * 100\n\nexport const euro = 2\n")
	r.Write("api/main.go", "package main\n\nimport \"example.com/api/store\"\n\nfunc main() {\n\tstore.Open()\n}\n")
	r.CommitAt("across both Packages", daysAgo(30))
	r.Write("web/src/money.test.ts", "import { cents } from './money'\ncents(1)\n")
	r.CommitAt("test only", daysAgo(10))
	r.Write("web/src/app.ts", "import { cents } from './money'\n\nexport const app = () => cents(2)\n")
	r.CommitAt("app", daysAgo(5))
	r.Write("web/src/money.ts", "export const cents = (n: number) => n * 100\n\nexport const euro = 1\n")
	r.CommitAt("money", daysAgo(1))
	return r
}

func overviewOf(t *testing.T, ws engine.Workspace, at engine.State, q engine.OverviewQuery) string {
	t.Helper()
	o, err := ws.Overview(context.Background(), at, q)
	if err != nil {
		t.Fatalf("Overview(%+v, %+v): %v", at, q, err)
	}
	data, err := json.Marshal(o)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestTheOverviewSumsUpTheStateAsTheMapShowsIt(t *testing.T) {
	ws := openAt(t, overviewRepo(t), engine.Options{})

	// Test Files hidden: money.test.ts is not counted, nor the commit that
	// touched only it; the commit across both Packages counts once.
	got := overviewOf(t, ws, worktree, engine.OverviewQuery{})
	want := `{"size":11,"packages":2,"directories":3,"files":4,"dependencies":2,"commits":3,` +
		`"languages":[{"language":"go","size":7},{"language":"ts","size":4}],` +
		`"movingPackage":{"id":"pkg:web","name":"web","churn":3},"partial":false}`
	if got != want {
		t.Errorf("Overview without tests =\n  %s\nwant\n  %s", got, want)
	}

	got = overviewOf(t, ws, worktree, engine.OverviewQuery{Tests: true})
	want = `{"size":13,"packages":2,"directories":3,"files":5,"dependencies":3,"commits":4,` +
		`"languages":[{"language":"go","size":7},{"language":"ts","size":6}],` +
		`"movingPackage":{"id":"pkg:web","name":"web","churn":4},"partial":false}`
	if got != want {
		t.Errorf("Overview with tests =\n  %s\nwant\n  %s", got, want)
	}
}

func TestTheOverviewOfACommitCountsTheHistoryBehindIt(t *testing.T) {
	ws := openAt(t, overviewRepo(t), engine.Options{})

	// Before the last commit, two commits of the window that touched a
	// File other than a test are behind it.
	got := overviewOf(t, ws, engine.State{Ref: "HEAD~1"}, engine.OverviewQuery{})
	want := `{"size":11,"packages":2,"directories":3,"files":4,"dependencies":2,"commits":2,` +
		`"languages":[{"language":"go","size":7},{"language":"ts","size":4}],` +
		`"movingPackage":{"id":"pkg:web","name":"web","churn":2},"partial":false}`
	if got != want {
		t.Errorf("Overview of HEAD~1 =\n  %s\nwant\n  %s", got, want)
	}
}

func TestTheOverviewOfACalmRepositoryNamesNoMovingPackage(t *testing.T) {
	r := testrepo.New(t)
	r.Write("main.go", "package main\n")
	r.CommitAt("long ago", daysAgo(200))
	ws := openAt(t, r, engine.Options{})

	got := overviewOf(t, ws, worktree, engine.OverviewQuery{})
	want := `{"size":1,"packages":1,"directories":1,"files":1,"dependencies":0,"commits":0,` +
		`"languages":[{"language":"go","size":1}],"partial":false}`
	if got != want {
		t.Errorf("Overview =\n  %s\nwant\n  %s", got, want)
	}
}
