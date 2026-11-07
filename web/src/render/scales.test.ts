import { describe, expect, it } from "vitest";
import {
  EDGE_WIDTH,
  MIN_RADIUS_PX,
  edgeDensity,
  edgeWidth,
  glow,
  heatColor,
  parseColor,
  toCss,
  type Palette,
} from "./scales";

const palette: Palette = {
  dark: true,
  canvas: [10, 14, 23],
  label: [220, 225, 235],
  halo: [10, 14, 23],
  muted: [139, 149, 170],
  edge: [70, 80, 100],
  cool: [76, 106, 158],
  warm: [167, 123, 243],
  hot: [255, 143, 77],
  focus: [143, 180, 255],
  added: [61, 220, 176],
  modified: [255, 207, 92],
  removed: [240, 110, 110],
};

describe("colours", () => {
  it("parses the hex and rgb() forms CSS tokens come in", () => {
    expect(parseColor("#ff8f4d")).toEqual([255, 143, 77]);
    expect(parseColor(" #abc ")).toEqual([170, 187, 204]);
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseColor("rgba(1 2 3 / 50%)")).toEqual([1, 2, 3]);
    expect(parseColor("nonsense")).toBeNull();
  });

  it("writes a colour sigma can parse", () => {
    expect(toCss([1, 2, 3])).toBe("rgb(1,2,3)");
  });
});

describe("Churn colour scale", () => {
  it("runs from the calm tone through the warm one to the hot one", () => {
    expect(heatColor(0, palette)).toEqual(palette.cool);
    expect(heatColor(0.5, palette)).toEqual(palette.warm);
    expect(heatColor(1, palette)).toEqual(palette.hot);
  });

  it("is continuous and stays in gamut between the stops", () => {
    let prev = heatColor(0, palette);
    for (let i = 1; i <= 100; i++) {
      const c = heatColor(i / 100, palette);
      for (const ch of c) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
      const jump = Math.max(...c.map((ch, k) => Math.abs(ch - prev[k]!)));
      expect(jump).toBeLessThan(12);
      prev = c;
    }
  });

  it("clamps a heat outside 0..1", () => {
    expect(heatColor(-1, palette)).toEqual(palette.cool);
    expect(heatColor(3, palette)).toEqual(palette.hot);
  });
});

describe("glow", () => {
  it("lights only the Modules that move a lot", () => {
    expect(glow(0)).toBe(0);
    expect(glow(0.4)).toBe(0);
    expect(glow(0.75)).toBeGreaterThan(0);
    expect(glow(0.75)).toBeLessThan(glow(0.9));
    expect(glow(1)).toBe(1);
  });
});

describe("Size scale", () => {
  it("keeps a floor so that small Modules stay clickable", () => {
    expect(MIN_RADIUS_PX).toBeGreaterThanOrEqual(2);
  });
});

describe("edge widths", () => {
  it("grows with the number of imports a Dependency carries", () => {
    expect(edgeWidth("packages", 0, false)).toBe(EDGE_WIDTH.min);
    expect(edgeWidth("packages", 1, false)).toBe(EDGE_WIDTH.max.packages);
    expect(edgeWidth("packages", 0.5, false)).toBeGreaterThan(EDGE_WIDTH.min);
    expect(edgeWidth("packages", 0.5, false)).toBeLessThan(
      EDGE_WIDTH.max.packages,
    );
  });

  it("stays thin between Files, where every Dependency weighs one import", () => {
    expect(edgeWidth("files", 1, false)).toBeLessThan(
      edgeWidth("directories", 1, false),
    );
  });

  it("thickens a highlighted Dependency", () => {
    expect(edgeWidth("files", 1, true)).toBeGreaterThan(
      edgeWidth("files", 1, false),
    );
  });
});

describe("edge density", () => {
  it("keeps a few Dependencies at full opacity and fades thousands, never to nothing", () => {
    expect(edgeDensity(10)).toBe(1);
    expect(edgeDensity(600)).toBeCloseTo(0.5);
    expect(edgeDensity(100000)).toBe(0.15);
  });
});
