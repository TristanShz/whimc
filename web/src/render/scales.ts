// The visual scales of the Map: how a measure becomes a colour, a glow or a
// width. Pure, so that they can be tested without WebGL.

import type { Level } from "../api/types";

/** A colour as 0–255 sRGB channels. */
export type Rgb = readonly [number, number, number];

/** The colours of the theme in use, read from the CSS tokens. */
export interface Palette {
  /** Dark themes let glows add light; light ones blend them normally. */
  dark: boolean;
  canvas: Rgb;
  label: Rgb;
  /** The outline drawn behind labels so that they read over nodes. */
  halo: Rgb;
  muted: Rgb;
  edge: Rgb;
  /** The Churn ramp: calm, warm, hot. */
  cool: Rgb;
  warm: Rgb;
  hot: Rgb;
  /** The hovered or selected Module and its Dependencies. */
  focus: Rgb;
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

// OKLab, so that the ramp keeps an even lightness between its stops instead
// of the muddy middle of an sRGB blend.
type Lab = [number, number, number];

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

function toLab(c: Rgb): Lab {
  const [r, g, b] = c.map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromLab([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function mixLab(a: Rgb, b: Rgb, t: number): Rgb {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const x = toLab(a);
  const y = toLab(b);
  return fromLab([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Lab);
}

/** The colour of a Churn heat, 0 (calm) to 1 (moves the most). */
export function heatColor(heat: number, p: Palette): Rgb {
  const h = Math.min(1, Math.max(0, heat));
  return h < 0.5
    ? mixLab(p.cool, p.warm, h * 2)
    : mixLab(p.warm, p.hot, (h - 0.5) * 2);
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much a node glows, 0 to 1: only the Modules that move a lot do. */
export function glow(heat: number): number {
  return smoothstep(0.55, 1, heat);
}

/** Below this radius on screen, a disc is drawn (and picked) at this radius. */
export const MIN_RADIUS_PX = 2.5;

/** Edge widths on screen, in pixels. */
export const EDGE_WIDTH = {
  min: 0.6,
  max: { packages: 9, directories: 4.5, files: 1.6 } as Record<Level, number>,
  highlight: 0.8,
};

/**
 * The width of a Dependency on screen, from its strength within the level:
 * quadratic, so that the few heavy couplings stand out from the many light
 * ones.
 */
export function edgeWidth(
  level: Level,
  strength: number,
  highlighted: boolean,
): number {
  const s = Math.min(1, Math.max(0, strength));
  const w = EDGE_WIDTH.min + (EDGE_WIDTH.max[level] - EDGE_WIDTH.min) * s * s;
  return highlighted ? w + EDGE_WIDTH.highlight : w;
}

/**
 * How much of its opacity a Dependency keeps when its level has `count` of
 * them on screen: a few stand out, thousands become a texture, not a wall.
 */
export function edgeDensity(count: number): number {
  return Math.min(1, Math.max(0.15, Math.sqrt(150 / Math.max(count, 1))));
}
