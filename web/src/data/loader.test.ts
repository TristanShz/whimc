import { describe, expect, it } from "vitest";
import { planFetches, wantedFetches, type Held, type Slot } from "./loader";

describe("what to fetch", () => {
  const wanted = wantedFetches({
    maps: [
      { level: "packages", tests: false },
      { level: "directories", tests: false },
    ],
    compare: null,
  });
  const held = (slot: Slot, revision = 0): Held => ({
    key: wanted.get(slot)!.key,
    revision,
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
    const plan = planFetches(wanted, { packages: held("packages") }, {});
    expect(plan.start.map((f) => f.slot)).toEqual(["directories"]);
    expect(plan.cancel).toEqual([]);
  });

  it("does not ask twice for a fetch on its way", () => {
    const plan = planFetches(
      wanted,
      {},
      { packages: held("packages"), directories: held("directories") },
    );
    expect(plan.start).toEqual([]);
  });

  it("replaces a fetch on its way when the view wants something else for its slot", () => {
    const plan = planFetches(
      wanted,
      {},
      { packages: { key: "/api/map?level=packages&tests=true", revision: 0 } },
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
      { packages: held("packages") },
      { files: { key: "/api/map?level=files&tests=false", revision: 0 } },
    );
    expect(plan).toEqual({ start: [], cancel: [] });
  });

  it("fetches again what was loaded before the index changed", () => {
    const plan = planFetches(
      wanted,
      { packages: held("packages", 1), directories: held("directories", 2) },
      {},
      2,
    );
    expect(plan.start.map((f) => f.slot)).toEqual(["packages"]);
  });

  it("lets a fetch on its way land before fetching the newer revision, so bursts do not starve it", () => {
    const plan = planFetches(
      wanted,
      { packages: held("packages", 0) },
      { packages: held("packages", 1), directories: held("directories", 1) },
      5,
    );
    expect(plan).toEqual({ start: [], cancel: [] });
  });
});
