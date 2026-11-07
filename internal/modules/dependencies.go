package modules

import (
	"sort"

	"github.com/TristanShz/whimc/internal/parse"
)

// FileDependency is a Dependency between two Files, given by their paths.
type FileDependency struct {
	From, To string
	Kind     parse.Kind
}

// KindCounts counts File Dependencies by kind.
type KindCounts struct{ Runtime, TypeOnly, Dynamic int }

// Dependency is a Dependency between two Nodes of one level.
type Dependency struct {
	From, To string // Node IDs
	// Kind is runtime if any aggregated File Dependency is, else type-only if
	// any is, else dynamic.
	Kind parse.Kind
	// Weight is the number of File Dependencies aggregated.
	Weight int
	Counts KindCounts
}

// Dependencies aggregates File Dependencies to the level of nodes, the
// result of Nodes for the same Query. Only Dependencies between two of nodes
// are kept, and Dependencies inside one Module are dropped. The result is
// sorted by From then To.
func (t *Tree) Dependencies(q Query, nodes []Node, fileDeps []FileDependency) []Dependency {
	visible := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		visible[n.ID] = true
	}
	moduleOf := func(p string) (string, bool) {
		i, ok := t.byPath[p]
		if !ok {
			return "", false
		}
		f := t.files[i]
		if f.Test && !q.Tests {
			return "", false
		}
		id := f.moduleID(q.Level)
		return id, visible[id]
	}
	agg := map[[2]string]*KindCounts{}
	for _, fd := range fileDeps {
		from, ok1 := moduleOf(fd.From)
		to, ok2 := moduleOf(fd.To)
		if !ok1 || !ok2 || from == to {
			continue
		}
		key := [2]string{from, to}
		c := agg[key]
		if c == nil {
			c = &KindCounts{}
			agg[key] = c
		}
		switch fd.Kind {
		case parse.Runtime:
			c.Runtime++
		case parse.TypeOnly:
			c.TypeOnly++
		default:
			c.Dynamic++
		}
	}
	deps := make([]Dependency, 0, len(agg))
	for key, c := range agg {
		d := Dependency{From: key[0], To: key[1], Weight: c.Runtime + c.TypeOnly + c.Dynamic, Counts: *c}
		switch {
		case c.Runtime > 0:
			d.Kind = parse.Runtime
		case c.TypeOnly > 0:
			d.Kind = parse.TypeOnly
		default:
			d.Kind = parse.Dynamic
		}
		deps = append(deps, d)
	}
	sort.Slice(deps, func(i, j int) bool {
		if deps[i].From != deps[j].From {
			return deps[i].From < deps[j].From
		}
		return deps[i].To < deps[j].To
	})
	return deps
}
