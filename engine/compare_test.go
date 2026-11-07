package engine_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// compare runs a Comparison with test Files included.
func compare(t *testing.T, ws engine.Workspace, base, target engine.State) engine.Comparison {
	t.Helper()
	return compareWith(t, ws, base, target, engine.CompareQuery{Tests: true})
}

func compareWith(t *testing.T, ws engine.Workspace, base, target engine.State, q engine.CompareQuery) engine.Comparison {
	t.Helper()
	c, err := ws.Compare(context.Background(), base, target, q)
	if err != nil {
		t.Fatalf("Compare(%v, %v): %v", base, target, err)
	}
	if c.Base != base || c.Target != target {
		t.Errorf("Comparison of %v and %v, want %v and %v", c.Base, c.Target, base, target)
	}
	return c
}

// changesOf returns the changed Modules of a level as one line per Module:
// "<change> <id> +<added> ~<modified> -<removed>".
func changesOf(t *testing.T, c engine.Comparison, level engine.Level) []string {
	t.Helper()
	lines := []string{}
	for _, m := range c.At(level).Modules {
		if m.Level != level {
			t.Errorf("%s has level %v in the %v of the Comparison", m.ID, m.Level, level)
		}
		if m.Changed != m.Added+m.Modified+m.Removed {
			t.Errorf("%s: changed=%d is not added+modified+removed", m.ID, m.Changed)
		}
		lines = append(lines, fmt.Sprintf("%s %s +%d ~%d -%d", m.Change, m.ID, m.Added, m.Modified, m.Removed))
	}
	return lines
}

// dependencyChangesOf returns the changed Dependencies of a level as one line
// per Dependency: "<change> <from> -> <to> <kind> +<added> -<removed>".
func dependencyChangesOf(c engine.Comparison, level engine.Level) []string {
	lines := []string{}
	for _, d := range c.At(level).Dependencies {
		lines = append(lines, fmt.Sprintf("%s %s -> %s %s +%d -%d", d.Change, d.From, d.To, d.Kind, d.Added, d.Removed))
	}
	return lines
}

func TestComparisonOfHEADAndTheWorkingTreeIncludesUntrackedFiles(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	r.Write("packages/core/src/money.ts", "export const cents = (n: number) => n * 100\nexport const euros = 1\n")
	r.Write("packages/core/src/tax.ts", "export const tax = 0.2\n") // untracked
	r.Remove("packages/api/routes/health.ts")
	r.Write("packages/web/README.md", "not a source File\n")
	ws := open(t, r)

	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)

	assertLines(t, changesOf(t, c, engine.Files),
		"removed file:packages/api/routes/health.ts +0 ~0 -1",
		"modified file:packages/core/src/money.ts +0 ~1 -0",
		"added file:packages/core/src/tax.ts +1 ~0 -0",
	)
	assertLines(t, changesOf(t, c, engine.Directories),
		"modified dir:packages/api/routes +0 ~0 -1",
		"modified dir:packages/core/src +1 ~1 -0",
	)
	assertLines(t, changesOf(t, c, engine.Packages),
		"modified pkg:packages/api +0 ~0 -1",
		"modified pkg:packages/core +1 ~1 -0",
	)
	want := engine.Summary{FilesChanged: 3, FilesAdded: 1, FilesModified: 1, FilesRemoved: 1, PackagesTouched: 2}
	if c.Summary != want {
		t.Errorf("summary = %+v, want %+v", c.Summary, want)
	}
}

