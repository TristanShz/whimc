// Brings the graphology graph sigma draws in line with the view state, with
// as few graph events as possible: sigma reprocesses each item an event
// touches, and reindexes the whole graph for every item dropped, so that
// dropping items one by one costs the square of the graph.

import Graph from "graphology";
import type { EdgeView, ViewState } from "../viewState";
import {
  FADE_SECONDS,
  edgeAttributes,
  nodeAttributes,
  retarget,
  type EdgeAttributes,
  type Fade,
  type NodeAttributes,
} from "./attributes";
import { edgeDensity, type Palette } from "./scales";

export type MapGraph = Graph<NodeAttributes, EdgeAttributes>;

/** The most Dependencies drawn per level: see edgeBudget. */
export const MAX_EDGES_PER_LEVEL = 3000;

/**
 * Items that left the view are kept, invisible, up to this many or as many
 * as the items in view.
 */
export const MIN_RETIRED = 4000;

/** Beyond this many search matches, their labels are left to the label grid. */
export const MAX_FORCED_MATCH_LABELS = 40;

/**
 * Beyond this many changed items, they are updated in one graph event over
 * every item rather than one event each.
 */
export const BULK_UPDATE = 64;

function same<T extends object>(a: T, b: T): boolean {
  for (const k in a) if (a[k] !== b[k]) return false;
  return true;
}

/** Which keys differ between two attribute sets. */
function changedKeys<T extends object>(a: T, b: T, into: Set<keyof T>) {
  for (const k in a) if (a[k] !== b[k]) into.add(k);
}

interface Plan<A> {
  /** Every item to draw, with its attributes. */
  next: Map<string, A>;
  /** Items already drawn whose attributes change. */
  changed: Set<string>;
  /** The attributes that change. */
  keys: Set<keyof A>;
  until: number;
}

function plan<A extends object & { fadeAt: number }>(
  items: Iterable<readonly [string, object & { fade: number }]>,
  prevOf: (id: string) => A | undefined,
  now: number,
): Plan<A> {
  const out: Plan<A> = {
    next: new Map(),
    changed: new Set(),
    keys: new Set(),
    until: -Infinity,
  };
  for (const [id, target] of items) {
    const prev = prevOf(id);
    const next = {
      ...target,
      ...retarget(prev as never, target.fade, now),
    } as unknown as A;
    if (prev && same(prev, next)) {
      out.next.set(id, prev);
      continue;
    }
    if (!prev || prev.fadeAt !== next.fadeAt)
      out.until = Math.max(out.until, now + FADE_SECONDS);
    if (prev) {
      out.changed.add(id);
      changedKeys(prev, next, out.keys);
    }
    out.next.set(id, next);
  }
  return out;
}

/**
 * Brings the graph in line with `view` at `now` (seconds on the render clock)
 * and returns the graph to draw, the same one or a new one built whole, and
 * until when an opacity transition runs (-Infinity for none).
 *
 * What leaves the view fades out and stays in the graph, invisible, until
 * there is more of it than of the rest: sigma reindexes the whole graph for
 * each item dropped, and a level left behind often comes back. Many items
 * arriving, or too many retired ones, make a new graph, which sigma takes in
 * one pass, rather than one event per item.
 */
