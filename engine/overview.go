package engine

import (
	"context"
	"fmt"

	"github.com/TristanShz/whimc/internal/modules"
)

// OverviewQuery selects the Files an Overview counts.
type OverviewQuery struct {
	// Tests counts test Files; when false they are left out, as on the Map,
	// and so are the commits that touched only them.
	Tests bool
}

// Overview sums up a whole State in a few figures, counting the Files the
// Map shows.
type Overview struct {
	// Size is the number of non-blank lines of every File.
	Size        int `json:"size"`
	Packages    int `json:"packages"`
	Directories int `json:"directories"`
	Files       int `json:"files"`
	// Dependencies is the number of File Dependencies.
	Dependencies int `json:"dependencies"`
	// Commits is the number of distinct commits of the Churn window that
	// touched any File: one commit touching several Packages counts once.
	Commits int `json:"commits"`
	// Languages splits Size by language, the largest first.
	Languages []LanguageSize `json:"languages"`
	// MovingPackage is the Package with the highest Churn, absent when no
	// Package moved within the Churn window.
	MovingPackage *MovingPackage `json:"movingPackage,omitempty"`
	// Partial is set while the first run has not reached every Package:
	// Size and the counts of Modules are whole, Dependencies and Commits
	// only cover the Packages reached so far.
	Partial bool `json:"partial"`
}

// LanguageSize is the Size of the Files of one language: "ts" (TypeScript
// and JavaScript) or "go".
type LanguageSize struct {
	Language string `json:"language"`
	Size     int    `json:"size"`
}

// MovingPackage names the Package that moved the most, and its Churn.
type MovingPackage struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Churn int    `json:"churn"`
}

func (w *workspace) Overview(ctx context.Context, at State, q OverviewQuery) (Overview, error) {
	snap, err := w.snapshot(ctx, at, w.warm.reached())
	if err != nil {
		return Overview{}, fmt.Errorf("overview: %w", err)
	}
	o := snap.tree.Overview(modules.Query{Tests: q.Tests}, snap.deps)
	out := Overview{
		Size: o.Size, Packages: o.Packages, Directories: o.Directories, Files: o.Files,
		Dependencies: o.Dependencies, Commits: o.Commits, Languages: []LanguageSize{},
		Partial: snap.partial,
	}
	for _, l := range o.Languages {
		out.Languages = append(out.Languages, LanguageSize{Language: string(l.Language), Size: l.Size})
	}
	if m := o.MovingPackage; m != nil {
		out.MovingPackage = &MovingPackage{ID: m.ID, Name: m.Name, Churn: m.Churn}
	}
	return out, nil
}
