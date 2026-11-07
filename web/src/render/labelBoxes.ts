// Keeps labels from overprinting each other: each frame, a label is drawn
// only where no label drawn before it lies.

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class LabelBoxes {
  private boxes: Box[] = [];

  /** Forgets the labels of the previous frame. */
  clear(): void {
    this.boxes = [];
  }

  /** Claims the box if it is free, with `gap` pixels around it; false if taken. */
  claim(b: Box, gap = 3): boolean {
    for (const o of this.boxes) {
      if (
        b.x0 - gap < o.x1 &&
        o.x0 < b.x1 + gap &&
        b.y0 - gap < o.y1 &&
        o.y0 < b.y1 + gap
      )
        return false;
    }
    this.boxes.push(b);
    return true;
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
const LABEL_MARGIN_PX = 120;

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
