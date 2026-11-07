// Package server is the HTTP layer of `whimc serve`: a JSON API mirroring
// engine.Workspace, a Server-Sent Events stream of its Changes, and the
// embedded web UI. It holds no state of its own beyond the Workspace.
package server

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/TristanShz/whimc/engine"
)

// MovingChildren is how many children the details of a Module list.
const MovingChildren = 5

// heartbeat is how often an idle Changes stream sends a comment, so that
// proxies and the browser keep it open.
const heartbeat = 15 * time.Second

// New returns the handler of whimc's HTTP server over ws. ui holds the built
// web UI (index.html at its root); without an index.html, the page explains
// how to build it.
//
// The API, all GET:
//
//	/api/map?level=&within=&tests=&ref=&x0=&y0=&x1=&y1=   a MapView
//	/api/compare?base=&target=&tests=                      a Comparison
//	/api/module?id=&ref=&tests=                            ModuleDetails
//	/api/changes                                           the Updates, as SSE
//
// tests defaults to false, ref and target to the working tree, base to HEAD.
// Requests whose Host is not a loopback name are refused, so that a web page
// cannot read the API through DNS rebinding.
func New(ws engine.Workspace, ui fs.FS) http.Handler {
	s := &server{ws: ws}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/map", s.handleMap)
	mux.HandleFunc("GET /api/compare", s.handleCompare)
	mux.HandleFunc("GET /api/module", s.handleModule)
	mux.HandleFunc("GET /api/changes", s.handleChanges)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, fmt.Errorf("no API at %s", r.URL.Path))
	})
	if _, err := fs.Stat(ui, "index.html"); err == nil {
		mux.Handle("/", http.FileServerFS(ui))
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, unbuiltPage)
		})
	}
	return loopbackOnly(mux)
}

const unbuiltPage = `<!doctype html>
<meta charset="utf-8">
<title>whimc</title>
<p>This whimc binary was built without its web UI. Build it with <code>make build</code>
(or <code>pnpm -C web install &amp;&amp; pnpm -C web build</code>, then <code>go build ./cmd/whimc</code>).
The API is served under <code>/api/</code>.</p>
`

type server struct{ ws engine.Workspace }

// ModuleDetails is what the Map shows when a Module is clicked: the Module
// and its children that moved the most within the Churn window.
type ModuleDetails struct {
	Module engine.Module `json:"module"`
	// MovingChildren are up to MovingChildren children with a Churn, the
	// highest Churn first.
	MovingChildren []engine.Module `json:"movingChildren"`
}

func (s *server) handleMap(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	mq := engine.MapQuery{Within: q.Get("within")}
	var err error
	if mq.Level, err = levelParam(q.Get("level")); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if mq.Tests, err = boolParam(q.Get("tests"), "tests"); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if mq.Viewport, err = viewportParam(q); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	view, err := s.ws.Map(r.Context(), engine.ParseState(q.Get("ref")), mq)
	if err != nil {
		writeEngineError(w, err)
		return
	}
	writeJSON(w, view)
}

func (s *server) handleCompare(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	tests, err := boolParam(q.Get("tests"), "tests")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	base := cmp.Or(q.Get("base"), "HEAD")
	c, err := s.ws.Compare(r.Context(), engine.ParseState(base), engine.ParseState(q.Get("target")), engine.CompareQuery{Tests: tests})
	if err != nil {
		writeEngineError(w, err)
		return
	}
	writeJSON(w, c)
}

func (s *server) handleModule(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id := q.Get("id")
	level, ok := levelOf(id)
	if !ok {
		writeError(w, http.StatusBadRequest, fmt.Errorf("id %q: want a Module ID (pkg:…, dir:… or file:…)", id))
		return
	}
	tests, err := boolParam(q.Get("tests"), "tests")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	at := engine.ParseState(q.Get("ref"))
	// A File's siblings are the Files of its folder, its Directory; other
	// Modules are looked up among their whole level.
	within := ""
	if level == engine.Files {
		within = "dir:" + path.Dir(strings.TrimPrefix(id, "file:"))
	}
	view, err := s.ws.Map(r.Context(), at, engine.MapQuery{Level: level, Within: within, Tests: tests})
	if err != nil {
		writeEngineError(w, err)
		return
	}
	i := slices.IndexFunc(view.Modules, func(m engine.Module) bool { return m.ID == id })
	if i < 0 {
		writeError(w, http.StatusNotFound, fmt.Errorf("no Module %s in %s", id, at))
		return
	}
	details := ModuleDetails{Module: view.Modules[i], MovingChildren: []engine.Module{}}
	if level < engine.Files {
		children, err := s.ws.Map(r.Context(), at, engine.MapQuery{Level: level + 1, Within: id, Tests: tests})
		if err != nil {
			writeEngineError(w, err)
			return
		}
		details.MovingChildren = moving(children.Modules)
	}
	writeJSON(w, details)
}

