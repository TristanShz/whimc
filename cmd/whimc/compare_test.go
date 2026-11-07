package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/TristanShz/whimc/internal/testrepo"
)

var update = flag.Bool("update", false, "rewrite the golden files of testdata/")

// shop is a TS workspace of two Packages, web and core, not yet coupled.
var shop = map[string]string{
	"package.json":                    `{"name":"shop","private":true}`,
	"packages/core/package.json":      `{"name":"core","main":"src/index.ts"}`,
	"packages/core/src/index.ts":      "export * from './money'\n",
	"packages/core/src/money.ts":      "export const cents = (n: number) => n * 100\n",
	"packages/core/src/legacy.ts":     "export const old = 1\n",
	"packages/core/src/money.test.ts": "import { cents } from './money'\ncents(1)\n",
	"packages/web/package.json":       `{"name":"web"}`,
	"packages/web/src/app.ts":         "export const app = () => 2\n",
	"packages/web/src/view.ts":        "export const view = 1\n",
}

// shopRepo commits shop, then a second commit that edits a File and adds a
// Directory whose File makes web depend on core, and leaves working-tree changes: an
// untracked File, a deleted File and an edited test File.
func shopRepo(t *testing.T) *testrepo.Repo {
	t.Helper()
	isolateUserCache(t)
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.Commit("initial")
	r.Git("tag", "v1")
	r.Write("packages/web/src/view.ts", "import { app } from './app'\nexport const view = () => app()\n")
	r.Write("packages/web/lib/format.ts", "import { cents } from 'core'\nexport const format = () => String(cents(3))\n")
	r.Commit("format prices")
	r.Write("packages/core/src/tax.ts", "export const tax = 0.2\n")
	r.Remove("packages/core/src/legacy.ts")
	r.Write("packages/core/src/money.test.ts", "export const nothing = 1\n")
	return r
}

func TestCompareGolden(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
	}{
		{"head-worktree", nil},
		{"head-worktree-tests", []string{"--tests"}},
		{"two-commits", []string{"--base", "v1", "--target", "main"}},
		{"worktree-ref", []string{"--base", "main~1", "--target", "worktree"}},
		{"no-changes", []string{"--base", "main", "--target", "HEAD"}},
	} {
		for _, format := range []string{"txt", "json"} {
			t.Run(tc.name+"."+format, func(t *testing.T) {
				r := shopRepo(t)
				args := append([]string{"compare"}, tc.args...)
				if format == "json" {
					args = append(args, "--json")
				}
				var stdout, stderr bytes.Buffer

				if code := run(append(args, r.Dir), &stdout, &stderr); code != 0 {
					t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
				}

				got := stdout.Bytes()
				if format == "json" {
					if !json.Valid(got) {
						t.Fatalf("output is not JSON:\n%s", got)
					}
					got = withoutCoordinates(got)
				}
				assertGolden(t, filepath.Join("testdata", "compare-"+tc.name+"."+format+".golden"), got)
			})
		}
	}
}

func TestCompareOfAnUnknownRefFails(t *testing.T) {
	r := shopRepo(t)
	var stdout, stderr bytes.Buffer

	code := run([]string{"compare", "--base", "nope", r.Dir}, &stdout, &stderr)

	if code != 1 || !strings.Contains(stderr.String(), "nope") {
		t.Fatalf("exit code = %d, stderr = %q, want 1 and an error naming the ref", code, stderr.String())
	}
}

// coordinates matches the map coordinates of the JSON output. They come from
// the layout, whose floating-point results may differ in their last digits
// from one CPU architecture to another, and are pinned by the engine's
// layout tests rather than here.
var coordinates = regexp.MustCompile(`"(x|y|radius)": -?[0-9][0-9.e+-]*`)

func withoutCoordinates(out []byte) []byte {
	return coordinates.ReplaceAll(out, []byte(`"$1": 0`))
}

func assertGolden(t *testing.T, path string, got []byte) {
	t.Helper()
	if *update {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run go test ./cmd/whimc -update to create it)", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("output differs from %s (run go test ./cmd/whimc -update if the change is intended)\n--- got\n%s\n--- want\n%s", path, got, want)
	}
}
