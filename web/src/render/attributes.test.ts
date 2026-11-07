import { describe, expect, it } from "vitest";
import type { EdgeView, NodeView } from "../viewState";
import {
  FADE_SECONDS,
  LEVEL_INDEX,
  displayedFade,
  edgeAttributes,
  nodeAttributes,
  retarget,
} from "./attributes";
import { heatColor, toCss, type Palette } from "./scales";

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

function node(extra: Partial<NodeView> = {}): NodeView {
  return {
    id: "dir:core/money",
    level: "directories",
    name: "money",
    path: "core/money",
    parent: "pkg:core",
    x: 10,
    y: 20,
    radius: 4,
    size: 120,
    churn: 3,
    heat: 0.2,
    test: false,
    levelWeight: 0.5,
    fade: 1,
    contextFade: 1,
    opacity: 0.5,
    focused: false,
    selected: false,
    match: false,
    highlighted: false,
    dimmed: false,
    change: null,
    changedFiles: 0,
    ghost: false,
    ...extra,
  };
}

function edge(extra: Partial<EdgeView> = {}): EdgeView {
  return {
    id: "a->b",
    from: "a",
    to: "b",
    level: "files",
    kind: "runtime",
    weight: 1,
    strength: 1,
    opacity: 1,
    highlighted: false,
    dimmed: false,
    change: null,
    ghost: false,
    ...extra,
  };
}

describe("node attributes", () => {
  it("places the node at its frozen position, y pointing down as on the engine's map", () => {
    const a = nodeAttributes(node(), palette);
    expect(a).toMatchObject({ x: 10, y: -20, size: 4, text: "money" });
    expect(a).toMatchObject({ lines: 120, commits: 3 });
    expect(a.level).toBe(LEVEL_INDEX.directories);
  });

  it("colours it by its heat and lets only hot nodes glow", () => {
    expect(nodeAttributes(node(), palette).color).toBe(
      toCss(heatColor(0.2, palette)),
    );
    expect(nodeAttributes(node(), palette).glow).toBe(0);
    expect(nodeAttributes(node({ heat: 1 }), palette).glow).toBe(1);
  });

  it("leaves the level weight and the reveal of the children to the shader", () => {
    expect(nodeAttributes(node(), palette).fade).toBe(1);
    expect(nodeAttributes(node({ fade: 0.1 }), palette).fade).toBeCloseTo(0.1);
    expect(
      nodeAttributes(node({ levelWeight: 0, opacity: 0 }), palette).fade,
    ).toBe(0);
  });

  it("does not see a change in a zoom step that only moves the level weight", () => {
    const a = nodeAttributes(
      node({ levelWeight: 0.3, fade: 0.15, opacity: 0.3 * 0.15 }),
      palette,
    );
    const b = nodeAttributes(
      node({ levelWeight: 0.7, fade: 0.15, opacity: 0.7 * 0.15 }),
      palette,
    );
    expect(a.fade).toBe(b.fade);
  });

  it("gives the share of its fade a highlighted parent keeps as context", () => {
    expect(nodeAttributes(node(), palette).context).toBe(1);
    const a = nodeAttributes(
      node({ selected: true, fade: 1, contextFade: 0.15 }),
      palette,
    );
    expect(a.context).toBeCloseTo(0.15);
    expect(
      nodeAttributes(node({ fade: 0, contextFade: 0 }), palette).context,
    ).toBe(1);
  });

  it("rings the focus in the focus colour and forces its label", () => {
    const a = nodeAttributes(node({ focused: true }), palette);
    expect(a.ring).toBe(1);
    expect(a.ringColor).toBe(toCss(palette.focus));
    expect(a.forceLabel).toBe(true);
    expect(nodeAttributes(node(), palette).ring).toBe(0);
  });

  it("marks an added Module with a dashed ring and a modified one with a solid ring", () => {
    const added = nodeAttributes(node({ change: "added" }), palette);
    expect(added).toMatchObject({ ring: 2, ringColor: toCss(palette.added) });
    const modified = nodeAttributes(node({ change: "modified" }), palette);
    expect(modified).toMatchObject({
      ring: 1,
      ringColor: toCss(palette.modified),
    });
  });

  it("badges a changed Directory or Package with its changed-File count, not a File", () => {
    const dir = nodeAttributes(
      node({ change: "modified", changedFiles: 1240 }),
      palette,
    );
    expect(dir).toMatchObject({
      badge: "1,240",
      forceLabel: true,
      labelFirst: false,
    });
    expect(dir.badgeColor).toBe(toCss(palette.modified));
    const added = nodeAttributes(
      node({ change: "added", changedFiles: 2 }),
      palette,
    );
    expect(added.badgeColor).toBe(toCss(palette.added));
    expect(
      nodeAttributes(
        node({ level: "files", change: "modified", changedFiles: 1 }),
        palette,
      ).badge,
    ).toBe("");
    expect(nodeAttributes(node(), palette)).toMatchObject({
      badge: "",
      forceLabel: false,
    });
  });

  it("draws a ghost hollow, without glow, behind the living nodes of its level", () => {
    const ghost = nodeAttributes(
      node({ ghost: true, change: "removed", heat: 1 }),
      palette,
    );
    expect(ghost).toMatchObject({ hollow: 1, glow: 0, ring: 2 });
    expect(ghost.zIndex).toBeLessThan(nodeAttributes(node(), palette).zIndex);
  });

  it("draws deeper levels above their parents, and the focus above its level", () => {
    const dir = nodeAttributes(node(), palette).zIndex;
    const file = nodeAttributes(node({ level: "files" }), palette).zIndex;
    const pkg = nodeAttributes(node({ level: "packages" }), palette).zIndex;
    const focused = nodeAttributes(node({ focused: true }), palette).zIndex;
    expect(pkg).toBeLessThan(dir);
    expect(dir).toBeLessThan(focused);
    expect(focused).toBeLessThan(file);
  });

  it("forces the labels of search matches only when they are few", () => {
    expect(nodeAttributes(node({ match: true }), palette).forceLabel).toBe(
      true,
    );
    expect(
      nodeAttributes(node({ match: true }), palette, { matchLabels: false })
        .forceLabel,
    ).toBe(false);
  });
});

