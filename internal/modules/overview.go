package modules

import (
	"cmp"
	"slices"

	"github.com/TristanShz/whimc/internal/parse"
)

// Overview sums up a whole State in a few figures.
type Overview struct {
	Size                  int
	Packages, Directories int
	Files                 int
	Dependencies          int
	Commits               int
	Languages             []LanguageSize // the largest first
	MovingPackage         *Node          // the Package with the highest Churn, nil when none moved
}

// LanguageSize is the Size of the Files of one language.
type LanguageSize struct {
	Language parse.Language
	Size     int
}

// Overview sums up the Files q keeps (test Files only when q.Tests): their
// Size by language, how many Packages, Directories and Files hold them, the
// File Dependencies between them, the distinct commits of the Churn window
// that touched any of them, and the Package that moved the most. Within and
// Level are ignored: an Overview is of the whole State.
func (t *Tree) Overview(q Query, fileDeps []FileDependency) Overview {
	var o Overview
	pkgs := map[string]map[int]bool{} // the commits touching each Package
	dirs := map[string]bool{}
	commits := map[int]bool{}
	langs := map[parse.Language]int{}
	for _, f := range t.files {
		if f.Test && !q.Tests {
			continue
		}
		o.Files++
		o.Size += f.Size
		langs[parse.LanguageOf(f.Path)] += f.Size
		dirs[f.dir] = true
		touched := pkgs[f.pkg]
		if touched == nil {
			touched = map[int]bool{}
			pkgs[f.pkg] = touched
		}
		for _, c := range f.Commits {
			commits[c] = true
			touched[c] = true
		}
	}
	o.Packages, o.Directories, o.Commits = len(pkgs), len(dirs), len(commits)
	for lang, size := range langs {
		o.Languages = append(o.Languages, LanguageSize{Language: lang, Size: size})
	}
	slices.SortFunc(o.Languages, func(a, b LanguageSize) int {
		return cmp.Or(cmp.Compare(b.Size, a.Size), cmp.Compare(a.Language, b.Language))
	})

	kept := func(p string) bool {
		i, ok := t.byPath[p]
		return ok && (q.Tests || !t.files[i].Test)
	}
	for _, d := range fileDeps {
		if kept(d.From) && kept(d.To) {
			o.Dependencies++
		}
	}

	best, churn := "", 0
	for p, touched := range pkgs {
		if n := len(touched); n > churn || (n == churn && n > 0 && p < best) {
			best, churn = p, n
		}
	}
	if churn > 0 {
		o.MovingPackage = &Node{
			ID: ID(Packages, best), Level: Packages, Name: t.packages[best].name, Path: best, Churn: churn,
		}
	}
	return o
}
