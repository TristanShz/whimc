// Keeps labels from overprinting each other: each frame, a label is drawn
// only where no label drawn before it lies.

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The side of the cells boxes are filed in, in pixels. */
const CELL = 64;

export class LabelBoxes {
  /** The boxes claimed this frame, filed by every cell they touch. */
  private cells = new Map<number, Box[]>();

  /** Forgets the labels of the previous frame. */
  clear(): void {
    this.cells.clear();
  }

  /** Claims the box if it is free, with `gap` pixels around it; false if taken. */
  claim(b: Box, gap = 3): boolean {
    const cx0 = Math.floor((b.x0 - gap) / CELL);
    const cx1 = Math.floor((b.x1 + gap) / CELL);
    const cy0 = Math.floor((b.y0 - gap) / CELL);
    const cy1 = Math.floor((b.y1 + gap) / CELL);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++)
        for (const o of this.cells.get(cell(cx, cy)) ?? [])
          if (
            b.x0 - gap < o.x1 &&
            o.x0 < b.x1 + gap &&
            b.y0 - gap < o.y1 &&
            o.y0 < b.y1 + gap
          )
            return false;
    const x0 = Math.floor(b.x0 / CELL);
    const x1 = Math.floor(b.x1 / CELL);
    const y0 = Math.floor(b.y0 / CELL);
    const y1 = Math.floor(b.y1 / CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = cell(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(b);
        else this.cells.set(k, [b]);
      }
    return true;
  }
}

/** A cell's key: screens are far smaller than 2^16 cells across. */
const cell = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

/** A node as the label index files it. */
export interface LabelEntry {
  key: string;
  level: number;
  /** Radius in map units. */
  size: number;
  /** Labelled whatever its size on screen (focus, selection, search, badge). */
  forced: boolean;
}

/**
 * The nodes that may be labelled, filed so that a frame visits only the
 * discs large enough on screen: on one camera, a disc's radius on screen is
 * its radius in map units times one scale, so the labelled discs of a level
 * are the head of its list sorted by size.
 */
export class LabelIndex {
  private levels: LabelEntry[][] = [];
  private forced: LabelEntry[] = [];

  constructor(entries: Iterable<LabelEntry> = []) {
    this.rebuild(entries);
  }

  rebuild(entries: Iterable<LabelEntry>): void {
    this.levels = [];
    this.forced = [];
    for (const e of entries) {
      if (e.forced) this.forced.push(e);
      else (this.levels[e.level] ??= []).push(e);
    }
    for (const l of this.levels) l?.sort((a, b) => b.size - a.size);
  }

  /**
   * The keys of the nodes worth a label at `scale` (screen pixels per map
   * unit), on the levels drawn (a weight above 0): the forced ones, and the
   * discs of LABEL_MIN_RADIUS_PX or more on screen.
   */
  candidates(weights: readonly number[], scale: number): string[] {
    const out: string[] = [];
    for (const e of this.forced)
      if ((weights[e.level] ?? 0) > 0) out.push(e.key);
    this.levels.forEach((list, level) => {
      if (!list || (weights[level] ?? 0) <= 0) return;
      for (const e of list) {
        if (e.size * scale < LABEL_MIN_RADIUS_PX) break;
        out.push(e.key);
      }
    });
    return out;
  }
}

/** A node whose label may be drawn, as it is on screen this frame. */
export interface LabelCandidate {
  key: string;
  /** 0 Packages, 1 Directories, 2 Files. */
  level: number;
  x: number;
  y: number;
  radiusPx: number;
  /** Focus, selection or search: drawn whatever the crowd, first. */
  labelFirst: boolean;
  /** Has a badge, drawn before the plain labels. */
  forceLabel: boolean;
}

/** Below this radius on screen, a disc is labelled only when forced. */
export const LABEL_MIN_RADIUS_PX = 9;
/** How far off screen a label's node may lie and still be drawn, in pixels. */
export const LABEL_MARGIN_PX = 120;

/**
 * The labels to draw this frame, in the order they claim their place (see
 * LabelBoxes): the forced ones, then those of the level in view, then the
 * others, each group biggest disc first. Every disc large enough on screen is
 * a candidate; only a label that collides with one drawn before it is left
 * out.
 */
export function labelOrder(
  nodes: readonly LabelCandidate[],
  screen: { width: number; height: number; levelInView: number },
): string[] {
  const rank = (n: LabelCandidate) =>
    n.labelFirst
      ? 0
      : n.forceLabel
        ? 1
        : n.level === screen.levelInView
          ? 2
          : 3;
  return nodes
    .filter(
      (n) =>
        (n.labelFirst || n.forceLabel || n.radiusPx >= LABEL_MIN_RADIUS_PX) &&
        n.x + n.radiusPx > -LABEL_MARGIN_PX &&
        n.x - n.radiusPx < screen.width + LABEL_MARGIN_PX &&
        n.y + n.radiusPx > -LABEL_MARGIN_PX &&
        n.y - n.radiusPx < screen.height + LABEL_MARGIN_PX,
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.radiusPx - a.radiusPx ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    .map((n) => n.key);
}