describe("edge attributes", () => {
  it("leaves the level weight to the shader", () => {
    const a = edgeAttributes(edge({ opacity: 0.25 }), palette, 0.5);
    const b = edgeAttributes(edge({ opacity: 0.5 }), palette, 1);
    expect(a.fade).toBeCloseTo(b.fade);
    expect(edgeAttributes(edge({ opacity: 0 }), palette, 0).fade).toBe(0);
  });

  it("thins the crowd of Dependencies, a highlighted one less so", () => {
    const plain = (d: number) => edgeAttributes(edge(), palette, 1, d).fade;
    const lit = (d: number) =>
      edgeAttributes(edge({ highlighted: true }), palette, 1, d).fade;
    expect(plain(0.5)).toBeCloseTo(plain(1) / 2);
    expect(lit(0.5)).toBeCloseTo(lit(1) * 0.9);
    expect(lit(0.1)).toBeCloseTo(lit(1) * 0.18);
    expect(lit(0.1)).toBeGreaterThan(plain(0.1));
  });

  it("shows a heavy Dependency more than a light one", () => {
    expect(
      edgeAttributes(edge({ strength: 1 }), palette, 1).fade,
    ).toBeGreaterThan(edgeAttributes(edge({ strength: 0.1 }), palette, 1).fade);
  });

  it("encodes the kind for the dash pattern and the width from the strength", () => {
    expect(edgeAttributes(edge(), palette, 1).kind).toBe(0);
    expect(edgeAttributes(edge({ kind: "type-only" }), palette, 1).kind).toBe(
      1,
    );
    expect(edgeAttributes(edge({ kind: "dynamic" }), palette, 1).kind).toBe(2);
    const weak = edgeAttributes(
      edge({ level: "packages", strength: 0 }),
      palette,
      1,
    );
    const strong = edgeAttributes(
      edge({ level: "packages", strength: 1 }),
      palette,
      1,
    );
    expect(strong.size).toBeGreaterThan(weak.size);
  });

  it("draws a highlighted Dependency in the focus colour, above the others", () => {
    const a = edgeAttributes(edge({ highlighted: true }), palette, 1);
    expect(a.color).toBe(toCss(palette.focus));
    expect(a.zIndex).toBeGreaterThan(edgeAttributes(edge(), palette, 1).zIndex);
    expect(a.fade).toBeGreaterThan(edgeAttributes(edge(), palette, 1).fade);
  });

  it("colours an added, a modified and a removed Dependency by their change, focus or not", () => {
    expect(edgeAttributes(edge({ change: "added" }), palette, 1).color).toBe(
      toCss(palette.added),
    );
    expect(
      edgeAttributes(
        edge({ change: "modified", highlighted: true }),
        palette,
        1,
      ).color,
    ).toBe(toCss(palette.modified));
    expect(
      edgeAttributes(edge({ change: "removed", ghost: true }), palette, 1)
        .color,
    ).toBe(toCss(palette.removed));
  });
});

describe("fade transitions", () => {
  it("fades a new item in from nothing", () => {
    const f = retarget(undefined, 0.8, 10);
    expect(f).toEqual({ fade: 0.8, fadeFrom: 0, fadeAt: 10 });
    expect(displayedFade(f, 10)).toBe(0);
    expect(displayedFade(f, 10 + FADE_SECONDS / 2)).toBeCloseTo(0.4);
    expect(displayedFade(f, 10 + FADE_SECONDS)).toBe(0.8);
  });

  it("keeps a running transition when the target does not change", () => {
    const f = retarget(undefined, 1, 10);
    expect(retarget(f, 1, 10.1)).toEqual(f);
  });

  it("starts a new transition from what is on screen, so that nothing jumps", () => {
    const f = retarget(undefined, 1, 10);
    const mid = 10 + FADE_SECONDS / 2;
    const g = retarget(f, 0.2, mid);
    expect(g.fade).toBe(0.2);
    expect(g.fadeAt).toBe(mid);
    expect(g.fadeFrom).toBeCloseTo(displayedFade(f, mid));
  });
});
