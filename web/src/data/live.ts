// What the Updates of /api/changes mean to the page: how far the first run
// is, and when what is on screen is out of date.

import type { Update } from "../api/types";

/** How far the first run of the index is. */
export type Indexing =
  /** Nothing heard yet: the server may be reading the structure. */
  | { phase: "starting" }
  /** The structure is in; Dependencies and Churn fill in Package by Package. */
  | { phase: "packages"; done: number; total: number }
  | { phase: "done" };

export const STARTING: Indexing = { phase: "starting" };

/** The first run after an Update. */
export function nextIndexing(prev: Indexing, u: Update): Indexing {
  switch (u.kind) {
    case "structure":
      return { phase: "packages", done: 0, total: u.total ?? 0 };
    case "package":
      return { phase: "packages", done: u.done ?? 0, total: u.total ?? 0 };
    case "indexed":
      return { phase: "done" };
    default:
      return prev;
  }
}

/** Its share done, 0 to 1, for a progress bar. */
export function indexingShare(i: Indexing): number {
  if (i.phase === "done") return 1;
  if (i.phase === "starting" || i.total === 0) return 0;
  return Math.min(1, i.done / i.total);
}
