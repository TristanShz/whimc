// Package layout places the nodes of one group of siblings on the Map: the
// Packages, the Directories of one Package, or the Files of one Directory. It
// is a force-directed relaxation — collisions keep nodes apart, Dependencies
// pull related nodes together, gravity and an optional bound keep the group
// in its parent's region — whose cost per iteration is linear in the group's
// size (collisions are found through grids of cells) and whose iteration count
// is bounded, so laying out a whole codebase stays roughly linear.
//
// Placement is deterministic: initial positions derive from node IDs and the
// group's seed only. Fixed nodes never move, so a group that gained a node is
// relaxed around its frozen members rather than laid out again.
package layout

import (
	"hash/fnv"
	"math"
	"slices"
	"sort"
)

// Point is a position on the Map, in map coordinates.
type Point struct{ X, Y float64 }

// Node is a node of a group.
type Node struct {
	ID     string
	Radius float64
	// Fixed nodes keep Pos; Place sets Pos of the others.
	Fixed bool
	Pos   Point
}

// Edge is a Dependency between two nodes of a group, by index in Nodes.
type Edge struct {
	A, B   int
	Weight float64
}

// Group is a set of siblings to place.
type Group struct {
	// Seed makes the layout of different groups differ; usually the parent ID.
	Seed string
	// Center is the point the group gathers around: the parent's position.
	Center Point
	// Bound is the radius around Center the nodes stay within, 0 for none.
	Bound float64
	Nodes []Node
	Edges []Edge
}

const (
	golden = math.Pi * (3 - 2.2360679774997896) // the golden angle
	// density is the share of the spiral's disc the nodes' discs cover.
	density = 0.6
	// gap is the clearance kept between two nodes, relative to the smaller.
	gap = 0.08
)

// Place sets the position of every node of g that is not Fixed.
func Place(g *Group) {
	var moving []int
	for i, n := range g.Nodes {
		if !n.Fixed {
			moving = append(moving, i)
		}
	}
	if len(moving) == 0 {
		return
	}
	if len(moving) == len(g.Nodes) {
		spiral(g)
	} else {
		seedNew(g, moving)
	}
	relax(g, moving, iterations(len(moving)))
}

// iterations bounds the relaxation: large groups get fewer passes, so the
// cost of a group grows linearly with its size.
func iterations(n int) int {
	switch {
	case n <= 100:
		return 160
	case n >= 2000:
		return 40
	}
	return 160 * 100 / n
}

// spiral lays out a group from scratch on a sunflower spiral, largest nodes
// first, which packs the discs densely before the relaxation.
func spiral(g *Group) {
	order := make([]int, len(g.Nodes))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		na, nb := g.Nodes[order[a]], g.Nodes[order[b]]
		if na.Radius != nb.Radius {
			return na.Radius > nb.Radius
		}
		return na.ID < nb.ID
	})
	start := angle(g.Seed)
	area := 0.0
	for k, i := range order {
		r := g.Nodes[i].Radius
		area += r * r / 2
		rho := math.Sqrt(area / density)
		area += r * r / 2
		theta := start + float64(k)*golden
		g.Nodes[i].Pos = Point{g.Center.X + rho*math.Cos(theta), g.Center.Y + rho*math.Sin(theta)}
	}
}

// seedNew gives each new node of a partly frozen group a starting point: the
// weighted mean of its already placed neighbours when it has some, a point of
// the parent's region otherwise.
func seedNew(g *Group, moving []int) {
	placed := make([]bool, len(g.Nodes))
	extent := 0.0
	for i, n := range g.Nodes {
		if n.Fixed {
			placed[i] = true
			extent = math.Max(extent, dist(n.Pos, g.Center)+n.Radius)
		}
	}
	adjacent := make([][]Edge, len(g.Nodes))
	for _, e := range g.Edges {
		adjacent[e.A] = append(adjacent[e.A], e)
		adjacent[e.B] = append(adjacent[e.B], Edge{A: e.B, B: e.A, Weight: e.Weight})
	}
	for _, i := range moving {
		n := &g.Nodes[i]
		a := angle(n.ID)
		var sx, sy, sw float64
		for _, e := range adjacent[i] {
			if placed[e.B] {
				w := math.Max(e.Weight, 1e-9)
				sx += g.Nodes[e.B].Pos.X * w
				sy += g.Nodes[e.B].Pos.Y * w
				sw += w
			}
		}
		switch {
		case sw > 0:
			n.Pos = Point{sx/sw + n.Radius*math.Cos(a), sy/sw + n.Radius*math.Sin(a)}
		case g.Bound > 0:
			rho := math.Max(g.Bound-n.Radius, g.Bound/2)
			n.Pos = Point{g.Center.X + rho*math.Cos(a), g.Center.Y + rho*math.Sin(a)}
		default:
			rho := extent + n.Radius
			n.Pos = Point{g.Center.X + rho*math.Cos(a), g.Center.Y + rho*math.Sin(a)}
		}
		placed[i] = true
	}
}

