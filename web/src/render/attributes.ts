// How a node or an edge of the view state becomes the attributes the WebGL
// programs read. The view state decides; this only encodes its decisions.

import type { Level } from "../api/types";
import type { EdgeView, NodeView } from "../viewState";
import { formatCount, shorten } from "../format";
import { churnColor, edgeStep, edgeWidth, toCss, type Palette } from "./scales";

export const LEVEL_INDEX: Record<Level, number> = {
  packages: 0,
  directories: 1,
  files: 2,
};

/** How long an opacity change takes on screen, in seconds. */
export const FADE_SECONDS = 0.2;

/**
 * An opacity in transition: the shader draws `fadeFrom` at `fadeAt` (seconds
 * on the render clock), easing to `fade` over FADE_SECONDS.
 */
export interface Fade {
  fade: number;
  fadeFrom: number;
  fadeAt: number;
}

export interface NodeAttributes extends Fade {
  x: number;
  y: number;
  /** Radius in map units: sizes follow the zoom (itemSizesReference). */
  size: number;
  color: string;
  /**
   * Its label. Not sigma's `label`: sigma would index every label in a
   * grid it never uses here (whimc draws the labels itself).
   */
  text: string;
  /** Size and Churn, for the hover line. */
  lines: number;
  commits: number;
  level: number;
  /** 0 none, 1 solid, 2 dashed. */
  ring: number;
  ringColor: string;
  /** 1 for a ghost: drawn as an outline. */
  hollow: number;
  /**
   * The share of its fade it keeps once the level below it is revealed (the
   * shader blends towards it): its context fade over its fade.
   */
  context: number;
  /** Sigma draws its label whatever the crowd: see labelFirst. */
  forceLabel: boolean;
  /**
   * Its label wins over the labels around it (focus, selection, search);
   * a badged node is drawn for its badge, its label only where it fits.
   */
  labelFirst: boolean;
  /** The changed-File count of a changed Directory or Package, "" for none. */
  badge: string;
  zIndex: number;
}

export interface EdgeAttributes extends Fade {
  /** Width on screen, in pixels. */
  size: number;
  color: string;
  level: number;
  /** 0 runtime (solid), 1 type-only (dashed), 2 dynamic (dotted). */
  kind: number;
  /** 1 when its direction shows (it narrows towards the imported Module). */
  taper: number;
  zIndex: number;
}

export interface NodeOptions {
  /** Force the labels of search matches; off when they are too many. */
  matchLabels?: boolean;
}

/**
 * Opacities are rounded so that a zoom step, which changes the level weight
 * the view state multiplies in and the shader divides back out, does not
 * look like a change.
 */
const round = (v: number) => Math.round(v * 1000) / 1000;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The opacity on screen at `now`, as the shader computes it. */
export function displayedFade(f: Fade, now: number): number {
  const t = Math.min(1, Math.max(0, (now - f.fadeAt) / FADE_SECONDS));
  return f.fadeFrom + (f.fade - f.fadeFrom) * smooth(t);
}

/** The transition towards `target`, starting from what is on screen now. */
export function retarget(
  prev: Fade | undefined,
  target: number,
  now: number,
): Fade {
  if (!prev) return { fade: target, fadeFrom: 0, fadeAt: now };
  // Only the fade fields: prev may be a whole attribute set.
  if (prev.fade === target)
    return { fade: prev.fade, fadeFrom: prev.fadeFrom, fadeAt: prev.fadeAt };
  return { fade: target, fadeFrom: displayedFade(prev, now), fadeAt: now };
}

/** The CSS colours of a palette, computed once per palette. */
interface PaletteCss {
  focus: string;
  match: string;
  added: string;
  modified: string;
  removed: string;
  edge: string;
  /** Churn colours by heat: a level has a few hundred distinct heats. */
  heat: Map<number, string>;
}

const paletteCss = new WeakMap<Palette, PaletteCss>();

