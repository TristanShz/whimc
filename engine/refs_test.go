package engine_test

import (
	"context"
	"testing"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

func TestRefsListBranchesTagsAndRecentCommits(t *testing.T) {
	r := testrepo.New(t)
	r.Write("a.ts", "export const a = 1\n")
	first := r.CommitAt("first", daysAgo(3))
	r.Git("tag", "-a", "v1", "-m", "release")
	r.Git("branch", "old")
	r.Write("a.ts", "export const a = 2\n")
	second := r.CommitAt("second", daysAgo(1))
	ws := open(t, r)

	refs, err := ws.Refs(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	head := r.Git("symbolic-ref", "--short", "HEAD")
	if refs.Head != head {
		t.Errorf("Head = %q, want %q", refs.Head, head)
	}
	names := func(rs []engine.Ref) (out []string) {
		for _, x := range rs {
			out = append(out, x.Name+"@"+x.Commit[:7]+" "+x.Subject)
		}
		return out
	}
	assertLines(t, names(refs.Branches), head+"@"+second[:7]+" second", "old@"+first[:7]+" first")
	assertLines(t, names(refs.Tags), "v1@"+first[:7]+" first")
	assertLines(t, names(refs.Commits), second[:7]+"@"+second[:7]+" second", first[:7]+"@"+first[:7]+" first")
	for _, c := range refs.Commits {
		if _, err := ws.Compare(context.Background(), engine.ParseState(c.Name), engine.State{}, engine.CompareQuery{}); err != nil {
			t.Errorf("a listed commit does not name a State: %v", err)
		}
	}
}

func TestARepositoryWithoutCommitsHasNoRefs(t *testing.T) {
	r := testrepo.New(t)
	r.Write("a.ts", "export const a = 1\n")

	refs, err := open(t, r).Refs(context.Background())

	if err != nil || len(refs.Branches)+len(refs.Tags)+len(refs.Commits) != 0 {
		t.Errorf("Refs = %+v, %v; want none", refs, err)
	}
}
