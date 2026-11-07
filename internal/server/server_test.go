package server_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/server"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// shop is a TS workspace of two Packages where web imports core.
var shop = map[string]string{
	"package.json":                    `{"name":"shop","private":true}`,
	"packages/core/package.json":      `{"name":"core","main":"src/index.ts"}`,
	"packages/core/src/index.ts":      "export * from './money'\n",
	"packages/core/src/money.ts":      "export const cents = (n: number) => n * 100\n",
	"packages/core/src/money.test.ts": "import { cents } from './money'\ncents(1)\n",
	"packages/web/package.json":       `{"name":"web"}`,
	"packages/web/src/app.ts":         "import { cents } from 'core'\nexport const app = () => cents(2)\n",
	"packages/web/lib/format.ts":      "export const format = (s: string) => s.trim()\n",
}

// shopServer commits shop, edits web's app in a second commit, adds an
// untracked File, and serves the repository.
func shopServer(t *testing.T, ui map[string]string) (*httptest.Server, *testrepo.Repo) {
	t.Helper()
	r := testrepo.New(t)
	r.WriteFiles(shop)
	r.Commit("initial")
	r.Git("tag", "v1")
	r.Write("packages/web/src/app.ts", "import { cents } from 'core'\nexport const app = () => cents(3)\nexport const two = 2\n")
	r.Commit("edit app")
	r.Write("packages/core/src/tax.ts", "export const tax = 0.2\n")
	// The clock stops just after the fixture's commits: they all count in Churn.
	ws, err := engine.Open(context.Background(), r.Dir, engine.Options{CacheDir: t.TempDir(), Now: func() time.Time { return testrepo.DefaultDate.Add(time.Hour) }})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { ws.Close() })
	return serve(t, ws, ui), r
}

func serve(t *testing.T, ws engine.Workspace, ui map[string]string) *httptest.Server {
	t.Helper()
	files := fstest.MapFS{}
	for name, content := range ui {
		files[name] = &fstest.MapFile{Data: []byte(content)}
	}
	srv := httptest.NewServer(server.New(ws, files))
	t.Cleanup(srv.Close)
	return srv
}

