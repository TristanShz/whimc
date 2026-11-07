// Package gitrepo reads a git repository through the git CLI: it lists the
// Files of a commit or of the working tree and reads their content. Blob
// contents go through one long-running `git cat-file --batch` process, and
// working-tree Files are hashed with `git hash-object` semantics so they share
// the key space of committed blobs.
package gitrepo

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	// ErrGitNotFound reports that no git executable is on PATH.
	ErrGitNotFound = errors.New("git was not found on PATH: install git (https://git-scm.com/downloads) and make sure the `git` command runs in your shell")
	// ErrNotARepository reports that a path is not inside a git work tree.
	ErrNotARepository = errors.New("not inside a git repository")
	// ErrUnknownRef reports a ref that names no commit, branch or tag.
	ErrUnknownRef = errors.New("unknown ref")
)

// Entry is a regular File of a repository State: its repository-relative
// slash path and the hash of its blob.
type Entry struct {
	Path string
	Blob string
}

// Repo is an open git work tree. It is safe for concurrent use.
type Repo struct {
	git  string
	root string

	mu      sync.Mutex
	catfile *catFile
}

// Open finds the work tree containing path.
func Open(ctx context.Context, path string) (*Repo, error) {
	git, err := exec.LookPath("git")
	if err != nil {
		return nil, ErrGitNotFound
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", path, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, fmt.Errorf("cannot open %s: %w", abs, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("cannot open %s: not a directory", abs)
	}
	out, err := run(ctx, git, abs, "rev-parse", "--show-toplevel")
	if err != nil {
		return nil, fmt.Errorf("%w: %s (run `git init` there, or pass the path of a git repository)", ErrNotARepository, abs)
	}
	return &Repo{git: git, root: strings.TrimSpace(string(out))}, nil
}

// Root is the absolute path of the work tree.
func (r *Repo) Root() string { return r.root }

// CommonDir returns the absolute, symlink-free path of the repository's
// common git directory: the same for every worktree of the repository.
func (r *Repo) CommonDir(ctx context.Context) (string, error) {
	out, err := r.run(ctx, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return "", err
	}
	dir, err := filepath.EvalSymlinks(strings.TrimSpace(string(out)))
	if err != nil {
		return "", fmt.Errorf("resolve the git directory: %w", err)
	}
	return dir, nil
}

// GitDir returns the absolute path of the work tree's own git directory,
// where its HEAD lives (not the common one, for a linked worktree).
func (r *Repo) GitDir(ctx context.Context) (string, error) {
	out, err := r.run(ctx, "rev-parse", "--absolute-git-dir")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// Ignored returns those of the repository-relative paths that git ignores:
// untracked paths matching an exclude rule (.gitignore, info/exclude, the
// global excludes file). Tracked paths are never ignored.
func (r *Repo) Ignored(ctx context.Context, paths []string) (map[string]bool, error) {
	ignored := map[string]bool{}
	if len(paths) == 0 {
		return ignored, nil
	}
	cmd := exec.CommandContext(ctx, r.git, "check-ignore", "--stdin", "-z")
	cmd.Dir = r.root
	cmd.Stdin = strings.NewReader(strings.Join(paths, "\x00") + "\x00")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 {
		return ignored, nil // none of them is ignored
	}
	if err != nil {
		return nil, fmt.Errorf("git check-ignore: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	for _, p := range splitNul(out) {
		ignored[p] = true
	}
	return ignored, nil
}

// ResolveCommit turns a commit, branch or tag into a commit hash.
func (r *Repo) ResolveCommit(ctx context.Context, ref string) (string, error) {
	out, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "--end-of-options", ref+"^{commit}")
	if err != nil {
		return "", fmt.Errorf("%w %q: not a commit, branch or tag of %s", ErrUnknownRef, ref, r.root)
	}
	return strings.TrimSpace(string(out)), nil
}

// ListCommit returns the regular Files of a commit. Symlinks and submodules
// are skipped.
func (r *Repo) ListCommit(ctx context.Context, commit string) ([]Entry, error) {
	out, err := r.run(ctx, "ls-tree", "-r", "-z", "--full-tree", commit)
	if err != nil {
		return nil, err
	}
	var entries []Entry
	for _, rec := range splitNul(out) {
		// "<mode> SP <type> SP <object> TAB <path>"
		meta, path, ok := strings.Cut(rec, "\t")
		if !ok {
			return nil, fmt.Errorf("git ls-tree: unexpected record %q", rec)
		}
		fields := strings.Fields(meta)
		if len(fields) != 3 || fields[1] != "blob" || (fields[0] != "100644" && fields[0] != "100755") {
			continue
		}
		entries = append(entries, Entry{Path: path, Blob: fields[2]})
	}
	return entries, nil
}

// ListWorkTree returns the repository-relative paths of the regular Files of
// the working tree as on disk: tracked Files still present, plus untracked
// Files that are not ignored.
func (r *Repo) ListWorkTree(ctx context.Context) ([]string, error) {
	out, err := r.run(ctx, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var paths []string
	for _, p := range splitNul(out) {
		if seen[p] {
			continue // a conflicted path is listed once per stage
		}
		seen[p] = true
		info, err := os.Lstat(filepath.Join(r.root, filepath.FromSlash(p)))
		if errors.Is(err, fs.ErrNotExist) {
			continue // deleted but not yet staged
		}
		if err != nil {
			return nil, err
		}
		if info.Mode().IsRegular() {
			paths = append(paths, p)
		}
	}
	return paths, nil
}

// ReadWorkTree reads a working-tree File and returns its content and blob hash.
func (r *Repo) ReadWorkTree(path string) (content []byte, blob string, err error) {
	content, err = os.ReadFile(filepath.Join(r.root, filepath.FromSlash(path)))
	if err != nil {
		return nil, "", err
	}
	return content, HashBlob(content), nil
}

// ReadBlob returns the content of a blob.
func (r *Repo) ReadBlob(blob string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.catfile == nil {
		cf, err := startCatFile(r.git, r.root)
		if err != nil {
			return nil, err
		}
		r.catfile = cf
	}
	content, err := r.catfile.read(blob)
	if err != nil {
		// The process may be in an unknown state: restart it on the next read.
		r.catfile.close()
		r.catfile = nil
	}
	return content, err
}

// Close stops the long-running git processes.
func (r *Repo) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.catfile == nil {
		return nil
	}
	err := r.catfile.close()
	r.catfile = nil
	return err
}

// HashBlob returns the git blob hash of content, as `git hash-object` does.
func HashBlob(content []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(content))
	h.Write(content)
	return hex.EncodeToString(h.Sum(nil))
}