// relax runs the force simulation, moving only the nodes of moving.
func relax(g *Group, moving []int, iters int) {
	nodes := g.Nodes
	movable := make([]bool, len(nodes))
	for _, i := range moving {
		movable[i] = true
	}
	maxWeight := 0.0
	for _, e := range g.Edges {
		maxWeight = math.Max(maxWeight, e.Weight)
	}
	grid := newGrid(nodes)
	for it := range iters {
		alpha := 1 - float64(it)/float64(iters)

		// Dependencies pull related nodes towards contact.
		for _, e := range g.Edges {
			a, b := &nodes[e.A], &nodes[e.B]
			if !movable[e.A] && !movable[e.B] {
				continue
			}
			d := dist(a.Pos, b.Pos)
			rest := (a.Radius + b.Radius) * (1 + gap)
			if d <= rest || d == 0 {
				continue
			}
			f := 0.1 * alpha * math.Sqrt(e.Weight/maxWeight) * (d - rest) / d
			dx, dy := (b.Pos.X-a.Pos.X)*f, (b.Pos.Y-a.Pos.Y)*f
			share(a, b, movable[e.A], movable[e.B], dx, dy)
		}

		// Gravity gathers the group around its centre; the bound keeps it in
		// its parent's region.
		for _, i := range moving {
			n := &nodes[i]
			n.Pos.X += (g.Center.X - n.Pos.X) * 0.02 * alpha
			n.Pos.Y += (g.Center.Y - n.Pos.Y) * 0.02 * alpha
			if g.Bound > 0 {
				limit := math.Max(g.Bound-n.Radius, 0)
				if d := dist(n.Pos, g.Center); d > limit && d > 0 {
					k := 1 - 0.5*(d-limit)/d
					n.Pos = Point{g.Center.X + (n.Pos.X-g.Center.X)*k, g.Center.Y + (n.Pos.Y-g.Center.Y)*k}
				}
			}
		}

		// Collisions push overlapping nodes apart, at full strength.
		grid.fill(nodes)
		grid.pairs(nodes, func(i, j int) {
			if !movable[i] && !movable[j] {
				return
			}
			a, b := &nodes[i], &nodes[j]
			small := a.Radius
			if b.Radius < small {
				small = b.Radius
			}
			want := a.Radius + b.Radius + gap*small
			dx, dy := b.Pos.X-a.Pos.X, b.Pos.Y-a.Pos.Y
			d2 := dx*dx + dy*dy
			if d2 >= want*want {
				return
			}
			d := math.Sqrt(d2)
			if d == 0 {
				t := angle(a.ID + "\x00" + b.ID)
				dx, dy, d = math.Cos(t), math.Sin(t), 1
			}
			f := -(want - d) / d
			share(a, b, movable[i], movable[j], dx*f, dy*f)
		})

		// Whatever the crowding, a node's centre stays in its parent's disc.
		if g.Bound > 0 {
			for _, i := range moving {
				n := &nodes[i]
				if d := dist(n.Pos, g.Center); d > g.Bound*0.95 {
					k := g.Bound * 0.95 / d
					n.Pos = Point{g.Center.X + (n.Pos.X-g.Center.X)*k, g.Center.Y + (n.Pos.Y-g.Center.Y)*k}
				}
			}
		}
	}
}

// share moves a by (dx, dy) and b by the opposite, splitting the move between
// them when both may move.
func share(a, b *Node, moveA, moveB bool, dx, dy float64) {
	switch {
	case moveA && moveB:
		a.Pos.X += dx / 2
		a.Pos.Y += dy / 2
		b.Pos.X -= dx / 2
		b.Pos.Y -= dy / 2
	case moveA:
		a.Pos.X += dx
		a.Pos.Y += dy
	case moveB:
		b.Pos.X -= dx
		b.Pos.Y -= dy
	}
}

// grid finds the pairs of nodes whose discs may overlap. Nodes are bucketed
// by size class (radii within a factor of two), each class in a dense grid of
// cells as wide as its largest disc; a node looks for overlaps in the 3×3
// cells around it in the grids of its own class and of every larger class.
// Each pass is linear in the number of nodes, whatever the spread of radii.
// Small groups are checked pair by pair.
type grid struct {
	class   []int // size class of each node
	classes []classGrid
}

type classGrid struct {
	members []int32
	reach   float64 // the largest radius of the class, with the gap
	cell    float64
	x0, y0  float64
	nx, ny  int
	start   []int32 // per cell, into items; len nx*ny+1
	items   []int32
}

// bruteForce is the group size up to which pairs are checked one by one.
const bruteForce = 48