// get requests path and decodes the JSON answer into out, failing unless the
// status is want.
func get(t *testing.T, srv *httptest.Server, path string, want int, out any) {
	t.Helper()
	res, err := http.Get(srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != want {
		t.Fatalf("GET %s: status %d, want %d; body %s", path, res.StatusCode, want, body)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("GET %s: Content-Type %q, want JSON", path, ct)
	}
	if err := json.Unmarshal(body, out); err != nil {
		t.Fatalf("GET %s: %v in %s", path, err, body)
	}
}

// module is the JSON shape of a Module the web client reads.
type module struct {
	ID       string  `json:"id"`
	Level    string  `json:"level"`
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	Parent   string  `json:"parent"`
	Size     int     `json:"size"`
	Churn    int     `json:"churn"`
	Children int     `json:"children"`
	Test     bool    `json:"test"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Radius   float64 `json:"radius"`
}

type mapView struct {
	Level        string   `json:"level"`
	Modules      []module `json:"modules"`
	Dependencies []struct {
		From   string         `json:"from"`
		To     string         `json:"to"`
		Kind   string         `json:"kind"`
		Weight int            `json:"weight"`
		Counts map[string]int `json:"counts"`
	} `json:"dependencies"`
}

func ids(ms []module) []string {
	out := []string{}
	for _, m := range ms {
		out = append(out, m.ID)
	}
	return out
}

func TestMapReturnsThePackagesByDefault(t *testing.T) {
	srv, _ := shopServer(t, nil)
	var view mapView

	get(t, srv, "/api/map", http.StatusOK, &view)

	if view.Level != "packages" {
		t.Errorf("level = %q, want packages", view.Level)
	}
	if got := strings.Join(ids(view.Modules), " "); got != "pkg:packages/core pkg:packages/web" {
		t.Fatalf("modules = %s", got)
	}
	core := view.Modules[0]
	if core.Name != "core" || core.Path != "packages/core" || core.Level != "packages" || core.Size != 3 ||
		core.Churn != 1 || core.Children != 1 || core.Radius <= 0 {
		t.Errorf("core = %+v", core)
	}
	if len(view.Dependencies) != 1 {
		t.Fatalf("dependencies = %+v, want web -> core", view.Dependencies)
	}
	d := view.Dependencies[0]
	if d.From != "pkg:packages/web" || d.To != "pkg:packages/core" || d.Kind != "runtime" || d.Weight != 1 ||
		d.Counts["runtime"] != 1 || d.Counts["typeOnly"] != 0 {
		t.Errorf("dependency = %+v", d)
	}
}

func TestMapTakesLevelWithinTestsAndRef(t *testing.T) {
	srv, _ := shopServer(t, nil)
	for _, tc := range []struct {
		query string
		want  string
	}{
		{"level=files&within=pkg:packages/core", "file:packages/core/src/index.ts file:packages/core/src/money.ts file:packages/core/src/tax.ts"},
		{"level=files&within=pkg:packages/core&tests=true", "file:packages/core/src/index.ts file:packages/core/src/money.test.ts file:packages/core/src/money.ts file:packages/core/src/tax.ts"},
		{"level=files&within=pkg:packages/core&ref=v1", "file:packages/core/src/index.ts file:packages/core/src/money.ts"},
		{"level=files&within=pkg:packages/core&ref=worktree", "file:packages/core/src/index.ts file:packages/core/src/money.ts file:packages/core/src/tax.ts"},
		{"level=directories", "dir:packages/core/src dir:packages/web/lib dir:packages/web/src"},
	} {
		var view mapView
		get(t, srv, "/api/map?"+tc.query, http.StatusOK, &view)
		if got := strings.Join(ids(view.Modules), " "); got != tc.want {
			t.Errorf("%s: modules = %s, want %s", tc.query, got, tc.want)
		}
	}
}

func TestMapKeepsTheModulesInTheViewport(t *testing.T) {
	srv, _ := shopServer(t, nil)
	var all mapView
	get(t, srv, "/api/map?level=directories", http.StatusOK, &all)
	d := all.Modules[0]
	var view mapView

	get(t, srv, "/api/map?level=directories&x0="+ftoa(d.X-0.01)+"&y0="+ftoa(d.Y-0.01)+"&x1="+ftoa(d.X+0.01)+"&y1="+ftoa(d.Y+0.01), http.StatusOK, &view)

	if got := ids(view.Modules); !slices.Contains(got, d.ID) || len(got) == len(all.Modules) {
		t.Errorf("modules in viewport = %v, want %s and not all of %v", got, d.ID, ids(all.Modules))
	}
}

func TestMapRejectsBadQueries(t *testing.T) {
	srv, _ := shopServer(t, nil)
	for _, q := range []string{"level=modules", "tests=maybe", "x0=1&y0=1&x1=2", "x0=a&y0=1&x1=2&y1=2"} {
		var e struct{ Error string }
		get(t, srv, "/api/map?"+q, http.StatusBadRequest, &e)
		if e.Error == "" {
			t.Errorf("%s: no error message", q)
		}
	}
}

func TestUnknownRefIsABadRequest(t *testing.T) {
	srv, _ := shopServer(t, nil)
	var e struct{ Error string }

	get(t, srv, "/api/map?ref=nope", http.StatusBadRequest, &e)

	if !strings.Contains(e.Error, `unknown ref "nope"`) {
		t.Errorf("error = %q", e.Error)
	}
}

func TestCompareDefaultsToHeadAgainstTheWorkingTree(t *testing.T) {
	srv, _ := shopServer(t, nil)
	var c engine.Comparison

	get(t, srv, "/api/compare", http.StatusOK, &c)

	if c.Base.String() != "HEAD" || c.Target.String() != "worktree" {
		t.Errorf("base, target = %s, %s", c.Base, c.Target)
	}
	if c.Summary.FilesAdded != 1 || c.Summary.FilesChanged != 1 {
		t.Errorf("summary = %+v, want the untracked tax.ts only", c.Summary)
	}
}

func TestCompareTakesRefsAndTests(t *testing.T) {
	srv, r := shopServer(t, nil)
	r.Write("packages/core/src/money.test.ts", "cents(9)\n")
	var c engine.Comparison
	get(t, srv, "/api/compare?base=v1&target=HEAD", http.StatusOK, &c)
	if c.Summary.FilesModified != 1 || c.Summary.FilesAdded != 0 || c.Files.Modules[0].ID != "file:packages/web/src/app.ts" {
		t.Errorf("v1..HEAD = %+v", c.Summary)
	}

	var noTests, tests engine.Comparison
	get(t, srv, "/api/compare", http.StatusOK, &noTests)
	get(t, srv, "/api/compare?tests=true", http.StatusOK, &tests)

	if noTests.Summary.FilesChanged != 1 || tests.Summary.FilesChanged != 2 {
		t.Errorf("Files changed without tests = %d, with tests = %d; want 1 and 2",
			noTests.Summary.FilesChanged, tests.Summary.FilesChanged)
	}
}

func TestModuleDetailsListTheChildrenThatMoveTheMost(t *testing.T) {
	srv, _ := shopServer(t, nil)
	var d struct {
		Module         module   `json:"module"`
		MovingChildren []module `json:"movingChildren"`
	}

	get(t, srv, "/api/module?id=pkg:packages/web", http.StatusOK, &d)

	if d.Module.ID != "pkg:packages/web" || d.Module.Churn != 2 || d.Module.Children != 2 {
		t.Errorf("module = %+v", d.Module)
	}
	if got := strings.Join(ids(d.MovingChildren), " "); got != "dir:packages/web/src dir:packages/web/lib" {
		t.Errorf("moving children = %s, want src (2 commits) before lib (1)", got)
	}
}

func TestModuleDetailsOfAFileAndOfADirectory(t *testing.T) {
	srv, _ := shopServer(t, nil)
	var file, dir struct {
		Module         module   `json:"module"`
		MovingChildren []module `json:"movingChildren"`
	}

	get(t, srv, "/api/module?id=file:packages/web/src/app.ts", http.StatusOK, &file)
	get(t, srv, "/api/module?id=dir:packages/core/src&tests=true", http.StatusOK, &dir)

	if file.Module.Path != "packages/web/src/app.ts" || file.Module.Churn != 2 || len(file.MovingChildren) != 0 {
		t.Errorf("file = %+v", file)
	}
	if dir.Module.Children != 4 {
		t.Errorf("directory with tests = %+v, want 4 children", dir.Module)
	}
	// tax.ts is untracked: it never moved, so it is not among the moving children.
	if got := strings.Join(ids(dir.MovingChildren), " "); got != "file:packages/core/src/index.ts file:packages/core/src/money.test.ts file:packages/core/src/money.ts" {
		t.Errorf("moving children = %s", got)
	}
}

func TestModuleDetailsOfAnUnknownModuleIsNotFound(t *testing.T) {
	srv, _ := shopServer(t, nil)
	var e struct{ Error string }
	get(t, srv, "/api/module?id=file:nope.ts", http.StatusNotFound, &e)
	get(t, srv, "/api/module?id=pkg:nope", http.StatusNotFound, &e)
	get(t, srv, "/api/module", http.StatusBadRequest, &e)
	get(t, srv, "/api/module?id=nope", http.StatusBadRequest, &e)
}

func TestUnknownAPIPathIsNotFound(t *testing.T) {
	srv, _ := shopServer(t, nil)
	var e struct{ Error string }
	get(t, srv, "/api/nope", http.StatusNotFound, &e)
}

func TestRequestsForAnotherHostAreRefused(t *testing.T) {
	srv, _ := shopServer(t, nil)
	req, _ := http.NewRequest("GET", srv.URL+"/api/map", nil)
	req.Host = "evil.example:7777"

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()

	if res.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403 for a foreign Host (DNS rebinding)", res.StatusCode)
	}
	for _, host := range []string{"localhost:7777", "127.0.0.1:7777", "[::1]:7777"} {
		req.Host = host
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("Host %s: status = %d, want 200", host, res.StatusCode)
		}
	}
}

func TestTheUIIsServedFromItsFiles(t *testing.T) {
	srv, _ := shopServer(t, map[string]string{
		"index.html":    "<!doctype html><title>whimc</title>",
		"assets/app.js": "console.log('map')",
	})

	for path, want := range map[string]string{"/": "<title>whimc</title>", "/assets/app.js": "console.log"} {
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK || !strings.Contains(string(body), want) {
			t.Errorf("GET %s = %d %q, want %q", path, res.StatusCode, body, want)
		}
	}
}

func TestWithoutABuiltUIThePageSaysHowToBuildIt(t *testing.T) {
	srv, _ := shopServer(t, nil)

	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()

	if res.StatusCode != http.StatusOK || !strings.Contains(string(body), "make build") {
		t.Errorf("GET / = %d %q, want a page pointing at make build", res.StatusCode, body)
	}
}

// changing is a Workspace whose Changes streams the Updates the test sends.
type changing struct {
	engine.Workspace
	updates chan engine.Update
}

func (c changing) Changes(ctx context.Context) (<-chan engine.Update, error) { return c.updates, nil }

func TestChangesStreamsUpdatesAsServerSentEvents(t *testing.T) {
	updates := make(chan engine.Update)
	srv := serve(t, changing{updates: updates}, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/changes", nil)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type = %q", ct)
	}
	updates <- engine.Update{}
	events := bufio.NewReader(res.Body)
	var lines []string
	for len(lines) < 2 || lines[len(lines)-1] != "" {
		line, err := events.ReadString('\n')
		if err != nil {
			t.Fatalf("reading the stream after %q: %v", lines, err)
		}
		line = strings.TrimSuffix(line, "\n")
		if strings.HasPrefix(line, ":") || len(lines) == 0 && line == "" {
			continue // comments and the blank line after them
		}
		lines = append(lines, line)
	}
	if got := strings.Join(lines, "|"); got != "event: update|data: {}|" {
		t.Errorf("event = %q", got)
	}
}

func TestChangesStaysOpenWhileTheEngineHasNoChangesYet(t *testing.T) {
	srv, _ := shopServer(t, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/changes", nil)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	line, err := bufio.NewReader(res.Body).ReadString('\n')

	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "text/event-stream" || err != nil || !strings.HasPrefix(line, ":") {
		t.Errorf("status %d, Content-Type %q, first line %q (%v): want an open stream starting with a comment",
			res.StatusCode, res.Header.Get("Content-Type"), line, err)
	}
}

func ftoa(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }
