package engine

import (
	"context"
	"fmt"
)

// RecentCommits is how many commits Refs lists.
const RecentCommits = 30

// Ref names a State to compare: a branch, a tag or a commit.
type Ref struct {
	// Name is what ParseState reads: a branch or tag name, or the
	// abbreviated hash of a commit.
	Name    string `json:"name"`
	Commit  string `json:"commit"`
	Subject string `json:"subject"`
	// Time is the committer date, in Unix seconds.
	Time int64 `json:"time"`
}

// Refs are the States a Comparison can pick, besides the working tree.
type Refs struct {
	// Head is the branch HEAD is on, empty when it is detached.
	Head string `json:"head"`
	// Branches and Tags come the most recently committed first.
	Branches []Ref `json:"branches"`
	Tags     []Ref `json:"tags"`
	// Commits are the last RecentCommits commits behind HEAD, newest first.
	Commits []Ref `json:"commits"`
}

func (w *workspace) Refs(ctx context.Context) (Refs, error) {
	branches, tags, err := w.repo.Refs(ctx)
	if err != nil {
		return Refs{}, fmt.Errorf("refs: %w", err)
	}
	commits, err := w.repo.RecentCommits(ctx, RecentCommits)
	if err != nil {
		return Refs{}, fmt.Errorf("refs: %w", err)
	}
	out := Refs{Head: w.repo.HeadBranch(ctx), Branches: []Ref{}, Tags: []Ref{}, Commits: []Ref{}}
	for _, r := range branches {
		out.Branches = append(out.Branches, Ref(r))
	}
	for _, r := range tags {
		out.Tags = append(out.Tags, Ref(r))
	}
	for _, r := range commits {
		out.Commits = append(out.Commits, Ref(r))
	}
	return out, nil
}
