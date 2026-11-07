import { describe, expect, it } from "vitest";
import { LabelBoxes, labelOrder, type LabelCandidate } from "./labelBoxes";

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

describe("which labels to draw, in which order", () => {
  const screen = { width: 800, height: 600, levelInView: 0 };
  const c = (
    key: string,
    radiusPx: number,
    extra: Partial<LabelCandidate> = {},
  ): LabelCandidate => ({
    key,
    level: 0,
    x: 400,
    y: 300,
    radiusPx,
    labelFirst: false,
    forceLabel: false,
    ...extra,
  });

  it("labels every disc large enough on screen, biggest first", () => {
    expect(
      labelOrder([c("mid", 40), c("tiny", 4), c("big", 200)], screen),
    ).toEqual(["big", "mid"]);
  });

  it("puts the forced labels first, then the level in view", () => {
    expect(
      labelOrder(
        [
          c("big", 200),
          c("file", 12, { level: 2 }),
          c("badged", 5, { forceLabel: true }),
          c("selected", 3, { labelFirst: true }),
        ],
        { ...screen, levelInView: 2 },
      ),
    ).toEqual(["selected", "badged", "file", "big"]);
  });

  it("leaves out discs far off screen", () => {
    expect(labelOrder([c("off", 20, { x: -500 })], screen)).toEqual([]);
  });
});
