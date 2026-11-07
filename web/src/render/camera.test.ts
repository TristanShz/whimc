import { describe, expect, it } from "vitest";
import {
  boundsOf,
  cameraFrom,
  diveArea,
  dotGrid,
  fitRatio,
  flipY,
} from "./camera";

describe("coordinates", () => {
  it("flips y between the engine's map (y down) and sigma's graph (y up)", () => {
    expect(flipY({ x: 3, y: 4 })).toEqual({ x: 3, y: -4 });
    expect(flipY(flipY({ x: 3, y: 4 }))).toEqual({ x: 3, y: 4 });
  });

  it("derives the camera of the view state from the screen corners", () => {
    const cam = cameraFrom(
      { width: 800, height: 400 },
      { x: -100, y: -50 },
      { x: 100, y: 50 },
    );
    expect(cam).toEqual({
      zoom: 4,
      viewport: { x0: -100, y0: -50, x1: 100, y1: 50 },
    });
  });

  it("orders the viewport whatever the corners' orientation", () => {
    const cam = cameraFrom(
      { width: 100, height: 100 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    );
    expect(cam.viewport).toEqual({ x0: 0, y0: 0, x1: 10, y1: 10 });
  });
});

describe("fitting", () => {
  it("bounds discs, radius included", () => {
    expect(
      boundsOf([
        { x: 0, y: 0, radius: 1 },
        { x: 10, y: 5, radius: 2 },
      ]),
    ).toEqual({ x0: -1, y0: -1, x1: 12, y1: 7 });
    expect(boundsOf([])).toBeNull();
  });

  it("finds the camera ratio that fits an area on screen, with a margin", () => {
    // At zoom 2, an area 100 wide spans 200 px of an 800 px wide screen: it
    // can grow 4 times, so the ratio shrinks 4 times (and a bit for the margin).
    const r = fitRatio(
      1,
      2,
      { x0: 0, y0: 0, x1: 100, y1: 50 },
      { width: 800, height: 800 },
      1,
    );
    expect(r).toBeCloseTo(0.25);
    expect(
      fitRatio(
        1,
        2,
        { x0: 0, y0: 0, x1: 100, y1: 50 },
        { width: 800, height: 800 },
        0.8,
      ),
    ).toBeCloseTo(0.25 / 0.8);
  });

  it("fits the tighter of the two dimensions", () => {
    const r = fitRatio(
      1,
      1,
      { x0: 0, y0: 0, x1: 100, y1: 100 },
      { width: 1000, height: 200 },
      1,
    );
    expect(r).toBeCloseTo(0.5);
  });
});

describe("dot grid", () => {
  it("keeps its spacing on screen within one octave while zooming", () => {
    for (const zoom of [0.01, 0.3, 1, 1.9, 7, 300]) {
      const g = dotGrid(zoom, { x: 0, y: 0 });
      expect(g.size).toBeGreaterThanOrEqual(24);
      expect(g.size).toBeLessThan(48);
    }
  });

  it("moves with the Map while panning", () => {
    const a = dotGrid(1, { x: 0, y: 0 });
    const b = dotGrid(1, { x: 5, y: -3 });
    expect(b.x - a.x).toBeCloseTo(5);
    expect(((b.y - a.y + a.size) % a.size) - a.size).toBeCloseTo(-3);
    expect(dotGrid(1, { x: 1000, y: 0 }).x).toBeLessThan(a.size);
  });
});

describe("diving into a Module", () => {
  it("frames the whole disc when its children show at that zoom", () => {
    // 4 children of radius 0.8 × 100 / 2 = 40; framing the disc on 700 px
    // at 0.7 gives a zoom of 2.45: children span 98 px, well revealed.
    const a = diveArea({ x: 10, y: 0, radius: 100, children: 4 }, 700, 30);
    expect(a.x1 - a.x0).toBeCloseTo(200);
    expect((a.x0 + a.x1) / 2).toBeCloseTo(10);
  });

  it("goes closer when the children are too small to show at that zoom", () => {
    // 10000 children of radius 0.8: the zoom must reach 30 / 0.8 = 37.5.
    const a = diveArea({ x: 0, y: 0, radius: 100, children: 10000 }, 700, 30);
    expect((0.7 * 700) / (a.x1 - a.x0)).toBeCloseTo(37.5);
  });
});
