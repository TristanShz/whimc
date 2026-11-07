# whimc — what's happening in my codebase

When most of your code is written by AI, you lose sight of your own architecture. whimc gives it back: it indexes a codebase and draws it as one zoomable map.

- **From afar**, you see your Packages. Zoom in and their Directories appear, then their Files.
- **Node size** is the lines of code: you see what is big.
- **Node colour** is the commits of the last 90 days: you see what moves a lot.
- **Changes** highlights what changed between HEAD and your working tree, so you see what the agent just did.

whimc runs locally, as a single binary that serves the map in your browser. Your code never leaves your machine. It is built for large repositories (10M+ lines), and analyses TypeScript/JavaScript and Go.

## Install

whimc needs `git` on your `PATH`. Prebuilt binaries exist for macOS (Apple silicon and Intel) and Linux (amd64 and arm64).

With Homebrew:

```sh
brew install TristanShz/tap/whimc
```

Or download the archive for your platform from the [releases](https://github.com/TristanShz/whimc/releases), check it against `checksums.txt`, and put `whimc` on your `PATH`:

```sh
tar -xzf whimc_<version>_darwin_arm64.tar.gz
sudo mv whimc /usr/local/bin/
```

The binaries are not notarized: on macOS, a binary downloaded with a browser may need `xattr -d com.apple.quarantine whimc` before it runs (Homebrew does this for you). The Linux binaries link glibc 2.35 or newer.

## Usage

### `whimc serve`

```sh
whimc serve [--port N] [--no-open] [path]
```

Run it anywhere inside a git repository (`path` defaults to the current directory). whimc indexes the repository, serves the Map on `http://127.0.0.1:7777` and opens it in your browser. No configuration needed.

- `--port N` listens on port N. Without it, whimc takes 7777, or another free port if 7777 is taken.
- `--no-open` does not open the browser; open the printed URL yourself.

On the Map, the switch **Changes** shows the Comparison between two refs: added and modified Files, removed Files as ghosts at their former place, the Directories and Packages they touch, and the Dependencies added or removed. The Map follows the working tree live while an agent writes Files. Test Files are hidden until you turn on the tests switch.

The first run of a large repository shows the Packages, Directories and Files right away, then fills in Dependencies and Churn Package by Package. Later runs only parse what changed.

### `whimc compare`

```sh
whimc compare [--base REF] [--target REF] [--json] [--tests=false] [path]
```

Prints the Comparison of two States in the terminal: the Files changed, added, modified and removed, the Packages touched with their Files, and the Dependencies added and removed.

- `--base REF` is the State compared from, `HEAD` by default.
- `--target REF` is the State compared to, the working tree by default.
- `--json` prints the Comparison as JSON instead: a `summary`, then the changed Modules and Dependencies at each level (`packages`, `directories`, `files`). An agent can call `whimc compare --json` at the end of a task to review its own changes.
- `--tests=false` leaves test Files out (they are included by default).

A REF is anything git resolves to a commit (a commit hash, a branch, a tag, `HEAD~3`), or `worktree` for the working tree as it is on disk, untracked Files included. The Map's ref pickers take the same refs.

```sh
whimc compare                          # HEAD against the working tree
whimc compare --base main              # the whole branch, uncommitted work included
whimc compare --base v1.0 --target v1.1 --json
```

### `whimc version`

Prints the version of whimc.

## Where the index lives

whimc never writes inside your repository. Its index (an SQLite database of parse results keyed by git blob, Churn and the frozen layout of the Map) lives in your user cache:

- macOS: `~/Library/Caches/whimc/<repository hash>/index.db`
- Linux: `$XDG_CACHE_HOME/whimc/<repository hash>/index.db` (`~/.cache/whimc/...` by default)

The hash identifies the repository's git directory, so all worktrees of one repository share one index. Deleting the folder is safe: whimc rebuilds it on the next run.

## Build from source

You need Go (see `go.mod`), a C compiler (whimc uses tree-sitter through cgo), Node.js and pnpm.

```sh
make build    # builds the web UI, then ./whimc
make test     # go test ./...
```

`make build` builds the web UI in `web/` first, because the binary embeds it. A plain `go build ./cmd/whimc` works too, but its server only shows a page asking you to run `make build`.

Releases are cut by pushing a `v*` tag: [`.github/workflows/release.yml`](.github/workflows/release.yml) builds each OS/arch natively (cgo rules out cross-compiling), then [GoReleaser](.goreleaser.yaml) publishes the archives, the checksums and the Homebrew cask.

## Status

Early: the Map, live Changes and `whimc compare` work, and the first release is being prepared. See [`CONTEXT.md`](CONTEXT.md) for the vocabulary and [`docs/adr/`](docs/adr) for the decisions taken so far.

## License

[Apache-2.0](LICENSE)
