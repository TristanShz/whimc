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
