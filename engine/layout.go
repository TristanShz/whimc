package engine

import (
	"fmt"
	"maps"
	"math"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"

	"github.com/TristanShz/whimc/internal/index"
	"github.com/TristanShz/whimc/internal/layout"
	"github.com/TristanShz/whimc/internal/modules"
)

// Radius is the radius of a Module's disc on the Map, in map coordinates: the
// square root of its Size (one line at least), shrunk by childScale at each
// level down. A disc's area is thus proportional to Size, and the Directories
// of a Package — whose Sizes add up to the Package's — fill about two thirds
// of its disc, as its Files fill their Directory's: zooming into a Module
// reveals its children inside and around it. Positions and radii share one
// coordinate system across the three levels.
func Radius(level Level, size int) float64 {
	return math.Sqrt(float64(max(size, 1))) * math.Pow(childScale, float64(level))
}

// childScale is how much smaller a child's disc is than a disc of the same
// Size one level up, so that siblings fit in their parent's disc.
const childScale = 0.8

// frozenLayout holds the positions of the Modules, as frozen in the index.
type frozenLayout struct {
	mu sync.Mutex
	at map[string]index.Point
	// draft holds the positions given while the first run had not resolved
	// every Dependency: kept in memory only, so that the positions frozen
	// at the end of the first run follow the Dependencies.
	draft map[string]index.Point
}

// position returns the frozen position of a Module, also of one no longer on
// the Map: its last known position. Before the first run ends, a Module not
// frozen yet has its draft position.
func (w *workspace) position(id string) (index.Point, bool) {
	w.layout.mu.Lock()
	defer w.layout.mu.Unlock()
	if p, ok := w.layout.at[id]; ok {
		return p, true
	}
	p, ok := w.layout.draft[id]
	return p, ok
}

// dropDraft forgets the draft positions, once the first run has resolved
// every Dependency.
func (w *workspace) dropDraft() {
	w.layout.mu.Lock()
	defer w.layout.mu.Unlock()
	w.layout.draft = nil
}

// place gives a position to every Module of snap that has none. Modules
// already placed keep theirs: new Modules are relaxed around them, Packages
// among the Packages, Directories in the disc of their Package, Files in the
// disc of their Directory. Placement does not depend on the tests switch:
// test Files are laid out too. A partial snapshot is only drafted: its new
// Modules get positions kept in memory, not frozen.
func (w *workspace) place(snap *snapshot) error {
	l := &w.layout
	l.mu.Lock()
	defer l.mu.Unlock()

	levels := [3][]modules.Node{}
	missing := false
	for lv := range levels {
		levels[lv] = snap.tree.Nodes(modules.Query{Level: modules.Level(lv), Tests: true})
		for _, n := range levels[lv] {
			_, frozen := l.at[n.ID]
			_, drafted := l.draft[n.ID]
			if !frozen && !(snap.partial && drafted) {
				missing = true
			}
		}
	}
	if !missing {
		return nil
	}
	if err := l.reload(w.ix); err != nil {
		return err
	}
	if snap.partial {
		at := maps.Clone(l.at)
		maps.Copy(at, l.draft)
		learnt := placeInto(at, snap, levels)
		separate(at, learnt)
		if l.draft == nil {
			l.draft = map[string]index.Point{}
		}
		maps.Copy(l.draft, learnt)
		return nil
	}
	learnt := placeInto(l.at, snap, levels)
	separate(l.at, learnt)
	if err := w.ix.PutLayout(learnt); err != nil {
		return fmt.Errorf("index: %w", err)
	}
	// Another process may have frozen some of these Modules first: its
	// positions are the ones kept.
	return l.reload(w.ix)
}

