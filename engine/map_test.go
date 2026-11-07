package engine_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// open opens the fixture repository as a Workspace closed at the end of the test.
func open(t *testing.T, r *testrepo.Repo) engine.Workspace {
	t.Helper()
	return openWith(t, r, engine.Options{})
}

// openWith opens the fixture repository with opts as a Workspace closed at
// the end of the test.
func openWith(t *testing.T, r *testrepo.Repo, opts engine.Options) engine.Workspace {
	t.Helper()
	ws, err := engine.Open(context.Background(), r.Dir, opts)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { ws.Close() })
	return ws
}

// mapOf returns the Map of a level as one line per Module:
// "<id> name=<name> parent=<parent> size=<size> children=<n>[ test]".
func mapOf(t *testing.T, ws engine.Workspace, at engine.State, q engine.MapQuery) []string {
	t.Helper()
	view, err := ws.Map(context.Background(), at, q)
	if err != nil {
		t.Fatalf("Map(%+v, %+v): %v", at, q, err)
	}
	if view.Level != q.Level {
		t.Errorf("view level = %v, want %v", view.Level, q.Level)
	}
	lines := []string{}
	for _, m := range view.Modules {
		if m.Level != q.Level {
			t.Errorf("module %s has level %v, want %v", m.ID, m.Level, q.Level)
		}
		line := fmt.Sprintf("%s name=%s parent=%s size=%d children=%d", m.ID, m.Name, m.Parent, m.Size, m.Children)
		if m.Test {
			line += " test"
		}
		lines = append(lines, line)
	}
	return lines
}

// ids returns the Module IDs of a level.
func ids(t *testing.T, ws engine.Workspace, at engine.State, q engine.MapQuery) []string {
	t.Helper()
	var out []string
	for _, line := range mapOf(t, ws, at, q) {
		id, _, _ := strings.Cut(line, " ")
		out = append(out, id)
	}
	return out
}

func assertLines(t *testing.T, got []string, want ...string) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Errorf("got\n  %s\nwant\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
}

var worktree = engine.State{}

func TestSingleModuleGoRepositoryIsOnePackageWithItsDirectories(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"go.mod":            "module example.com/shop\n\ngo 1.26\n",
		"main.go":           "package main\n\nfunc main() {\n\trun()\n}\n",
		"cart/cart.go":      "package cart\n\n// Cart holds items.\ntype Cart struct{}\n",
		"cart/total.go":     "package cart\n\nfunc Total() int { return 0 }\n",
		"cart/cart_test.go": "package cart\n\nimport \"testing\"\n\nfunc TestCart(t *testing.T) {}\n",
		"internal/db/db.go": "package db\n",
		"docs/notes.md":     "not a source File\n",
	})
	r.Commit("initial")
	ws := open(t, r)
	all := engine.MapQuery{Tests: true}

	all.Level = engine.Packages
	assertLines(t, mapOf(t, ws, worktree, all),
		"pkg:. name=example.com/shop parent= size=13 children=3")

	all.Level = engine.Directories
	assertLines(t, mapOf(t, ws, worktree, all),
		"dir:. name=example.com/shop parent=pkg:. size=4 children=1",
		"dir:cart name=cart parent=pkg:. size=8 children=3",
		"dir:internal/db name=internal/db parent=pkg:. size=1 children=1",
	)

	all.Level = engine.Files
	assertLines(t, mapOf(t, ws, worktree, all),
		"file:cart/cart.go name=cart.go parent=dir:cart size=3 children=0",
		"file:cart/cart_test.go name=cart_test.go parent=dir:cart size=3 children=0 test",
		"file:cart/total.go name=total.go parent=dir:cart size=2 children=0",
		"file:internal/db/db.go name=db.go parent=dir:internal/db size=1 children=0",
		"file:main.go name=main.go parent=dir:. size=4 children=0",
	)
}

