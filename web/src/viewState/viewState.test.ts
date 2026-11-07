import { describe, expect, it } from "vitest";
import type {
  Comparison,
  Dependency,
  Level,
  LevelComparison,
  MapView,
  Module,
  ModuleChange,
} from "../api/types";
import {
  VIEW,
  cameraSignature,
  typicalRadii,
  computeView,
  requestKey,
  searchMatches,
  type MapData,
  type NodeView,
  type UiState,
  type ViewState,
} from "./index";

// The fixture: two Packages, web and core, of radius 100 and 4 Directories
// each, so a typical Directory has radius 0.8 × 100 / √4 = 40; each Directory
// holds 16 Files, so a typical File has radius 0.8 × 40 / √16 = 8 (the
// radii the engine gives: area ∝ Size, 0.8 per level).
const DIR_RADIUS = 40;
const FILE_RADIUS = 8;

function mod(level: Level, id: string, extra: Partial<Module> = {}): Module {
  const path = id.slice(id.indexOf(":") + 1);
  const radius =
    level === "packages"
      ? 100
      : level === "directories"
        ? DIR_RADIUS
        : FILE_RADIUS;
  const children = level === "packages" ? 4 : level === "directories" ? 16 : 0;
  return {
    id,
    level,
    name: path.split("/").pop() ?? path,
    path,
    size: 100,
    churn: 0,
    children,
    x: 0,
    y: 0,
    radius,
    ...extra,
  };
}

function dep(
  from: string,
  to: string,
  extra: Partial<Dependency> = {},
): Dependency {
  return {
    from,
    to,
    kind: "runtime",
    weight: 1,
    counts: { runtime: 1, typeOnly: 0, dynamic: 0 },
    ...extra,
  };
}

const packages: MapView = {
  level: "packages",
  modules: [
    mod("packages", "pkg:core", { churn: 2 }),
    mod("packages", "pkg:web", { name: "storefront", churn: 8, x: 300 }),
    mod("packages", "pkg:docs", { x: -300 }),
  ],
  dependencies: [dep("pkg:web", "pkg:core", { weight: 3 })],
};

const directories: MapView = {
  level: "directories",
  modules: [
    mod("directories", "dir:core/money", { parent: "pkg:core", churn: 1 }),
    mod("directories", "dir:core/tax", { parent: "pkg:core" }),
    mod("directories", "dir:web/app", { parent: "pkg:web", x: 300, churn: 4 }),
    mod("directories", "dir:docs/guide", { parent: "pkg:docs", x: -300 }),
  ],
  dependencies: [dep("dir:web/app", "dir:core/money", { weight: 3 })],
};

const files: MapView = {
  level: "files",
  modules: [
    mod("files", "file:core/money/cents.ts", {
      parent: "dir:core/money",
      churn: 1,
    }),
    mod("files", "file:core/money/cents.test.ts", {
      parent: "dir:core/money",
      test: true,
    }),
    mod("files", "file:core/tax/vat.ts", { parent: "dir:core/tax" }),
    mod("files", "file:web/app/main.ts", {
      parent: "dir:web/app",
      x: 300,
      churn: 4,
    }),
    mod("files", "file:web/app/view.ts", {
      parent: "dir:web/app",
      x: 310,
      churn: 1,
    }),
    mod("files", "file:docs/guide/intro.ts", {
      parent: "dir:docs/guide",
      x: -300,
    }),
  ],
  dependencies: [
    dep("file:web/app/main.ts", "file:core/money/cents.ts"),
    dep("file:web/app/view.ts", "file:core/money/cents.ts", {
      kind: "type-only",
    }),
    dep("file:web/app/main.ts", "file:web/app/view.ts"),
    dep("file:core/money/cents.test.ts", "file:core/money/cents.ts"),
  ],
};

const loaded: MapData = {
  levels: { packages, directories, files },
  comparison: null,
};

/** The zoom at which a disc of radius r spans px pixels of radius on screen. */
const zoomFor = (px: number, r: number) => px / r;

const FAR = zoomFor(VIEW.revealStartPx / 2, DIR_RADIUS); // Packages only
const DIRECTORIES = zoomFor(VIEW.revealEndPx * 1.5, DIR_RADIUS); // Directories, no Files yet
const CLOSE = zoomFor(VIEW.revealEndPx * 2, FILE_RADIUS); // Files

function ui(extra: Partial<UiState> = {}): UiState {
  return {
    camera: {
      zoom: FAR,
      viewport: { x0: -1000, y0: -1000, x1: 1000, y1: 1000 },
    },
    search: "",
    hovered: null,
    selected: null,
    tests: false,
    changes: null,
    ...extra,
  };
}

const at = (zoom: number, extra: Partial<UiState> = {}) =>
  ui({ ...extra, camera: { ...ui().camera, zoom } });

function node(view: ViewState, id: string): NodeView {
  const n = view.nodes.find((n) => n.id === id);
  if (!n) throw new Error(`no node ${id} in ${view.nodes.map((n) => n.id)}`);
  return n;
}

const ids = (view: ViewState, level?: Level) =>
  view.nodes.filter((n) => !level || n.level === level).map((n) => n.id);

describe("zoom thresholds and level blending", () => {
  it("shows only the Packages from afar, fully opaque", () => {
    const view = computeView(loaded, at(FAR));

    expect(view.level).toBe("packages");
    expect(view.depth).toBe(0);
    expect(ids(view)).toEqual(["pkg:core", "pkg:docs", "pkg:web"]);
    expect(view.nodes.every((n) => n.opacity === 1 && !n.dimmed)).toBe(true);
    expect(view.edges.map((e) => e.id)).toEqual(["pkg:web->pkg:core"]);
  });

  it("reveals the Directories once a typical Directory reaches the reveal size on screen", () => {
    const before = computeView(
      loaded,
      at(zoomFor(VIEW.revealStartPx * 0.99, DIR_RADIUS)),
    );
    const after = computeView(
      loaded,
      at(zoomFor(VIEW.revealStartPx * 1.2, DIR_RADIUS)),
    );

    expect(ids(before, "directories")).toEqual([]);
    expect(ids(after, "directories")).toHaveLength(4);
    expect(after.levelWeights.directories).toBeGreaterThan(0);
    expect(after.levelWeights.directories).toBeLessThan(0.5);
    expect(after.level).toBe("packages");
  });

  it("blends the two levels while zooming, the deeper one taking over halfway", () => {
    const zooms = Array.from({ length: 30 }, (_, i) =>
      zoomFor(
        VIEW.revealStartPx + ((VIEW.revealEndPx - VIEW.revealStartPx) * i) / 29,
        DIR_RADIUS,
      ),
    );
    const views = zooms.map((z) => computeView(loaded, at(z)));
    const pkgWeights = views.map((v) => v.levelWeights.packages);
    const dirWeights = views.map((v) => v.levelWeights.directories);

    for (let i = 1; i < views.length; i++) {
      expect(dirWeights[i]).toBeGreaterThanOrEqual(dirWeights[i - 1]!);
      expect(pkgWeights[i]).toBeLessThanOrEqual(pkgWeights[i - 1]!);
    }
    expect(dirWeights.at(-1)).toBe(1);
    expect(pkgWeights.at(-1)).toBeCloseTo(VIEW.contextWeight);
    const switched = views.findIndex((v) => v.level === "directories");
    expect(views[switched]!.levelWeights.directories).toBeGreaterThanOrEqual(
      0.5,
    );
    expect(views[switched - 1]!.levelWeights.directories).toBeLessThan(0.5);
    const mid = views[15]!;
    expect(mid.depth).toBeGreaterThan(0);
    expect(mid.depth).toBeLessThan(1);
    expect(node(mid, "dir:web/app").levelWeight).toBe(
      mid.levelWeights.directories,
    );
    expect(node(mid, "pkg:web").opacity).toBe(mid.levelWeights.packages);
  });

  it("keeps the upper levels as faint context once the Files are in view", () => {
    const view = computeView(loaded, at(CLOSE));

    expect(view.level).toBe("files");
    expect(view.depth).toBe(2);
    expect(view.levelWeights).toEqual({
      packages: VIEW.contextWeight,
      directories: VIEW.contextWeight,
      files: 1,
    });
    expect(node(view, "file:web/app/main.ts").opacity).toBe(1);
    expect(node(view, "pkg:web").opacity).toBeCloseTo(VIEW.contextWeight);
  });

  it("draws parents behind their children", () => {
    const view = computeView(loaded, at(CLOSE));
    const levels = view.nodes.map((n) => n.level);

    expect(levels.indexOf("files")).toBeGreaterThan(
      levels.lastIndexOf("directories"),
    );
    expect(levels.indexOf("directories")).toBeGreaterThan(
      levels.lastIndexOf("packages"),
    );
  });
});

describe("what the view asks the server", () => {
  it("asks only the levels in view", () => {
    expect(
      computeView({ levels: {}, comparison: null }, at(FAR)).requests,
    ).toEqual({
      maps: [{ level: "packages", tests: false }],
      compare: null,
    });
    expect(
      computeView(loaded, at(DIRECTORIES)).requests.maps.map((r) => r.level),
    ).toEqual(["packages", "directories"]);
  });

  it("asks a big level for the viewport only, in steps a small pan does not change", () => {
    const big: MapData = {
      levels: {
        packages: {
          ...packages,
          modules: [
            // Its typical Directory has radius DIR_RADIUS still.
            mod("packages", "pkg:mono", {
              children: VIEW.bigLevel + 1,
              radius: (DIR_RADIUS / 0.8) * Math.sqrt(VIEW.bigLevel + 1),
            }),
          ],
        },
      },
      comparison: null,
    };
    const camera = (x: number) => ({
      zoom: DIRECTORIES,
      viewport: { x0: x, y0: 0, x1: x + 100, y1: 80 },
    });

    const [, dirs] = computeView(big, ui({ camera: camera(0) })).requests.maps;
    const [, panned] = computeView(big, ui({ camera: camera(3) })).requests
      .maps;
    const [, far] = computeView(big, ui({ camera: camera(5000) })).requests
      .maps;

    expect(dirs?.viewport).toBeDefined();
    const v = dirs!.viewport!;
    expect(v.x0).toBeLessThanOrEqual(0);
    expect(v.x1).toBeGreaterThanOrEqual(100);
    expect(requestKey(panned!)).toBe(requestKey(dirs!));
    expect(requestKey(far!)).not.toBe(requestKey(dirs!));
  });

  it("asks the Map of the target and the Comparison when the Changes switch is on", () => {
    const view = computeView(
      loaded,
      at(FAR, { tests: true, changes: { base: "main", target: "worktree" } }),
    );

    expect(view.requests).toEqual({
      maps: [{ level: "packages", tests: true, ref: "worktree" }],
      compare: { base: "main", target: "worktree", tests: true },
    });
  });
});

describe("search", () => {
  it("fades everything but the Modules whose name or path matches, case-insensitively", () => {
    const view = computeView(loaded, at(CLOSE, { search: "CENTS" }));

    const cents = node(view, "file:core/money/cents.ts");
    expect(cents.match).toBe(true);
    expect(cents.dimmed).toBe(false);
    expect(cents.opacity).toBe(1);
    const vat = node(view, "file:core/tax/vat.ts");
    expect(vat.match).toBe(false);
    expect(vat.dimmed).toBe(true);
    expect(vat.opacity).toBeCloseTo(VIEW.searchFade);
  });

  it("keeps the ancestors and the descendants of a match", () => {
    const view = computeView(loaded, at(CLOSE, { search: "cents" }));
    const kept = view.nodes.filter((n) => !n.dimmed).map((n) => n.id);

    expect(kept).toEqual([
      "pkg:core",
      "dir:core/money",
      "file:core/money/cents.ts",
    ]);

    // web's manifest names it storefront: only the Package matches.
    const byPackage = computeView(loaded, at(CLOSE, { search: "storefront" }));
    expect(byPackage.nodes.filter((n) => !n.dimmed).map((n) => n.id)).toEqual([
      "pkg:web",
      "dir:web/app",
      "file:web/app/main.ts",
      "file:web/app/view.ts",
    ]);
  });

  it("fades the Dependencies unless both ends are kept", () => {
    const view = computeView(loaded, at(CLOSE, { search: "app" }));
    const edge = (id: string) => view.edges.find((e) => e.id === id)!;

    expect(edge("file:web/app/main.ts->file:web/app/view.ts").dimmed).toBe(
      false,
    );
    expect(edge("file:web/app/main.ts->file:core/money/cents.ts").dimmed).toBe(
      true,
    );
  });

  it("finds matches in the levels not in view, each Module once, to count them and fly to them", () => {
    const found = searchMatches(loaded, at(FAR, { search: "money" }));
    expect(found.map((m) => m.id)).toEqual([
      "dir:core/money",
      "file:core/money/cents.ts",
    ]);
    expect(found[0]).toMatchObject({
      level: "directories",
      radius: DIR_RADIUS,
    });
    expect(
      searchMatches(loaded, at(FAR, { search: "money", tests: true })).map(
        (m) => m.id,
      ),
    ).toContain("file:core/money/cents.test.ts");
    expect(searchMatches(loaded, at(FAR, { search: " " }))).toEqual([]);
  });

  it("fades nothing when the search is blank", () => {
    const view = computeView(loaded, at(CLOSE, { search: "  " }));

    expect(view.nodes.some((n) => n.dimmed || n.match)).toBe(false);
  });
});

