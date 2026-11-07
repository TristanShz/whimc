import Graph from "graphology";
import { describe, expect, it } from "vitest";
import { testPalette } from "./palette.fixture";
import type { EdgeView, NodeView, ViewState } from "../viewState";
import { FADE_SECONDS } from "./attributes";
import {
  BULK_UPDATE,
  MIN_RETIRED,
  edgeBudget,
  MAX_FORCED_MATCH_LABELS,
  syncGraph,
  type MapGraph,
} from "./graphSync";
import type { Palette } from "./scales";

const palette: Palette = testPalette;

const n = (id: string, extra: Partial<NodeView> = {}): NodeView => ({
  id,
  level: "packages",
  name: id,
  path: id,
  parent: null,
  x: 0,
  y: 0,
  radius: 10,
  size: 100,
  churn: 0,
  heat: 0,
  test: false,
  levelWeight: 1,
  fade: 1,
  contextFade: 1,
  opacity: 1,
  focused: false,
  selected: false,
  match: false,
  highlighted: false,
  dimmed: false,
  change: null,
  changedFiles: 0,
  ghost: false,
  ...extra,
});

const e = (from: string, to: string): EdgeView => ({
  id: `${from}->${to}`,
  from,
  to,
  level: "packages",
  kind: "runtime",
  weight: 1,
  strength: 1,
  opacity: 1,
  highlighted: false,
  dimmed: false,
  change: null,
  ghost: false,
});

function view(nodes: NodeView[], edges: EdgeView[] = []): ViewState {
  return {
    level: "packages",
    depth: 0,
    levelWeights: { packages: 1, directories: 0, files: 0 },
    nodes,
    edges,
    churnMax: { packages: 0, directories: 0, files: 0 },
    focus: null,
    changes: null,
    requests: { maps: [], compare: null },
  };
}

/** The graph sigma draws, as syncGraph hands it back. */
class Drawn {
  g: MapGraph = new Graph({ type: "directed" });
  sync(v: ViewState, now: number): number {
    const r = syncGraph(this.g, v, palette, now);
    this.g = r.graph;
    return r.until;
  }
}