export function syncGraph(
  graph: MapGraph,
  view: ViewState,
  palette: Palette,
  now: number,
): { graph: MapGraph; until: number } {
  const matches = view.nodes.reduce((k, n) => k + (n.match ? 1 : 0), 0);
  const opts = { matchLabels: matches <= MAX_FORCED_MATCH_LABELS };

  const nodes = plan<NodeAttributes>(
    view.nodes.map((n) => [n.id, nodeAttributes(n, palette, opts)] as const),
    (id) => (graph.hasNode(id) ? graph.getNodeAttributes(id) : undefined),
    now,
  );

  const drawn = edgeBudget(view.edges);
  const perLevel = new Map<string, number>();
  for (const e of drawn)
    perLevel.set(e.level, (perLevel.get(e.level) ?? 0) + 1);
  const ends = new Map<string, readonly [string, string]>();
  const edges = plan<EdgeAttributes>(
    drawn
      .filter((e) => nodes.next.has(e.from) && nodes.next.has(e.to))
      .map((e) => {
        ends.set(e.id, [e.from, e.to]);
        const a = edgeAttributes(
          e,
          palette,
          view.levelWeights[e.level],
          edgeDensity(perLevel.get(e.level) ?? 0),
        );
        return [e.id, a] as const;
      }),
    (id) => (graph.hasEdge(id) ? graph.getEdgeAttributes(id) : undefined),
    now,
  );

  let arriving = 0;
  for (const id of nodes.next.keys()) if (!graph.hasNode(id)) arriving++;
  for (const id of edges.next.keys()) if (!graph.hasEdge(id)) arriving++;
  const live = nodes.next.size + edges.next.size;
  let retired = 0;
  graph.forEachNode((id) => {
    if (!nodes.next.has(id)) retired++;
  });
  graph.forEachEdge((id) => {
    if (!edges.next.has(id)) retired++;
  });

  if (retired > Math.max(MIN_RETIRED, live) || arriving > BULK_UPDATE) {
    const fresh: MapGraph = new Graph({ type: "directed" });
    for (const [id, a] of nodes.next) fresh.addNode(id, a);
    for (const [id, a] of edges.next) {
      const [from, to] = ends.get(id)!;
      fresh.addDirectedEdgeWithKey(id, from, to, a);
    }
    // Retired items fading out keep fading out, unless there are too many.
    if (retired <= Math.max(MIN_RETIRED, live)) {
      graph.forEachNode((id, a) => {
        if (!fresh.hasNode(id)) fresh.addNode(id, retire(a, now));
      });
      graph.forEachEdge((id, a, from, to) => {
        if (!fresh.hasEdge(id))
          fresh.addDirectedEdgeWithKey(id, from, to, retire(a, now));
      });
    }
    return {
      graph: fresh,
      until: Math.max(nodes.until, edges.until, now + FADE_SECONDS),
    };
  }

  // Retire what left the view: fade it out where it is.
  let until = Math.max(nodes.until, edges.until);
  graph.forEachNode((id, a) => {
    if (nodes.next.has(id) || a.fade === 0) return;
    nodes.next.set(id, retire(a, now));
    nodes.changed.add(id);
    for (const k of RETIRED_KEYS) nodes.keys.add(k);
    until = Math.max(until, now + FADE_SECONDS);
  });
  graph.forEachEdge((id, a) => {
    if (edges.next.has(id) || a.fade === 0) return;
    edges.next.set(id, retire(a, now));
    edges.changed.add(id);
    for (const k of RETIRED_KEYS) edges.keys.add(k);
    until = Math.max(until, now + FADE_SECONDS);
  });

  // Many changes: one event over every item, the attributes that changed as
  // the hint, so that sigma places them again only when it has to.
  if (nodes.changed.size > BULK_UPDATE)
    graph.updateEachNodeAttributes((id, a) => nodes.next.get(id) ?? a, {
      attributes: [...nodes.keys],
    });
  else
    for (const id of nodes.changed)
      graph.replaceNodeAttributes(id, nodes.next.get(id)!);
  for (const [id, a] of nodes.next)
    if (!graph.hasNode(id)) graph.addNode(id, a);

  if (edges.changed.size > BULK_UPDATE)
    graph.updateEachEdgeAttributes((id, a) => edges.next.get(id) ?? a, {
      attributes: [...edges.keys],
    });
  else
    for (const id of edges.changed)
      graph.replaceEdgeAttributes(id, edges.next.get(id)!);
  for (const [id, a] of edges.next)
    if (!graph.hasEdge(id)) {
      const [from, to] = ends.get(id)!;
      graph.addDirectedEdgeWithKey(id, from, to, a);
    }
  return { graph, until };
}

/** The attributes retiring an item changes. */
const RETIRED_KEYS = ["fade", "fadeFrom", "fadeAt"] as const;

/** An item that left the view: fading out from what is on screen. */
function retire<A extends Fade>(a: A, now: number): A {
  if (a.fade === 0) return a;
  return { ...a, ...retarget(a, 0, now) };
}

/**
 * The Dependencies of a level worth drawing: every one singled out (focus,
 * Changes, ghost), then the strongest, up to `max`. Thousands of light
 * Dependencies are a texture at best; past the budget they cost frames and
 * add nothing a reader can follow.
 */
export function edgeBudget(
  edges: readonly EdgeView[],
  max = MAX_EDGES_PER_LEVEL,
): EdgeView[] {
  const byLevel = new Map<string, EdgeView[]>();
  for (const e of edges) {
    const l = byLevel.get(e.level);
    if (l) l.push(e);
    else byLevel.set(e.level, [e]);
  }
  const out: EdgeView[] = [];
  for (const list of byLevel.values()) {
    if (list.length <= max) {
      out.push(...list);
      continue;
    }
    const singled = (e: EdgeView) =>
      e.highlighted ||
      e.ghost ||
      (e.change !== null && e.change !== "unchanged");
    const kept = list.filter(singled);
    const rest = list
      .filter((e) => !singled(e))
      .sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
    out.push(...kept, ...rest.slice(0, Math.max(0, max - kept.length)));
  }
  return out;
}
