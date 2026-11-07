import { describe, expect, it } from "vitest";
import type { Update } from "../api/types";
import { STARTING, indexingShare, nextIndexing, type Indexing } from "./live";

const run = (...us: Update[]): Indexing => us.reduce(nextIndexing, STARTING);

describe("first run progress", () => {
  it("starts before the structure is in", () => {
    expect(run()).toEqual({ phase: "starting" });
    expect(indexingShare(run())).toBe(0);
  });

  it("counts the Packages indexed after the structure", () => {
    const i = run(
      { kind: "structure", total: 4 },
      { kind: "package", package: "pkg:a", done: 1, total: 4 },
    );
    expect(i).toEqual({ phase: "packages", done: 1, total: 4 });
    expect(indexingShare(i)).toBe(0.25);
  });

  it("ends with the first run, and edits leave it as it is", () => {
    const done = run({ kind: "structure", total: 1 }, { kind: "indexed" });
    expect(done).toEqual({ phase: "done" });
    expect(indexingShare(done)).toBe(1);
    expect(nextIndexing(done, { kind: "files", paths: ["a.ts"] })).toBe(done);
  });

  it("knows where it is from the progress a late subscriber first receives", () => {
    expect(run({ kind: "package", done: 3, total: 5 })).toEqual({
      phase: "packages",
      done: 3,
      total: 5,
    });
  });
});