describe("syncing the view state into the graph", () => {
  it("adds the nodes and edges of the view, fading them in", () => {
    const d = new Drawn();
    d.sync(view([n("a"), n("b")], [e("a", "b")]), 5);
    expect(d.g.nodes()).toEqual(["a", "b"]);
    expect(d.g.edges()).toEqual(["a->b"]);
    expect(d.g.getNodeAttributes("a")).toMatchObject({
      fade: 1,
      fadeFrom: 0,
      fadeAt: 5,
    });
    expect(d.g.getEdgeAttributes("a->b")).toMatchObject({ fadeFrom: 0 });
  });

  it("leaves unchanged nodes alone, so that the renderer has nothing to redo", () => {
    const d = new Drawn();
    d.sync(view([n("a")]), 0);
    const before = d.g.getNodeAttributes("a");
    let updates = 0;
    d.g.on("nodeAttributesUpdated", () => updates++);
    d.sync(view([n("a")]), 3);
    expect(updates).toBe(0);
    expect(d.g.getNodeAttributes("a")).toBe(before);
  });

  it("starts a transition from the opacity on screen when the view dims a node", () => {
    const d = new Drawn();
    d.sync(view([n("a")]), 0);
    d.sync(
      view([
        n("a", { fade: 0.15, contextFade: 0.15, opacity: 0.15, dimmed: true }),
      ]),
      FADE_SECONDS * 4,
    );
    expect(d.g.getNodeAttributes("a")).toMatchObject({
      fade: 0.15,
      fadeFrom: 1,
      fadeAt: FADE_SECONDS * 4,
    });
  });

  it("updates what changed while the opacity stays, such as the focus ring", () => {
    const d = new Drawn();
    d.sync(view([n("a")]), 0);
    d.sync(view([n("a", { selected: true, focused: true })]), 1);
    expect(d.g.getNodeAttributes("a")).toMatchObject({
      ring: 1,
      forceLabel: true,
      fadeAt: 0,
    });
  });

  it("says until when a transition runs, so that the renderer keeps drawing", () => {
    const d = new Drawn();
    expect(d.sync(view([n("a")]), 2)).toBe(2 + FADE_SECONDS);
    expect(d.sync(view([n("a")]), 9)).toBe(-Infinity);
  });

  it("forces the labels of search matches only while they are few", () => {
    const d = new Drawn();
    const few = [n("a", { match: true }), n("b")];
    d.sync(view(few), 0);
    expect(d.g.getNodeAttribute("a", "forceLabel")).toBe(true);
    const many = Array.from({ length: MAX_FORCED_MATCH_LABELS + 1 }, (_, i) =>
      n(`m${i}`, { match: true }),
    );
    d.sync(view(many), 1);
    expect(d.g.getNodeAttribute("m0", "forceLabel")).toBe(false);
  });

  it("fades out what left the view, its edges with it, and keeps it invisible", () => {
    const d = new Drawn();
    d.sync(view([n("a"), n("b")], [e("a", "b")]), 0);
    const until = d.sync(view([n("a")]), 1);
    expect(until).toBe(1 + FADE_SECONDS);
    expect(d.g.getNodeAttributes("b")).toMatchObject({
      fade: 0,
      fadeFrom: 1,
      fadeAt: 1,
    });
    expect(d.g.getEdgeAttribute("a->b", "fade")).toBe(0);
    // What comes back fades in from where it is.
    d.sync(view([n("a"), n("b")], [e("a", "b")]), 1 + FADE_SECONDS);
    expect(d.g.getNodeAttributes("b")).toMatchObject({
      fade: 1,
      fadeFrom: 0,
    });
  });

  it("drops what left the view in one new graph once it outnumbers the rest", () => {
    // Sigma reindexes the whole graph for every node or edge dropped.
    const d = new Drawn();
    const ids = Array.from({ length: MIN_RETIRED + 100 }, (_, i) => `n${i}`);
    const all = ids.map((id) => n(id));
    d.sync(view(all), 0);
    const old = d.g;
    let drops = 0;
    old.on("nodeDropped", () => drops++);
    d.sync(view(all.slice(0, 50)), 1);
    expect(drops).toBe(0);
    expect(d.g).not.toBe(old);
    expect(d.g.order).toBe(50);
  });

  it("keeps the fade on screen of what stays in a new graph", () => {
    const d = new Drawn();
    d.sync(view([n("a")]), 0);
    const many = Array.from({ length: BULK_UPDATE * 2 }, (_, i) => n(`m${i}`));
    d.sync(view([n("a"), ...many]), 10);
    expect(d.g.getNodeAttributes("a")).toMatchObject({
      fadeFrom: 0,
      fadeAt: 0,
    });
    expect(d.g.getNodeAttribute("m0", "fadeAt")).toBe(10);
  });

  it("adds a few items to the graph it has, and many by a new one", () => {
    const d = new Drawn();
    const ids = Array.from({ length: BULK_UPDATE * 2 }, (_, i) => `n${i}`);
    d.sync(view([n("n0")]), 0);
    const first = d.g;
    d.sync(view([n("n0"), n("n1")]), 1);
    expect(d.g).toBe(first);
    d.sync(view(ids.map((id) => n(id))), 2);
    expect(d.g).not.toBe(first);
    expect(d.g.order).toBe(ids.length);
  });

  it("updates many changed nodes in one event", () => {
    const d = new Drawn();
    const ids = Array.from({ length: BULK_UPDATE * 2 }, (_, i) => `n${i}`);
    d.sync(view(ids.map((id) => n(id))), 0);
    let single = 0;
    let bulk = 0;
    d.g.on("nodeAttributesUpdated", () => single++);
    d.g.on("eachNodeAttributesUpdated", () => bulk++);
    d.sync(view(ids.map((id) => n(id, { fade: 0.15, contextFade: 0.15 }))), 1);
    expect([single, bulk]).toEqual([0, 1]);
    expect(d.g.getNodeAttribute("n0", "fade")).toBe(0.15);
  });
});

describe("the Dependencies drawn per level", () => {
  const strong = (
    id: string,
    strength: number,
    extra: Partial<EdgeView> = {},
  ) => ({
    ...e(id, `${id}'`),
    strength,
    ...extra,
  });

  it("keeps every Dependency singled out, then the strongest", () => {
    const edges = [
      strong("a", 0.1),
      strong("b", 0.9),
      strong("c", 0.5),
      strong("d", 0, { highlighted: true }),
      strong("e", 0, { change: "added" }),
    ];
    expect(edgeBudget(edges, 3).map((x) => x.from)).toEqual(["d", "e", "b"]);
  });

  it("counts each level apart and leaves a level under budget as it is", () => {
    const edges = [
      strong("a", 0.1),
      strong("b", 0.9),
      strong("f", 0.2, { level: "files" }),
    ];
    expect(edgeBudget(edges, 1).map((x) => x.from)).toEqual(["b", "f"]);
    expect(edgeBudget(edges, 2)).toEqual(edges);
  });
});
