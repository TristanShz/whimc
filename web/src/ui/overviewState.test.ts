import { describe, expect, it } from "vitest";
import type { Overview } from "../api/types";
import { languageShares, overviewOpenAtStart } from "./overviewState";

const overview = (languages: Overview["languages"]): Overview => ({
  size: languages.reduce((s, l) => s + l.size, 0),
  packages: 1,
  directories: 1,
  files: 1,
  dependencies: 0,
  commits: 0,
  languages,
  partial: false,
});

describe("the language split", () => {
  it("gives each language its share of the Size, the largest first", () => {
    const shares = languageShares(
      overview([
        { language: "ts", size: 780 },
        { language: "go", size: 220 },
      ]),
    );
    expect(shares.map((s) => [s.name, s.percent])).toEqual([
      ["TS/JS", "78%"],
      ["Go", "22%"],
    ]);
    expect(shares[0]!.share).toBeCloseTo(0.78);
  });

  it("never rounds a language present away, nor the other up to all", () => {
    const shares = languageShares(
      overview([
        { language: "ts", size: 999 },
        { language: "go", size: 1 },
      ]),
    );
    expect(shares.map((s) => s.percent)).toEqual([">99%", "<1%"]);
  });

  it("is empty for a State without lines", () => {
    expect(languageShares(overview([]))).toEqual([]);
    expect(languageShares(overview([{ language: "go", size: 0 }]))).toEqual([]);
  });
});

describe("the panel at start", () => {
  it("opens as the viewer left it", () => {
    expect(overviewOpenAtStart("open", false)).toBe(true);
    expect(overviewOpenAtStart("closed", true)).toBe(false);
  });

  it("opens on a wide screen and folds on a narrow one the first time", () => {
    expect(overviewOpenAtStart(null, true)).toBe(true);
    expect(overviewOpenAtStart(null, false)).toBe(false);
  });
});
