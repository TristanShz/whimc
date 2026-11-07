// The Map page: the view state computed from what the server sent and what
// the user does, drawn by the WebGL canvas, with its floating controls.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createApi } from "./api/client";
import { LEVELS, type Level, type Module } from "./api/types";
import { useMapData } from "./data/useMapData";
import { useLive } from "./data/useLive";
import { MapCanvas, type MapHandle } from "./render/MapCanvas";
import { boundsOf, diveArea, insetsFrom, type Insets } from "./render/camera";
import { keyAction } from "./render/keys";
import { usePalette, usePrefersReducedMotion } from "./render/theme";
import { DetailsPanel } from "./ui/DetailsPanel";
import { IndexingProgress } from "./ui/IndexingProgress";
import { LevelIndicator } from "./ui/LevelIndicator";
import { Legend } from "./ui/Legend";
import { Toolbar } from "./ui/Toolbar";
import { ChangesBar, DEFAULT_REFS } from "./ui/ChangesBar";
import { ZoomControls } from "./ui/ZoomControls";
import {
  computeView,
  VIEW,
  cameraSignature,
  frameMatches,
  levelBlend,
  revealZoom,
  searchMatches,
  typicalRadii,
  type Camera,
  type ChangesRefs,
  type Requests,
  type UiState,
} from "./viewState";

const api = createApi();

/** After the camera stops this long, the view state takes its exact position. */
const CAMERA_SETTLE_MS = 250;
/** How often the level indicator follows a moving camera. */
const INDICATOR_MS = 60;

const LEVEL_NAMES: Record<Level, string> = {
  packages: "Packages",
  directories: "Directories",
  files: "Files",
};

