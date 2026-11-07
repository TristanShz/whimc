import { LEVELS, type Level, type Rect } from "../api/types";
import { levelZooms } from "./levels";
import type { SearchMatch } from "./viewState";

/** What to bring into view to show the search matches. */
export interface MatchesFrame {
  /** The level the matches are shown at. */
  level: Level;
  /** The matches framed: all of them, or the largest group that fits. */
  ids: string[];
  /** The area to frame, discs included, in map coordinates. */
  area: Rect;
  /**
   * The zooms that keep their level the one in view, screen pixels per map
   * unit: close enough for it to show, not so close the next one does.
   */
  minZoom: number;
  maxZoom: number;
}

/**
 * Where Enter in the search takes the camera: to the matches at their own
 * level. A match inside another match is shown by it and left out; the
 * level is the one most of the others are at (the deeper one on a tie),
 * zoomed in until that level is in view, and no closer than keeps it so. When they cannot all be in view
 * at that zoom, the largest group of them that fits in `screen` (pixels) is
 * framed.
 */
export function frameMatches(
  matches: readonly SearchMatch[],
  radii: Record<Level, number | null>,
  screen: { width: number; height: number },
): MatchesFrame | null {
  const ids = new Set(matches.map((m) => m.id));
  const outer = matches.filter((m) => !m.ancestors.some((a) => ids.has(a)));
  if (outer.length === 0) return null;

  let level: Level = outer[0]!.level;
  let most = 0;
  for (const l of LEVELS) {
    const n = outer.filter((m) => m.level === l).length;
    if (n > 0 && n >= most) [level, most] = [l, n];
  }
  const atLevel = outer.filter((m) => m.level === level);
  const zooms = levelZooms(radii, level);
  const minZoom = zooms?.min ?? 0;
  const maxZoom = zooms?.max ?? Infinity;

  // The window the screen covers at that zoom, in map units.
  const w = minZoom > 0 ? screen.width / minZoom : Infinity;
  const h = minZoom > 0 ? screen.height / minZoom : Infinity;
  const inWindow = (c: SearchMatch) =>
    atLevel.filter(
      (m) =>
        m.x - m.radius >= c.x - w / 2 &&
        m.x + m.radius <= c.x + w / 2 &&
        m.y - m.radius >= c.y - h / 2 &&
        m.y + m.radius <= c.y + h / 2,
    );
  let group = atLevel;
  const all = boundsOf(atLevel);
  if (all.x1 - all.x0 > w || all.y1 - all.y0 > h) {
    group = [];
    for (const c of atLevel) {
      const g = inWindow(c);
      if (g.length > group.length) group = g;
    }
    if (group.length === 0) group = [atLevel[0]!];
  }
  return {
    level,
    ids: group.map((m) => m.id),
    area: boundsOf(group),
    minZoom,
    maxZoom,
  };
}

function boundsOf(ms: readonly SearchMatch[]): Rect {
  return {
    x0: Math.min(...ms.map((m) => m.x - m.radius)),
    y0: Math.min(...ms.map((m) => m.y - m.radius)),
    x1: Math.max(...ms.map((m) => m.x + m.radius)),
    y1: Math.max(...ms.map((m) => m.y + m.radius)),
  };
}
