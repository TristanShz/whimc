package engine

import (
	"context"
	"fmt"
	"path"
	"path/filepath"
	"sync/atomic"

	"github.com/TristanShz/whimc/internal/churn"
	"github.com/TristanShz/whimc/internal/gitrepo"
	"github.com/TristanShz/whimc/internal/index"
	"github.com/TristanShz/whimc/internal/modules"
	"github.com/TristanShz/whimc/internal/parse"
	"github.com/TristanShz/whimc/internal/resolve"
)

// source is how the Files of a State are read.
type source interface {
	// paths lists the Files of the State.
	paths(ctx context.Context) ([]string, error)
	// entry returns a File's blob hash, and its content when reading it was
	// needed to know the hash (nil otherwise: read it with read).
	entry(p string) (blob string, content []byte, err error)
	// read returns the content of the File at p whose blob entry gave, and
	// false when it is no longer that blob's.
	read(p, blob string) (content []byte, exact bool, err error)
}

// worktreeSource reads the working tree as revalidated (see revalidate).
type worktreeSource struct {
	repo  *gitrepo.Repo
	cache *worktreeCache
	order []string
	blobs map[string]string // by path
	// contents holds the content of the Files read while revalidating, and
	// of the manifests and configs.
	contents map[string][]byte
}

func (s *worktreeSource) paths(context.Context) ([]string, error) { return s.order, nil }

func (s *worktreeSource) entry(p string) (string, []byte, error) {
	return s.blobs[p], s.contents[p], nil
}

func (s *worktreeSource) read(p, blob string) ([]byte, bool, error) {
	content, now, err := s.repo.ReadWorkTree(p)
	if err != nil {
		return nil, false, err
	}
	if now != blob {
		// Written since it was hashed: the next snapshot hashes it again.
		s.cache.written([]string{p})
	}
	return content, now == blob, nil
}

// commitSource lists the tree of a commit; its blobs are known without
// reading them.
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

func (s *commitSource) entry(p string) (string, []byte, error) { return s.blobs[p], nil, nil }

func (s *commitSource) read(_, blob string) ([]byte, bool, error) {
	content, err := s.repo.ReadBlob(blob)
	return content, err == nil, err
}

// snapshot is the analysed form of one State.
type snapshot struct {
	tree *modules.Tree
	deps []modules.Edge
	// blobs holds the blob hash of every File of the tree, by path.
	blobs map[string]string
	// partial is set when the first run had not reached every Package: the
	// Files of the others have their Size but no Dependencies nor Churn yet.
	partial bool
	// unparsed are the Files left unparsed for that reason.
	unparsed []unparsedFile
	// placed is set once every Module of a complete snapshot has a frozen
	// position: positions are never deleted, so placing it again is moot.
	placed atomic.Bool
}

// unparsedFile is a File of a partial snapshot the first run has to parse.
type unparsedFile struct {
	path string
	pkg  string // the folder of its Package
}

// reached tells whether the first run reached the Package at a folder: its
// Files are parsed and their Churn counted. A nil reached has reached all.
type reached func(pkg string) bool

// snapshot returns the Module hierarchy of a State and its File
// Dependencies, as far as the first run reached (see reached), from the
// cache when the State did not change since (see snapshotCache).
func (w *workspace) snapshot(ctx context.Context, at State, done reached) (*snapshot, error) {
	if at.Ref == "" {
		return w.worktreeSnapshot(ctx, done)
	}
	return w.commitSnapshot(ctx, at.Ref, done)
}

