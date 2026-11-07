import { describe, expect, it } from "vitest";
import { planFetches, wantedFetches } from "./loader";

describe("what to fetch", () => {
  const wanted = wantedFetches({
    maps: [
      { level: "packages", tests: false },
      { level: "directories", tests: false },
    ],
    compare: null,
  });

  it("keys each fetch by its slot: a level, or the Comparison", () => {
    expect([...wanted.keys()]).toEqual(["packages", "directories"]);
    expect(wanted.get("packages")?.key).toBe(
      "/api/map?level=packages&tests=false",
    );
    const withCompare = wantedFetches({
      maps: [],
      compare: { base: "HEAD", target: "worktree", tests: false },
    });
    expect(withCompare.get("compare")?.key).toBe(
      "/api/compare?base=HEAD&target=worktree&tests=false",
    );
  });

  it("fetches what is neither loaded nor on its way", () => {
    const plan = planFetches(
      wanted,
      { packages: wanted.get("packages")!.key },
      {},
    );
    expect(plan.start.map((f) => f.slot)).toEqual(["directories"]);
    expect(plan.cancel).toEqual([]);
  });

  it("does not ask twice for a fetch on its way", () => {
    const plan = planFetches(
      wanted,
      {},
      {
        packages: wanted.get("packages")!.key,
        directories: wanted.get("directories")!.key,
      },
    );
    expect(plan.start).toEqual([]);
  });

  it("replaces a fetch on its way when the view wants something else for its slot", () => {
    const plan = planFetches(
      wanted,
      {},
      {
        packages: "/api/map?level=packages&tests=true",
      },
    );
    expect(plan.cancel).toEqual(["packages"]);
    expect(plan.start.map((f) => f.slot)).toEqual(["packages", "directories"]);
  });

  it("lets a fetch finish when its level leaves the view, to have it at hand on the way back", () => {
    const plan = planFetches(
      wantedFetches({
        maps: [{ level: "packages", tests: false }],
        compare: null,
      }),
      { packages: wanted.get("packages")!.key },
      { files: "/api/map?level=files&tests=false" },
    );
    expect(plan).toEqual({ start: [], cancel: [] });
  });
});
