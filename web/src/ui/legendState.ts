// The Legend's state and words. Whether it starts open: open on the first
// view on a wide screen, so that the Map reads without docs, then collapsed
// (it covers part of the Map), unless the user opened it last time. And the
// commits each Churn step covers.

import { formatCount } from "../format";
import type { ChurnRange } from "../render/scales";

/** The localStorage key holding "open" or "closed". */
export const LEGEND_KEY = "whimc.legend";

/**
 * The Legend's state at start from what was stored, and what to store now
 * so that the next view starts collapsed.
 */
export function legendAtStart(
  stored: string | null,
  wide: boolean,
): { open: boolean; store: "open" | "closed" | null } {
  if (stored === "open") return { open: true, store: null };
  if (stored === "closed") return { open: false, store: null };
  return { open: wide, store: "closed" };
}

/**
 * The commits each Churn step covers, as the Legend writes them under its
 * swatch: "0", "3–7", "1,024–1,800", or "none" for a step no whole
 * commit count falls in.
 */
export function churnLegend(ranges: ChurnRange[]): string[] {
  return ranges.map((r) =>
    !r
      ? "none"
      : r.from === r.to
        ? formatCount(r.from)
        : `${formatCount(r.from)}–${formatCount(r.to)}`,
  );
}
