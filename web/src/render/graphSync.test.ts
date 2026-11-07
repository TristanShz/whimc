import Graph from "graphology";
import { describe, expect, it } from "vitest";
import type { EdgeView, NodeView, ViewState } from "../viewState";
import { FADE_SECONDS } from "./attributes";
import { MAX_FORCED_MATCH_LABELS, syncGraph, type MapGraph } from "./graphSync";
import type { Palette } from "./scales";

const palette: Palette = {
  dark: false,
  canvas: [250, 250, 250],
  label: [20, 20, 20],
  halo: [250, 250, 250],
  muted: [100, 100, 100],
  edge: [180, 180, 180],
  cool: [140, 160, 190],
  warm: [140, 85, 224],
  hot: [226, 89, 28],
  focus: [43, 91, 215],
  added: [14, 152, 115],
  modified: [184, 134, 11],
  removed: [200, 60, 60],
};

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
    focus: null,
    changes: null,
    requests: { maps: [], compare: null },
  };
}

const newGraph = (): MapGraph => new Graph({ type: "directed" });

describe("syncing the view state into the graph", () => {
  it("adds the nodes and edges of the view, fading them in", () => {
    const g = newGraph();
    syncGraph(g, view([n("a"), n("b")], [e("a", "b")]), palette, 5);
    expect(g.nodes()).toEqual(["a", "b"]);
    expect(g.edges()).toEqual(["a->b"]);
    expect(g.getNodeAttributes("a")).toMatchObject({
      fade: 1,
      fadeFrom: 0,
      fadeAt: 5,
    });
    expect(g.getEdgeAttributes("a->b")).toMatchObject({ fadeFrom: 0 });
  });

  it("drops what left the view, its edges with it", () => {
    const g = newGraph();
    syncGraph(g, view([n("a"), n("b")], [e("a", "b")]), palette, 0);
    syncGraph(g, view([n("a")]), palette, 1);
    expect(g.nodes()).toEqual(["a"]);
    expect(g.size).toBe(0);
  });

  it("leaves unchanged nodes alone, so that the renderer has nothing to redo", () => {
    const g = newGraph();
    syncGraph(g, view([n("a")]), palette, 0);
    const before = g.getNodeAttributes("a");
    let updates = 0;
    g.on("nodeAttributesUpdated", () => updates++);
    syncGraph(g, view([n("a")]), palette, 3);
    expect(updates).toBe(0);
    expect(g.getNodeAttributes("a")).toBe(before);
  });

  it("starts a transition from the opacity on screen when the view dims a node", () => {
    const g = newGraph();
    syncGraph(g, view([n("a")]), palette, 0);
    syncGraph(
      g,
      view([
        n("a", { fade: 0.15, contextFade: 0.15, opacity: 0.15, dimmed: true }),
      ]),
      palette,
      FADE_SECONDS * 4,
    );
    expect(g.getNodeAttributes("a")).toMatchObject({
      fade: 0.15,
      fadeFrom: 1,
      fadeAt: FADE_SECONDS * 4,
    });
  });

  it("updates what changed while the opacity stays, such as the focus ring", () => {
    const g = newGraph();
    syncGraph(g, view([n("a")]), palette, 0);
    syncGraph(g, view([n("a", { selected: true, focused: true })]), palette, 1);
    expect(g.getNodeAttributes("a")).toMatchObject({
      ring: 1,
      forceLabel: true,
      fadeAt: 0,
    });
  });

  it("says until when a transition runs, so that the renderer keeps drawing", () => {
    const g = newGraph();
    expect(syncGraph(g, view([n("a")]), palette, 2)).toBe(2 + FADE_SECONDS);
    expect(syncGraph(g, view([n("a")]), palette, 9)).toBe(-Infinity);
  });

  it("forces the labels of search matches only while they are few", () => {
    const g = newGraph();
    const few = [n("a", { match: true }), n("b")];
    syncGraph(g, view(few), palette, 0);
    expect(g.getNodeAttribute("a", "forceLabel")).toBe(true);
    const many = Array.from({ length: MAX_FORCED_MATCH_LABELS + 1 }, (_, i) =>
      n(`m${i}`, { match: true }),
    );
    syncGraph(g, view(many), palette, 1);
    expect(g.getNodeAttribute("m0", "forceLabel")).toBe(false);
  });
});