export function App() {
  const palette = usePalette();
  const reducedMotion = usePrefersReducedMotion();
  const map = useRef<MapHandle>(null);
  const searchField = useRef<HTMLInputElement>(null);

  const [camera, setCamera] = useState<Camera>({
    zoom: 0,
    viewport: { x0: 0, y0: 0, x1: 0, y1: 0 },
  });
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tests, setTests] = useState(false);
  // The refs stay picked while the Changes switch is off.
  const [changesOn, setChangesOn] = useState(false);
  const [refs, setRefs] = useState<ChangesRefs>(DEFAULT_REFS);
  const [failure, setFailure] = useState<string | null>(null);

  const [requests, setRequests] = useState<Requests>({
    maps: [{ level: "packages", tests: false }],
    compare: null,
  });
  // Each Update of the index fetches what is in view again; the previous
  // answers stay on screen until the new ones land.
  const live = useLive(api);
  const { data, loading, errors, retry } = useMapData(
    api,
    requests,
    live.revision,
  );

  const ui: UiState = useMemo(
    () => ({
      camera,
      search,
      hovered,
      selected,
      tests,
      changes: changesOn ? refs : null,
    }),
    [camera, search, hovered, selected, tests, changesOn, refs],
  );
  const view = useMemo(() => computeView(data, ui), [data, ui]);
  useEffect(() => setRequests(view.requests), [view.requests]);

  const packages = data.levels.packages;
  const bounds = useMemo(() => boundsOf(packages?.modules ?? []), [packages]);
  const radii = useMemo(() => typicalRadii(data.levels), [data.levels]);
  const blend = useCallback((zoom: number) => levelBlend(radii, zoom), [radii]);

  // The camera moves every frame, and the renderer blends the levels on its
  // own; the view state is computed again only when the camera changes what
  // it decides (cameraSignature), and once the camera settles.
  const [indicator, setIndicator] = useState<{ level: Level; depth: number }>({
    level: "packages",
    depth: 0,
  });
  const latestCamera = useRef<Camera | null>(null);
  const signature = useRef("");
  const settle = useRef<number | undefined>(undefined);
  const indicatorAt = useRef(0);
  const onCamera = useCallback(
    (c: Camera) => {
      latestCamera.current = c;
      const sig = cameraSignature(radii, c.zoom, c.viewport);
      if (sig !== signature.current) {
        signature.current = sig;
        setCamera(c);
      }
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => {
        if (latestCamera.current) setCamera(latestCamera.current);
      }, CAMERA_SETTLE_MS);
      const now = performance.now();
      if (now - indicatorAt.current > INDICATOR_MS) {
        indicatorAt.current = now;
        const b = levelBlend(radii, c.zoom);
        setIndicator({ level: b.level, depth: b.depth });
      }
    },
    [radii],
  );
  useEffect(() => () => window.clearTimeout(settle.current), []);
  // Data arriving changes the blend at the same camera.
  useEffect(
    () => setIndicator({ level: view.level, depth: view.depth }),
    [view.level, view.depth],
  );

  const matches = useMemo(() => searchMatches(data, ui), [data, ui]);
  /** Brings the matches into view at their own level, clear of the panels. */
  const showMatches = useCallback(() => {
    const insets = panelInsets();
    const margin = 0.7;
    const clear = {
      width: (window.innerWidth - insets.left - insets.right) * margin,
      height: (window.innerHeight - insets.top - insets.bottom) * margin,
    };
    const frame = frameMatches(matches, radii, clear);
    if (frame)
      map.current?.flyTo(frame.area, {
        margin,
        insets,
        minZoom: frame.minZoom,
        maxZoom: frame.maxZoom,
      });
  }, [matches, radii]);

  /**
   * Brings a Module's inside into view, close enough for its children, and
   * the level they are at, to show.
   */
  const dive = useCallback(
    (m: Module) => {
      const insets = panelInsets();
      const screen = Math.min(
        window.innerWidth - insets.left - insets.right,
        window.innerHeight - insets.top - insets.bottom,
      );
      const below = m.level === "packages" ? "directories" : "files";
      const minZoom = m.level === "files" ? 0 : (revealZoom(radii, below) ?? 0);
      map.current?.flyTo(diveArea(m, screen, VIEW.revealEndPx), {
        margin: 0.7,
        insets,
        minZoom,
      });
    },
    [radii],
  );
  const diveInto = useCallback(
    (id: string) => {
      for (const l of LEVELS) {
        const m = data.levels[l]?.modules.find((m) => m.id === id);
        if (m) return dive(m);
      }
    },
    [data.levels, dive],
  );
  const pick = useCallback(
    (m: Module) => {
      setSelected(m.id);
      dive(m);
    },
    [dive],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const editable =
        !!t &&
        (t.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      const action = keyAction(e, editable);
      if (!action) return;
      if (action === "escape") {
        if (editable && t === searchField.current) {
          if (search) setSearch("");
          else searchField.current?.blur();
        } else if (selected) setSelected(null);
        else if (search) setSearch("");
        else return;
      } else if (action === "search") searchField.current?.focus();
      else if (action === "zoomIn") map.current?.zoomIn();
      else if (action === "zoomOut") map.current?.zoomOut();
      else map.current?.fit();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, selected]);

  // A level that failed while the Map is on screen: a toast. The Packages
  // failing before anything is on screen is the whole-Map error below.
  // With the Changes switch on, a failing Comparison is told in its bar: an
  // unknown target ref fails the levels too, for the same reason.
  const levelError = LEVELS.find(
    (l) =>
      errors[l] &&
      (l !== "packages" || packages !== undefined) &&
      !(changesOn && errors.compare),
  );
  const empty = packages !== undefined && packages.modules.length === 0;

  return (
    <main className="app">
      <h1 className="visually-hidden">whimc, the Map of this repository</h1>
      <MapCanvas
        ref={map}
        view={view}
        palette={palette}
        bounds={bounds}
        blend={blend}
        reducedMotion={reducedMotion}
        insets={panelInsets}
        onCamera={onCamera}
        onHover={setHovered}
        onSelect={setSelected}
        onDive={diveInto}
        onFailure={setFailure}
      />

      <div className="controls">
        <Toolbar
          search={search}
          matches={matches.length}
          tests={tests}
          onSearch={setSearch}
          onSearchSubmit={showMatches}
          onTests={setTests}
          changes={changesOn}
          onChanges={setChangesOn}
          searchRef={searchField}
        />
        {changesOn && (
          <ChangesBar
            api={api}
            refs={refs}
            onRefs={setRefs}
            changes={view.changes}
            loading={loading.has("compare")}
            error={errors.compare}
            revision={live.revision}
          />
        )}
      </div>
      <LevelIndicator level={indicator.level} depth={indicator.depth} />
      <Legend changes={changesOn} />
      <ZoomControls
        onZoomIn={() => map.current?.zoomIn()}
        onZoomOut={() => map.current?.zoomOut()}
        onFit={() => map.current?.fit()}
      />
      {selected && (
        <DetailsPanel
          api={api}
          id={selected}
          tests={tests}
          revision={live.revision}
          onClose={() => setSelected(null)}
          onPick={pick}
        />
      )}

      {failure ? (
        <Status title="This browser cannot draw the Map">
          whimc draws the Map with WebGL, which is turned off or unavailable
          here ({failure}). Try another browser, or turn hardware acceleration
          on.
        </Status>
      ) : !packages && errors.packages ? (
        <Status
          title="Could not load the Map"
          action={<button onClick={retry}>Try again</button>}
        >
          {errors.packages}. If you stopped it, run <code>whimc serve</code>{" "}
          again in the repository, then try again.
        </Status>
      ) : !packages ? (
        <Status title="Indexing the repository" busy>
          The first run reads every File; the next ones reuse the index and open
          at once.
        </Status>
      ) : empty ? (
        <Status
          title="No source Files here"
          action={
            !tests ? (
              <button onClick={() => setTests(true)}>Show test Files</button>
            ) : undefined
          }
        >
          whimc maps TypeScript, JavaScript and Go Files that git tracks or
          would track. {!tests && "Test Files are hidden."}
        </Status>
      ) : null}

      {packages && !empty && <IndexingProgress indexing={live.indexing} />}
      {levelError && (
        <div className="panel toast" role="alert">
          Could not load the {LEVEL_NAMES[levelError]}: {errors[levelError]}
          <button onClick={retry}>Try again</button>
        </div>
      )}
      {loading.size > 0 && packages && (
        <span className="loading-dot" role="status" aria-label="Loading">
          <i />
        </span>
      )}
    </main>
  );
}

/** The panels floating over the Map, which framing keeps clear. */
const PANELS = ".controls > .panel, .levels, .legend, .zoom, .details";

/** The screen edges the panels over the Map take, as they are laid out now. */
function panelInsets(): Insets {
  const panels = [...document.querySelectorAll(PANELS)].map((el) => {
    const r = el.getBoundingClientRect();
    return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
  });
  return insetsFrom(
    { width: window.innerWidth, height: window.innerHeight },
    panels,
  );
}

function Status(p: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  busy?: boolean;
}) {
  return (
    <section
      className="status"
      role={p.busy ? "status" : "alert"}
      aria-busy={p.busy}
    >
      {p.busy && <span className="status-pulse" aria-hidden="true" />}
      <h2>{p.title}</h2>
      <p>{p.children}</p>
      {p.action}
    </section>
  );
}