// moving returns the children with a Churn, the highest first (ties by ID),
// at most MovingChildren of them.
func moving(children []engine.Module) []engine.Module {
	out := slices.DeleteFunc(slices.Clone(children), func(m engine.Module) bool { return m.Churn == 0 })
	slices.SortStableFunc(out, func(a, b engine.Module) int {
		return cmp.Or(cmp.Compare(b.Churn, a.Churn), strings.Compare(a.ID, b.ID))
	})
	return out[:min(len(out), MovingChildren)]
}

func (s *server) handleChanges(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming is not supported"))
		return
	}
	updates, err := s.ws.Changes(r.Context())
	if err != nil {
		writeEngineError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	fmt.Fprint(w, ": whimc changes\n\n")
	flusher.Flush()
	tick := time.NewTicker(heartbeat)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
			fmt.Fprint(w, ": heartbeat\n\n")
		case u, ok := <-updates:
			if !ok {
				return
			}
			data, err := json.Marshal(u)
			if err != nil {
				return
			}
			fmt.Fprintf(w, "event: update\ndata: %s\n\n", data)
		}
		flusher.Flush()
	}
}

// levelOf returns the level of a Module ID from its prefix.
func levelOf(id string) (engine.Level, bool) {
	prefix, rest, ok := strings.Cut(id, ":")
	if !ok || rest == "" {
		return 0, false
	}
	switch prefix {
	case "pkg":
		return engine.Packages, true
	case "dir":
		return engine.Directories, true
	case "file":
		return engine.Files, true
	}
	return 0, false
}

func levelParam(v string) (engine.Level, error) {
	if v == "" {
		return engine.Packages, nil
	}
	return engine.ParseLevel(v)
}

func boolParam(v, name string) (bool, error) {
	if v == "" {
		return false, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s=%q: want true or false", name, v)
	}
	return b, nil
}

// viewportParam reads x0, y0, x1 and y1: all four or none.
func viewportParam(q map[string][]string) (*engine.Rect, error) {
	names := []string{"x0", "y0", "x1", "y1"}
	var vals [4]float64
	given := 0
	for i, n := range names {
		v := ""
		if len(q[n]) > 0 {
			v = q[n][0]
		}
		if v == "" {
			continue
		}
		given++
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return nil, fmt.Errorf("%s=%q: want a number", n, v)
		}
		vals[i] = f
	}
	switch given {
	case 0:
		return nil, nil
	case 4:
		return &engine.Rect{X0: vals[0], Y0: vals[1], X1: vals[2], Y1: vals[3]}, nil
	}
	return nil, errors.New("viewport: give all of x0, y0, x1 and y1, or none")
}

func writeJSON(w http.ResponseWriter, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// writeEngineError answers an engine error: a bad request for an unknown
// ref, a server error otherwise.
func writeEngineError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, engine.ErrUnknownRef):
		writeError(w, http.StatusBadRequest, err)
	case errors.Is(err, context.Canceled):
		// The client went away; nobody reads the answer.
	default:
		writeError(w, http.StatusInternalServerError, err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(struct {
		Error string `json:"error"`
	}{err.Error()})
}

// loopbackOnly refuses requests whose Host header is not a loopback name.
func loopbackOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		host = strings.Trim(host, "[]")
		if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			writeError(w, http.StatusForbidden, fmt.Errorf("host %q: whimc only answers on localhost", r.Host))
			return
		}
		next.ServeHTTP(w, r)
	})
}
