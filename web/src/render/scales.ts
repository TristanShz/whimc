// The visual scales of the Map: how a measure becomes a colour or a width.
// Pure, so that they can be tested without WebGL.

import type { Level } from "../api/types";

/** A colour as 0–255 sRGB channels. */
export type Rgb = readonly [number, number, number];

/** The colours of the theme in use, read from the CSS tokens. */
export interface Palette {
  /** The theme in use is dark: discs take a stronger fill on dark. */
  dark: boolean;
  canvas: Rgb;
  /** The plates over the Map: the hover card, the badges. */
  surface: Rgb;
  label: Rgb;
  /** The outline drawn behind labels so that they read over nodes. */
  halo: Rgb;
  muted: Rgb;
  edge: Rgb;
  /** The Churn steps, calm to moving a lot (CHURN_STEPS of them). */
  churn: readonly Rgb[];
  /** The hovered or selected Module and its Dependencies. */
  focus: Rgb;
  /** The outline of a search match. */
  match: Rgb;
  /** Changes marks. */
  added: Rgb;
  modified: Rgb;
  removed: Rgb;
}

/** Parses `#rgb`, `#rrggbb`, `rgb()` and `rgba()`, as computed styles give them. */
export function parseColor(input: string): Rgb | null {
  const s = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    return [0, 2, 4].map((i) =>
      parseInt(h.slice(i, i + 2), 16),
    ) as unknown as Rgb;
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null;
}

export function toCss(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** The Churn scale has this many steps, calm to moving a lot. */
export const CHURN_STEPS = 5;

/**
 * The step of a Churn heat (0 calm, 1 moves the most within the level):
 * quantised into CHURN_STEPS even bands, so that a colour on the Map is one
 * of the few the Legend lists rather than a shade to estimate.
 */
export function churnStep(heat: number): number {
  const h = Math.min(1, Math.max(0, heat));
  return Math.min(CHURN_STEPS - 1, Math.floor(h * CHURN_STEPS));
}

/** The colour of a Churn heat: the colour of its step. */
export function churnColor(heat: number, p: Palette): Rgb {
  return p.churn[churnStep(heat)] ?? p.muted;
}

/** The commits a Churn step covers, both ends included; null when none does. */
export type ChurnRange = { from: number; to: number } | null;

/**
 * The commit counts each step covers in a level whose busiest Module has
 * `max` commits, as the view state normalises Churn (log1p(c) / log1p(max)):
 * what the Legend writes next to each colour.
 */
export function churnRanges(max: number): ChurnRange[] {
  const top = Math.max(0, Math.floor(max));
  const stepOf = (c: number) =>
    top > 0 ? churnStep(Math.log1p(c) / Math.log1p(top)) : 0;
  const ranges: ChurnRange[] = [];
  for (let k = 0; k < CHURN_STEPS; k++) {
    // The first count of step k from the band's edge, nudged to the exact
    // integer: expm1 of the edge may land a hair either side of it.
    let from =
      k === 0 ? 0 : Math.ceil(Math.expm1((k / CHURN_STEPS) * Math.log1p(top)));
    while (from > 0 && stepOf(from - 1) >= k) from--;
    while (from <= top && stepOf(from) < k) from++;
    let to = from;
    while (to + 1 <= top && stepOf(to + 1) === k) to++;
    ranges.push(from <= top && stepOf(from) === k ? { from, to } : null);
  }
  return ranges;
}

/** Below this radius on screen, a disc is drawn (and picked) at this radius. */
export const MIN_RADIUS_PX = 2.5;

/**
 * Edge widths on screen, in pixels, by strength step (light, middling,
 * heavy): a few discreet steps, wider at the levels where one Dependency
 * stands for many imports.
 */
export const EDGE_WIDTH: {
  steps: Record<Level, readonly number[]>;
  highlight: number;
} = {
  steps: {
    packages: [0.75, 1.5, 2.5],
    directories: [0.75, 1.25, 2],
    files: [0.75, 1, 1.25],
  },
  highlight: 0.5,
};

/** The strength step of a Dependency within its level: 0, 1 or 2. */
export function edgeStep(strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  return s >= 2 / 3 ? 2 : s >= 1 / 3 ? 1 : 0;
}

/** The width of a Dependency on screen, from its strength within the level. */
export function edgeWidth(
  level: Level,
  strength: number,
  highlighted: boolean,
): number {
  const w = EDGE_WIDTH.steps[level][edgeStep(strength)]!;
  return highlighted ? w + EDGE_WIDTH.highlight : w;
}

/**
 * How much of its opacity a Dependency keeps when its level has `count` of
 * them on screen: a few stand out, thousands become a texture, not a wall.
 */
export function edgeDensity(count: number): number {
  return Math.min(1, Math.max(0.15, Math.sqrt(150 / Math.max(count, 1))));
}