// build builds the Module hierarchy of the State src reads and resolves its
// File Dependencies, with the Churn of the history behind commit ("" for
// none), as far as the first run reached.
func (w *workspace) build(ctx context.Context, src source, commit string, done reached) (*snapshot, error) {
	paths, err := src.paths(ctx)
	if err != nil {
		return nil, err
	}
	var manifests []modules.Manifest
	manifestDirs := map[string]bool{}
	configs := map[string][]byte{}
	type sourceFile struct {
		path    string
		key     index.BlobKey
		content []byte
	}
	var sources []sourceFile
	for _, p := range paths {
		kind := modules.Classify(p)
		if kind == modules.Ignored {
			continue
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		blob, content, err := src.entry(p)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", p, err)
		}
		if kind == modules.SourceFile {
			sources = append(sources, sourceFile{path: p, key: index.BlobKey{Blob: blob, Grammar: parse.Grammar(p)}, content: content})
			continue
		}
		if content == nil {
			if content, _, err = src.read(p, blob); err != nil {
				return nil, fmt.Errorf("read %s: %w", p, err)
			}
		}
		configs[p] = content
		if kind == modules.ManifestFile {
			manifests = append(manifests, modules.Manifest{Dir: path.Dir(p), Name: modules.ManifestName(p, content)})
			manifestDirs[path.Dir(p)] = true
		}
	}

	keys := make([]index.BlobKey, len(sources))
	for i, sf := range sources {
		keys[i] = sf.key
	}
	known, err := w.ix.Blobs(keys)
	if err != nil {
		return nil, fmt.Errorf("index: %w", err)
	}
	learnt := map[index.BlobKey]index.Blob{}
	snap := &snapshot{blobs: map[string]string{}}
	var files, churned []modules.File
	parsed := map[string]parse.Result{}
	for _, sf := range sources {
		pkg := modules.PackageOf(manifestDirs, sf.path)
		parseIt := done == nil || done(pkg)
		b, ok := known[sf.key]
		if !ok {
			b, ok = learnt[sf.key]
		}
		if !ok {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			content, exact := sf.content, true
			if content == nil {
				if content, exact, err = src.read(sf.path, sf.key.Blob); err != nil {
					return nil, fmt.Errorf("read %s: %w", sf.path, err)
				}
			}
			facts := modules.Analyze(content)
			b = index.Blob{Size: facts.Size, Generated: facts.Generated}
			if !facts.Generated && !parseIt {
				// Only its Size, until the first run reaches its Package.
				snap.partial = true
				snap.unparsed = append(snap.unparsed, unparsedFile{path: sf.path, pkg: pkg})
			} else {
				if !facts.Generated {
					r := parse.File(sf.path, content)
					w.parsedBlobs.Add(1)
					b.Parse = &r
				}
				if exact {
					learnt[sf.key] = b
				}
			}
		}
		if b.Generated {
			continue
		}
		f := modules.File{Path: sf.path, Size: b.Size, Test: modules.IsTest(sf.path)}
		files = append(files, f)
		snap.blobs[sf.path] = sf.key.Blob
		if b.Parse != nil {
			parsed[sf.path] = *b.Parse
		}
		if parseIt {
			churned = append(churned, f)
		} else {
			snap.partial = true
		}
	}
	if err := w.ix.PutBlobs(learnt); err != nil {
		return nil, fmt.Errorf("index: %w", err)
	}

	if len(churned) > 0 {
		if err := w.attributeChurn(ctx, commit, churned); err != nil {
			return nil, fmt.Errorf("churn: %w", err)
		}
		commits := make(map[string][]int, len(churned))
		for _, f := range churned {
			commits[f.Path] = f.Commits
		}
		for i := range files {
			files[i].Commits = commits[files[i].Path]
		}
	}
	snap.tree = modules.Build(filepath.Base(w.repo.Root()), manifests, files)
	for _, d := range resolve.Resolve(resolve.Snapshot{Files: parsed, Configs: configs}) {
		snap.deps = append(snap.deps, modules.Edge{From: d.From, To: d.To, Kind: d.Kind})
	}
	return snap, nil
}

// attributeChurn sets the commits of the Churn window that touched each File,
// walking the history behind commit.
func (w *workspace) attributeChurn(ctx context.Context, commit string, files []modules.File) error {
	if commit == "" {
		return nil
	}
	now := w.opts.Now()
	stamps, err := w.repo.CommitsSince(ctx, commit, now.Add(-w.opts.ChurnWindow))
	if err != nil {
		return err
	}
	var hashes []string
	for _, s := range stamps {
		if s.Time <= now.Unix() {
			hashes = append(hashes, s.Hash)
		}
	}
	changes, err := w.commitChanges(ctx, hashes)
	if err != nil {
		return err
	}
	commits := make([]churn.Commit, len(hashes))
	for i, h := range hashes {
		commits[i] = churn.Commit{Hash: h, Changes: changes[h]}
	}
	paths := make([]string, len(files))
	for i, f := range files {
		paths[i] = f.Path
	}
	touched := churn.Attribute(commits, paths)
	for i := range files {
		files[i].Commits = touched[files[i].Path]
	}
	return nil
}

// commitChanges returns the paths each commit touched, from the index when it
// knows the commit, from git otherwise.
func (w *workspace) commitChanges(ctx context.Context, hashes []string) (map[string][]gitrepo.Change, error) {
	changes, err := w.ix.Commits(hashes)
	if err != nil {
		return nil, fmt.Errorf("index: %w", err)
	}
	var missing []string
	for _, h := range hashes {
		if _, ok := changes[h]; !ok {
			missing = append(missing, h)
		}
	}
	if len(missing) == 0 {
		return changes, nil
	}
	read, err := w.repo.Changes(ctx, missing)
	if err != nil {
		return nil, err
	}
	w.diffedCommits.Add(int64(len(missing)))
	learnt := make(map[string][]gitrepo.Change, len(missing))
	for _, h := range missing {
		learnt[h] = read[h]
		changes[h] = read[h]
	}
	if err := w.ix.PutCommits(learnt); err != nil {
		return nil, fmt.Errorf("index: %w", err)
	}
	return changes, nil
}
