# whimc is one zoomable Map with a frozen force layout

whimc has a single view, the Map: an Obsidian-like graph showing Packages from afar, their Directories as you zoom in, then their Files. Node size is Size (lines of code), node colour is Churn, and a Comparison is a highlight on the same Map rather than a screen of its own. Mockups with a dedicated Comparison screen, lenses for tests and complexity, and an inspector were rejected as too complex for the job, which is a fast picture of the codebase.

The layout is force-directed per level — Packages by their Dependencies, Directories around their Package, Files around their Directory — and is computed by the Go engine, then persisted with the index, so the Map does not rearrange itself between openings. New Modules are placed by relaxing locally around the frozen positions. A live simulation in the browser, as Obsidian does, was rejected: it reshuffles the Map on every opening and does not hold at 10M+ LOC. The engine still sends only the level in view, rendered in WebGL.

Supersedes 2026-11-07-engine-computes-layout.md.
