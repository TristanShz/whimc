// The JSON shapes of whimc's HTTP API, as encoded by the Go engine
// (engine.MapView, engine.Comparison) and the server (server.ModuleDetails).

/** A level of the Module hierarchy. */
export type Level = "packages" | "directories" | "files";

/** The levels from the top of the hierarchy down. */
export const LEVELS: readonly Level[] = ["packages", "directories", "files"];

/** How a Dependency is imported. */
export type DependencyKind = "runtime" | "type-only" | "dynamic";

/** How a Module or a Dependency differs from the base State to the target. */
export type Change = "unchanged" | "added" | "modified" | "removed";

/** An area of the Map, in map coordinates. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A node of the Map: a Package, a Directory or a File. */
export interface Module {
  /** Unique across levels: `pkg:<path>`, `dir:<path>` or `file:<path>`. */
  id: string;
  level: Level;
  name: string;
  /** Repository-relative slash path; "." is the repository root. */
  path: string;
  /** The enclosing Module's ID; absent on a Package. */
  parent?: string;
  /** Non-blank lines, summed over the Module's Files. */
  size: number;
  /** Commits touching the Module within the Churn window. */
  churn: number;
  /** Number of Modules one level down. */
  children: number;
  /** Set on test Files. */
  test?: boolean;
  /** Frozen position and disc radius, in map coordinates shared by every level. */
  x: number;
  y: number;
  radius: number;
}

export interface KindCounts {
  runtime: number;
  typeOnly: number;
  dynamic: number;
}

/** An edge of the Map, aggregated to the level in view. */
export interface Dependency {
  from: string;
  to: string;
  kind: DependencyKind;
  /** Number of File Dependencies aggregated: 1 between Files. */
  weight: number;
  counts: KindCounts;
}

/** The Modules of one level and the Dependencies between them. */
export interface MapView {
  level: Level;
  modules: Module[];
  dependencies: Dependency[];
}

export interface Summary {
  filesChanged: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  packagesTouched: number;
  dependenciesAdded: number;
  dependenciesRemoved: number;
}

/** A Module that differs between the two States of a Comparison. */
export interface ModuleChange {
  id: string;
  level: Level;
  name: string;
  path: string;
  parent?: string;
  change: Change;
  test?: boolean;
  /** Changed Files in the Module: added + modified + removed. */
  changed: number;
  added: number;
  modified: number;
  removed: number;
  size: number;
  /** A removed Module keeps its last position, where its ghost is drawn. */
  x: number;
  y: number;
  radius: number;
}

/** A Dependency that differs between the two States of a Comparison. */
export interface DependencyChange {
  from: string;
  to: string;
  change: Change;
  kind: DependencyKind;
  weight: number;
  added: number;
  removed: number;
}

export interface LevelComparison {
  level: Level;
  /** The changed Modules; every Module not listed is unchanged. */
  modules: ModuleChange[];
  dependencies: DependencyChange[];
}

/** What differs between a base and a target State, at each level. */
export interface Comparison {
  /** Refs, "worktree" for the working tree. */
  base: string;
  target: string;
  summary: Summary;
  packages: LevelComparison;
  directories: LevelComparison;
  files: LevelComparison;
}

/** What the Map shows when a Module is clicked. */
export interface ModuleDetails {
  module: Module;
  /** Up to five children with a Churn, the highest first. */
  movingChildren: Module[];
}

/** What an Update reports (engine.UpdateKind). */
export type UpdateKind =
  /** The first run knows the structure; `total` Packages to index. */
  | "structure"
  /** The first run indexed one more Package: `done` of `total`. */
  | "package"
  /** The first run is over. */
  | "indexed"
  /** Files of the working tree were written, created or removed. */
  | "files"
  /** HEAD points at another commit. */
  | "head";

/** A change of the index pushed on /api/changes. */
export interface Update {
  kind: UpdateKind;
  /** The Package a "package" Update is about. */
  package?: string;
  done?: number;
  total?: number;
  /** The paths a "files" Update is about. */
  paths?: string[];
}