func TestComparisonOfTwoCommitsByHashBranchOrTag(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	first := r.Commit("initial")
	r.Git("tag", "v1")
	r.Write("packages/web/src/view.ts", "import { app } from './app'\nexport const view = () => app() + 1\n")
	r.Write("packages/web/ui/button.ts", "export const button = 1\n")
	r.Commit("a button")
	r.Write("packages/web/src/app.ts", "uncommitted edit\n") // not part of a commit State
	ws := open(t, r)

	for _, refs := range [][2]string{{first, "main"}, {"v1", "HEAD"}, {"main~1", "main"}} {
		c := compare(t, ws, engine.State{Ref: refs[0]}, engine.State{Ref: refs[1]})
		assertLines(t, changesOf(t, c, engine.Files),
			"modified file:packages/web/src/view.ts +0 ~1 -0",
			"added file:packages/web/ui/button.ts +1 ~0 -0",
		)
		assertLines(t, changesOf(t, c, engine.Directories),
			"modified dir:packages/web/src +0 ~1 -0",
			"added dir:packages/web/ui +1 ~0 -0",
		)
		assertLines(t, changesOf(t, c, engine.Packages), "modified pkg:packages/web +1 ~1 -0")
	}
}

func TestComparisonOfAStateWithItselfIsEmpty(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	ws := open(t, r)

	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)

	for _, level := range []engine.Level{engine.Packages, engine.Directories, engine.Files} {
		assertLines(t, changesOf(t, c, level))
		assertLines(t, dependencyChangesOf(c, level))
	}
	if c.Summary != (engine.Summary{}) {
		t.Errorf("summary = %+v, want zero", c.Summary)
	}
}

func TestADeletedFileIsReportedAtItsLastPosition(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	ws := open(t, r)
	before := layoutOf(t, ws, worktree)
	r.Remove("packages/core/util")

	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)

	assertLines(t, changesOf(t, c, engine.Files),
		"removed file:packages/core/util/clock.ts +0 ~0 -1",
		"removed file:packages/core/util/id.ts +0 ~0 -1",
	)
	assertLines(t, changesOf(t, c, engine.Directories), "removed dir:packages/core/util +0 ~0 -2")
	assertLines(t, changesOf(t, c, engine.Packages), "modified pkg:packages/core +0 ~0 -2")
	for _, level := range []engine.Level{engine.Files, engine.Directories} {
		for _, m := range c.At(level).Modules {
			p := before[m.ID]
			if m.X != p.x || m.Y != p.y || m.Radius != p.r || m.Parent != p.parent {
				t.Errorf("%s at (%v, %v) r=%v in %s, want its last position (%v, %v) r=%v in %s",
					m.ID, m.X, m.Y, m.Radius, m.Parent, p.x, p.y, p.r, p.parent)
			}
		}
	}
}

func TestARemovedFileNeverSeenOnTheMapStillHasAPosition(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	r.Remove("packages/web/lib/format.ts")
	ws := open(t, r) // the base State was never mapped

	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)

	ghosts := c.At(engine.Files).Modules
	if len(ghosts) != 1 || ghosts[0].X == 0 && ghosts[0].Y == 0 || ghosts[0].Radius == 0 {
		t.Fatalf("removed Files = %+v, want format.ts placed on the Map", ghosts)
	}
	again := layoutOf(t, ws, engine.State{Ref: "HEAD"})["file:packages/web/lib/format.ts"]
	if again.x != ghosts[0].X || again.y != ghosts[0].Y {
		t.Errorf("the Map of HEAD puts format.ts at (%v, %v), the Comparison at (%v, %v)", again.x, again.y, ghosts[0].X, ghosts[0].Y)
	}
}

