import { describe, expect, it } from "vitest";
import { testPalette as palette } from "./palette.fixture";
import {
  CHURN_STEPS,
  EDGE_WIDTH,
  MIN_RADIUS_PX,
  churnColor,
  churnRanges,
  churnStep,
  edgeDensity,
  edgeStep,
  edgeWidth,
  parseColor,
  toCss,
} from "./scales";

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
  it("has five steps, one colour of the theme each", () => {
    expect(CHURN_STEPS).toBe(5);
    expect(palette.churn).toHaveLength(CHURN_STEPS);
  });

  it("quantises a heat into five even bands, calm to moving a lot", () => {
    expect(churnStep(0)).toBe(0);
    expect(churnStep(0.19)).toBe(0);
    expect(churnStep(0.2)).toBe(1);
    expect(churnStep(0.5)).toBe(2);
    expect(churnStep(0.79)).toBe(3);
    expect(churnStep(0.8)).toBe(4);
    expect(churnStep(1)).toBe(4);
  });

  it("clamps a heat outside 0..1", () => {
    expect(churnStep(-1)).toBe(0);
    expect(churnStep(3)).toBe(4);
  });

  it("colours a heat with the colour of its step", () => {
    expect(churnColor(0, palette)).toEqual(palette.churn[0]);
    expect(churnColor(0.45, palette)).toEqual(palette.churn[2]);
    expect(churnColor(1, palette)).toEqual(palette.churn[4]);
  });
});

describe("Churn ranges for the Legend", () => {
  const stepOf = (c: number, max: number) =>
    churnStep(Math.log1p(c) / Math.log1p(max));

  it("covers every commit count from 0 to the busiest, each in its own step", () => {
    for (const max of [1, 2, 7, 40, 90, 1234]) {
      const ranges = churnRanges(max);
      expect(ranges).toHaveLength(CHURN_STEPS);
      let next = 0;
      ranges.forEach((r, k) => {
        if (!r) return;
        expect(r.from).toBe(next);
        expect(stepOf(r.from, max)).toBe(k);
        expect(stepOf(r.to, max)).toBe(k);
        next = r.to + 1;
      });
      expect(next).toBe(max + 1);
    }
  });

  it("starts at no commits and ends at the busiest Module", () => {
    const r = churnRanges(90);
    expect(r[0]!.from).toBe(0);
    expect(r[4]!.to).toBe(90);
  });

  it("leaves a step empty when no whole commit count falls in it", () => {
    // 0 and 1 commits: heat 0 and 1, the steps between hold nothing.
    expect(churnRanges(1)).toEqual([
      { from: 0, to: 0 },
      null,
      null,
      null,
      { from: 1, to: 1 },
    ]);
  });

  it("puts everything in the calm step when nothing moved", () => {
    expect(churnRanges(0)).toEqual([
      { from: 0, to: 0 },
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("Size scale", () => {
  it("keeps a floor so that small Modules stay clickable", () => {
    expect(MIN_RADIUS_PX).toBeGreaterThanOrEqual(2);
  });
});

describe("edge widths", () => {
  it("steps up with the number of imports a Dependency carries", () => {
    expect(edgeStep(0)).toBe(0);
    expect(edgeStep(0.5)).toBe(1);
    expect(edgeStep(1)).toBe(2);
    const w = (s: number) => edgeWidth("packages", s, false);
    expect(w(0)).toBe(EDGE_WIDTH.steps.packages[0]);
    expect(w(0.5)).toBeGreaterThan(w(0));
    expect(w(1)).toBeGreaterThan(w(0.5));
  });

  it("stays thin: discreet even for the heaviest coupling", () => {
    for (const l of ["packages", "directories", "files"] as const)
      expect(edgeWidth(l, 1, false)).toBeLessThanOrEqual(3);
  });

  it("stays thinner between Files, where every Dependency weighs one import", () => {
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
