import type { Level, MapView, Module, Rect } from "../api/types";

/** The tuning of the view: thresholds, fades and sizes. */
export const VIEW = {
  /**
   * A level starts to fade in when its typical disc reaches this radius on
   * screen, in pixels, and has fully faded in at revealEndPx.
   */
  revealStartPx: 6,
  revealEndPx: 16,
  /** The weight a level keeps as context behind the levels below it. */
  contextWeight: 0.15,
  /** Opacity factor of what the hovered or selected Module is not related to. */
  focusDim: 0.15,
  /** Opacity factor of what does not match the search. */
  searchFade: 0.08,
  /** Opacity factor of unchanged Modules and Dependencies under Changes. */
  changesFade: 0.2,
  /** Opacity of a removed Module or Dependency. */
  ghostOpacity: 0.45,
  /** Beyond this many Modules, a level is fetched for the viewport only. */
  bigLevel: 5000,
} as const;

/** The radius ratio of a level to the one above (engine.Radius). */
const LEVEL_SHRINK = 0.8;
/** Files per Directory assumed until the Directories are fetched. */
const FILES_PER_DIRECTORY_GUESS = 8;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * The typical child radius of a level: children share their parent's
 * Size, and radius grows as √Size, so a child of a parent of radius R with n
 * children has radius about 0.8 × R / √n.
 */
function typicalChildRadius(parents: Module[]): number | null {
  return median(
    parents.map(
      (m) => (LEVEL_SHRINK * m.radius) / Math.sqrt(Math.max(m.children, 1)),
    ),
  );
}

/**
 * The radius of a typical Module of each level, estimated from the level
 * above so that it does not move as a level arrives viewport by viewport.
 * Null when nothing is known yet.
 */
export function typicalRadii(
  levels: Partial<Record<Level, MapView>>,
): Record<Level, number | null> {
  const pkgs = levels.packages?.modules ?? [];
  const dirs = levels.directories?.modules ?? [];
  const packages = median(pkgs.map((m) => m.radius));
  const directories = typicalChildRadius(pkgs);
  const files =
    typicalChildRadius(dirs) ??
    (directories === null
      ? null
      : (LEVEL_SHRINK * directories) / Math.sqrt(FILES_PER_DIRECTORY_GUESS));
  return { packages, directories, files };
}

/** 0 below the reveal size on screen, 1 above, smooth in between. */
function reveal(radius: number | null, zoom: number): number {
  if (radius === null) return 0;
  const px = radius * zoom;
  const t = Math.min(
    1,
    Math.max(
      0,
      (px - VIEW.revealStartPx) / (VIEW.revealEndPx - VIEW.revealStartPx),
    ),
  );
  return t * t * (3 - 2 * t);
}

export interface LevelBlend {
  level: Level;
  depth: number;
  weights: Record<Level, number>;
}

/**
 * How much of each level the zoom shows. Each level fades in as its typical
 * disc grows on screen, and the levels above it fade back to context
 * weight; the level in view is the deepest one at least half in.
 */
export function levelBlend(
  radii: Record<Level, number | null>,
  zoom: number,
): LevelBlend {
  const dirs = reveal(radii.directories, zoom);
  const files = Math.min(dirs, reveal(radii.files, zoom));
  // Exactly 1 at t = 0 and exactly contextWeight at t = 1.
  const context = (t: number) => 1 - t + t * VIEW.contextWeight;
  const weights = {
    packages: context(dirs),
    directories: dirs * context(files),
    files,
  };
  const depth = dirs + files;
  const level =
    files >= 0.5 ? "files" : dirs >= 0.5 ? "directories" : "packages";
  return { level, depth, weights };
}

/**
 * The area to fetch for a viewport: the viewport padded by half its size on
 * each side, snapped outwards to a grid whose step is a power of two near
 * its size, so that a small pan or zoom asks the same area again.
 */
export function fetchArea(v: Rect): Rect {
  const w = v.x1 - v.x0;
  const h = v.y1 - v.y0;
  const step = 2 ** Math.ceil(Math.log2(Math.max(w, h, Number.MIN_VALUE)));
  return {
    x0: Math.floor((v.x0 - w / 2) / step) * step,
    y0: Math.floor((v.y0 - h / 2) / step) * step,
    x1: Math.ceil((v.x1 + w / 2) / step) * step,
    y1: Math.ceil((v.y1 + h / 2) / step) * step,
  };
}