describe("neighbour highlighting", () => {
  it("highlights the hovered Module and its neighbours and dims the rest", () => {
    const view = computeView(
      loaded,
      at(DIRECTORIES, { hovered: "dir:core/money" }),
    );

    expect(node(view, "dir:core/money")).toMatchObject({
      focused: true,
      highlighted: true,
      dimmed: false,
    });
    expect(node(view, "dir:web/app")).toMatchObject({
      focused: false,
      highlighted: true,
      dimmed: false,
    });
    const tax = node(view, "dir:core/tax");
    expect(tax).toMatchObject({ highlighted: false, dimmed: true });
    expect(tax.opacity).toBeCloseTo(
      view.levelWeights.directories * VIEW.focusDim,
    );
    expect(
      view.edges.find((e) => e.id === "dir:web/app->dir:core/money"),
    ).toMatchObject({
      highlighted: true,
      dimmed: false,
    });
  });

  it("highlights the Modules inside the focus and its neighbours at deeper levels", () => {
    const view = computeView(loaded, at(CLOSE, { hovered: "pkg:core" }));
    const highlighted = view.nodes
      .filter((n) => n.highlighted)
      .map((n) => n.id);

    expect(highlighted).toEqual([
      "pkg:core",
      "pkg:web",
      "dir:core/money",
      "dir:core/tax",
      "dir:web/app",
      "file:core/money/cents.ts",
      "file:core/tax/vat.ts",
      "file:web/app/main.ts",
      "file:web/app/view.ts",
    ]);
    expect(node(view, "file:docs/guide/intro.ts").dimmed).toBe(true);
    // A File Dependency into the focused Package is highlighted; none other is.
    expect(
      view.edges
        .filter((e) => e.highlighted && e.level === "files")
        .map((e) => e.id),
    ).toEqual([
      "file:web/app/main.ts->file:core/money/cents.ts",
      "file:web/app/view.ts->file:core/money/cents.ts",
    ]);
  });

  it("falls back on the selected Module, and the hovered one wins", () => {
    const selected = computeView(loaded, at(FAR, { selected: "pkg:docs" }));
    expect(selected.focus).toBe("pkg:docs");
    expect(node(selected, "pkg:docs")).toMatchObject({
      selected: true,
      focused: true,
    });
    expect(node(selected, "pkg:web").dimmed).toBe(true);

    const both = computeView(
      loaded,
      at(FAR, { selected: "pkg:docs", hovered: "pkg:web" }),
    );
    expect(both.focus).toBe("pkg:web");
    expect(node(both, "pkg:docs")).toMatchObject({
      selected: true,
      focused: false,
    });
    expect(node(both, "pkg:core").highlighted).toBe(true);
  });

  it("highlights nothing for a focus that is not on the Map", () => {
    const view = computeView(loaded, at(FAR, { hovered: "pkg:gone" }));

    expect(view.nodes.some((n) => n.dimmed || n.highlighted)).toBe(false);
  });
});