func (r *Repo) run(ctx context.Context, args ...string) ([]byte, error) {
	return run(ctx, r.git, r.root, args...)
}

func run(ctx context.Context, git, dir string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, git, args...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}

func splitNul(out []byte) []string {
	s := strings.TrimSuffix(string(out), "\x00")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\x00")
}

// catFile is a running `git cat-file --batch` process.
type catFile struct {
	cmd *exec.Cmd
	in  io.WriteCloser
	out *bufio.Reader
}

func startCatFile(git, dir string) (*catFile, error) {
	cmd := exec.Command(git, "cat-file", "--batch")
	cmd.Dir = dir
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start git cat-file: %w", err)
	}
	return &catFile{cmd: cmd, in: in, out: bufio.NewReaderSize(out, 64*1024)}, nil
}

func (c *catFile) read(blob string) ([]byte, error) {
	if _, err := io.WriteString(c.in, blob+"\n"); err != nil {
		return nil, fmt.Errorf("git cat-file: %w", err)
	}
	header, err := c.out.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("git cat-file: %w", err)
	}
	// "<object> SP <type> SP <size> LF", or "<object> SP missing LF".
	fields := strings.Fields(header)
	if len(fields) != 3 {
		return nil, fmt.Errorf("git cat-file: object %s: %s", blob, strings.TrimSpace(header))
	}
	size, err := strconv.Atoi(fields[2])
	if err != nil {
		return nil, fmt.Errorf("git cat-file: bad header %q", header)
	}
	content := make([]byte, size+1) // content + trailing LF
	if _, err := io.ReadFull(c.out, content); err != nil {
		return nil, fmt.Errorf("git cat-file: %w", err)
	}
	return content[:size], nil
}

func (c *catFile) close() error {
	c.in.Close()
	return c.cmd.Wait()
}

// Head returns the commit HEAD points at, or "" when the repository has no
// commit yet.
func (r *Repo) Head(ctx context.Context) (string, error) {
	out, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "HEAD^{commit}")
	if err != nil {
		if _, err := r.run(ctx, "rev-parse", "--git-dir"); err != nil {
			return "", err
		}
		return "", nil // unborn branch
	}
	return strings.TrimSpace(string(out)), nil
}

// Stamp is a commit and its committer date, in Unix seconds.
type Stamp struct {
	Hash string
	Time int64
}

// CommitsSince returns the commits reachable from commit whose committer
// date is not before since, children before their parents.
func (r *Repo) CommitsSince(ctx context.Context, commit string, since time.Time) ([]Stamp, error) {
	out, err := r.run(ctx, "rev-list", "--topo-order", "--timestamp",
		"--since="+strconv.FormatInt(since.Unix()-1, 10), commit, "--")
	if err != nil {
		return nil, err
	}
	var stamps []Stamp
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		ts, hash, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		t, err := strconv.ParseInt(ts, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("git rev-list: bad line %q", line)
		}
		if t >= since.Unix() {
			stamps = append(stamps, Stamp{Hash: hash, Time: t})
		}
	}
	return stamps, nil
}

