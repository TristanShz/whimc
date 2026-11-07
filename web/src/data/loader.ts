// What to fetch for the view: each level in view and the Comparison has a
// slot that holds one answer; a slot is fetched again only when the view
// wants another answer for it (another tests switch, ref or viewport area).

import {
  compareUrl,
  type CompareRequest,
  type MapRequest,
} from "../api/client";
import type { Level } from "../api/types";
import { requestKey, type Requests } from "../viewState";

export type Slot = Level | "compare";

export type Fetch =
  | { slot: Level; key: string; map: MapRequest }
  | { slot: "compare"; key: string; compare: CompareRequest };

/** The fetches the view's requests stand for, by slot. */
export function wantedFetches(r: Requests): Map<Slot, Fetch> {
  const out = new Map<Slot, Fetch>();
  for (const map of r.maps)
    out.set(map.level, { slot: map.level, key: requestKey(map), map });
  if (r.compare)
    out.set("compare", {
      slot: "compare",
      key: compareUrl(r.compare),
      compare: r.compare,
    });
  return out;
}

export interface Plan {
  start: Fetch[];
  /** Slots whose fetch on its way is no longer wanted. */
  cancel: Slot[];
}

/**
 * Which fetches to start and cancel, given the key each slot holds and the
 * key each fetch on its way will bring. A slot keeps its last answer until
 * the next one arrives, so the Map never blanks while it refreshes.
 */
export function planFetches(
  wanted: Map<Slot, Fetch>,
  loaded: Partial<Record<Slot, string>>,
  inflight: Partial<Record<Slot, string>>,
): Plan {
  const plan: Plan = { start: [], cancel: [] };
  for (const [slot, f] of wanted) {
    const coming = inflight[slot];
    if (coming === f.key) continue;
    if (coming !== undefined) plan.cancel.push(slot);
    if (loaded[slot] !== f.key) plan.start.push(f);
  }
  return plan;
}
