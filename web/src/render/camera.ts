// Camera arithmetic between the engine's map coordinates, sigma's graph and
// the screen. Pure: the renderer feeds it what sigma measures.

import type { Rect } from "../api/types";
import type { Camera } from "../viewState";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The engine's y grows downwards and sigma's upwards: the same flip both ways. */
export function flipY(p: Point): Point {
  return { x: p.x, y: -p.y };
}

/** The view state's camera from the map coordinates of two opposite screen corners. */
export function cameraFrom(screen: Size, a: Point, b: Point): Camera {
  const viewport = {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
  const width = viewport.x1 - viewport.x0;
  return { zoom: width > 0 ? screen.width / width : 1, viewport };
}

/** The area covering every disc. */
export function boundsOf(
  discs: readonly { x: number; y: number; radius: number }[],
): Rect | null {
  if (discs.length === 0) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const d of discs) {
    x0 = Math.min(x0, d.x - d.radius);
    y0 = Math.min(y0, d.y - d.radius);
    x1 = Math.max(x1, d.x + d.radius);
    y1 = Math.max(y1, d.y + d.radius);
  }
  return { x0, y0, x1, y1 };
}

/**
 * The area to bring into view to dive into a Module: the whole disc, or
 * closer when that is what it takes for its children to show — a typical
 * child (0.8·R/√children, as the engine sizes them) reaching `revealPx`.
 */
export function diveArea(
  m: { x: number; y: number; radius: number; children: number },
  screenMin: number,
  revealPx: number,
  margin = 0.7,
): Rect {
  const child = (0.8 * m.radius) / Math.sqrt(Math.max(m.children, 1));
  const zoom = Math.max(
    (margin * screenMin) / (2 * m.radius),
    revealPx / child,
  );
  const half = (margin * screenMin) / (2 * zoom);
  return { x0: m.x - half, y0: m.y - half, x1: m.x + half, y1: m.y + half };
}

/** Screen pixels kept clear along each edge, for the panels over the Map. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** No inset takes more than this share of the screen's width or height. */
const MAX_INSET_SHARE = 0.45;

/**
 * The insets that keep the panels over the Map clear: each panel pushes in
 * the edge it hugs, the one it takes the least to clear (the toolbar the
 * top, the details panel the right, the legend the bottom).
 */
export function insetsFrom(screen: Size, panels: readonly Rect[]): Insets {
  const out = { ...NO_INSETS };
  for (const p of panels) {
    if (p.x1 <= p.x0 || p.y1 <= p.y0) continue;
    const options: [keyof Insets, number][] = [
      ["top", p.y1],
      ["right", screen.width - p.x0],
      ["bottom", screen.height - p.y0],
      ["left", p.x1],
    ];
    const [edge, inset] = options.reduce((a, b) => (b[1] < a[1] ? b : a));
    out[edge] = Math.max(out[edge], inset);
  }
  const cap = (v: number, size: number) =>
    Math.max(0, Math.min(v, size * MAX_INSET_SHARE));
  return {
    top: cap(out.top, screen.height),
    right: cap(out.right, screen.width),
    bottom: cap(out.bottom, screen.height),
    left: cap(out.left, screen.width),
  };
}

/**
 * Where to put the camera to show an area in the part of the screen the
 * insets leave clear, filling `margin` of it, within `minZoom` and
 * `maxZoom` (screen pixels per map unit; the closest wins): the zoom, and the map point at the centre of
 * the screen.
 */
export function frameArea(
  area: Rect,
  screen: Size,
  insets: Insets = NO_INSETS,
  margin = 0.85,
  minZoom = 0,
  maxZoom = Infinity,
): { zoom: number; centre: Point } {
  const free = {
    width: Math.max(1, screen.width - insets.left - insets.right),
    height: Math.max(1, screen.height - insets.top - insets.bottom),
  };
  const w = Math.max(area.x1 - area.x0, 1e-9);
  const h = Math.max(area.y1 - area.y0, 1e-9);
  const fit = Math.min(free.width / w, free.height / h) * margin;
  const zoom = Math.max(minZoom, Math.min(maxZoom, fit));
  // The area's centre goes to the centre of the clear part of the screen.
  return {
    zoom,
    centre: {
      x: (area.x0 + area.x1) / 2 + (insets.right - insets.left) / (2 * zoom),
      y: (area.y0 + area.y1) / 2 + (insets.bottom - insets.top) / (2 * zoom),
    },
  };
}
