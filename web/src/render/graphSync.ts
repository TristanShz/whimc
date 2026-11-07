// Brings the graphology graph sigma draws in line with the view state, with
// as few graph events as possible: the renderer reprocesses each item an
// event touches.

import type Graph from "graphology";
import type { ViewState } from "../viewState";
import {
  FADE_SECONDS,
  edgeAttributes,
  nodeAttributes,
  retarget,
  type EdgeAttributes,
  type NodeAttributes,
} from "./attributes";
import { edgeDensity, type Palette } from "./scales";

export type MapGraph = Graph<NodeAttributes, EdgeAttributes>;

/** Beyond this many search matches, their labels are left to the label grid. */
export const MAX_FORCED_MATCH_LABELS = 40;

function same<T extends object>(a: T, b: T): boolean {
  for (const k in a) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Updates the graph to draw `view` at `now` (seconds on the render clock) and
 * returns until when an opacity transition runs (-Infinity for none).
 */
export function syncGraph(
  graph: MapGraph,
  view: ViewState,
  palette: Palette,
  now: number,
): number {
  let until = -Infinity;
  const matches = view.nodes.reduce((k, n) => k + (n.match ? 1 : 0), 0);
  const opts = { matchLabels: matches <= MAX_FORCED_MATCH_LABELS };

  const nodes = new Set<string>();
  for (const n of view.nodes) {
    nodes.add(n.id);
    const target = nodeAttributes(n, palette, opts);
    const prev = graph.hasNode(n.id)
      ? graph.getNodeAttributes(n.id)
      : undefined;
    const next: NodeAttributes = {
      ...target,
      ...retarget(prev, target.fade, now),
    };
    if (prev && same(prev, next)) continue;
    if (!prev || prev.fadeAt !== next.fadeAt)
      until = Math.max(until, now + FADE_SECONDS);
    if (prev) graph.replaceNodeAttributes(n.id, next);
    else graph.addNode(n.id, next);
  }
  for (const id of graph.nodes()) if (!nodes.has(id)) graph.dropNode(id);

  const perLevel = new Map<string, number>();
  for (const e of view.edges)
    perLevel.set(e.level, (perLevel.get(e.level) ?? 0) + 1);
  const edges = new Set<string>();
  for (const e of view.edges) {
    if (!graph.hasNode(e.from) || !graph.hasNode(e.to)) continue;
    edges.add(e.id);
    const target = edgeAttributes(
      e,
      palette,
      view.levelWeights[e.level],
      edgeDensity(perLevel.get(e.level) ?? 0),
    );
    const prev = graph.hasEdge(e.id)
      ? graph.getEdgeAttributes(e.id)
      : undefined;
    const next: EdgeAttributes = {
      ...target,
      ...retarget(prev, target.fade, now),
    };
    if (prev && same(prev, next)) continue;
    if (!prev || prev.fadeAt !== next.fadeAt)
      until = Math.max(until, now + FADE_SECONDS);
    if (prev) graph.replaceEdgeAttributes(e.id, next);
    else graph.addDirectedEdgeWithKey(e.id, e.from, e.to, next);
  }
  for (const id of graph.edges()) if (!edges.has(id)) graph.dropEdge(id);
  return until;
}