// Change is a path a commit touched, against its first parent. Status is
// git's: 'A', 'M', 'D', 'T', 'R' (renamed from From) or 'C' (copied from
// From).
type Change struct {
	Status byte   `json:"s"`
	Path   string `json:"p"`
	From   string `json:"f,omitempty"`
}

// Changes returns the paths each commit touched, renames detected. Merge
// commits touch nothing.
func (r *Repo) Changes(ctx context.Context, commits []string) (map[string][]Change, error) {
	result := make(map[string][]Change, len(commits))
	if len(commits) == 0 {
		return result, nil
	}
	cmd := exec.CommandContext(ctx, r.git, "log", "--no-walk=unsorted", "--stdin", "--root",
		"--no-show-signature", "-M", "--name-status", "-z", "--no-color", "--format=%x01%H")
	cmd.Dir = r.root
	cmd.Stdin = strings.NewReader(strings.Join(commits, "\n") + "\n")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git log: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	// Records: "\x01<hash>", then "<status>", "<path>" or "<status>",
	// "<from>", "<path>" for renames and copies; the first status after a
	// header starts with a newline.
	tokens := strings.Split(string(out), "\x00")
	var current string
	for i := 0; i < len(tokens); i++ {
		tok := strings.TrimLeft(tokens[i], "\n")
		switch {
		case tok == "":
			continue
		case tok[0] == '\x01':
			current = tok[1:]
			result[current] = nil
		case tok[0] == 'R' || tok[0] == 'C':
			if i+2 >= len(tokens) {
				return nil, fmt.Errorf("git log: truncated record in %s", current)
			}
			result[current] = append(result[current], Change{Status: tok[0], From: tokens[i+1], Path: tokens[i+2]})
			i += 2
		default:
			if i+1 >= len(tokens) {
				return nil, fmt.Errorf("git log: truncated record in %s", current)
			}
			result[current] = append(result[current], Change{Status: tok[0], Path: tokens[i+1]})
			i++
		}
	}
	return result, nil
}

// Ref is a branch, a tag or a commit, with the commit it points at.
type Ref struct {
	Name    string // short name, or the abbreviated hash of a commit
	Commit  string
	Subject string
	Time    int64 // committer date, Unix seconds
}

// refFormat prints a ref's full name, its commit (peeled for an annotated
// tag), subject and committer date, NUL-separated.
const refFormat = "%(refname)%00%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)%00%(if)%(*subject)%(then)%(*subject)%(else)%(subject)%(end)%00%(if)%(*committerdate:unix)%(then)%(*committerdate:unix)%(else)%(committerdate:unix)%(end)"

// Refs lists the branches and the tags, the most recently committed first.
func (r *Repo) Refs(ctx context.Context) (branches, tags []Ref, err error) {
	out, err := r.run(ctx, "for-each-ref", "--sort=-committerdate", "--format="+refFormat, "refs/heads", "refs/tags")
	if err != nil {
		return nil, nil, err
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(line, "\x00")
		if len(f) != 4 {
			continue
		}
		t, _ := strconv.ParseInt(f[3], 10, 64)
		ref := Ref{Commit: f[1], Subject: f[2], Time: t}
		if name, ok := strings.CutPrefix(f[0], "refs/heads/"); ok {
			ref.Name = name
			branches = append(branches, ref)
		} else if name, ok := strings.CutPrefix(f[0], "refs/tags/"); ok {
			ref.Name = name
			tags = append(tags, ref)
		}
	}
	return branches, tags, nil
}

// RecentCommits returns at most n commits reachable from HEAD, the newest
// first; none in a repository without commits.
func (r *Repo) RecentCommits(ctx context.Context, n int) ([]Ref, error) {
	head, err := r.Head(ctx)
	if err != nil || head == "" {
		return nil, err
	}
	out, err := r.run(ctx, "log", "-n", strconv.Itoa(n), "--no-show-signature", "--format=%h%x00%H%x00%s%x00%ct", head, "--")
	if err != nil {
		return nil, err
	}
	var refs []Ref
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(line, "\x00")
		if len(f) != 4 {
			continue
		}
		t, _ := strconv.ParseInt(f[3], 10, 64)
		refs = append(refs, Ref{Name: f[0], Commit: f[1], Subject: f[2], Time: t})
	}
	return refs, nil
}

// HeadBranch returns the branch HEAD is on, "" when it is detached.
func (r *Repo) HeadBranch(ctx context.Context) string {
	out, err := r.run(ctx, "symbolic-ref", "--short", "-q", "HEAD")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
