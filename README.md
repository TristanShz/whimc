# whimc — what's happening in my codebase

When most of your code is written by AI, you lose sight of your own architecture. whimc gives it back: it indexes a codebase and draws it as one zoomable map.

- **From afar**, you see your Packages. Zoom in and their Directories appear, then their Files.
- **Node size** is the lines of code: you see what is big.
- **Node colour** is the commits of the last 90 days: you see what moves a lot.
- **Changements** highlights what changed between HEAD and your working tree, so you see what the agent just did.

whimc runs locally, as a single binary that serves the map in your browser. It is built for large repositories (10M+ lines), and analyses TypeScript/JavaScript and Go.

> Status: design phase. See [`CONTEXT.md`](CONTEXT.md) for the vocabulary and [`docs/adr/`](docs/adr) for the decisions taken so far.

## License

[Apache-2.0](LICENSE)
