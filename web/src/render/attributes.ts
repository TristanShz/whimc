// How a node or an edge of the view state becomes the attributes the WebGL
// programs read. The view state decides; this only encodes its decisions.

import type { Level } from "../api/types";
import type { EdgeView, NodeView } from "../viewState";
import { formatCount, measures, shorten } from "../format";
import { edgeWidth, glow, heatColor, toCss, type Palette } from "./scales";

export const LEVEL_INDEX: Record<Level, number> = {
  packages: 0,
  directories: 1,
  files: 2,
};

/** How long an opacity change takes on screen, in seconds. */
export const FADE_SECONDS = 0.28;

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
  label: string;
  /** The hover line: Size and Churn. */
  caption: string;
  level: number;
  /** 0 to 1: the halo of a Module that moves a lot. */
  glow: number;
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
  badgeColor: string;
  zIndex: number;
}

export interface EdgeAttributes extends Fade {
  /** Width on screen, in pixels. */
  size: number;
  color: string;
  level: number;
  /** 0 runtime (solid), 1 type-only (dashed), 2 dynamic (dotted). */
  kind: number;
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

/** A node's attributes, its fade being the target of a transition (see retarget). */
export function nodeAttributes(
  n: NodeView,
  p: Palette,
  opts: NodeOptions = {},
): Omit<NodeAttributes, "fadeFrom" | "fadeAt"> {
  const level = LEVEL_INDEX[n.level];
  let ring = 0;
  let ringColor = p.focus;
  if (n.focused || n.selected) ring = 1;
  else if (n.ghost) [ring, ringColor] = [2, p.removed];
  else if (n.change === "added") [ring, ringColor] = [2, p.added];
  else if (n.change === "modified") [ring, ringColor] = [1, p.modified];
  else if (n.match) ring = 1;
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
    color: toCss(heatColor(n.heat, p)),
    label: shorten(n.name),
    caption: measures(n.size, n.churn),
    level,
    fade: n.levelWeight > 0 ? round(n.fade) : 0,
    glow: n.ghost ? 0 : glow(n.heat),
    ring,
    ringColor: toCss(ringColor),
    hollow: n.ghost ? 1 : 0,
    context: n.fade > 0 ? round(Math.min(1, n.contextFade / n.fade)) : 1,
    forceLabel: labelFirst || badge !== "",
    labelFirst,
    badge,
    badgeColor: toCss(n.change === "added" ? p.added : p.modified),
    zIndex: level * 4 + (n.ghost ? 0 : 1) + emphasis,
  };
}

/** How much of an edge shows at full opacity: Dependencies stay behind nodes. */
const EDGE_ALPHA = { normal: 0.42, highlighted: 0.95 };

/** An edge's attributes; levelWeight is its level's share of the blend. */
export function edgeAttributes(
  e: EdgeView,
  p: Palette,
  levelWeight: number,
  /** The share of opacity the level's crowd of Dependencies leaves (edgeDensity). */
  density = 1,
): Omit<EdgeAttributes, "fadeFrom" | "fadeAt"> {
  const level = LEVEL_INDEX[e.level];
  const color =
    e.change === "added"
      ? p.added
      : e.ghost || e.change === "removed"
        ? p.removed
        : e.highlighted
          ? p.focus
          : p.edge;
  // A highlighted crowd thins too, but stays above the rest.
  const base = e.highlighted
    ? EDGE_ALPHA.highlighted * Math.min(1, density * 1.8)
    : EDGE_ALPHA.normal * density;
  return {
    size: edgeWidth(e.level, e.strength, e.highlighted),
    color: toCss(color),
    level,
    kind: e.kind === "runtime" ? 0 : e.kind === "type-only" ? 1 : 2,
    // The level weight is the shader's, as for nodes.
    fade: levelWeight > 0 ? round((e.opacity / levelWeight) * base) : 0,
    zIndex: e.highlighted || e.change === "added" ? 1 : 0,
  };
}