func TestEveryPackageJSONDeclaresAPackageNestedOnesIncluded(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":                       `{"name": "monorepo", "private": true}`,
		"scripts/release.mjs":                "console.log('release')\n",
		"packages/ui/package.json":           `{"name": "@acme/ui"}`,
		"packages/ui/src/button.tsx":         "export const Button = () => null\n\n",
		"packages/ui/src/index.ts":           "export * from './button'\n",
		"packages/ui/plugins/x/package.json": `{"name": "@acme/ui-x"}`,
		"packages/ui/plugins/x/index.js":     "module.exports = 1\nmodule.exports.y = 2\n",
		"packages/api/package.json":          `{"version": "1.0.0"}`,
		"packages/api/server.cts":            "export {}\n",
	})
	r.Commit("initial")
	ws := open(t, r)

	assertLines(t, mapOf(t, ws, worktree, engine.MapQuery{Level: engine.Packages}),
		"pkg:. name=monorepo parent= size=1 children=1",
		"pkg:packages/api name=api parent= size=1 children=1",
		"pkg:packages/ui name=@acme/ui parent= size=2 children=1",
		"pkg:packages/ui/plugins/x name=@acme/ui-x parent= size=2 children=1",
	)
	assertLines(t, mapOf(t, ws, worktree, engine.MapQuery{Level: engine.Directories}),
		"dir:packages/api name=api parent=pkg:packages/api size=1 children=1",
		"dir:packages/ui/plugins/x name=@acme/ui-x parent=pkg:packages/ui/plugins/x size=2 children=1",
		"dir:packages/ui/src name=src parent=pkg:packages/ui size=2 children=2",
		"dir:scripts name=scripts parent=pkg:. size=1 children=1",
	)
}

func TestFilesOutsideEveryPackageGoToAnImplicitRootPackage(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"tools/gen.js":     "run()\n",
		"web/package.json": `{"name": "web"}`,
		"web/app.ts":       "app()\n",
	})
	r.Commit("initial")
	ws := open(t, r)

	view, err := ws.Map(context.Background(), worktree, engine.MapQuery{Level: engine.Packages})
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Modules) != 2 || view.Modules[0].ID != "pkg:." || view.Modules[1].ID != "pkg:web" {
		t.Fatalf("packages = %+v, want pkg:. and pkg:web", view.Modules)
	}
	if want := filepathBase(r.Dir); view.Modules[0].Name != want {
		t.Errorf("implicit root Package name = %q, want the repository folder %q", view.Modules[0].Name, want)
	}
}

func TestMixedTypeScriptAndGoRepository(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"backend/go.mod":          "module github.com/acme/backend\n",
		"backend/cmd/api/main.go": "package main\n\nfunc main() {}\n",
		"backend/store/store.go":  "package store\n",
		"frontend/package.json":   `{"name": "frontend"}`,
		"frontend/src/app.tsx":    "export const App = 1\n",
	})
	r.Commit("initial")
	ws := open(t, r)

	assertLines(t, ids(t, ws, worktree, engine.MapQuery{Level: engine.Packages}),
		"pkg:backend", "pkg:frontend")
	assertLines(t, mapOf(t, ws, worktree, engine.MapQuery{Level: engine.Directories}),
		"dir:backend/cmd/api name=cmd/api parent=pkg:backend size=2 children=1",
		"dir:backend/store name=store parent=pkg:backend size=1 children=1",
		"dir:frontend/src name=src parent=pkg:frontend size=1 children=1",
	)
}

func filepathBase(p string) string { return p[strings.LastIndex(p, "/")+1:] }

