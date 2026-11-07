package engine

import (
	"context"
	"fmt"
	"path"
	"path/filepath"

	"github.com/TristanShz/whimc/internal/gitrepo"
	"github.com/TristanShz/whimc/internal/modules"
)

// source is how the content of a State's Files is read.
type source interface {
	// paths lists the Files of the State.
	paths(ctx context.Context) ([]string, error)
	// read returns a File's content and blob hash.
	read(p string) (content []byte, blob string, err error)
}

// worktreeSource reads the working tree as on disk.
type worktreeSource struct{ repo *gitrepo.Repo }

func (s worktreeSource) paths(ctx context.Context) ([]string, error) {
	return s.repo.ListWorkTree(ctx)
}

func (s worktreeSource) read(p string) ([]byte, string, error) {
	return s.repo.ReadWorkTree(p)
}

// commitSource reads the tree of a commit through `git cat-file --batch`.
type commitSource struct {
	repo  *gitrepo.Repo
	blobs map[string]string // by path
	order []string
}

func newCommitSource(ctx context.Context, repo *gitrepo.Repo, commit string) (*commitSource, error) {
	entries, err := repo.ListCommit(ctx, commit)
	if err != nil {
		return nil, err
	}
	s := &commitSource{repo: repo, blobs: make(map[string]string, len(entries))}
	for _, e := range entries {
		s.blobs[e.Path] = e.Blob
		s.order = append(s.order, e.Path)
	}
	return s, nil
}

func (s *commitSource) paths(context.Context) ([]string, error) { return s.order, nil }

func (s *commitSource) read(p string) ([]byte, string, error) {
	blob := s.blobs[p]
	content, err := s.repo.ReadBlob(blob)
	return content, blob, err
}

// sourceOf opens the source of a State.
func (w *workspace) sourceOf(ctx context.Context, at State) (source, error) {
	if at.Ref == "" {
		return worktreeSource{w.repo}, nil
	}
	commit, err := w.repo.ResolveCommit(ctx, at.Ref)
	if err != nil {
		return nil, err
	}
	return newCommitSource(ctx, w.repo, commit)
}

// tree builds the Module hierarchy of a State.
func (w *workspace) tree(ctx context.Context, at State) (*modules.Tree, error) {
	src, err := w.sourceOf(ctx, at)
	if err != nil {
		return nil, err
	}
	paths, err := src.paths(ctx)
	if err != nil {
		return nil, err
	}
	var manifests []modules.Manifest
	var files []modules.File
	for _, p := range paths {
		kind := modules.Classify(p)
		if kind == modules.Ignored {
			continue
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		content, _, err := src.read(p)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", p, err)
		}
		switch kind {
		case modules.ManifestFile:
			manifests = append(manifests, modules.Manifest{Dir: path.Dir(p), Name: modules.ManifestName(p, content)})
		case modules.SourceFile:
			facts := modules.Analyze(content)
			if facts.Generated {
				continue
			}
			files = append(files, modules.File{Path: p, Size: facts.Size, Test: modules.IsTest(p)})
		}
	}
	return modules.Build(filepath.Base(w.repo.Root()), manifests, files), nil
}