function css(p: Palette): PaletteCss {
  let c = paletteCss.get(p);
  if (!c) {
    c = {
      focus: toCss(p.focus),
      match: toCss(p.match),
      added: toCss(p.added),
      modified: toCss(p.modified),
      removed: toCss(p.removed),
      edge: toCss(p.edge),
      heat: new Map(),
    };
    paletteCss.set(p, c);
  }
  return c;
}

function heatCss(heat: number, p: Palette): string {
  const cache = css(p).heat;
  let c = cache.get(heat);
  if (c === undefined) {
    c = toCss(churnColor(heat, p));
    cache.set(heat, c);
  }
  return c;
}

/** A node's attributes, its fade being the target of a transition (see retarget). */
export function nodeAttributes(
  n: NodeView,
  p: Palette,
  opts: NodeOptions = {},
): Omit<NodeAttributes, "fadeFrom" | "fadeAt"> {
  const level = LEVEL_INDEX[n.level];
  const c = css(p);
  let ring = 0;
  let ringColor = c.focus;
  if (n.focused || n.selected) ring = 1;
  else if (n.ghost) [ring, ringColor] = [2, c.removed];
  else if (n.change === "added") [ring, ringColor] = [1, c.added];
  else if (n.change === "modified") [ring, ringColor] = [1, c.modified];
  else if (n.match) [ring, ringColor] = [1, c.match];
  const emphasis = n.focused || n.selected ? 2 : n.highlighted ? 1 : 0;
  const labelFirst =
    n.focused || n.selected || (n.match && opts.matchLabels !== false);
  const badge =
    n.level !== "files" && !n.ghost && n.changedFiles > 0
      ? formatCount(n.changedFiles)
      : "";
  return {
    x: n.x,
    y: -n.y,
    size: n.radius,
    color: heatCss(n.heat, p),
    text: shorten(n.name),
    lines: n.size,
    commits: n.churn,
    level,
    fade: n.levelWeight > 0 ? round(n.fade) : 0,
    ring,
    ringColor,
    hollow: n.ghost ? 1 : 0,
    context: n.fade > 0 ? round(Math.min(1, n.contextFade / n.fade)) : 1,
    forceLabel: labelFirst || badge !== "",
    labelFirst,
    badge,
    zIndex: level * 4 + (n.ghost ? 0 : 1) + emphasis,
  };
}

/**
 * How much of an edge shows at full opacity: Dependencies are a quiet
 * texture under the discs' outlines, the focus's stand out.
 */
const EDGE_ALPHA = { normal: 0.18, highlighted: 0.85 };

/** An edge's attributes; levelWeight is its level's share of the blend. */
export function edgeAttributes(
  e: EdgeView,
  p: Palette,
  levelWeight: number,
  /** The share of opacity the level's crowd of Dependencies leaves (edgeDensity). */
  density = 1,
): Omit<EdgeAttributes, "fadeFrom" | "fadeAt"> {
  const level = LEVEL_INDEX[e.level];
  // A change wins over the focus: the Changes legend explains each colour.
  const c = css(p);
  const color =
    e.change === "added"
      ? c.added
      : e.ghost || e.change === "removed"
        ? c.removed
        : e.change === "modified"
          ? c.modified
          : e.highlighted
            ? c.focus
            : c.edge;
  // A highlighted crowd thins too, but stays above the rest.
  const base = e.highlighted
    ? EDGE_ALPHA.highlighted * Math.min(1, density * 1.8)
    : EDGE_ALPHA.normal * density * (0.8 + 0.2 * edgeStep(e.strength));
  return {
    size: edgeWidth(e.level, e.strength, e.highlighted),
    color,
    level,
    kind: e.kind === "runtime" ? 0 : e.kind === "type-only" ? 1 : 2,
    // Direction is shown where it is asked about: around the focus.
    taper: e.highlighted ? 1 : 0,
    // The level weight is the shader's, as for nodes.
    fade: levelWeight > 0 ? round((e.opacity / levelWeight) * base) : 0,
    zIndex:
      e.highlighted || e.change === "added" || e.change === "modified" ? 1 : 0,
  };
}
