import { describe, expect, it } from "vitest";
import type { Level } from "../api/types";
import { frameMatches } from "./framing";
import { VIEW, levelZooms, revealZoom } from "./levels";
import type { SearchMatch } from "./viewState";

const radii: Record<Level, number | null> = {
  packages: 100,
  directories: 40,
  files: 8,
};
const screen = { width: 1000, height: 800 };

function match(
  level: Level,
  id: string,
  x: number,
  y: number,
  ancestors: string[] = [],
): SearchMatch {
  const radius = level === "packages" ? 100 : level === "directories" ? 40 : 8;
  return { id, level, x, y, radius, ancestors };
}

describe("the zoom that shows a level", () => {
  it("brings the typical disc of the level, and of those above it, to the end of the reveal", () => {
    expect(revealZoom(radii, "packages")).toBe(0);
    expect(revealZoom(radii, "directories")).toBe(VIEW.revealEndPx / 40);
    expect(revealZoom(radii, "files")).toBe(VIEW.revealEndPx / 8);
  });

  it("keeps a level in view until the one below it starts to show", () => {
    expect(levelZooms(radii, "packages")).toEqual({
      min: 0,
      max: VIEW.revealStartPx / 40,
    });
    expect(levelZooms(radii, "directories")).toEqual({
      min: VIEW.revealEndPx / 40,
      max: VIEW.revealStartPx / 8,
    });
    expect(levelZooms(radii, "files")).toEqual({
      min: VIEW.revealEndPx / 8,
      max: (3 * VIEW.revealEndPx) / 8,
    });
  });

  it("is unknown while a radius it needs is", () => {
    expect(revealZoom({ ...radii, files: null }, "files")).toBeNull();
  });
});

describe("framing the search matches", () => {
  it("zooms in to the Files level when the matches are Files", () => {
    const f = frameMatches(
      [
        match("files", "file:a/probe.ts", 0, 0, ["dir:a", "pkg:x"]),
        match("files", "file:a/probe2.ts", 30, 10, ["dir:a", "pkg:x"]),
      ],
      radii,
      screen,
    )!;

    expect(f.level).toBe("files");
    expect(f.minZoom).toBe(revealZoom(radii, "files"));
    expect(f.maxZoom).toBe(3 * revealZoom(radii, "files")!);
    expect(f.area).toEqual({ x0: -8, y0: -8, x1: 38, y1: 18 });
    expect(f.ids).toHaveLength(2);
  });

  it("leaves out the matches inside another match, shown by it", () => {
    const f = frameMatches(
      [
        match("directories", "dir:a/probe", 0, 0, ["pkg:x"]),
        match("files", "file:a/probe/index.ts", 5, 5, ["dir:a/probe", "pkg:x"]),
        match("files", "file:a/probe/run.ts", -5, 5, ["dir:a/probe", "pkg:x"]),
      ],
      radii,
      screen,
    )!;

    expect(f.level).toBe("directories");
    expect(f.ids).toEqual(["dir:a/probe"]);
    expect(f.minZoom).toBe(revealZoom(radii, "directories"));
  });

  it("shows the level most matches are at, the deeper one on a tie", () => {
    const f = frameMatches(
      [
        match("directories", "dir:b/probe", 0, 0, ["pkg:x"]),
        match("files", "file:c/probe.ts", 50, 0, ["dir:c", "pkg:x"]),
      ],
      radii,
      screen,
    )!;
    expect(f.level).toBe("files");
  });

  it("frames the largest group that fits at that zoom when they cannot all", () => {
    // At the Files zoom (3.25 px/unit) the screen spans about 308 × 246 units.
    const f = frameMatches(
      [
        match("files", "file:far.ts", 5000, 0, ["dir:z"]),
        match("files", "file:a.ts", 0, 0, ["dir:a"]),
        match("files", "file:b.ts", 40, 20, ["dir:a"]),
        match("files", "file:c.ts", 80, -20, ["dir:a"]),
      ],
      radii,
      screen,
    )!;
    expect(f.ids.sort()).toEqual(["file:a.ts", "file:b.ts", "file:c.ts"]);
    expect(f.area).toEqual({ x0: -8, y0: -28, x1: 88, y1: 28 });
  });

  it("frames nothing without matches", () => {
    expect(frameMatches([], radii, screen)).toBeNull();
  });
});
