package parse

import (
	"strconv"

	ts "github.com/tree-sitter/go-tree-sitter"
)

func readGo(root *ts.Node, src []byte, r *Result) {
	for _, n := range namedChildren(root) {
		switch n.Kind() {
		case "package_clause":
			r.GoPackage = identifierOf(n, "package_identifier", src)
		case "import_declaration":
			walk(n, func(s *ts.Node) {
				if s.Kind() != "import_spec" {
					return
				}
				p := s.ChildByFieldName("path")
				if p == nil {
					return
				}
				spec, err := strconv.Unquote(p.Utf8Text(src))
				if err != nil {
					return
				}
				imp := Import{Spec: spec, Kind: Runtime}
				if name := s.ChildByFieldName("name"); name != nil {
					imp.Alias = name.Utf8Text(src)
				}
				r.Imports = append(r.Imports, imp)
			})
		case "function_declaration":
			if name := n.ChildByFieldName("name"); name != nil {
				r.Declares = append(r.Declares, name.Utf8Text(src))
			}
		case "type_declaration", "var_declaration", "const_declaration":
			walk(n, func(s *ts.Node) {
				switch s.Kind() {
				case "type_spec", "type_alias", "var_spec", "const_spec":
					for i := uint(0); i < s.NamedChildCount(); i++ {
						if s.FieldNameForNamedChild(uint32(i)) == "name" {
							r.Declares = append(r.Declares, s.NamedChild(i).Utf8Text(src))
						}
					}
				}
			})
		}
	}

	seen := map[Selector]bool{}
	walk(root, func(n *ts.Node) {
		var pkg, sym *ts.Node
		switch n.Kind() {
		case "selector_expression":
			pkg, sym = n.ChildByFieldName("operand"), n.ChildByFieldName("field")
			if pkg == nil || pkg.Kind() != "identifier" {
				return
			}
		case "qualified_type":
			pkg, sym = n.ChildByFieldName("package"), n.ChildByFieldName("name")
		default:
			return
		}
		if pkg == nil || sym == nil {
			return
		}
		s := Selector{Pkg: pkg.Utf8Text(src), Symbol: sym.Utf8Text(src)}
		if !seen[s] {
			seen[s] = true
			r.Selectors = append(r.Selectors, s)
		}
	})
}

// identifierOf returns the text of n's first named child of the given kind.
func identifierOf(n *ts.Node, kind string, src []byte) string {
	for _, c := range namedChildren(n) {
		if c.Kind() == kind {
			return c.Utf8Text(src)
		}
	}
	return ""
}
