// Fetches what the view asks for: only the levels in view (and the viewport
// of a big level), keeping each answer on screen until the next one lands.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type Api } from "../api/client";
import type { MapData, Requests } from "../viewState";
import { planFetches, wantedFetches, type Slot } from "./loader";

export interface MapDataState {
  data: MapData;
  /** Slots with a fetch on its way. */
  loading: ReadonlySet<Slot>;
  /** The last failure of each slot, until it loads. */
  errors: Partial<Record<Slot, string>>;
  retry(): void;
}

export function useMapData(api: Api, requests: Requests): MapDataState {
  const [data, setData] = useState<MapData>({ levels: {}, comparison: null });
  const [errors, setErrors] = useState<Partial<Record<Slot, string>>>({});
  const [loading, setLoading] = useState<ReadonlySet<Slot>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef<Partial<Record<Slot, string>>>({});
  const inflight = useRef(
    new Map<Slot, { key: string; ctrl: AbortController }>(),
  );

  const wanted = useMemo(() => wantedFetches(requests), [requests]);
  const wantedKey = [...wanted.values()].map((f) => f.key).join(" ");

  const syncLoading = useCallback(
    () => setLoading(new Set(inflight.current.keys())),
    [],
  );

  useEffect(() => {
    const coming = Object.fromEntries(
      [...inflight.current].map(([s, f]) => [s, f.key]),
    );
    const plan = planFetches(wanted, loaded.current, coming);
    for (const slot of plan.cancel) {
      inflight.current.get(slot)?.ctrl.abort();
      inflight.current.delete(slot);
    }
    for (const f of plan.start) {
      const ctrl = new AbortController();
      inflight.current.set(f.slot, { key: f.key, ctrl });
      const done = () => {
        if (inflight.current.get(f.slot)?.ctrl === ctrl)
          inflight.current.delete(f.slot);
        syncLoading();
      };
      const fetched =
        f.slot === "compare"
          ? api
              .compare(f.compare, ctrl.signal)
              .then((c) => setData((d) => ({ ...d, comparison: c })))
          : api.map(f.map, ctrl.signal).then((v) =>
              setData((d) => ({
                ...d,
                levels: { ...d.levels, [f.slot]: v },
              })),
            );
      fetched.then(
        () => {
          loaded.current[f.slot] = f.key;
          setErrors(({ [f.slot]: _, ...rest }) => rest);
          done();
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          setErrors((es) => ({ ...es, [f.slot]: failure(e) }));
          done();
        },
      );
    }
    syncLoading();
    // wanted is keyed by wantedKey; attempt re-runs a failed fetch.
  }, [wantedKey, attempt, api, syncLoading]);

  useEffect(() => {
    const all = inflight.current;
    return () => {
      for (const f of all.values()) f.ctrl.abort();
      all.clear();
    };
  }, []);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { data, loading, errors, retry };
}

/** What went wrong, in the words the UI shows. */
export function failure(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "whimc serve did not answer";
}
