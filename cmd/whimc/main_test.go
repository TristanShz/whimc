package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/TristanShz/whimc/internal/testrepo"
)

func TestServeOutsideARepositoryPrintsTheErrorAndFails(t *testing.T) {
	dir := t.TempDir()
	var stdout, stderr bytes.Buffer

	code := run([]string{"serve", "--no-open", dir}, &stdout, &stderr)

	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero")
	}
	if !strings.Contains(stderr.String(), "not inside a git repository") || !strings.Contains(stderr.String(), dir) {
		t.Errorf("stderr = %q, want the not-a-repository error naming %s", stderr.String(), dir)
	}
}

func TestCompareWithoutGitPrintsTheErrorAndFails(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	var stdout, stderr bytes.Buffer

	code := run([]string{"compare", t.TempDir()}, &stdout, &stderr)

	if code == 0 || !strings.Contains(stderr.String(), "git was not found") {
		t.Fatalf("exit code = %d, stderr = %q, want a non-zero exit and the git-not-found error", code, stderr.String())
	}
}

func TestServeListsThePackagesOfTheRepository(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"go.mod":  "module example.com/shop\n",
		"main.go": "package main\n\nfunc main() {}\n",
	})
	r.Commit("initial")
	var stdout, stderr bytes.Buffer

	code := run([]string{"serve", "--no-open", r.Dir}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "example.com/shop") {
		t.Errorf("stdout = %q, want the Package listed", stdout.String())
	}
}

func TestUnknownCommandShowsUsage(t *testing.T) {
	var stdout, stderr bytes.Buffer

	code := run([]string{"frobnicate"}, &stdout, &stderr)

	if code != 2 || !strings.Contains(stderr.String(), "Usage") {
		t.Fatalf("exit code = %d, stderr = %q, want 2 and the usage", code, stderr.String())
	}
}