func TestComparisonReportsDependenciesAddedAndRemovedAtEachLevel(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	// web/view now also uses core/util (a new coupling between the
	// Directories web/src and core/util, inside an existing one between the
	// Packages); api/routes/cart stops using api/main (the coupling between
	// the Directories disappears); api/main stops using web/lib/format (the
	// coupling between the Packages api and web disappears).
	r.Write("packages/web/src/view.ts", "import { app } from './app'\nimport { now } from 'core/util/clock'\nexport const view = () => app() + now()\n")
	r.Write("packages/api/routes/cart.ts", "export const route = () => 0\n")
	r.Write("packages/api/main.ts", "import { total } from 'core'\nexport const main = () => String(total())\n")
	ws := open(t, r)

	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)

	assertLines(t, dependencyChangesOf(c, engine.Files),
		"removed file:packages/api/main.ts -> file:packages/web/lib/format.ts runtime +0 -1",
		"removed file:packages/api/routes/cart.ts -> file:packages/api/main.ts runtime +0 -1",
		"added file:packages/web/src/view.ts -> file:packages/core/util/clock.ts runtime +1 -0",
	)
	assertLines(t, dependencyChangesOf(c, engine.Directories),
		"removed dir:packages/api -> dir:packages/web/lib runtime +0 -1",
		"removed dir:packages/api/routes -> dir:packages/api runtime +0 -1",
		"added dir:packages/web/src -> dir:packages/core/util runtime +1 -0",
	)
	assertLines(t, dependencyChangesOf(c, engine.Packages),
		"removed pkg:packages/api -> pkg:packages/web runtime +0 -1",
		"modified pkg:packages/web -> pkg:packages/core runtime +1 -0",
	)
	if c.Summary.DependenciesAdded != 1 || c.Summary.DependenciesRemoved != 2 {
		t.Errorf("summary = %+v, want 1 Dependency added and 2 removed", c.Summary)
	}
}

func TestComparisonOnlyParsesTheBlobsThatDiffer(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.Commit("initial")
	r.Write("src/price.ts", "export const price = 2\n")
	r.Write("src/tax.ts", "export const tax = 0.2\n")
	ws := openWith(t, r, engine.Options{CacheDir: t.TempDir()})

	compare(t, ws, engine.State{Ref: "HEAD"}, worktree)
	if got := parsed(ws); got != 5 {
		t.Fatalf("a cold Comparison parsed %d blobs, want the 3 of HEAD and the 2 that differ", got)
	}
	r.Write("src/cart.ts", "export const cart = 0\n")
	compare(t, ws, engine.State{Ref: "HEAD"}, worktree)
	if got := parsed(ws) - 5; got != 1 {
		t.Errorf("a second Comparison parsed %d blobs, want the 1 edited File", got)
	}
}

func TestComparisonLeavesTestFilesOutUnlessAsked(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":          `{"name":"app"}`,
		"src/cart.ts":           "export const cart = 1\n",
		"src/cart.test.ts":      "import { cart } from './cart'\ncart\n",
		"src/__tests__/a.ts":    "export const a = 1\n",
		"src/__tests__/b.ts":    "export const b = 1\n",
		"src/__tests__/keep.ts": "export const keep = 1\n",
	})
	r.Commit("initial")
	r.Write("src/cart.test.ts", "export const nothing = 1\n")
	r.Remove("src/__tests__/a.ts")
	r.Write("src/__tests__/c.ts", "export const c = 1\n")
	ws := open(t, r)

	c := compareWith(t, ws, engine.State{Ref: "HEAD"}, worktree, engine.CompareQuery{})
	for _, level := range []engine.Level{engine.Packages, engine.Directories, engine.Files} {
		assertLines(t, changesOf(t, c, level))
		assertLines(t, dependencyChangesOf(c, level))
	}

	c = compare(t, ws, engine.State{Ref: "HEAD"}, worktree)
	assertLines(t, changesOf(t, c, engine.Files),
		"removed file:src/__tests__/a.ts +0 ~0 -1",
		"added file:src/__tests__/c.ts +1 ~0 -0",
		"modified file:src/cart.test.ts +0 ~1 -0",
	)
	for _, m := range c.At(engine.Files).Modules {
		if !m.Test {
			t.Errorf("%s is not flagged as a test File", m.ID)
		}
	}
	assertLines(t, dependencyChangesOf(c, engine.Files), "removed file:src/cart.test.ts -> file:src/cart.ts runtime +0 -1")
}

