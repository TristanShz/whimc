// What to fetch for the view: each level in view and the Comparison has a
// slot that holds one answer; a slot is fetched again when the view wants
// another answer for it (another tests switch, ref or viewport area), or when
// the index changed since its answer (a newer revision).

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

/** What a slot holds or has on its way: a fetch, at a revision of the index. */
export interface Held {
  key: string;
  revision: number;
}

export interface Plan {
  start: Fetch[];
  /** Slots whose fetch on its way is no longer wanted. */
  cancel: Slot[];
}

/**
 * Which fetches to start and cancel, given what each slot holds and what
 * each fetch on its way will bring, at `revision` of the index. A slot keeps
 * its last answer until the next one arrives, so the Map never blanks while
 * it refreshes. A fetch on its way is never cancelled for a newer revision:
 * the slot is fetched once more when it lands, so a burst of Updates costs
 * at most one fetch more per slot rather than starving it.
 */
export function planFetches(
  wanted: Map<Slot, Fetch>,
  loaded: Partial<Record<Slot, Held>>,
  inflight: Partial<Record<Slot, Held>>,
  revision = 0,
): Plan {
  const plan: Plan = { start: [], cancel: [] };
  for (const [slot, f] of wanted) {
    const coming = inflight[slot];
    if (coming?.key === f.key) continue;
    if (coming !== undefined) plan.cancel.push(slot);
    const have = loaded[slot];
    if (have?.key !== f.key || have.revision < revision) plan.start.push(f);
  }
  return plan;
}