func TestIgnoredVendoredAndGeneratedFilesAreLeftOut(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		".gitignore":                     "coverage/\n*.local.ts\n",
		"package.json":                   `{"name": "app"}`,
		"src/app.ts":                     "app()\n",
		"src/settings.local.ts":          "ignored()\n",
		"coverage/report.js":             "ignored()\n",
		"node_modules/left-pad/index.js": "vendored()\n",
		"src/node_modules/x/index.js":    "vendored()\n",
		"vendor/github.com/x/y/y.go":     "package y\n",
		"dist/app.js":                    "built()\n",
		"packages/lib/build/out.js":      "built()\n",
		"src/api.gen.ts":                 "// Code generated by openapi. DO NOT EDIT.\nexport {}\n",
		"src/models.pb.go":               "// Code generated by protoc-gen-go. DO NOT EDIT.\n\npackage src\n",
		"src/mentions_generated_late.ts": strings.Repeat("x()\n", 30) + "// Code generated by x. DO NOT EDIT.\n",
	})
	// Tracked, even under an excluded folder: still vendored or built output.
	r.Git("add", "--force", "node_modules", "dist")
	r.Commit("initial")
	r.Write("src/untracked.ts", "fresh()\n")
	r.Write("coverage/untracked.js", "ignored()\n")
	ws := open(t, r)

	assertLines(t, ids(t, ws, worktree, engine.MapQuery{Level: engine.Files, Tests: true}),
		"file:src/app.ts",
		"file:src/mentions_generated_late.ts",
		"file:src/untracked.ts",
	)
}

func TestTestFilesAreFlaggedAndHiddenUnlessAsked(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":              `{"name": "app"}`,
		"src/cart.ts":               "a()\nb()\n",
		"src/cart.test.ts":          "t()\n",
		"src/cart.spec.tsx":         "t()\n",
		"src/__tests__/helpers.ts":  "t()\nt()\n",
		"e2e/__tests__/checkout.js": "t()\n",
		"go/go.mod":                 "module example.com/go\n",
		"go/pay/pay.go":             "package pay\n",
		"go/pay/pay_test.go":        "package pay\n",
		"src/testing.ts":            "notATest()\n",
	})
	r.Commit("initial")
	ws := open(t, r)

	assertLines(t, mapOf(t, ws, worktree, engine.MapQuery{Level: engine.Files, Tests: true}),
		"file:e2e/__tests__/checkout.js name=checkout.js parent=dir:e2e/__tests__ size=1 children=0 test",
		"file:go/pay/pay.go name=pay.go parent=dir:go/pay size=1 children=0",
		"file:go/pay/pay_test.go name=pay_test.go parent=dir:go/pay size=1 children=0 test",
		"file:src/__tests__/helpers.ts name=helpers.ts parent=dir:src/__tests__ size=2 children=0 test",
		"file:src/cart.spec.tsx name=cart.spec.tsx parent=dir:src size=1 children=0 test",
		"file:src/cart.test.ts name=cart.test.ts parent=dir:src size=1 children=0 test",
		"file:src/cart.ts name=cart.ts parent=dir:src size=2 children=0",
		"file:src/testing.ts name=testing.ts parent=dir:src size=1 children=0",
	)

	// Hidden by default: test Files, Directories holding only tests, and
	// their Size everywhere above them.
	assertLines(t, mapOf(t, ws, worktree, engine.MapQuery{Level: engine.Files}),
		"file:go/pay/pay.go name=pay.go parent=dir:go/pay size=1 children=0",
		"file:src/cart.ts name=cart.ts parent=dir:src size=2 children=0",
		"file:src/testing.ts name=testing.ts parent=dir:src size=1 children=0",
	)
	assertLines(t, mapOf(t, ws, worktree, engine.MapQuery{Level: engine.Directories}),
		"dir:go/pay name=pay parent=pkg:go size=1 children=1",
		"dir:src name=src parent=pkg:. size=3 children=2",
	)
	assertLines(t, mapOf(t, ws, worktree, engine.MapQuery{Level: engine.Packages}),
		"pkg:. name=app parent= size=3 children=1",
		"pkg:go name=example.com/go parent= size=1 children=1",
	)
}

