package engine_test

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// shop is a small TS repository: three Files importing each other.
var shop = map[string]string{
	"package.json":    `{"name": "shop"}`,
	"src/cart.ts":     "import { price } from './price'\nexport const cart = price\n",
	"src/price.ts":    "export const price = 1\n",
	"src/checkout.ts": "import { cart } from './cart'\nexport const pay = () => cart\n",
}

// everything returns the Map at every level, Modules and Dependencies, as
// lines, to check that an answer read from the index is the one computed.
func everything(t *testing.T, ws engine.Workspace, at engine.State) []string {
	t.Helper()
	var lines []string
	for _, level := range []engine.Level{engine.Packages, engine.Directories, engine.Files} {
		q := engine.MapQuery{Level: level, Tests: true}
		lines = append(lines, mapOf(t, ws, at, q)...)
		lines = append(lines, churnOf(t, ws, at, q)...)
		lines = append(lines, depsOf(t, ws, at, q)...)
	}
	return lines
}

func parsed(ws engine.Workspace) int { return ws.Stats().ParsedBlobs }

func TestReopeningAWorkspaceReparsesNothing(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.CommitAt("initial", daysAgo(3))
	r.Write("src/cart.ts", shop["src/cart.ts"]+"export const empty = []\n")
	r.CommitAt("edit cart", daysAgo(1))
	cache := t.TempDir()

	first := openAt(t, r, engine.Options{CacheDir: cache})
	want := everything(t, first, worktree)
	if got := parsed(first); got != 3 {
		t.Fatalf("first open parsed %d blobs, want 3", got)
	}
	if got := first.Stats().DiffedCommits; got != 2 {
		t.Fatalf("first open read the changes of %d commits, want 2", got)
	}
	first.Close()

	second := openAt(t, r, engine.Options{CacheDir: cache})
	assertLines(t, everything(t, second, worktree), want...)
	assertLines(t, everything(t, second, engine.State{Ref: "HEAD"}), want...)
	if got := parsed(second); got != 0 {
		t.Errorf("second open parsed %d blobs, want 0", got)
	}
	if got := second.Stats().DiffedCommits; got != 0 {
		t.Errorf("second open read the changes of %d commits, want 0", got)
	}
}

func TestTheMapOfASecondStateOnlyParsesTheBlobsThatDiffer(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(shop)
	first := r.Commit("initial")
	r.Write("src/price.ts", "export const price = 2\n")
	r.Write("src/tax.ts", "export const tax = 0.2\n")
	r.Commit("change the price, add a tax")
	ws := openWith(t, r, engine.Options{CacheDir: t.TempDir()})

	mapOf(t, ws, engine.State{Ref: first}, fileLevel)
	if got := parsed(ws); got != 3 {
		t.Fatalf("first State parsed %d blobs, want 3", got)
	}
	mapOf(t, ws, engine.State{Ref: "main"}, fileLevel)
	if got := parsed(ws) - 3; got != 2 {
		t.Errorf("second State parsed %d blobs, want the 2 that differ", got)
	}
	r.Write("src/cart.ts", "export const cart = 0\n")
	mapOf(t, ws, worktree, fileLevel)
	if got := parsed(ws) - 5; got != 1 {
		t.Errorf("working tree parsed %d blobs, want the 1 edited File", got)
	}
}

func TestTheSameBlobUnderAnotherLanguageIsParsedAgain(t *testing.T) {
	r := testrepo.New(t)
	content := "export const a = <div/>\n"
	r.Write("src/a.tsx", content)
	r.Write("src/b.ts", content) // not JSX in plain TS: a parse failure
	ws := openWith(t, r, engine.Options{CacheDir: t.TempDir()})

	mapOf(t, ws, worktree, fileLevel)
	if got := parsed(ws); got != 2 {
		t.Errorf("parsed %d blobs, want 2: one per grammar", got)
	}
}

func TestWorktreesOfOneRepositoryShareTheirIndex(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.Commit("initial")
	other := filepath.Join(t.TempDir(), "feature")
	r.Git("worktree", "add", "--quiet", "-b", "feature", other)
	cache := t.TempDir()

	main := openWith(t, r, engine.Options{CacheDir: cache})
	mapOf(t, main, worktree, fileLevel)
	main.Close()
	wt, err := engine.Open(context.Background(), other, engine.Options{CacheDir: cache})
	if err != nil {
		t.Fatalf("Open worktree: %v", err)
	}
	defer wt.Close()
	if _, err := wt.Map(context.Background(), worktree, fileLevel); err != nil {
		t.Fatal(err)
	}

	if got := parsed(wt); got != 0 {
		t.Errorf("the second worktree parsed %d blobs, want 0", got)
	}
	entries, err := os.ReadDir(cache)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("cache holds %d index directories, want 1", len(entries))
	}
}

func TestTheIndexLivesInTheUserCacheAndNothingIsWrittenInTheRepository(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, ".cache"))
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.Commit("initial")
	r.Write("src/draft.ts", "export const draft = 1\n")
	before := filesUnder(t, r.Dir)

	ws, err := engine.Open(context.Background(), r.Dir, engine.Options{})
	if err != nil {
		t.Fatal(err)
	}
	mapOf(t, ws, worktree, fileLevel)
	mapOf(t, ws, engine.State{Ref: "HEAD"}, fileLevel)
	ws.Close()

	assertLines(t, filesUnder(t, r.Dir), before...)
	if status := r.Git("status", "--porcelain", "--ignored"); status != "?? src/draft.ts" {
		t.Errorf("git status = %q, want only the untracked draft", status)
	}
	userCache, err := os.UserCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	indexes, _ := filepath.Glob(filepath.Join(userCache, "whimc", "*", "index.db"))
	if len(indexes) != 1 || !regexp.MustCompile(`/whimc/[0-9a-f]{64}/index\.db$`).MatchString(indexes[0]) {
		t.Errorf("indexes in the user cache = %v, want one whimc/<repository hash>/index.db", indexes)
	}
}

// filesUnder lists every File under dir, .git included, as relative paths.
func filesUnder(t *testing.T, dir string) []string {
	t.Helper()
	var files []string
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			rel, _ := filepath.Rel(dir, p)
			files = append(files, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(files)
	return files
}