func TestAPackageDeclaredWithoutChangingAFileIsAdded(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":   `{"name":"app"}`,
		"src/main.ts":    "export const main = 1\n",
		"tools/build.ts": "export const build = 1\n",
	})
	r.Commit("initial")
	r.Write("tools/package.json", `{"name":"tools"}`)
	ws := open(t, r)

	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)

	assertLines(t, changesOf(t, c, engine.Files))
	assertLines(t, changesOf(t, c, engine.Packages), "added pkg:tools +0 ~0 -0")
	if c.Summary.PackagesTouched != 1 {
		t.Errorf("summary = %+v, want 1 Package touched", c.Summary)
	}
}

func TestComparisonOfAnUnknownRefFails(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.Commit("initial")
	ws := open(t, r)

	if _, err := ws.Compare(context.Background(), engine.State{Ref: "nope"}, worktree, engine.CompareQuery{}); err == nil {
		t.Fatal("Compare with an unknown base succeeded")
	}
}

func TestComparisonLooksUpAnyModuleOfAnyLevel(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(monorepo)
	r.Commit("initial")
	r.Write("packages/core/src/tax.ts", "export const tax = 0.2\n")
	ws := open(t, r)

	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)

	for id, want := range map[string]engine.Change{
		"file:packages/core/src/tax.ts":  engine.Added,
		"dir:packages/core/src":          engine.Modified,
		"pkg:packages/core":              engine.Modified,
		"file:packages/core/src/cart.ts": engine.Unchanged,
		"pkg:packages/web":               engine.Unchanged,
	} {
		if got := c.Module(id).Change; got != want {
			t.Errorf("Module(%s).Change = %q, want %q", id, got, want)
		}
	}
}

func TestComparisonJSONNamesItsStatesAsRefs(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.Commit("initial")
	ws := open(t, r)

	out, err := json.Marshal(compare(t, ws, engine.State{Ref: "HEAD"}, worktree))
	if err != nil {
		t.Fatal(err)
	}
	var back struct {
		Base, Target engine.State
		Files        engine.LevelComparison
	}
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatalf("unmarshal %s: %v", out, err)
	}
	if back.Base.Ref != "HEAD" || back.Target != worktree || back.Files.Level != engine.Files {
		t.Errorf("round trip of %s gave %+v", out, back)
	}
}

func TestParseStateReadsTheRefSyntaxOfTheCommandLineAndTheAPI(t *testing.T) {
	for in, want := range map[string]engine.State{
		"":            worktree,
		"worktree":    worktree,
		" worktree ":  worktree,
		"HEAD":        {Ref: "HEAD"},
		"main~1":      {Ref: "main~1"},
		"v1.2.0":      {Ref: "v1.2.0"},
		"  feature/x": {Ref: "feature/x"},
	} {
		if got := engine.ParseState(in); got != want {
			t.Errorf("ParseState(%q) = %+v, want %+v", in, got, want)
		}
	}
	if s := worktree.String(); s != "worktree" {
		t.Errorf("working tree String() = %q, want worktree", s)
	}
}

func TestFilesCheckedOutWithCRLFLineEndingsAreUnchanged(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		".gitattributes": "* text eol=crlf\n",
		"package.json":   `{"name": "shop"}`,
		"src/cart.ts":    "import { price } from './price'\nexport const cart = price\n",
		"src/price.ts":   "export const price = 1\n",
	})
	r.Commit("initial")
	// Check the Files out again, with the line endings the attributes ask.
	r.Remove("src")
	r.Remove("package.json")
	r.Git("checkout", "--", ".")
	if content, err := os.ReadFile(r.Path("src/price.ts")); err != nil || !strings.Contains(string(content), "\r\n") {
		t.Fatalf("src/price.ts was not checked out with CRLF: %q, %v", content, err)
	}
	ws := open(t, r)

	c := compare(t, ws, engine.State{Ref: "HEAD"}, worktree)
	if got := changesOf(t, c, engine.Files); len(got) != 0 {
		t.Errorf("Files changed against HEAD = %q, want none", got)
	}
}
