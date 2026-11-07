// Whether the Legend starts open: open on the first view on a wide screen,
// so that the Map reads without docs, then collapsed (it covers part of the
// Map), unless the user opened it last time.

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
