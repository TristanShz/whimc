// A typed client of whimc's HTTP API (internal/server). Every call takes the
// parameters the endpoint takes; leaving one out takes the server's default
// (packages level, working tree, base HEAD, test Files hidden).

import type {
  Comparison,
  Level,
  MapView,
  ModuleDetails,
  Rect,
  Update,
} from "./types";

/** A /api/map call: the Modules of one level. */
export interface MapRequest {
  level: Level;
  /** A Module ID: only its descendants. */
  within?: string;
  tests?: boolean;
  /** A commit, branch or tag, or "worktree"; the working tree when absent. */
  ref?: string;
  /** Only the Modules whose disc meets this area, for very large levels. */
  viewport?: Rect;
}

/** A /api/compare call. */
export interface CompareRequest {
  base?: string;
  target?: string;
  tests?: boolean;
}

/** A /api/module call: the click details of a Module. */
export interface ModuleRequest {
  id: string;
  ref?: string;
  tests?: boolean;
}

/** An error answer of the API. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Params = Record<string, string | number | boolean | undefined>;

function url(path: string, params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export function mapUrl(r: MapRequest): string {
  const v = r.viewport;
  return url("/api/map", {
    level: r.level,
    within: r.within,
    tests: r.tests,
    ref: r.ref,
    x0: v?.x0,
    y0: v?.y0,
    x1: v?.x1,
    y1: v?.y1,
  });
}

export function compareUrl(r: CompareRequest): string {
  return url("/api/compare", {
    base: r.base,
    target: r.target,
    tests: r.tests,
  });
}

export function moduleUrl(r: ModuleRequest): string {
  return url("/api/module", { id: r.id, ref: r.ref, tests: r.tests });
}

export interface Api {
  map(r: MapRequest, signal?: AbortSignal): Promise<MapView>;
  compare(r: CompareRequest, signal?: AbortSignal): Promise<Comparison>;
  module(r: ModuleRequest, signal?: AbortSignal): Promise<ModuleDetails>;
  /** Calls onUpdate for each Update until the returned function is called. */
  changes(onUpdate: (u: Update) => void): () => void;
}

export interface ApiOptions {
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
}

export function createApi(opts: ApiOptions = {}): Api {
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  async function get<T>(u: string, signal?: AbortSignal): Promise<T> {
    const res = await doFetch(u, signal ? { signal } : {});
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String(body.error)
          : `${res.status} ${res.statusText}`;
      throw new ApiError(res.status, message);
    }
    return body as T;
  }
  return {
    map: (r, signal) => get(mapUrl(r), signal),
    compare: (r, signal) => get(compareUrl(r), signal),
    module: (r, signal) => get(moduleUrl(r), signal),
    changes(onUpdate) {
      const Source = opts.EventSource ?? EventSource;
      const source = new Source("/api/changes");
      source.addEventListener("update", (e) => {
        onUpdate(JSON.parse((e as MessageEvent<string>).data) as Update);
      });
      return () => source.close();
    },
  };
}
