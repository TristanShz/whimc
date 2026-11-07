// Listens to /api/changes: the first run's progress, and a revision of the
// index that moves on with each Update so that what is on screen is fetched
// again. Updates arriving close together move it on once.

import { useEffect, useState } from "react";
import type { Api } from "../api/client";
import { STARTING, nextIndexing, type Indexing } from "./live";

/** How long a burst of Updates is gathered into one revision. */
export const COALESCE_MS = 150;

export interface Live {
  indexing: Indexing;
  /** Moves on when the index changed: fetch again what is in view. */
  revision: number;
}

export function useLive(api: Api): Live {
  const [indexing, setIndexing] = useState<Indexing>(STARTING);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let timer: number | undefined;
    const stop = api.changes((u) => {
      setIndexing((i) => nextIndexing(i, u));
      if (timer === undefined)
        timer = window.setTimeout(() => {
          timer = undefined;
          setRevision((r) => r + 1);
        }, COALESCE_MS);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [api]);
  return { indexing, revision };
}
