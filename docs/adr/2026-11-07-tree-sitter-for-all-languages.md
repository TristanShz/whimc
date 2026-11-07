# Both languages are parsed with tree-sitter through cgo

TypeScript/JavaScript and Go are both parsed with tree-sitter, Go included, although `go/parser` is in the standard library and esbuild ships a fast pure-Go TS parser. We chose one parsing model for every language so that adding a language later is a grammar plus queries, not a new parser integration. The cost is accepted knowingly: cgo means no static cross-compilation, so releases are built on one CI runner per OS and architecture.
