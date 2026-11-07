// Command whimc indexes a repository and shows it as one zoomable Map.
//
//	whimc serve   [--port N] [--no-open] [path]
//	whimc compare [--base REF] [--target REF] [--json] [--tests=false] [path]
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
)

const usage = `Usage:
  whimc serve   [--port N] [--no-open] [path]          open the Map of the repository in the browser
  whimc compare [--base REF] [--target REF] [--json] [--tests=false] [path]
                                                       print what changed between two States

path defaults to the current directory. REF is a commit, branch or tag, or
"worktree" (or empty) for the working tree. compare defaults to HEAD against
the working tree, untracked Files included; --tests=false leaves test Files out.
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run executes the command line args until done or interrupted, and returns
// the process exit code.
func run(args []string, stdout, stderr io.Writer) int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runContext(ctx, args, stdout, stderr)
}

// runContext executes the command line args until done or until ctx ends,
// and returns the process exit code.
func runContext(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	var err error
	switch args[0] {
	case "serve":
		err = serve(ctx, args[1:], stdout, stderr)
	case "compare":
		err = compare(ctx, args[1:], stdout, stderr)
	case "help", "-h", "--help":
		fmt.Fprint(stdout, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "whimc: unknown command %q\n\n%s", args[0], usage)
		return 2
	}
	if errors.Is(err, flag.ErrHelp) || errors.Is(err, errUsage) {
		return 2
	}
	if err != nil {
		fmt.Fprintf(stderr, "whimc: %v\n", err)
		return 1
	}
	return 0
}

// errUsage reports a command line the flag set already complained about.
var errUsage = errors.New("usage")

func newFlagSet(name string, stderr io.Writer) *flag.FlagSet {
	fs := flag.NewFlagSet("whimc "+name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() { fmt.Fprint(stderr, usage) }
	return fs
}

// repoPath is the optional positional path argument.
func repoPath(fs *flag.FlagSet) (string, error) {
	switch fs.NArg() {
	case 0:
		return ".", nil
	case 1:
		return fs.Arg(0), nil
	}
	fs.Usage()
	return "", errUsage
}

func parse(fs *flag.FlagSet, args []string) (string, error) {
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return "", err
		}
		return "", errUsage
	}
	return repoPath(fs)
}
