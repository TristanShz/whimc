import { describe, expect, it } from "vitest";
import { LabelBoxes } from "./labelBoxes";

describe("label boxes", () => {
  it("lets the first label have its place and turns away one overlapping it", () => {
    const boxes = new LabelBoxes();
    expect(boxes.claim({ x0: 0, y0: 0, x1: 100, y1: 12 })).toBe(true);
    expect(boxes.claim({ x0: 90, y0: 5, x1: 160, y1: 17 })).toBe(false);
    expect(boxes.claim({ x0: 0, y0: 20, x1: 100, y1: 32 })).toBe(true);
  });

  it("keeps a gap between labels", () => {
    const boxes = new LabelBoxes();
    boxes.claim({ x0: 0, y0: 0, x1: 100, y1: 12 });
    expect(boxes.claim({ x0: 101, y0: 0, x1: 150, y1: 12 })).toBe(false);
    expect(boxes.claim({ x0: 101, y0: 0, x1: 150, y1: 12 }, 0)).toBe(true);
  });

  it("starts each frame empty", () => {
    const boxes = new LabelBoxes();
    boxes.claim({ x0: 0, y0: 0, x1: 100, y1: 12 });
    boxes.clear();
    expect(boxes.claim({ x0: 0, y0: 0, x1: 100, y1: 12 })).toBe(true);
  });
});
