import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createApi } from "./api/client";
import type { MapView, Rect } from "./api/types";
import { computeView, type UiState } from "./viewState";

const api = createApi();

// A placeholder page until the Sigma renderer: it fetches the Packages and
// draws them as plain discs from the view state, fitted to the window.
export function App() {
  const [packages, setPackages] = useState<MapView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .map({ level: "packages" }, ctrl.signal)
      .then(setPackages)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(String(e));
      });
    return () => ctrl.abort();
  }, []);

  const bounds = useMemo(() => fit(packages), [packages]);
  const view = useMemo(() => {
    if (!packages) return null;
    const ui: UiState = {
      camera: { zoom: 600 / (bounds.x1 - bounds.x0), viewport: bounds },
      search: "",
      hovered: null,
      selected: null,
      tests: false,
      changes: null,
    };
    return computeView({ levels: { packages }, comparison: null }, ui);
  }, [packages, bounds]);

  if (error) return <p className="message">Could not load the Map: {error}</p>;
  if (!view) return <p className="message">Indexing…</p>;
  return (
    <main>
      <header>
        whimc · {view.nodes.length} Packages · level: {view.level}
      </header>
      <svg
        viewBox={`${bounds.x0} ${bounds.y0} ${bounds.x1 - bounds.x0} ${bounds.y1 - bounds.y0}`}
        role="img"
        aria-label="The Packages of the repository"
      >
        {view.nodes.map((n) => (
          <g key={n.id} opacity={n.opacity}>
            <circle
              cx={n.x}
              cy={n.y}
              r={n.radius}
              className="node"
              style={{ "--heat": n.heat } as CSSProperties}
            />
            <text x={n.x} y={n.y} fontSize={n.radius / 3} textAnchor="middle">
              {n.name}
            </text>
          </g>
        ))}
      </svg>
    </main>
  );
}

/** The square around every Package, with a margin. */
function fit(view: MapView | null): Rect {
  const ms = view?.modules ?? [];
  if (ms.length === 0) return { x0: -1, y0: -1, x1: 1, y1: 1 };
  const x0 = Math.min(...ms.map((m) => m.x - m.radius));
  const y0 = Math.min(...ms.map((m) => m.y - m.radius));
  const x1 = Math.max(...ms.map((m) => m.x + m.radius));
  const y1 = Math.max(...ms.map((m) => m.y + m.radius));
  const side = Math.max(x1 - x0, y1 - y0) * 1.1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    x0: cx - side / 2,
    y0: cy - side / 2,
    x1: cx + side / 2,
    y1: cy + side / 2,
  };
}