// placeInto places the Modules of levels missing from at, around the ones at
// holds, and returns their positions, also written into at.
func placeInto(at map[string]index.Point, snap *snapshot, levels [3][]modules.Node) map[string]index.Point {
	learnt := map[string]index.Point{}
	for lv, nodes := range levels {
		q := modules.Query{Level: modules.Level(lv), Tests: true}
		groups := map[string][]int{} // node indexes by parent
		for i, n := range nodes {
			groups[n.Parent] = append(groups[n.Parent], i)
		}
		var parents []string
		for p, members := range groups {
			for _, i := range members {
				if _, ok := at[nodes[i].ID]; !ok {
					parents = append(parents, p)
					break
				}
			}
		}
		if len(parents) == 0 {
			continue
		}
		sort.Strings(parents)
		deps := snap.tree.Dependencies(q, nodes, snap.deps)
		sizes := map[string]int{}
		if lv > 0 {
			for _, n := range levels[lv-1] {
				sizes[n.ID] = n.Size
			}
		}
		placed := make([]layout.Group, len(parents))
		for k, parent := range parents {
			g := layout.Group{Seed: parent}
			if parent != "" {
				c := at[parent]
				g.Center = layout.Point{X: c.X, Y: c.Y}
				g.Bound = Radius(Level(lv-1), sizes[parent])
			}
			slot := map[string]int{}
			for _, i := range groups[parent] {
				n := nodes[i]
				p, fixed := at[n.ID]
				slot[n.ID] = len(g.Nodes)
				g.Nodes = append(g.Nodes, layout.Node{
					ID: n.ID, Radius: Radius(Level(lv), n.Size), Fixed: fixed, Pos: layout.Point{X: p.X, Y: p.Y},
				})
			}
			for _, d := range deps {
				a, okA := slot[d.From]
				b, okB := slot[d.To]
				if okA && okB {
					g.Edges = append(g.Edges, layout.Edge{A: a, B: b, Weight: float64(d.Weight)})
				}
			}
			placed[k] = g
		}
		placeAll(placed)
		for _, g := range placed {
			for _, n := range g.Nodes {
				if !n.Fixed {
					p := index.Point{X: n.Pos.X, Y: n.Pos.Y}
					at[n.ID] = p
					learnt[n.ID] = p
				}
			}
		}
	}
	return learnt
}

// placeAll places groups in parallel: siblings of different parents do not
// interact, so the result is the same as placing them one by one.
func placeAll(groups []layout.Group) {
	next := atomic.Int64{}
	var wg sync.WaitGroup
	for range min(runtime.GOMAXPROCS(0), len(groups)) {
		wg.Go(func() {
			for k := next.Add(1) - 1; k < int64(len(groups)); k = next.Add(1) - 1 {
				layout.Place(&groups[k])
			}
		})
	}
	wg.Wait()
}

// reload reads the positions frozen in the index.
func (l *frozenLayout) reload(ix *index.Index) error {
	at, err := ix.Layout()
	if err != nil {
		return fmt.Errorf("index: %w", err)
	}
	l.at = at
	return nil
}

// separate nudges the newly placed Modules that share exact coordinates with
// another Module of at, so no two Modules sit at the same point.
func separate(at, learnt map[string]index.Point) {
	taken := make(map[index.Point]bool, len(at))
	for id, p := range at {
		if _, ok := learnt[id]; !ok {
			taken[p] = true
		}
	}
	ids := make([]string, 0, len(learnt))
	for id := range learnt {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		p := learnt[id]
		for step := 1; taken[p]; step++ {
			q := layout.Nudge(layout.Point{X: p.X, Y: p.Y}, id, step)
			p = index.Point{X: q.X, Y: q.Y}
		}
		taken[p] = true
		learnt[id] = p
		at[id] = p
	}
}

// inView reports whether a Module's disc meets the viewport r, whose corners
// may come in any order.
func inView(m Module, r Rect) bool {
	x0, x1 := math.Min(r.X0, r.X1), math.Max(r.X0, r.X1)
	y0, y1 := math.Min(r.Y0, r.Y1), math.Max(r.Y0, r.Y1)
	dx := m.X - math.Max(x0, math.Min(m.X, x1))
	dy := m.Y - math.Max(y0, math.Min(m.Y, y1))
	return dx*dx+dy*dy <= m.Radius*m.Radius
}
