import type { CompareRequest, MapRequest } from "../api/client";
import type {
  Change,
  Comparison,
  DependencyKind,
  Level,
  MapView,
  Rect,
  Summary,
} from "../api/types";

/** What the camera shows. */
export interface Camera {
  /** Screen pixels per map unit. */
  zoom: number;
  /** The visible area of the Map, in map coordinates. */
  viewport: Rect;
}

/** The refs of the Comparison the Changes switch shows. */
export interface ChangesRefs {
  /** A commit, branch or tag, or "worktree". */
  base: string;
  target: string;
}

/** What the user does to the Map. */
export interface UiState {
  camera: Camera;
  search: string;
  /** The Module ID under the pointer. */
  hovered: string | null;
  /** The Module ID clicked last. */
  selected: string | null;
  /** The tests switch: show test Files. */
  tests: boolean;
  /** The Changes switch: null when off, the refs to compare when on. */
  changes: ChangesRefs | null;
}

/** What the server sent so far. */
export interface MapData {
  /** The Map at each level fetched; a big level may only hold a viewport. */
  levels: Partial<Record<Level, MapView>>;
  /** The Comparison for the Changes switch, once fetched. */
  comparison: Comparison | null;
}

/** A Module to draw, with every decision about how to draw it taken. */
export interface NodeView {
  id: string;
  level: Level;
  name: string;
  path: string;
  parent: string | null;
  /** Position and disc radius, in map coordinates. */
  x: number;
  y: number;
  radius: number;
  size: number;
  churn: number;
  /** Churn normalised within the level, 0 (calm) to 1 (moves the most). */
  heat: number;
  test: boolean;
  /** How much of the node's level is in view: its share of the level blend. */
  levelWeight: number;
  /** Every fade that applies to it: the focus, the search, Changes, ghost. */
  fade: number;
  /**
   * The fade it takes once its children are revealed: that of a Module
   * nothing singles out, so that a highlighted parent fades out as well.
   */
  contextFade: number;
  /**
   * Final opacity: level weight × its fade, blended towards its context
   * fade as the level below it is revealed.
   */
  opacity: number;
  /** The hovered Module, else the selected one. */
  focused: boolean;
  selected: boolean;
  /** Its name or path matches the search. */
  match: boolean;
  /** Stands out: the focus or a neighbour (or inside one), or a change. */
  highlighted: boolean;
  /** Faded by the focus, the search or the Changes switch. */
  dimmed: boolean;
  /** How it changed when the Changes switch is on and loaded, else null. */
  change: Change | null;
  /** Changed Files inside it (1 for a changed File), for the badge. */
  changedFiles: number;
  /** A removed Module, drawn at its last position. */
  ghost: boolean;
}

/** A Dependency to draw. */
export interface EdgeView {
  /** `<from>-><to>`. */
  id: string;
  from: string;
  to: string;
  level: Level;
  kind: DependencyKind;
  weight: number;
  /** Weight normalised within the level, 0 to 1. */
  strength: number;
  opacity: number;
  highlighted: boolean;
  dimmed: boolean;
  change: Change | null;
  /** A removed Dependency, between Modules still drawn. */
  ghost: boolean;
}

/** What the view needs from the server. */
export interface Requests {
  /** The levels in view: the one in view, and the one fading in or out. */
  maps: MapRequest[];
  /** The Comparison, when the Changes switch is on. */
  compare: CompareRequest | null;
}

/** Everything the renderer draws, and nothing it has to decide. */
export interface ViewState {
  /** The level in view, for the level indicator. */
  level: Level;
  /**
   * Where the zoom is in the hierarchy, continuously: 0 at Packages, 1 at
   * Directories, 2 at Files; `level` is the nearest level.
   */
  depth: number;
  /** How much of each level is drawn, 0 (not at all) to 1. */
  levelWeights: Record<Level, number>;
  /** The nodes to draw, back to front: by level, then removed ones, then ID. */
  nodes: NodeView[];
  /** The edges to draw, by level then ID. */
  edges: EdgeView[];
  /**
   * The Churn of the busiest Module drawn at each level (0 for a level not
   * drawn): heat is normalised against it, the Legend tells its steps.
   */
  churnMax: Record<Level, number>;
  /** The Module the highlight is centred on, if it is on the Map. */
  focus: string | null;
  /** The Comparison drawn, for the one-line summary; null when not drawn. */
  changes: {
    base: string;
    target: string;
    summary: Summary;
    /**
     * Whether it compares the refs the Changes switch asks for; the last one
     * stays drawn while the one asked for is on its way.
     */
    current: boolean;
  } | null;
  requests: Requests;
}
