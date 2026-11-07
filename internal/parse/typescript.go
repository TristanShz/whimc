package parse

import (
	ts "github.com/tree-sitter/go-tree-sitter"
)

// binding is a local name an import statement introduces.
type binding struct {
	spec, name string
	typeOnly   bool
}

func readTS(root *ts.Node, src []byte, r *Result) {
	bindings := map[string]binding{}
	declared := map[string]bool{}
	declare := func(name string) {
		if name != "" && !declared[name] {
			declared[name] = true
			r.Declares = append(r.Declares, name)
		}
	}
	type localExport struct{ name, alias string }
	var localExports []localExport

	for _, n := range namedChildren(root) {
		switch n.Kind() {
		case "import_statement":
			readTSImport(n, src, r, bindings)
		case "export_statement":
			stmtType := hasToken(n, "type")
			if source := n.ChildByFieldName("source"); source != nil {
				spec := stringValue(source, src)
				exported := false
				for _, c := range namedChildren(n) {
					switch c.Kind() {
					case "export_clause":
						exported = true
						for _, s := range namedChildren(c) {
							if s.Kind() != "export_specifier" {
								continue
							}
							name, alias := specifierNames(s, src)
							r.ReExports = append(r.ReExports, ReExport{
								Spec: spec, Name: alias, From: name, TypeOnly: stmtType || hasToken(s, "type"),
							})
						}
					case "namespace_export":
						exported = true
						r.ReExports = append(r.ReExports, ReExport{
							Spec: spec, Name: identifierText(c, src), From: Whole, TypeOnly: stmtType,
						})
					}
				}
				if !exported {
					r.ReExports = append(r.ReExports, ReExport{Spec: spec, Star: true, TypeOnly: stmtType})
				}
				continue
			}
			if hasToken(n, "default") {
				declare("default")
			}
			if decl := n.ChildByFieldName("declaration"); decl != nil {
				for _, name := range declarationNames(decl, src) {
					declare(name)
				}
			}
			for _, c := range namedChildren(n) {
				if c.Kind() != "export_clause" {
					continue
				}
				for _, s := range namedChildren(c) {
					if s.Kind() == "export_specifier" {
						name, alias := specifierNames(s, src)
						localExports = append(localExports, localExport{name, alias})
					}
				}
			}
		}
	}
	// `export { x }` re-exports x when x is an imported binding, and declares
	// it otherwise.
	for _, e := range localExports {
		if b, ok := bindings[e.name]; ok {
			r.ReExports = append(r.ReExports, ReExport{Spec: b.spec, Name: e.alias, From: b.name, TypeOnly: b.typeOnly})
		} else {
			declare(e.alias)
		}
	}

	walk(root, func(n *ts.Node) {
		if n.Kind() != "call_expression" {
			return
		}
		fn := n.ChildByFieldName("function")
		args := n.ChildByFieldName("arguments")
		if fn == nil || args == nil || args.NamedChildCount() == 0 {
			return
		}
		first := args.NamedChild(0)
		if first.Kind() != "string" {
			return
		}
		switch {
		case fn.Kind() == "import":
			r.Imports = append(r.Imports, Import{Spec: stringValue(first, src), Kind: Dynamic, Names: []string{Whole}})
		case fn.Kind() == "identifier" && fn.Utf8Text(src) == "require":
			r.Imports = append(r.Imports, Import{Spec: stringValue(first, src), Kind: Runtime, Names: []string{Whole}})
		}
	})
}

// readTSImport reads an import statement: one Import per kind it carries, as
// `import { type A, B }` imports A as a type and B at runtime.
func readTSImport(n *ts.Node, src []byte, r *Result, bindings map[string]binding) {
	stmtType := hasToken(n, "type")
	var spec string
	if source := n.ChildByFieldName("source"); source != nil {
		spec = stringValue(source, src)
	}
	var runtime, types []string
	add := func(name, local string, typeOnly bool) {
		if typeOnly {
			types = append(types, name)
		} else {
			runtime = append(runtime, name)
		}
		if local != "" {
			bindings[local] = binding{spec: spec, name: name, typeOnly: typeOnly}
		}
	}
	clauses := 0
	for _, c := range namedChildren(n) {
		switch c.Kind() {
		case "import_clause":
			clauses++
			for _, part := range namedChildren(c) {
				switch part.Kind() {
				case "identifier":
					add("default", part.Utf8Text(src), stmtType)
				case "namespace_import":
					add(Whole, identifierText(part, src), stmtType)
				case "named_imports":
					for _, s := range namedChildren(part) {
						if s.Kind() != "import_specifier" {
							continue
						}
						name, alias := specifierNames(s, src)
						add(name, alias, stmtType || hasToken(s, "type"))
					}
				}
			}
		case "import_require_clause": // import x = require('y')
			clauses++
			if source := c.ChildByFieldName("source"); source != nil {
				spec = stringValue(source, src)
			}
			add(Whole, "", stmtType)
		}
	}
	if spec == "" {
		return
	}
	if clauses == 0 { // import 'side-effect'
		add(Whole, "", false)
	}
	if len(runtime) > 0 {
		r.Imports = append(r.Imports, Import{Spec: spec, Kind: Runtime, Names: runtime})
	}
	if len(types) > 0 {
		r.Imports = append(r.Imports, Import{Spec: spec, Kind: TypeOnly, Names: types})
	}
}

// specifierNames returns the name and the alias (the name itself when there
// is none) of an import or export specifier.
func specifierNames(s *ts.Node, src []byte) (name, alias string) {
	if n := s.ChildByFieldName("name"); n != nil {
		name = moduleExportName(n, src)
	}
	alias = name
	if a := s.ChildByFieldName("alias"); a != nil {
		alias = moduleExportName(a, src)
	}
	return name, alias
}

// moduleExportName reads an identifier, or a string used as an export name.
func moduleExportName(n *ts.Node, src []byte) string {
	if n.Kind() == "string" {
		return stringValue(n, src)
	}
	return n.Utf8Text(src)
}

// identifierText returns the text of n's first identifier child.
func identifierText(n *ts.Node, src []byte) string {
	for _, c := range namedChildren(n) {
		if c.Kind() == "identifier" {
			return c.Utf8Text(src)
		}
	}
	return ""
}

// stringValue returns the value of a string literal node.
func stringValue(n *ts.Node, src []byte) string {
	text := n.Utf8Text(src)
	if len(text) >= 2 {
		return text[1 : len(text)-1]
	}
	return ""
}

// declarationNames returns the names a declaration binds at top level.
func declarationNames(decl *ts.Node, src []byte) []string {
	switch decl.Kind() {
	case "lexical_declaration", "variable_declaration":
		var names []string
		for _, d := range namedChildren(decl) {
			if d.Kind() != "variable_declarator" {
				continue
			}
			if name := d.ChildByFieldName("name"); name != nil {
				walk(name, func(n *ts.Node) {
					switch n.Kind() {
					case "identifier", "shorthand_property_identifier_pattern":
						names = append(names, n.Utf8Text(src))
					}
				})
			}
		}
		return names
	case "ambient_declaration":
		var names []string
		for _, c := range namedChildren(decl) {
			names = append(names, declarationNames(c, src)...)
		}
		return names
	}
	if name := decl.ChildByFieldName("name"); name != nil {
		return []string{moduleExportName(name, src)}
	}
	return nil
}
