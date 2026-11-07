package engine_test

import (
	"context"
	"fmt"
	"math"
	"sort"
	"testing"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// monorepo is a TS workspace with three Packages, Dependencies between them,
// and several Directories and Files in each.
var monorepo = map[string]string{
	"package.json":                  `{"name":"root","private":true}`,
	"packages/core/package.json":    `{"name":"core","main":"src/index.ts"}`,
	"packages/core/src/index.ts":    "export * from './money'\nexport * from './cart'\n",
	"packages/core/src/money.ts":    "export const cents = (n: number) => n * 100\n",
	"packages/core/src/cart.ts":     "import { cents } from './money'\nexport const total = () => cents(1)\n",
	"packages/core/util/clock.ts":   "export const now = () => 0\n",
	"packages/core/util/id.ts":      "import { now } from './clock'\nexport const id = () => now()\n",
	"packages/web/package.json":     `{"name":"web","main":"src/app.ts"}`,
	"packages/web/src/app.ts":       "import { total } from 'core'\nexport const app = () => total()\n",
	"packages/web/src/view.ts":      "import { app } from './app'\nexport const view = () => app()\n",
	"packages/web/lib/format.ts":    "export const format = (s: string) => s\n",
	"packages/api/package.json":     `{"name":"api","main":"main.ts"}`,
	"packages/api/main.ts":          "import { total } from 'core'\nimport { format } from 'web/lib/format'\nexport const main = () => format(String(total()))\n",
	"packages/api/routes/cart.ts":   "import { main } from '../main'\nexport const route = () => main()\n",
	"packages/api/routes/money.ts":  "export const route = () => 1\n",
	"packages/api/routes/health.ts": "export const health = () => 'ok'\n",
}

// placement is where a Module sits on the Map.
type placement struct {
	parent  string
	x, y, r float64
}

// layoutOf returns the placement of every Module of every level, test Files
// included.
func layoutOf(t *testing.T, ws engine.Workspace, at engine.State) map[string]placement {
	t.Helper()
	out := map[string]placement{}
	for _, level := range []engine.Level{engine.Packages, engine.Directories, engine.Files} {
		view, err := ws.Map(context.Background(), at, engine.MapQuery{Level: level, Tests: true})
		if err != nil {
			t.Fatalf("Map(%v): %v", level, err)
		}
		for _, m := range view.Modules {
			if m.Radius <= 0 {
				t.Errorf("%s has radius %v, want > 0", m.ID, m.Radius)
			}
			out[m.ID] = placement{parent: m.Parent, x: m.X, y: m.Y, r: m.Radius}
		}
	}
	return out
}

func distance(a, b placement) float64 { return math.Hypot(a.x-b.x, a.y-b.y) }

// assertUnmoved checks that every Module of before sits at the same place in
// after.
func assertUnmoved(t *testing.T, before, after map[string]placement) {
	t.Helper()
	for id, b := range before {
		a, ok := after[id]
		if !ok {
			t.Errorf("%s disappeared", id)
			continue
		}
		if a.x != b.x || a.y != b.y {
			t.Errorf("%s moved from (%v, %v) to (%v, %v)", id, b.x, b.y, a.x, a.y)
		}
	}
}

// assertAroundParent checks that the centre of each child lies within its
// parent's disc, so zooming into the parent reveals it around it.
func assertAroundParent(t *testing.T, layout map[string]placement) {
	t.Helper()
	for id, p := range layout {
		if p.parent == "" {
			continue
		}
		parent, ok := layout[p.parent]
		if !ok {
			t.Errorf("%s: parent %s has no placement", id, p.parent)
			continue
		}
		if d := distance(p, parent); d > parent.r {
			t.Errorf("%s is %.1f from its parent %s, outside its radius %.1f", id, d, p.parent, parent.r)
		}
	}
}

func TestTheLayoutIsTheSameAfterReopening(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	cache := t.TempDir()

	first := openWith(t, r, engine.Options{CacheDir: cache})
	want := layoutOf(t, first, worktree)
	if len(want) != 3+6+12 {
		t.Fatalf("laid out %d Modules, want 21", len(want))
	}
	first.Close()

	second := openWith(t, r, engine.Options{CacheDir: cache})
	assertUnmoved(t, want, layoutOf(t, second, worktree))
	assertUnmoved(t, want, layoutOf(t, second, engine.State{Ref: "HEAD"}))
}

func TestTheLayoutIsDeterministic(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")

	want := layoutOf(t, open(t, r), worktree)
	assertUnmoved(t, want, layoutOf(t, open(t, r), worktree)) // another, empty index
}

func TestNoTwoModulesShareCoordinates(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Write("single/go.mod", "module example.com/single\n")
	r.Write("single/only.go", "package single\n")
	seen := map[[2]float64]string{}
	for id, p := range layoutOf(t, open(t, r), worktree) {
		key := [2]float64{p.x, p.y}
		if other, ok := seen[key]; ok {
			t.Errorf("%s and %s both sit at (%v, %v)", id, other, p.x, p.y)
		}
		seen[key] = id
	}
}

func TestChildrenSitAroundTheirParent(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	for i := range 40 {
		r.Write(fmt.Sprintf("packages/web/src/widgets/w%02d.ts", i), fmt.Sprintf("export const w%d = %d\n", i, i))
	}
	layout := layoutOf(t, open(t, r), worktree)
	assertAroundParent(t, layout)

	// Siblings do not pile up on each other.
	for id, p := range layout {
		for other, q := range layout {
			if id < other && p.parent == q.parent && distance(p, q) < (p.r+q.r)/2 {
				t.Errorf("siblings %s and %s overlap: %.2f apart, radii %.2f and %.2f", id, other, distance(p, q), p.r, q.r)
			}
		}
	}
}

func TestAddingModulesElsewhereLeavesEveryPositionUnchanged(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	cache := t.TempDir()

	first := openWith(t, r, engine.Options{CacheDir: cache})
	before := layoutOf(t, first, worktree)
	first.Close()

	r.WriteFiles(map[string]string{
		"packages/core/src/tax.ts":       "import { cents } from './money'\nexport const tax = () => cents(2)\n",
		"packages/web/hooks/useCart.ts":  "import { total } from 'core'\nexport const useCart = () => total()\n",
		"packages/admin/package.json":    `{"name":"admin","main":"index.ts"}`,
		"packages/admin/index.ts":        "import { total } from 'core'\nexport const admin = () => total()\n",
		"packages/admin/pages/orders.ts": "export const orders = []\n",
	})
	second := openWith(t, r, engine.Options{CacheDir: cache})
	after := layoutOf(t, second, worktree)
	assertUnmoved(t, before, after)
	for _, id := range []string{
		"file:packages/core/src/tax.ts", "dir:packages/web/hooks", "file:packages/web/hooks/useCart.ts",
		"pkg:packages/admin", "dir:packages/admin", "dir:packages/admin/pages",
	} {
		if _, ok := after[id]; !ok {
			t.Errorf("new Module %s is not on the Map", id)
		}
	}
	assertAroundParent(t, after)
}

func TestARemovedFileKeepsItsPosition(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	ws := open(t, r)
	before := layoutOf(t, ws, worktree)

	r.Remove("packages/core/util/id.ts")
	if _, ok := layoutOf(t, ws, worktree)["file:packages/core/util/id.ts"]; ok {
		t.Fatal("the removed File is still on the Map")
	}
	r.Write("packages/core/util/id.ts", monorepo["packages/core/util/id.ts"])
	assertUnmoved(t, before, layoutOf(t, ws, worktree))
}

func TestAViewportKeepsOnlyTheModulesInView(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	ws := open(t, r)
	layout := layoutOf(t, ws, worktree)
	core := layout["pkg:packages/core"]

	inView := func(level engine.Level, rect engine.Rect) []string {
		t.Helper()
		view, err := ws.Map(context.Background(), worktree, engine.MapQuery{Level: level, Viewport: &rect})
		if err != nil {
			t.Fatalf("Map(viewport %+v): %v", rect, err)
		}
		in := map[string]bool{}
		var got []string
		for _, m := range view.Modules {
			in[m.ID] = true
			got = append(got, m.ID)
		}
		for _, d := range view.Dependencies {
			if !in[d.From] || !in[d.To] {
				t.Errorf("Dependency %s -> %s leaves the viewport", d.From, d.To)
			}
		}
		sort.Strings(got)
		return got
	}

	// A point-sized viewport on the core Package sees core and nothing far away.
	got := inView(engine.Packages, engine.Rect{X0: core.x, Y0: core.y, X1: core.x, Y1: core.y})
	found := false
	for _, id := range got {
		if id == "pkg:packages/core" {
			found = true
		}
		if p := layout[id]; distance(p, core) > p.r+core.r {
			t.Errorf("%s is out of view but returned", id)
		}
	}
	if !found {
		t.Errorf("viewport on core returned %v, without core", got)
	}

	// A viewport far from everything sees nothing; corners may come in any order.
	far := 1e9
	if got := inView(engine.Files, engine.Rect{X0: far + 10, Y0: far + 10, X1: far, Y1: far}); len(got) != 0 {
		t.Errorf("a viewport far away returned %v", got)
	}

	// A viewport over the whole Map sees every File.
	all := inView(engine.Files, engine.Rect{X0: -far, Y0: -far, X1: far, Y1: far})
	if len(all) != 12 {
		t.Errorf("the whole Map returned %d Files, want 12", len(all))
	}
}
