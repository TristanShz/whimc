// Package parse reads one File's content with tree-sitter and extracts what
// the resolver needs to find its Dependencies: imports and their kind,
// re-exports, top-level declarations and, in Go, the `pkg.Symbol` selectors
// it uses.
//
// A Result depends only on the File's content and language, never on the
// rest of the State, so it can be stored under the File's blob hash. It is a
// plain value that encodes to JSON as is.
package parse

import (
	"bytes"
	"path"
	"strings"

	ts "github.com/tree-sitter/go-tree-sitter"
	tsgo "github.com/tree-sitter/tree-sitter-go/bindings/go"
	tsts "github.com/tree-sitter/tree-sitter-typescript/bindings/go"
)

// Kind is the kind of an import, and of the Dependency it gives. Lower values
// win when several imports are merged into one Dependency.
type Kind int

const (
	// Runtime imports load the imported module when the importer runs;
	// `require()` is one.
	Runtime Kind = iota
	// TypeOnly imports (`import type`, `export type`) vanish at runtime.
	TypeOnly
	// Dynamic imports (`import()`) load the module lazily.
	Dynamic
)

// Language is the language a File is parsed as.
type Language string

const (
	TypeScript Language = "ts" // TS and JS, JSX included
	Go         Language = "go"
)

// Whole is the imported name standing for the whole module: a namespace
// import, a side-effect import, `require()` or `import()`.
const Whole = "*"

// Result is what a File tells about its Dependencies.
type Result struct {
	Language Language `json:"language"`
	// Failed is set when the File does not parse; it then carries nothing
	// but its line count.
	Failed bool `json:"failed,omitempty"`
	// Lines is the number of lines of the File.
	Lines int `json:"lines"`
	// Imports are the File's imports, in source order.
	Imports []Import `json:"imports,omitempty"`
	// ReExports are the names a TS File exports from another module.
	ReExports []ReExport `json:"reExports,omitempty"`
	// Declares lists the names the File defines itself: in TS the names it
	// exports from its own declarations ("default" included), in Go its
	// top-level functions, types, variables and constants.
	Declares []string `json:"declares,omitempty"`
	// GoPackage is the name in a Go File's package clause.
	GoPackage string `json:"goPackage,omitempty"`
	// Selectors are the distinct `x.Name` selectors of a Go File whose operand
	// is a plain identifier, in source order; the resolver keeps those whose
	// operand names an import.
	Selectors []Selector `json:"selectors,omitempty"`
}

// Import is one import of a module.
type Import struct {
	// Spec is the module specifier (TS) or import path (Go).
	Spec string `json:"spec"`
	Kind Kind   `json:"kind"`
	// Names are the imported names in TS: "default", a named export, or
	// Whole.
	Names []string `json:"names,omitempty"`
	// Alias is the explicit name of a Go import: an identifier, "_" or ".".
	Alias string `json:"alias,omitempty"`
}

// ReExport is a name a TS File exports from another module, or every name of
// it for `export * from`.
type ReExport struct {
	Spec string `json:"spec"`
	// Star is set for `export * from Spec`.
	Star bool `json:"star,omitempty"`
	// Name is the exported name, From the name in Spec (Whole for
	// `export * as Name from Spec`).
	Name     string `json:"name,omitempty"`
	From     string `json:"from,omitempty"`
	TypeOnly bool   `json:"typeOnly,omitempty"`
}

// Selector is a Go `Pkg.Symbol` selector.
type Selector struct {
	Pkg    string `json:"pkg"`
	Symbol string `json:"symbol"`
}

// LanguageOf returns the language a File is parsed as, from its path.
func LanguageOf(p string) Language {
	if path.Ext(p) == ".go" {
		return Go
	}
	return TypeScript
}

// Grammar names the grammar the File at p is parsed with: "go", "ts" or
// "tsx". A Result depends only on the content and the grammar.
func Grammar(p string) string {
	switch {
	case LanguageOf(p) == Go:
		return "go"
	case strings.HasSuffix(p, ".ts") || strings.HasSuffix(p, ".mts") || strings.HasSuffix(p, ".cts"):
		return "ts"
	default: // .tsx and every JS flavour: the TSX grammar also reads JSX
		return "tsx"
	}
}

// File parses the content of the File at p.
func File(p string, content []byte) Result {
	lang := LanguageOf(p)
	r := Result{Language: lang, Lines: lineCount(content)}
	var grammar *ts.Language
	switch Grammar(p) {
	case "go":
		grammar = ts.NewLanguage(tsgo.Language())
	case "ts":
		grammar = ts.NewLanguage(tsts.LanguageTypescript())
	default:
		grammar = ts.NewLanguage(tsts.LanguageTSX())
	}
	parser := ts.NewParser()
	defer parser.Close()
	if err := parser.SetLanguage(grammar); err != nil {
		r.Failed = true
		return r
	}
	tree := parser.Parse(content, nil)
	if tree == nil {
		r.Failed = true
		return r
	}
	defer tree.Close()
	root := tree.RootNode()
	if root.HasError() {
		r.Failed = true
		return r
	}
	if lang == Go {
		readGo(root, content, &r)
	} else {
		readTS(root, content, &r)
	}
	return r
}

func lineCount(content []byte) int {
	if len(content) == 0 {
		return 0
	}
	n := bytes.Count(content, []byte{'\n'})
	if content[len(content)-1] != '\n' {
		n++
	}
	return n
}

// namedChildren returns the named children of n.
func namedChildren(n *ts.Node) []*ts.Node {
	out := make([]*ts.Node, 0, n.NamedChildCount())
	for i := uint(0); i < n.NamedChildCount(); i++ {
		out = append(out, n.NamedChild(i))
	}
	return out
}

// hasToken reports whether n has an anonymous child token tok, such as the
// `type` of `import type`.
func hasToken(n *ts.Node, tok string) bool {
	for i := uint(0); i < n.ChildCount(); i++ {
		c := n.Child(i)
		if !c.IsNamed() && c.Kind() == tok {
			return true
		}
	}
	return false
}

// walk calls visit on n and every node below it, depth first.
func walk(n *ts.Node, visit func(*ts.Node)) {
	visit(n)
	for i := uint(0); i < n.NamedChildCount(); i++ {
		walk(n.NamedChild(i), visit)
	}
}