describe("Changes switch", () => {
  function changed(
    level: Level,
    id: string,
    change: ModuleChange["change"],
    extra: Partial<ModuleChange> = {},
  ): ModuleChange {
    const m = mod(level, id);
    return {
      id,
      level,
      name: m.name,
      path: m.path,
      ...(m.parent ? { parent: m.parent } : {}),
      change,
      changed: 1,
      added: change === "added" ? 1 : 0,
      modified: change === "modified" ? 1 : 0,
      removed: change === "removed" ? 1 : 0,
      size: 10,
      x: m.x,
      y: m.y,
      radius: m.radius,
      ...extra,
    };
  }
  const level = (l: Level, c: Partial<LevelComparison>): LevelComparison => ({
    level: l,
    modules: [],
    dependencies: [],
    ...c,
  });
  const comparison: Comparison = {
    base: "HEAD",
    target: "worktree",
    summary: {
      filesChanged: 3,
      filesAdded: 1,
      filesModified: 1,
      filesRemoved: 1,
      packagesTouched: 2,
      dependenciesAdded: 1,
      dependenciesRemoved: 1,
    },
    packages: level("packages", {
      modules: [
        changed("packages", "pkg:core", "modified", {
          changed: 2,
          removed: 1,
          modified: 1,
        }),
        changed("packages", "pkg:web", "modified"),
      ],
    }),
    directories: level("directories", {
      modules: [
        changed("directories", "dir:core/money", "modified", { changed: 2 }),
        changed("directories", "dir:web/app", "modified"),
      ],
    }),
    files: level("files", {
      modules: [
        changed("files", "file:core/money/cents.ts", "modified"),
        changed("files", "file:core/money/round.ts", "removed", {
          parent: "dir:core/money",
          x: 12,
          y: -7,
          radius: 5,
        }),
        changed("files", "file:core/money/old.test.ts", "removed", {
          parent: "dir:core/money",
          test: true,
        }),
        changed("files", "file:web/app/view.ts", "added"),
      ],
      dependencies: [
        {
          from: "file:web/app/view.ts",
          to: "file:core/money/cents.ts",
          change: "added",
          kind: "type-only",
          weight: 1,
          added: 1,
          removed: 0,
        },
        {
          from: "file:web/app/main.ts",
          to: "file:core/money/round.ts",
          change: "removed",
          kind: "runtime",
          weight: 1,
          added: 0,
          removed: 1,
        },
      ],
    }),
  };
  const withChanges: MapData = { ...loaded, comparison };
  const on = { base: "HEAD", target: "worktree" };

  it("marks nothing while the switch is off", () => {
    const view = computeView(withChanges, at(CLOSE));

    expect(view.changes).toBeNull();
    expect(
      view.nodes.every((n) => n.change === null && !n.ghost && !n.dimmed),
    ).toBe(true);
    expect(view.edges.every((e) => e.change === null)).toBe(true);
  });

  it("highlights the changed Modules with their count of changed Files and dims the unchanged ones", () => {
    const view = computeView(withChanges, at(CLOSE, { changes: on }));

    expect(node(view, "pkg:core")).toMatchObject({
      change: "modified",
      changedFiles: 2,
      highlighted: true,
      dimmed: false,
    });
    expect(node(view, "file:web/app/view.ts")).toMatchObject({
      change: "added",
      highlighted: true,
    });
    expect(node(view, "file:core/money/cents.ts")).toMatchObject({
      change: "modified",
    });
    const vat = node(view, "file:core/tax/vat.ts");
    expect(vat).toMatchObject({
      change: "unchanged",
      changedFiles: 0,
      dimmed: true,
      highlighted: false,
    });
    expect(vat.opacity).toBeCloseTo(VIEW.changesFade);
    expect(view.changes).toEqual({
      base: "HEAD",
      target: "worktree",
      summary: comparison.summary,
      current: true,
    });
  });

  it("keeps the last Comparison on screen while the one for other refs is on its way, and says so", () => {
    const view = computeView(
      withChanges,
      at(CLOSE, { changes: { base: "main", target: "worktree" } }),
    );

    expect(view.changes).toMatchObject({ base: "HEAD", current: false });
    expect(node(view, "file:core/money/cents.ts").change).toBe("modified");
    expect(view.requests.compare).toEqual({
      base: "main",
      target: "worktree",
      tests: false,
    });
  });

  it("draws a removed File as a ghost at its former position", () => {
    const view = computeView(withChanges, at(CLOSE, { changes: on }));

    const ghost = node(view, "file:core/money/round.ts");
    expect(ghost).toMatchObject({
      ghost: true,
      change: "removed",
      level: "files",
      parent: "dir:core/money",
      x: 12,
      y: -7,
      radius: 5,
    });
    expect(ghost.opacity).toBeCloseTo(VIEW.ghostOpacity);
    expect(
      ids(computeView(withChanges, at(FAR, { changes: on }))),
    ).not.toContain("file:core/money/round.ts");
  });

  it("marks added and removed Dependencies, a removed one drawn as a ghost edge", () => {
    const view = computeView(withChanges, at(CLOSE, { changes: on }));
    const edge = (id: string) => view.edges.find((e) => e.id === id);

    expect(
      edge("file:web/app/view.ts->file:core/money/cents.ts"),
    ).toMatchObject({
      change: "added",
      highlighted: true,
      ghost: false,
    });
    expect(
      edge("file:web/app/main.ts->file:core/money/round.ts"),
    ).toMatchObject({
      change: "removed",
      ghost: true,
      kind: "runtime",
    });
    expect(edge("file:web/app/main.ts->file:web/app/view.ts")).toMatchObject({
      change: "unchanged",
      dimmed: true,
    });
  });

  it("marks nothing until the Comparison has arrived", () => {
    const view = computeView(loaded, at(CLOSE, { changes: on }));

    expect(view.changes).toBeNull();
    expect(view.nodes.every((n) => n.change === null && !n.dimmed)).toBe(true);
  });

  it("leaves a removed test File out while test Files are hidden", () => {
    const hidden = computeView(withChanges, at(CLOSE, { changes: on }));
    const shown = computeView(
      withChanges,
      at(CLOSE, { changes: on, tests: true }),
    );

    expect(ids(hidden)).not.toContain("file:core/money/old.test.ts");
    expect(node(shown, "file:core/money/old.test.ts").ghost).toBe(true);
  });
});

