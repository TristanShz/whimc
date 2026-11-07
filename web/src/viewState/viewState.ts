import { mapUrl, type MapRequest } from "../api/client";
import {
  LEVELS,
  type Comparison,
  type DependencyChange,
  type Level,
  type ModuleChange,
} from "../api/types";
import { VIEW, fetchArea, levelBlend, typicalRadii } from "./levels";
import type {
  EdgeView,
  MapData,
  NodeView,
  Requests,
  UiState,
  ViewState,
} from "./types";

const edgeId = (from: string, to: string) => `${from}->${to}`;

/** Where a Module sits in the hierarchy, from any level fetched. */
interface Place {
  level: Level;
  parent: string | null;
}

/**
 * The view of the Map for what the server sent and what the user does: the
 * level in view and how levels blend, and for each node and edge whether and
 * how to draw it. Pure: the renderer draws what it returns and decides
 * nothing.
 */
export function computeView(data: MapData, ui: UiState): ViewState {
  const radii = typicalRadii(data.levels);
  const { level, depth, weights } = levelBlend(radii, ui.camera.zoom);
  const shown = (m: { test?: boolean }) => ui.tests || !m.test;
  const comparison = ui.changes ? data.comparison : null;
  const changes = comparisonIndex(comparison);

  // Where every Module fetched sits, to walk up from a node to its ancestors.
  const places = new Map<string, Place>();
  for (const l of LEVELS) {
    for (const m of data.levels[l]?.modules ?? []) {
      if (shown(m)) places.set(m.id, { level: l, parent: m.parent ?? null });
    }
  }
  for (const c of comparison ? LEVELS.map((l) => comparison[l]) : []) {
    for (const m of c.modules) {
      if (shown(m) && !places.has(m.id))
        places.set(m.id, { level: c.level, parent: m.parent ?? null });
    }
  }
  /** The Module and its ancestors. */
  const lineage = (id: string): string[] => {
    const out: string[] = [];
    for (
      let at: string | null = id;
      at !== null;
      at = places.get(at)?.parent ?? null
    ) {
      out.push(at);
    }
    return out;
  };
  const within = (id: string, set: Set<string>) =>
    lineage(id).some((a) => set.has(a));
  /** Every ancestor of the Modules of set, themselves excluded. */
  const ancestorsOf = (set: Set<string>) => {
    const out = new Set<string>();
    for (const id of set) for (const a of lineage(id).slice(1)) out.add(a);
    return out;
  };

  // The focus, its neighbours at its level, and their ancestors.
  const focusId = ui.hovered ?? ui.selected;
  const focus = focusId !== null && places.has(focusId) ? focusId : null;
  const focusSet = new Set(focus === null ? [] : [focus]);
  const related = new Set(focusSet);
  if (focus !== null) {
    for (const d of data.levels[places.get(focus)!.level]?.dependencies ?? []) {
      if (!places.has(d.from) || !places.has(d.to)) continue;
      if (d.from === focus) related.add(d.to);
      if (d.to === focus) related.add(d.from);
    }
  }
  const relatedAncestors = ancestorsOf(related);

  // The search matches, among everything fetched.
  const query = ui.search.trim().toLowerCase();
  const matches = new Set<string>();
  if (query) {
    const all = [
      ...LEVELS.flatMap((l) => data.levels[l]?.modules ?? []),
      ...(comparison ? LEVELS.flatMap((l) => comparison[l].modules) : []),
    ];
    for (const m of all) {
      if (
        places.has(m.id) &&
        (m.name.toLowerCase().includes(query) ||
          m.path.toLowerCase().includes(query))
      )
        matches.add(m.id);
    }
  }
  const matchAncestors = ancestorsOf(matches);
  const keptBySearch = (id: string) =>
    !query || within(id, matches) || matchAncestors.has(id);

  const nodes: NodeView[] = [];
  const edges: EdgeView[] = [];
  for (const l of LEVELS) {
    const levelWeight = weights[l];
    if (levelWeight <= 0) continue;
    const view = data.levels[l];
    const levelNodes: NodeView[] = [];
    const node = (
      m: {
        id: string;
        name: string;
        path: string;
        parent?: string;
        x: number;
        y: number;
        radius: number;
        size: number;
        test?: boolean;
      },
      churn: number,
      ghost: boolean,
    ): NodeView => {
      const c = changes?.modules.get(m.id);
      const change = changes ? (c?.change ?? "unchanged") : null;
      const focusDimmed =
        focus !== null && !within(m.id, related) && !relatedAncestors.has(m.id);
      const searchDimmed = !keptBySearch(m.id);
      const changesDimmed = change === "unchanged";
      const opacity =
        levelWeight *
        (ghost ? VIEW.ghostOpacity : 1) *
        (focusDimmed ? VIEW.focusDim : 1) *
        (searchDimmed ? VIEW.searchFade : 1) *
        (changesDimmed ? VIEW.changesFade : 1);
      return {
        id: m.id,
        level: l,
        name: m.name,
        path: m.path,
        parent: m.parent ?? null,
        x: m.x,
        y: m.y,
        radius: m.radius,
        size: m.size,
        churn,
        heat: 0,
        test: m.test ?? false,
        levelWeight,
        opacity,
        focused: m.id === focus,
        selected: m.id === ui.selected,
        match: matches.has(m.id),
        highlighted:
          (focus !== null && within(m.id, related)) ||
          (change !== null && change !== "unchanged"),
        dimmed: focusDimmed || searchDimmed || changesDimmed,
        change,
        changedFiles: c?.changed ?? 0,
        ghost,
      };
    };
    for (const m of view?.modules ?? []) {
      if (shown(m)) levelNodes.push(node(m, m.churn, false));
    }
    const drawn = new Set(levelNodes.map((n) => n.id));
    const ghosts: NodeView[] = [];
    for (const c of comparison?.[l].modules ?? []) {
      if (c.change === "removed" && shown(c) && !drawn.has(c.id)) {
        ghosts.push(node(c, 0, true));
        drawn.add(c.id);
      }
    }
    normalise(
      levelNodes,
      (n) => n.churn,
      (n, v) => (n.heat = v),
    );
    levelNodes.sort((a, b) => cmp(a.id, b.id));
    ghosts.sort((a, b) => cmp(a.id, b.id));
    nodes.push(...levelNodes, ...ghosts);

    const opacityOf = new Map(
      [...levelNodes, ...ghosts].map((n) => [n.id, n.opacity]),
    );
    const levelEdges: EdgeView[] = [];
    const edge = (
      d: { from: string; to: string; kind: EdgeView["kind"]; weight: number },
      ghost: boolean,
    ): EdgeView => {
      const id = edgeId(d.from, d.to);
      const c = changes?.dependencies.get(id);
      const change = changes ? (c?.change ?? "unchanged") : null;
      const focusHighlighted =
        focus !== null &&
        ((within(d.from, focusSet) && within(d.to, related)) ||
          (within(d.to, focusSet) && within(d.from, related)));
      const focusDimmed = focus !== null && !focusHighlighted;
      const searchDimmed = !keptBySearch(d.from) || !keptBySearch(d.to);
      const changesDimmed = change === "unchanged";
      return {
        id,
        from: d.from,
        to: d.to,
        level: l,
        kind: d.kind,
        weight: d.weight,
        strength: 0,
        opacity:
          levelWeight *
          (ghost ? VIEW.ghostOpacity : 1) *
          (focusDimmed ? VIEW.focusDim : 1) *
          (searchDimmed ? VIEW.searchFade : 1) *
          (changesDimmed ? VIEW.changesFade : 1),
        highlighted:
          focusHighlighted || (change !== null && change !== "unchanged"),
        dimmed: focusDimmed || searchDimmed || changesDimmed,
        change,
        ghost,
      };
    };
    for (const d of view?.dependencies ?? []) {
      if (opacityOf.has(d.from) && opacityOf.has(d.to))
        levelEdges.push(edge(d, false));
    }
    const present = new Set(levelEdges.map((e) => e.id));
    for (const d of comparison?.[l].dependencies ?? []) {
      const id = edgeId(d.from, d.to);
      if (
        d.change === "removed" &&
        !present.has(id) &&
        opacityOf.has(d.from) &&
        opacityOf.has(d.to)
      )
        levelEdges.push(edge(d, true));
    }
    normalise(
      levelEdges,
      (e) => e.weight,
      (e, v) => (e.strength = v),
    );
    levelEdges.sort((a, b) => cmp(a.id, b.id));
    edges.push(...levelEdges);
  }

  return {
    level,
    depth,
    levelWeights: weights,
    nodes,
    edges,
    focus,
    changes: comparison
      ? {
          base: comparison.base,
          target: comparison.target,
          summary: comparison.summary,
        }
      : null,
    requests: requests(data, ui, weights),
  };
}

