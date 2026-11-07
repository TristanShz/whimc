package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TristanShz/whimc/internal/testrepo"
)

// syncBuffer is a bytes.Buffer safe to read while the command writes it.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

var mapURL = regexp.MustCompile(`http://127\.0\.0\.1:\d+/`)

// startServe runs `whimc serve args` in the background and returns the URL
// it prints and a function stopping it that returns its exit code.
func startServe(t *testing.T, args ...string) (url string, stop func() int) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	var stdout, stderr syncBuffer
	done := make(chan int, 1)
	go func() { done <- runContext(ctx, append([]string{"serve"}, args...), &stdout, &stderr) }()
	stop = func() int {
		cancel()
		select {
		case code := <-done:
			return code
		case <-time.After(10 * time.Second):
			t.Fatal("serve did not stop")
			return -1
		}
	}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if url = mapURL.FindString(stdout.String()); url != "" {
			return url, stop
		}
		select {
		case code := <-done:
			t.Fatalf("serve exited with %d before printing its URL; stdout %q, stderr %q", code, stdout.String(), stderr.String())
		case <-time.After(20 * time.Millisecond):
		}
	}
	stop()
	t.Fatalf("serve printed no URL; stdout %q, stderr %q", stdout.String(), stderr.String())
	return "", nil
}

func goRepo(t *testing.T) *testrepo.Repo {
	t.Helper()
	isolateUserCache(t)
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"go.mod":  "module example.com/shop\n",
		"main.go": "package main\n\nfunc main() {}\n",
	})
	r.Commit("initial")
	return r
}

func TestServeServesTheMapOnLocalhostUntilStopped(t *testing.T) {
	r := goRepo(t)

	url, stop := startServe(t, "--no-open", "--port", "0", r.Dir)
	res, err := http.Get(url + "api/map")
	if err != nil {
		t.Fatal(err)
	}
	var view struct {
		Modules []struct{ Name string } `json:"modules"`
	}
	err = json.NewDecoder(res.Body).Decode(&view)
	res.Body.Close()

	if err != nil || len(view.Modules) != 1 || view.Modules[0].Name != "example.com/shop" {
		t.Errorf("GET /api/map = %+v (%v), want the Package", view, err)
	}
	if code := stop(); code != 0 {
		t.Errorf("exit code = %d after stop, want 0", code)
	}
}

func TestServeOpensTheBrowserOnTheMap(t *testing.T) {
	r := goRepo(t)
	opened := make(chan string, 1)
	defer func(prev func(string) error) { openBrowser = prev }(openBrowser)
	openBrowser = func(url string) error { opened <- url; return nil }

	url, stop := startServe(t, "--port", "0", r.Dir)
	defer stop()

	select {
	case got := <-opened:
		if got != url {
			t.Errorf("opened %q, want %q", got, url)
		}
	case <-time.After(5 * time.Second):
		t.Error("the browser was not opened")
	}
}

func TestListenFallsBackToAFreePortUnlessThePortWasAskedFor(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()
	port := taken.Addr().(*net.TCPAddr).Port

	l, err := listen(port, false)
	if err != nil {
		t.Fatalf("listen on a taken default port: %v", err)
	}
	got := l.Addr().(*net.TCPAddr)
	l.Close()
	if got.Port == port || !got.IP.IsLoopback() {
		t.Errorf("fell back to %v, want another port on 127.0.0.1", got)
	}

	if _, err := listen(port, true); err == nil || !strings.Contains(err.Error(), strconv.Itoa(port)) {
		t.Errorf("listen on a taken asked-for port: err = %v, want an error naming the port", err)
	}
}
