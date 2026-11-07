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
)

var (
	// ErrGitNotFound reports that no git executable is on PATH.
	ErrGitNotFound = errors.New("git was not found on PATH: install git (https://git-scm.com/downloads) and make sure the `git` command runs in your shell")
	// ErrNotARepository reports that a path is not inside a git work tree.
	ErrNotARepository = errors.New("not inside a git repository")
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

// ResolveCommit turns a commit, branch or tag into a commit hash.
func (r *Repo) ResolveCommit(ctx context.Context, ref string) (string, error) {
	out, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "--end-of-options", ref+"^{commit}")
	if err != nil {
		return "", fmt.Errorf("unknown ref %q: not a commit, branch or tag of %s", ref, r.root)
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
