package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/server"
	"github.com/TristanShz/whimc/web"
)

// defaultPort is the port serve listens on when --port is not given.
const defaultPort = 7777

func serve(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	fs := newFlagSet("serve", stderr)
	port := fs.Int("port", defaultPort, "port to listen on, on 127.0.0.1 (another free one if it is taken and not asked for)")
	noOpen := fs.Bool("no-open", false, "do not open the browser")
	path, err := parse(fs, args)
	if err != nil {
		return err
	}
	portAsked := false
	fs.Visit(func(f *flag.Flag) { portAsked = portAsked || f.Name == "port" })

	ws, err := engine.Open(ctx, path, engine.Options{})
	if err != nil {
		return err
	}
	defer ws.Close()

	l, err := listen(*port, portAsked)
	if err != nil {
		return err
	}
	// The first run goes on while the Map is served: the structure first,
	// then the Packages one by one.
	updates, err := ws.Changes(ctx)
	if err != nil {
		return err
	}
	go reportIndexing(updates, stdout, time.Now())
	srv := &http.Server{
		Handler:           server.New(ws, web.UI()),
		ReadHeaderTimeout: 10 * time.Second,
		// Requests end with the command, Changes streams included.
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	url := fmt.Sprintf("http://%s/", l.Addr())
	fmt.Fprintf(stdout, "The Map is on %s (Ctrl+C to stop).\n", url)
	if !*noOpen {
		if err := openBrowser(url); err != nil {
			fmt.Fprintf(stderr, "whimc: could not open the browser (%v): open %s yourself.\n", err, url)
		}
	}

	served := make(chan error, 1)
	go func() { served <- srv.Serve(l) }()
	select {
	case err := <-served:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil {
		return err
	}
	if err := <-served; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// reportIndexing prints the progress of the first run.
func reportIndexing(updates <-chan engine.Update, stdout io.Writer, start time.Time) {
	for u := range updates {
		switch u.Kind {
		case engine.StructureIndexed:
			fmt.Fprintf(stdout, "Indexing %s…\n", count(u.Total, "Package"))
		case engine.Indexed:
			fmt.Fprintf(stdout, "Indexed %s in %s.\n", count(u.Total, "Package"), time.Since(start).Round(time.Millisecond))
			// The Watcher keeps streaming; nothing more to print.
			for range updates {
			}
			return
		}
	}
}

// listen listens on port of 127.0.0.1 only, so that the code never leaves
// the machine. When the port is taken and was not asked for, it falls back to
// a free port.
func listen(port int, asked bool) (net.Listener, error) {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err == nil || asked {
		if err != nil {
			return nil, fmt.Errorf("port %d: %w (pick another one with --port)", port, err)
		}
		return l, nil
	}
	return net.Listen("tcp", "127.0.0.1:0")
}

// openBrowser opens url in the user's browser; tests replace it.
var openBrowser = func(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux", "freebsd", "openbsd", "netbsd":
		cmd = exec.Command("xdg-open", url)
	default:
		return fmt.Errorf("no browser opener known on %s", runtime.GOOS)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}
