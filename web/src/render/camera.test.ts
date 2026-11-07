import { describe, expect, it } from "vitest";
import {
  boundsOf,
  cameraFrom,
  diveArea,
  dotGrid,
  GRID_MAJOR,
  flipY,
  frameArea,
  insetsFrom,
  NO_INSETS,
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

  it("fits the tighter of the two dimensions", () => {
    const f = frameArea(
      { x0: 0, y0: 0, x1: 100, y1: 100 },
      { width: 1000, height: 200 },
      NO_INSETS,
      1,
    );
    expect(f.zoom).toBe(2);
    expect(f.centre).toEqual({ x: 50, y: 50 });
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

  it("puts a major dot every few dots, on a dot, moving with the Map", () => {
    const g = dotGrid(1.3, { x: 1000, y: -77 });
    const major = g.size * GRID_MAJOR;
    expect(g.majorX).toBeLessThan(major);
    expect(g.majorY).toBeGreaterThanOrEqual(0);
    // A major dot sits on a minor one.
    expect(((g.majorX - g.x) / g.size) % 1).toBeCloseTo(0);
    expect(((g.majorY - g.y) / g.size) % 1).toBeCloseTo(0);
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

describe("framing around the panels", () => {
  const screen = { width: 1000, height: 800 };

  it("pushes in the edge each panel hugs", () => {
    const insets = insetsFrom(screen, [
      { x0: 16, y0: 16, x1: 560, y1: 60 }, // toolbar
      { x0: 16, y0: 16, x1: 560, y1: 110 }, // toolbar and Changes bar
      { x0: 664, y0: 70, x1: 984, y1: 700 }, // details
      { x0: 16, y0: 740, x1: 110, y1: 784 }, // legend, collapsed
    ]);
    expect(insets).toEqual({ top: 110, right: 336, bottom: 60, left: 0 });
  });

  it("never lets the panels take the whole screen", () => {
    const insets = insetsFrom(screen, [{ x0: 0, y0: 0, x1: 1000, y1: 790 }]);
    expect(insets.top).toBe(800 * 0.45);
  });

  it("ignores panels that are not shown", () => {
    expect(insetsFrom(screen, [{ x0: 0, y0: 0, x1: 0, y1: 0 }])).toEqual(
      NO_INSETS,
    );
  });

  it("centres the area in the clear part of the screen", () => {
    const area = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const insets = { top: 100, right: 0, bottom: 0, left: 0 };
    const f = frameArea(area, screen, insets, 1);
    // 700 px of height left for 100 units.
    expect(f.zoom).toBe(7);
    // The screen centre (y 400) sits 50 px above the clear centre (y 450).
    expect(f.centre.x).toBe(50);
    expect(f.centre.y).toBeCloseTo(50 - 50 / 7);
  });

  it("goes no farther than the zoom asked for", () => {
    const area = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
    expect(frameArea(area, screen, NO_INSETS, 1, 3).zoom).toBe(3);
    expect(frameArea(area, screen, NO_INSETS, 1, 0).zoom).toBe(0.8);
  });

  it("goes no closer than the zoom allowed, unless the minimum asks to", () => {
    const area = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(frameArea(area, screen, NO_INSETS, 1, 0, 5).zoom).toBe(5);
    expect(frameArea(area, screen, NO_INSETS, 1, 8, 5).zoom).toBe(8);
  });
});