func TestWithinKeepsOnlyTheDescendantsOfAModule(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":        `{"name": "root"}`,
		"index.ts":            "x()\n",
		"lib/a.ts":            "a()\n",
		"web/package.json":    `{"name": "web"}`,
		"web/main.ts":         "m()\n",
		"web/pages/home.tsx":  "h()\n",
		"web/pages/about.tsx": "a()\n",
	})
	r.Commit("initial")
	ws := open(t, r)

	for _, tc := range []struct {
		level  engine.Level
		within string
		want   []string
	}{
		{engine.Directories, "pkg:web", []string{"dir:web", "dir:web/pages"}},
		{engine.Directories, "web", []string{"dir:web", "dir:web/pages"}},
		{engine.Directories, "pkg:.", []string{"dir:.", "dir:lib"}},
		{engine.Files, "pkg:web", []string{"file:web/main.ts", "file:web/pages/about.tsx", "file:web/pages/home.tsx"}},
		{engine.Files, "dir:web", []string{"file:web/main.ts"}},
		{engine.Files, "web/pages", []string{"file:web/pages/about.tsx", "file:web/pages/home.tsx"}},
		{engine.Files, "dir:nowhere", nil},
		{engine.Packages, "pkg:web", nil},
	} {
		t.Run(tc.level.String()+" within "+tc.within, func(t *testing.T) {
			assertLines(t, ids(t, ws, worktree, engine.MapQuery{Level: tc.level, Within: tc.within}), tc.want...)
		})
	}
}

func TestMapOfACommitAndOfTheWorkingTree(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"go.mod":   "module example.com/m\n",
		"a/a.go":   "package a\n",
		"b/b.go":   "package b\n\nvar B = 1\n",
		"c/old.go": "package c\n",
	})
	first := r.Commit("first")
	r.Write("a/a.go", "package a\n\nvar A = 1\nvar AA = 2\n")
	r.Commit("grow a")
	r.Git("tag", "v1")

	// Uncommitted work: an edit, an untracked File, a rename, a deletion.
	r.Write("a/a.go", "package a\n")
	r.Write("d/new.go", "package d\n\nvar D = 1\n")
	r.Rename("c/old.go", "c/renamed.go")
	r.Remove("b/b.go")
	ws := open(t, r)
	files := engine.MapQuery{Level: engine.Files}

	assertLines(t, mapOf(t, ws, worktree, files),
		"file:a/a.go name=a.go parent=dir:a size=1 children=0",
		"file:c/renamed.go name=renamed.go parent=dir:c size=1 children=0",
		"file:d/new.go name=new.go parent=dir:d size=2 children=0",
	)
	assertLines(t, mapOf(t, ws, engine.State{Ref: "HEAD"}, files),
		"file:a/a.go name=a.go parent=dir:a size=3 children=0",
		"file:b/b.go name=b.go parent=dir:b size=2 children=0",
		"file:c/old.go name=old.go parent=dir:c size=1 children=0",
	)
	assertLines(t, mapOf(t, ws, engine.State{Ref: first}, engine.MapQuery{Level: engine.Packages}),
		"pkg:. name=example.com/m parent= size=4 children=3")
	assertLines(t, mapOf(t, ws, engine.State{Ref: "v1"}, engine.MapQuery{Level: engine.Packages}),
		"pkg:. name=example.com/m parent= size=6 children=3")
	assertLines(t, mapOf(t, ws, engine.State{Ref: "main"}, engine.MapQuery{Level: engine.Packages}),
		"pkg:. name=example.com/m parent= size=6 children=3")
}

func TestMapOfAnUnknownRefFails(t *testing.T) {
	r := testrepo.New(t)
	r.Write("go.mod", "module m\n")
	r.Commit("initial")
	ws := open(t, r)

	_, err := ws.Map(context.Background(), engine.State{Ref: "no-such-branch"}, engine.MapQuery{})

	if err == nil || !strings.Contains(err.Error(), "no-such-branch") {
		t.Fatalf("Map error = %v, want an error naming the ref", err)
	}
}
