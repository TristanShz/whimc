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
 * The camera ratio at which `area` fills `margin` of the screen, given the
 * current ratio and zoom (screen pixels per map unit). Sigma's ratio is the
 * inverse of its zoom, so it scales with the area's size on screen.
 */
export function fitRatio(
  ratio: number,
  zoom: number,
  area: Rect,
  screen: Size,
  margin = 0.85,
): number {
  const w = Math.max((area.x1 - area.x0) * zoom, 1e-9);
  const h = Math.max((area.y1 - area.y0) * zoom, 1e-9);
  const grow = Math.min(screen.width / w, screen.height / h) * margin;
  return ratio / grow;
}

const GRID_BASE_PX = 24;

/**
 * The background dot grid: its spacing breathes within one octave as the
 * zoom changes, and its origin follows the map origin on screen, so that
 * panning and zooming feel anchored even over empty space.
 */
export function dotGrid(
  zoom: number,
  originPx: Point,
): { size: number; x: number; y: number } {
  const octave = Math.log2(Math.max(zoom, 1e-12));
  const size = GRID_BASE_PX * 2 ** (octave - Math.floor(octave));
  const mod = (v: number) => ((v % size) + size) % size;
  return { size, x: mod(originPx.x), y: mod(originPx.y) };
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
