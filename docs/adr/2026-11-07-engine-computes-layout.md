---
status: superseded by 2026-11-07-single-zoomable-map.md
---

# The engine aggregates and lays out graphs; the UI only renders them

At 10M+ LOC the File graph has hundreds of thousands of nodes, which no browser can receive whole. The Go engine aggregates Dependencies to the level being displayed (Package, Directory, File) and computes a nested-container layout — Directories and Files placed inside their Package's region — before sending positioned nodes to the UI, which renders them with Sigma.js in WebGL and requests deeper levels only when the user expands a Module. Containers keep positions stable across commits, so a Comparison lays out the union of both states and nothing moves that did not change.
