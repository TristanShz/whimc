// Package testrepo builds throwaway git repositories for tests: write Files,
// commit them at controlled dates, and leave uncommitted, untracked, renamed or
// deleted Files in the working tree.
package testrepo

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// DefaultDate is the date used by Commit: a fixed instant, so that fixture
// repositories are reproducible.
var DefaultDate = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

// Repo is a git repository in a temporary directory, removed when the test ends.
type Repo struct {
	t   testing.TB
	Dir string
}

// New creates an empty repository on branch main, isolated from the user's
// and the system's git configuration.
func New(t testing.TB) *Repo {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("testrepo: resolve temp dir: %v", err)
	}
	r := &Repo{t: t, Dir: dir}
	r.Git("init", "--quiet", "--initial-branch=main")
	return r
}

// Path returns the absolute path of a repository-relative slash path.
func (r *Repo) Path(rel string) string {
	return filepath.Join(r.Dir, filepath.FromSlash(rel))
}

// Write writes content to the File at rel, creating its folders.
func (r *Repo) Write(rel, content string) {
	r.t.Helper()
	p := r.Path(rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		r.t.Fatalf("testrepo: mkdir for %s: %v", rel, err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		r.t.Fatalf("testrepo: write %s: %v", rel, err)
	}
}

// WriteFiles writes every File of files, keyed by repository-relative path.
func (r *Repo) WriteFiles(files map[string]string) {
	r.t.Helper()
	for rel, content := range files {
		r.Write(rel, content)
	}
}

// Remove deletes the File or folder at rel from the working tree.
func (r *Repo) Remove(rel string) {
	r.t.Helper()
	if err := os.RemoveAll(r.Path(rel)); err != nil {
		r.t.Fatalf("testrepo: remove %s: %v", rel, err)
	}
}

// Rename moves the File at from to to in the working tree; the next Commit
// records it as a rename.
func (r *Repo) Rename(from, to string) {
	r.t.Helper()
	if err := os.MkdirAll(filepath.Dir(r.Path(to)), 0o755); err != nil {
		r.t.Fatalf("testrepo: mkdir for %s: %v", to, err)
	}
	if err := os.Rename(r.Path(from), r.Path(to)); err != nil {
		r.t.Fatalf("testrepo: rename %s to %s: %v", from, to, err)
	}
}

// Commit stages every change of the working tree and commits it at DefaultDate.
// It returns the commit hash.
func (r *Repo) Commit(message string) string {
	r.t.Helper()
	return r.CommitAt(message, DefaultDate)
}

// CommitAt stages every change of the working tree and commits it with both
// author and committer dates set to at. It returns the commit hash.
func (r *Repo) CommitAt(message string, at time.Time) string {
	r.t.Helper()
	r.Git("add", "--all")
	date := at.Format(time.RFC3339)
	r.gitEnv([]string{"GIT_AUTHOR_DATE=" + date, "GIT_COMMITTER_DATE=" + date},
		"commit", "--quiet", "--allow-empty", "--no-verify", "-m", message)
	return r.Git("rev-parse", "HEAD")
}

// Git runs a git command in the repository and returns its trimmed output.
func (r *Repo) Git(args ...string) string {
	r.t.Helper()
	return r.gitEnv(nil, args...)
}

func (r *Repo) gitEnv(extra []string, args ...string) string {
	r.t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = r.Dir
	cmd.Env = append(append(os.Environ(),
		"GIT_CONFIG_GLOBAL="+os.DevNull,
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_AUTHOR_NAME=whimc test",
		"GIT_AUTHOR_EMAIL=test@whimc.invalid",
		"GIT_COMMITTER_NAME=whimc test",
		"GIT_COMMITTER_EMAIL=test@whimc.invalid",
	), extra...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		r.t.Fatalf("testrepo: git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}
