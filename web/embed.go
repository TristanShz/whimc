// Package web holds whimc's web UI: a React + TypeScript app built by Vite
// into dist/, which this package embeds in the binary.
//
// dist/ only holds a placeholder in git (public/.gitkeep, which Vite copies
// back on every build), so that `go build` works without building the UI; the
// server then serves a page explaining how to build it. `make build` builds
// the UI first.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// UI returns the built UI, rooted at dist/.
func UI() fs.FS {
	ui, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // "dist" is a valid path: fs.Sub cannot fail
	}
	return ui
}