describe("tests switch", () => {
  it("hides the test Files and their Dependencies while off", () => {
    const view = computeView(loaded, at(CLOSE));

    expect(ids(view, "files")).not.toContain("file:core/money/cents.test.ts");
    expect(view.edges.map((e) => e.from)).not.toContain(
      "file:core/money/cents.test.ts",
    );
    expect(view.requests.maps.every((r) => r.tests === false)).toBe(true);
  });

  it("shows them, and asks them from the server, while on", () => {
    const view = computeView(loaded, at(CLOSE, { tests: true }));

    expect(node(view, "file:core/money/cents.test.ts").test).toBe(true);
    expect(view.edges.map((e) => e.from)).toContain(
      "file:core/money/cents.test.ts",
    );
    expect(view.requests.maps.every((r) => r.tests === true)).toBe(true);
  });
});

describe("measures", () => {
  it("normalises Churn into a heat per level", () => {
    const view = computeView(loaded, at(CLOSE));

    expect(node(view, "pkg:web").heat).toBe(1);
    expect(node(view, "pkg:docs").heat).toBe(0);
    const core = node(view, "pkg:core").heat;
    expect(core).toBeGreaterThan(0);
    expect(core).toBeLessThan(1);
    expect(node(view, "dir:web/app").heat).toBe(1);
    expect(node(view, "file:web/app/main.ts").heat).toBe(1);
  });

  it("normalises Dependency weights into a strength per level", () => {
    const view = computeView(loaded, at(CLOSE));
    const strength = (id: string) =>
      view.edges.find((e) => e.id === id)!.strength;

    expect(strength("pkg:web->pkg:core")).toBe(1);
    expect(strength("file:web/app/main.ts->file:core/money/cents.ts")).toBe(1);
  });

  it("carries the kind of each Dependency", () => {
    const view = computeView(loaded, at(CLOSE));

    expect(
      view.edges.find(
        (e) => e.id === "file:web/app/view.ts->file:core/money/cents.ts",
      )?.kind,
    ).toBe("type-only");
  });
});

describe("camera signature", () => {
  const radii = typicalRadii(loaded.levels);
  const vp = { x0: 0, y0: 0, x1: 100, y1: 80 };
  const sig = (zoom: number, v = vp) => cameraSignature(radii, zoom, v);

  it("stays the same while a zoom only moves the blend between the same levels", () => {
    const a = zoomFor(VIEW.revealStartPx * 1.1, DIR_RADIUS);
    const b = zoomFor(VIEW.revealStartPx * 1.3, DIR_RADIUS);
    expect(sig(a)).toBe(sig(b));
    expect(sig(a, { x0: 2, y0: 1, x1: 102, y1: 81 })).toBe(sig(a));
  });

  it("changes when a level starts to be drawn, the level in view changes, or the fetch area moves", () => {
    expect(sig(FAR)).not.toBe(
      sig(zoomFor(VIEW.revealStartPx * 1.1, DIR_RADIUS)),
    );
    expect(sig(zoomFor(VIEW.revealStartPx * 1.1, DIR_RADIUS))).not.toBe(
      sig(DIRECTORIES),
    );
    expect(sig(FAR, { x0: 5000, y0: 0, x1: 5100, y1: 80 })).not.toBe(sig(FAR));
  });

  it("agrees with the view state: same signature, same nodes and requests", () => {
    const a = zoomFor(VIEW.revealStartPx * 1.1, DIR_RADIUS);
    const b = zoomFor(VIEW.revealStartPx * 1.3, DIR_RADIUS);
    const va = computeView(loaded, at(a));
    const vb = computeView(loaded, at(b));
    expect(vb.nodes.map((n) => n.id)).toEqual(va.nodes.map((n) => n.id));
    expect(vb.requests).toEqual(va.requests);
  });
});