/** A stable key of a Map request, to cache and deduplicate fetches. */
export function requestKey(r: MapRequest): string {
  return mapUrl(r);
}

function requests(
  data: MapData,
  ui: UiState,
  weights: Record<Level, number>,
): Requests {
  const pkgs = data.levels.packages;
  const dirs = data.levels.directories;
  const childCount = (v: typeof pkgs) =>
    (v?.modules ?? []).reduce((n, m) => n + m.children, 0);
  const dirsBig = childCount(pkgs) > VIEW.bigLevel;
  // Until the Directories are all in, the number of Files is unknown.
  const filesBig = dirsBig || !dirs || childCount(dirs) > VIEW.bigLevel;
  const big: Record<Level, boolean> = {
    packages: false,
    directories: dirsBig,
    files: filesBig,
  };
  const maps: MapRequest[] = [];
  for (const l of LEVELS) {
    if (l !== "packages" && weights[l] <= 0) continue;
    maps.push({
      level: l,
      tests: ui.tests,
      ...(ui.changes ? { ref: ui.changes.target } : {}),
      ...(big[l] ? { viewport: fetchArea(ui.camera.viewport) } : {}),
    });
  }
  return {
    maps,
    compare: ui.changes
      ? { base: ui.changes.base, target: ui.changes.target, tests: ui.tests }
      : null,
  };
}

/** The changes of a Comparison by Module ID and by edge ID. */
interface ComparisonIndex {
  modules: Map<string, ModuleChange>;
  dependencies: Map<string, DependencyChange>;
}

const indexes = new WeakMap<Comparison, ComparisonIndex>();

function comparisonIndex(c: Comparison | null): ComparisonIndex | null {
  if (!c) return null;
  let ix = indexes.get(c);
  if (!ix) {
    ix = { modules: new Map(), dependencies: new Map() };
    for (const l of LEVELS) {
      for (const m of c[l].modules) ix.modules.set(m.id, m);
      for (const d of c[l].dependencies)
        ix.dependencies.set(edgeId(d.from, d.to), d);
    }
    indexes.set(c, ix);
  }
  return ix;
}

/**
 * Sets, on each item, its measure normalised within the items: log-scaled so
 * that the many small values stay apart, 0 for none and 1 for the largest.
 */
function normalise<T>(
  items: T[],
  measure: (t: T) => number,
  set: (t: T, v: number) => void,
) {
  let max = 0;
  for (const t of items) max = Math.max(max, measure(t));
  for (const t of items)
    set(t, max > 0 ? Math.log1p(measure(t)) / Math.log1p(max) : 0);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
