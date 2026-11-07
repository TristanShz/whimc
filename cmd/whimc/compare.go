package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/TristanShz/whimc/engine"
)

func compare(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	fs := newFlagSet("compare", stderr)
	base := fs.String("base", "HEAD", `base State: a commit, branch or tag, or "worktree"`)
	target := fs.String("target", engine.WorktreeRef, `target State: a commit, branch or tag, or "worktree"`)
	asJSON := fs.Bool("json", false, "print the Comparison as JSON")
	tests := fs.Bool("tests", true, "include test Files")
	path, err := parse(fs, args)
	if err != nil {
		return err
	}
	ws, err := engine.Open(ctx, path, engine.Options{})
	if err != nil {
		return err
	}
	defer ws.Close()

	c, err := ws.Compare(ctx, engine.ParseState(*base), engine.ParseState(*target), engine.CompareQuery{Tests: *tests})
	if err != nil {
		return err
	}
	if *asJSON {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(c)
	}
	return writeComparison(stdout, c)
}

// writeComparison prints a Comparison for a reader: the summary, then each
// touched Package with its changed Files, then the Dependencies added and
// removed between Packages and between Files.
func writeComparison(out io.Writer, c engine.Comparison) error {
	w := bufio.NewWriter(out)
	s := c.Summary
	fmt.Fprintf(w, "Comparison of %s with %s\n\n", c.Base, c.Target)
	if s == (engine.Summary{}) && len(c.Packages.Modules) == 0 {
		fmt.Fprintln(w, "No changes.")
		return w.Flush()
	}
	fmt.Fprintf(w, "%s changed: %d added, %d modified, %d removed\n",
		count(s.FilesChanged, "File"), s.FilesAdded, s.FilesModified, s.FilesRemoved)
	fmt.Fprintf(w, "%s touched\n", count(s.PackagesTouched, "Package"))
	fmt.Fprintf(w, "Dependencies: %d added, %d removed\n", s.DependenciesAdded, s.DependenciesRemoved)

	packageOf := map[string]string{} // Directory ID -> Package ID
	for _, d := range c.Directories.Modules {
		packageOf[d.ID] = d.Parent
	}
	filesOf := map[string][]engine.ModuleChange{}
	for _, f := range c.Files.Modules {
		p := packageOf[f.Parent]
		filesOf[p] = append(filesOf[p], f)
	}
	for _, p := range c.Packages.Modules {
		fmt.Fprintf(w, "\n%s (%s), %s: %d added, %d modified, %d removed\n",
			p.Name, p.Path, p.Change, p.Added, p.Modified, p.Removed)
		for _, f := range filesOf[p.ID] {
			line := fmt.Sprintf("  %s %s", mark(f.Change), f.Path)
			if f.Test {
				line += " (test)"
			}
			fmt.Fprintln(w, line)
		}
	}

	var couplings, imports []string
	for _, d := range c.Packages.Dependencies {
		if d.Change == engine.Added || d.Change == engine.Removed {
			couplings = append(couplings, dependencyLine(d.Change, d))
		}
	}
	for _, d := range c.Files.Dependencies {
		switch {
		case d.Added > 0:
			imports = append(imports, dependencyLine(engine.Added, d))
		case d.Removed > 0:
			imports = append(imports, dependencyLine(engine.Removed, d))
		}
	}
	section(w, "Dependencies between Packages", couplings)
	section(w, "Dependencies between Files", imports)
	return w.Flush()
}

func dependencyLine(c engine.Change, d engine.DependencyChange) string {
	return fmt.Sprintf("  %s %s -> %s (%s)", mark(c), pathOf(d.From), pathOf(d.To), d.Kind)
}

// section prints a titled list, nothing when the list is empty.
func section(w io.Writer, title string, lines []string) {
	if len(lines) > 0 {
		fmt.Fprintf(w, "\n%s\n%s\n", title, strings.Join(lines, "\n"))
	}
}

// mark is the one-letter mark of a change, as in git status.
func mark(c engine.Change) string {
	switch c {
	case engine.Added:
		return "A"
	case engine.Removed:
		return "D"
	}
	return "M"
}

func count(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

// pathOf strips the level prefix of a Module ID.
func pathOf(id string) string {
	_, p, _ := strings.Cut(id, ":")
	return p
}