func newGrid(nodes []Node) *grid {
	g := &grid{class: make([]int, len(nodes))}
	if len(nodes) <= bruteForce {
		return g
	}
	minR := math.Inf(1)
	for _, n := range nodes {
		if n.Radius > 0 {
			minR = math.Min(minR, n.Radius)
		}
	}
	for i, n := range nodes {
		c := 0
		if n.Radius > minR {
			c = int(math.Log2(n.Radius / minR))
		}
		for len(g.classes) <= c {
			g.classes = append(g.classes, classGrid{})
		}
		g.class[i] = c
		g.classes[c].members = append(g.classes[c].members, int32(i))
		g.classes[c].reach = math.Max(g.classes[c].reach, n.Radius*(1+gap))
	}
	return g
}

// fill buckets the nodes of each class at their current positions.
func (g *grid) fill(nodes []Node) {
	for c := range g.classes {
		cg := &g.classes[c]
		if len(cg.members) == 0 {
			continue
		}
		x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
		for _, i := range cg.members {
			p := nodes[i].Pos
			x0, y0 = math.Min(x0, p.X), math.Min(y0, p.Y)
			x1, y1 = math.Max(x1, p.X), math.Max(y1, p.Y)
		}
		cg.cell = math.Max(2*cg.reach, 1e-9)
		// Keep the grid within a few cells per member, however sparse.
		for (x1-x0)/cg.cell*(y1-y0)/cg.cell > float64(4*len(cg.members)+16) {
			cg.cell *= 2
		}
		cg.x0, cg.y0 = x0, y0
		cg.nx, cg.ny = int((x1-x0)/cg.cell)+1, int((y1-y0)/cg.cell)+1
		cells := cg.nx * cg.ny
		cg.start = slices.Grow(cg.start[:0], cells+1)[:cells+1]
		clear(cg.start)
		for _, i := range cg.members {
			cg.start[cg.cellOf(nodes[i].Pos)+1]++
		}
		for k := 1; k <= cells; k++ {
			cg.start[k] += cg.start[k-1]
		}
		cg.items = slices.Grow(cg.items[:0], len(cg.members))[:len(cg.members)]
		fillAt := slices.Clone(cg.start[:cells])
		for _, i := range cg.members {
			k := cg.cellOf(nodes[i].Pos)
			cg.items[fillAt[k]] = i
			fillAt[k]++
		}
	}
}

func (cg *classGrid) cellOf(p Point) int {
	cx := min(max(int((p.X-cg.x0)/cg.cell), 0), cg.nx-1)
	cy := min(max(int((p.Y-cg.y0)/cg.cell), 0), cg.ny-1)
	return cy*cg.nx + cx
}

// pairs calls f once for each pair of nodes close enough to overlap, and
// possibly for a few that are not.
func (g *grid) pairs(nodes []Node, f func(i, j int)) {
	if len(g.classes) == 0 {
		for i := range nodes {
			for j := i + 1; j < len(nodes); j++ {
				f(i, j)
			}
		}
		return
	}
	for i, n := range nodes {
		for c := g.class[i]; c < len(g.classes); c++ {
			cg := &g.classes[c]
			if len(cg.members) == 0 {
				continue
			}
			reach := n.Radius*(1+gap) + cg.reach
			cx0 := max(int((n.Pos.X-reach-cg.x0)/cg.cell), 0)
			cx1 := min(int((n.Pos.X+reach-cg.x0)/cg.cell), cg.nx-1)
			cy0 := max(int((n.Pos.Y-reach-cg.y0)/cg.cell), 0)
			cy1 := min(int((n.Pos.Y+reach-cg.y0)/cg.cell), cg.ny-1)
			if n.Pos.X+reach < cg.x0 || n.Pos.Y+reach < cg.y0 {
				continue
			}
			for cy := cy0; cy <= cy1; cy++ {
				for cx := cx0; cx <= cx1; cx++ {
					k := cy*cg.nx + cx
					for _, j := range cg.items[cg.start[k]:cg.start[k+1]] {
						if c == g.class[i] && int(j) <= i {
							continue
						}
						f(i, int(j))
					}
				}
			}
		}
	}
}

func dist(a, b Point) float64 { return math.Hypot(a.X-b.X, a.Y-b.Y) }

// angle derives a stable angle from s.
func angle(s string) float64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return float64(h.Sum64()%1_000_000) / 1_000_000 * 2 * math.Pi
}

// Nudge returns a point a hair away from p, in a direction derived from id:
// used to keep two nodes from sharing exact coordinates.
func Nudge(p Point, id string, step int) Point {
	a := angle(id)
	d := math.Max(math.Max(math.Abs(p.X), math.Abs(p.Y)), 1) * 1e-9 * float64(step)
	return Point{p.X + d*math.Cos(a), p.Y + d*math.Sin(a)}
}
