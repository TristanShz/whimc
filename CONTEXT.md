# whimc — what's happening in my codebase

whimc indexes a codebase and shows it as one zoomable map, so that a developer whose code is mostly written by AI can see at a glance what the codebase looks like, what is big, what moves a lot, and what just changed.

## Language

### Structure

**Map**:
The single view of whimc: the graph of Modules, where zooming in reveals the next level of the hierarchy.
_Avoid_: Dashboard, graph view, screen

**Module**:
Any node of the structural hierarchy — a Package, a Directory or a File. The Map shows Packages from afar, then Directories, then Files.
_Avoid_: Component, unit

**Package**:
A unit the project declares with a manifest: a `package.json` or a `go.mod`. The top level of the Module hierarchy; a single-module repository has exactly one Package.
_Avoid_: Workspace, library, Go module

**Directory**:
A folder inside a Package, the middle level of the Module hierarchy. A Go package is a Directory.
_Avoid_: Folder, Go package

**File**:
A source file of a supported language, the leaf of the Module hierarchy.

**Dependency**:
An import from one File to the File that defines what it imports, within the same project — through re-exports in TS, through the used symbols in Go. Each Dependency has a kind: runtime, type-only or dynamic. Dependencies between Directories and between Packages are aggregates of File Dependencies.
_Avoid_: Link, reference, edge

**Barrel**:
A File that only re-exports what other Files define. A Dependency passes through it to the defining File.

### Measures

**Size**:
The lines of code of a Module, summed over its Files. Drawn as the size of its node on the Map.
_Avoid_: Weight, LOC count

**Churn**:
The number of commits that touched a Module within a sliding window, 90 days by default. Drawn as the colour of its node on the Map, from calm to moving a lot.
_Avoid_: Activity, most modified

### Change

**State**:
A state of the codebase: a commit, a branch or a tag, or the working tree as on disk.
_Avoid_: Version, revision

**Comparison**:
A pair of codebase states — a base and a target — whose differences are highlighted on the Map. Defaults to HEAD against the working tree, untracked but not ignored files included.
_Avoid_: Diff (reserved for the line-level text diff)

### Engine

**Workspace**:
A repository whimc has opened, and the engine's single seam: the command line and the Map ask it for Maps, Comparisons and Updates. Not a set of Packages, which npm and Go call a workspace.
_Avoid_: Project, repo handle

**Watcher**:
What follows the working tree while whimc runs: it notices the Files written, created or removed, and HEAD moving, and reports each burst of writes in one Update.
_Avoid_: Poller, file monitor

**Update**:
A change of the index pushed to the Map: progress of the first run, Files of the working tree written, or HEAD moved. A Map or a Comparison asked for after it reflects it.
_Avoid_: Event, notification
