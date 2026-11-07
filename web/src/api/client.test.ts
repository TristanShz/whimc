import { describe, expect, it } from "vitest";
import { ApiError, compareUrl, createApi, mapUrl, moduleUrl } from "./client";
import type { MapView } from "./types";

describe("URLs", () => {
  it("asks the Map of a level, with only the parameters given", () => {
    expect(mapUrl({ level: "packages" })).toBe("/api/map?level=packages");
    expect(
      mapUrl({
        level: "files",
        within: "dir:src/app",
        tests: true,
        ref: "main",
        viewport: { x0: -1.5, y0: 0, x1: 2, y1: 3.25 },
      }),
    ).toBe(
      "/api/map?level=files&within=dir%3Asrc%2Fapp&tests=true&ref=main&x0=-1.5&y0=0&x1=2&y1=3.25",
    );
  });

  it("asks a Comparison and the details of a Module", () => {
    expect(compareUrl({})).toBe("/api/compare");
    expect(compareUrl({ base: "v1", target: "worktree", tests: false })).toBe(
      "/api/compare?base=v1&target=worktree&tests=false",
    );
    expect(moduleUrl({ id: "pkg:packages/web", ref: "HEAD" })).toBe(
      "/api/module?id=pkg%3Apackages%2Fweb&ref=HEAD",
    );
  });
});

describe("createApi", () => {
  const view: MapView = { level: "packages", modules: [], dependencies: [] };

  it("decodes the JSON answer", async () => {
    const asked: string[] = [];
    const api = createApi({
      fetch: async (url) => {
        asked.push(String(url));
        return new Response(JSON.stringify(view), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await expect(api.map({ level: "packages" })).resolves.toEqual(view);
    expect(asked).toEqual(["/api/map?level=packages"]);
  });

  it("turns an error answer into an ApiError carrying the server's message", async () => {
    const api = createApi({
      fetch: async () =>
        new Response(JSON.stringify({ error: 'unknown ref "nope"' }), {
          status: 400,
        }),
    });

    const err = await api.compare({ base: "nope" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: 'unknown ref "nope"' });
  });

  it("streams the Updates of /api/changes until unsubscribed", () => {
    const sources: FakeEventSource[] = [];
    class FakeEventSource {
      listeners: Record<string, (e: MessageEvent) => void> = {};
      closed = false;
      constructor(readonly url: string) {
        sources.push(this);
      }
      addEventListener(type: string, fn: (e: MessageEvent) => void) {
        this.listeners[type] = fn;
      }
      close() {
        this.closed = true;
      }
    }
    const api = createApi({
      EventSource: FakeEventSource as unknown as typeof EventSource,
    });
    const got: unknown[] = [];

    const unsubscribe = api.changes((u) => got.push(u));
    sources[0]?.listeners.update?.(
      new MessageEvent("update", { data: '{"kind":"files","paths":["a.ts"]}' }),
    );
    unsubscribe();

    expect(sources[0]?.url).toBe("/api/changes");
    expect(got).toEqual([{ kind: "files", paths: ["a.ts"] }]);
    expect(sources[0]?.closed).toBe(true);
  });
});
