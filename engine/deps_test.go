package engine_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/TristanShz/whimc/engine"
	"github.com/TristanShz/whimc/internal/testrepo"
)

// depsOf returns the Dependencies of a level as one line per Dependency:
// "<from> -> <to> <kind> weight=<n>", plus the per-kind counts when the
// Dependency aggregates more than one kind.
func depsOf(t *testing.T, ws engine.Workspace, at engine.State, q engine.MapQuery) []string {
	t.Helper()
	view, err := ws.Map(context.Background(), at, q)
	if err != nil {
		t.Fatalf("Map(%+v, %+v): %v", at, q, err)
	}
	lines := []string{}
	for _, d := range view.Dependencies {
		line := fmt.Sprintf("%s -> %s %s weight=%d", d.From, d.To, d.Kind, d.Weight)
		c := d.Counts
		if c.Runtime+c.TypeOnly+c.Dynamic != d.Weight {
			t.Errorf("%s: counts %+v do not add up to weight %d", line, c, d.Weight)
		}
		if (c.Runtime > 0 && c.Runtime != d.Weight) || (c.TypeOnly > 0 && c.TypeOnly != d.Weight) {
			line += fmt.Sprintf(" (runtime=%d type-only=%d dynamic=%d)", c.Runtime, c.TypeOnly, c.Dynamic)
		}
		lines = append(lines, line)
	}
	return lines
}

var fileLevel = engine.MapQuery{Level: engine.Files}

func TestRelativeImportsResolveToTheImportedFile(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":     `{"name": "app"}`,
		"src/main.ts":      "import { cart } from './cart'\nimport { total } from '../lib/total.js'\nimport { ui } from './ui'\ncart(); total(); ui()\n",
		"src/cart.ts":      "export function cart() {}\n",
		"lib/total.ts":     "export const total = () => 0\n",
		"src/ui/index.tsx": "export function ui() { return <div /> }\n",
		"src/unrelated.ts": "import { missing } from './nowhere'\nimport React from 'react'\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, fileLevel),
		"file:src/main.ts -> file:lib/total.ts runtime weight=1",
		"file:src/main.ts -> file:src/cart.ts runtime weight=1",
		"file:src/main.ts -> file:src/ui/index.tsx runtime weight=1",
	)
}

func TestTsconfigPathsAndBaseURLResolvePerPackage(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json": `{"name": "root", "private": true}`,
		"tsconfig.base.json": `{
			// shared options, JSON with comments
			"compilerOptions": {
				"baseUrl": ".",
				"paths": { "@shared/*": ["libs/shared/*"], },
			},
		}`,
		"libs/shared/log.ts":           "export const log = 1\n",
		"apps/web/package.json":        `{"name": "web"}`,
		"apps/web/tsconfig.json":       `{"extends": "../../tsconfig.base.json", "compilerOptions": {"baseUrl": "src", "paths": {"@/*": ["./*"], "#config": ["config/index.ts"]}}}`,
		"apps/web/src/main.ts":         "import { a } from '@/feature/a'\nimport cfg from '#config'\nimport { b } from 'feature/b'\n",
		"apps/web/src/feature/a.ts":    "export const a = 1\n",
		"apps/web/src/feature/b.ts":    "export const b = 1\n",
		"apps/web/src/config/index.ts": "export default {}\n",
		"apps/api/package.json":        `{"name": "api"}`,
		"apps/api/tsconfig.json":       `{"extends": "../../tsconfig.base.json"}`,
		"apps/api/server.ts":           "import { log } from '@shared/log'\nimport { a } from '@/feature/a'\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, fileLevel),
		"file:apps/api/server.ts -> file:libs/shared/log.ts runtime weight=1",
		"file:apps/web/src/main.ts -> file:apps/web/src/config/index.ts runtime weight=1",
		"file:apps/web/src/main.ts -> file:apps/web/src/feature/a.ts runtime weight=1",
		"file:apps/web/src/main.ts -> file:apps/web/src/feature/b.ts runtime weight=1",
	)
}

func TestWorkspacePackagesResolveByNameThroughTheirEntryPoint(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json": `{"name": "monorepo", "private": true, "workspaces": ["packages/*"]}`,
		// exports with conditions and a subpath
		"packages/ui/package.json":        `{"name": "@acme/ui", "exports": {".": {"types": "./src/main.ts", "import": "./dist/main.js"}, "./button": "./src/button/index.ts"}}`,
		"packages/ui/src/main.ts":         "export const ui = 1\n",
		"packages/ui/src/button/index.ts": "export const button = 1\n",
		// main pointing at a build output: falls back to src/index
		"packages/core/package.json":  `{"name": "@acme/core", "main": "dist/index.js"}`,
		"packages/core/src/index.ts":  "export const core = 1\n",
		"packages/core/src/deep/x.ts": "export const x = 1\n",
		// types field
		"packages/types/package.json":   `{"name": "acme-types", "types": "lib/types.d.ts"}`,
		"packages/types/lib/types.d.ts": "export interface T {}\n",
		"apps/web/package.json":         `{"name": "web", "dependencies": {"@acme/ui": "workspace:*"}}`,
		"apps/web/app.ts": "import { ui } from '@acme/ui'\nimport { button } from '@acme/ui/button'\n" +
			"import { core } from '@acme/core'\nimport { x } from '@acme/core/src/deep/x'\nimport type { T } from 'acme-types'\nimport lodash from 'lodash'\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, fileLevel),
		"file:apps/web/app.ts -> file:packages/core/src/deep/x.ts runtime weight=1",
		"file:apps/web/app.ts -> file:packages/core/src/index.ts runtime weight=1",
		"file:apps/web/app.ts -> file:packages/types/lib/types.d.ts type-only weight=1",
		"file:apps/web/app.ts -> file:packages/ui/src/button/index.ts runtime weight=1",
		"file:apps/web/app.ts -> file:packages/ui/src/main.ts runtime weight=1",
	)
}

func TestDependenciesGoThroughBarrelsToTheDefiningFile(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json": `{"name": "app"}`,
		// a Barrel of named re-exports, one of them renamed, one through an import binding
		"src/ui/index.ts":  "export { Button } from './button'\nexport { Input as TextInput } from './input'\nimport { Card } from './card'\nexport { Card }\n",
		"src/ui/button.ts": "export function Button() {}\n",
		"src/ui/input.ts":  "export const Input = 1\n",
		"src/ui/card.ts":   "export class Card {}\n",
		// a Barrel of `export *`, nested in another one
		"src/lib/index.ts":         "export * from './math'\nexport * from './strings'\n",
		"src/lib/math.ts":          "export const add = 1\nexport default 0\n",
		"src/lib/strings/index.ts": "export * from './upper'\n",
		"src/lib/strings/upper.ts": "export function upper() {}\n",
		// a namespace import of a Barrel depends on everything it re-exports
		"src/all.ts":  "import * as lib from './lib'\n",
		"src/main.ts": "import { Button, TextInput, Card } from './ui'\nimport { upper, add } from './lib'\nimport { nothing } from './lib'\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, fileLevel),
		"file:src/all.ts -> file:src/lib/math.ts runtime weight=1",
		"file:src/all.ts -> file:src/lib/strings/upper.ts runtime weight=1",
		"file:src/lib/index.ts -> file:src/lib/math.ts runtime weight=1",
		"file:src/lib/index.ts -> file:src/lib/strings/upper.ts runtime weight=1",
		"file:src/lib/strings/index.ts -> file:src/lib/strings/upper.ts runtime weight=1",
		"file:src/main.ts -> file:src/lib/index.ts runtime weight=1",
		"file:src/main.ts -> file:src/lib/math.ts runtime weight=1",
		"file:src/main.ts -> file:src/lib/strings/upper.ts runtime weight=1",
		"file:src/main.ts -> file:src/ui/button.ts runtime weight=1",
		"file:src/main.ts -> file:src/ui/card.ts runtime weight=1",
		"file:src/main.ts -> file:src/ui/input.ts runtime weight=1",
		"file:src/ui/index.ts -> file:src/ui/button.ts runtime weight=1",
		"file:src/ui/index.ts -> file:src/ui/card.ts runtime weight=1",
		"file:src/ui/index.ts -> file:src/ui/input.ts runtime weight=1",
	)
}

func TestImportKindsTypeOnlyDynamicAndRequire(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":   `{"name": "app"}`,
		"src/types.ts":   "export interface User {}\nexport type Id = string\n",
		"src/both.ts":    "export interface Shape {}\nexport const make = 1\n",
		"src/lazy.ts":    "export default function lazy() {}\n",
		"src/legacy.cjs": "module.exports = {}\n",
		"src/mixed.ts":   "export type Mixed = 1\nexport const m = 1\n",
		"src/main.ts": "import type { User } from './types'\nimport { type Id } from './types'\n" +
			"import { type Shape } from './both'\nimport { make } from './both'\n" +
			"const lazy = () => import('./lazy')\nconst legacy = require('./legacy.cjs')\n" +
			"import { type Mixed, m } from './mixed'\n",
		"src/barrel.ts": "export type { User } from './types'\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, fileLevel),
		"file:src/barrel.ts -> file:src/types.ts type-only weight=1",
		"file:src/main.ts -> file:src/both.ts runtime weight=1",
		"file:src/main.ts -> file:src/lazy.ts dynamic weight=1",
		"file:src/main.ts -> file:src/legacy.cjs runtime weight=1",
		"file:src/main.ts -> file:src/mixed.ts runtime weight=1",
		"file:src/main.ts -> file:src/types.ts type-only weight=1",
	)
}

func TestJavaScriptFlavoursAreAnalysedLikeTypeScript(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"package.json":   `{"name": "app"}`,
		"src/main.js":    "import { view } from './view.jsx'\nimport { esm } from './esm.mjs'\nconst cjs = require('./common')\n",
		"src/view.jsx":   "export function view() { return <p>hi</p> }\n",
		"src/esm.mjs":    "export const esm = 1\n",
		"src/common.cjs": "const util = require('./util')\nmodule.exports = { util }\n",
		"src/util.js":    "exports.util = 1\n",
		"src/app.tsx":    "import { view } from './view'\nexport const App = () => <main>{view()}</main>\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, fileLevel),
		"file:src/app.tsx -> file:src/view.jsx runtime weight=1",
		"file:src/common.cjs -> file:src/util.js runtime weight=1",
		"file:src/main.js -> file:src/common.cjs runtime weight=1",
		"file:src/main.js -> file:src/esm.mjs runtime weight=1",
		"file:src/main.js -> file:src/view.jsx runtime weight=1",
	)
}

func TestGoSelectorsResolveToTheFileDeclaringTheSymbol(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"go.mod":                     "module example.com/shop\n\ngo 1.26\n",
		"main.go":                    "package main\n\nimport (\n\t\"fmt\"\n\n\t\"example.com/shop/cart\"\n\tpay \"example.com/shop/internal/payment\"\n)\n\nfunc main() {\n\tc := cart.New()\n\tfmt.Println(c.Total(), pay.Charge)\n}\n",
		"cart/new.go":                "package cart\n\nfunc New() *Cart { return &Cart{} }\n",
		"cart/cart.go":               "package cart\n\ntype Cart struct{ items []Item }\n\nfunc (c *Cart) Total() int { return 0 }\n",
		"cart/item.go":               "package cart\n\nimport \"example.com/shop/internal/payment\"\n\ntype Item struct{ price payment.Amount }\n",
		"cart/unused.go":             "package cart\n\nconst Unused = 1\n",
		"internal/payment/charge.go": "package payment\n\nvar Charge, Refund = 1, 2\n",
		"internal/payment/amount.go": "package payment\n\ntype (\n\tAmount int\n\tCurrency = string\n)\n",
		// a package whose name differs from its folder, imported without alias
		"internal/v2api/api.go": "package api\n\nfunc Serve() {}\n",
		"server.go":             "package main\n\nimport \"example.com/shop/internal/v2api\"\n\nfunc serve() { api.Serve() }\n",
		// test Files are no target: their symbols are not importable
		"cart/cart_test.go": "package cart\n\nfunc Helper() {}\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, fileLevel),
		"file:cart/item.go -> file:internal/payment/amount.go runtime weight=1",
		"file:main.go -> file:cart/new.go runtime weight=1",
		"file:main.go -> file:internal/payment/charge.go runtime weight=1",
		"file:server.go -> file:internal/v2api/api.go runtime weight=1",
	)
}

func TestFilesThatDoNotParseKeepTheirSizeWithoutDependencies(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"go.mod":           "module example.com/m\n\ngo 1.26\n",
		"util/util.go":     "package util\n\nfunc Do() {}\n",
		"broken.go":        "package main\n\nimport \"example.com/m/util\"\n\nfunc main() {\n\tutil.Do(\n}\n",
		"ok.go":            "package main\n\nimport \"example.com/m/util\"\n\nfunc ok() { util.Do() }\n",
		"web/package.json": `{"name": "web"}`,
		"web/lib.ts":       "export const lib = 1\n",
		"web/broken.ts":    "import { lib } from './lib'\nexport const x = {\n",
		"web/main.ts":      "import { lib } from './lib'\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, fileLevel),
		"file:ok.go -> file:util/util.go runtime weight=1",
		"file:web/main.ts -> file:web/lib.ts runtime weight=1",
	)
	sizes := map[string]int{}
	for _, line := range mapOf(t, ws, worktree, fileLevel) {
		var id string
		var size int
		fields := strings.Fields(line)
		id = fields[0]
		fmt.Sscanf(fields[3], "size=%d", &size)
		sizes[id] = size
	}
	if sizes["file:broken.go"] != 5 || sizes["file:web/broken.ts"] != 2 {
		t.Errorf("broken Files sizes = %d, %d; want 5, 2", sizes["file:broken.go"], sizes["file:web/broken.ts"])
	}
}

func TestDependenciesAggregateToDirectoriesAndPackages(t *testing.T) {
	r := testrepo.New(t)
	r.WriteFiles(map[string]string{
		"apps/web/package.json":       `{"name": "web"}`,
		"apps/web/pages/home.ts":      "import { button } from '@acme/ui'\nimport type { Theme } from '@acme/ui/theme'\nimport { api } from '../api/client'\n",
		"apps/web/pages/about.ts":     "import { button } from '@acme/ui'\nconst lazy = import('@acme/ui/modal')\nimport { home } from './home'\n",
		"apps/web/api/client.ts":      "import type { Theme } from '@acme/ui/theme'\nexport const api = 1\n",
		"apps/web/pages/home.test.ts": "import { button } from '@acme/ui'\nimport { api } from '../api/client'\n",
		"packages/ui/package.json":    `{"name": "@acme/ui"}`,
		"packages/ui/src/index.ts":    "export { button } from './button'\n",
		"packages/ui/src/button.ts":   "import type { Theme } from './theme'\nexport const button = 1\n",
		"packages/ui/src/theme.ts":    "export interface Theme {}\n",
		"packages/ui/src/modal.ts":    "export const modal = 1\n",
	})
	ws := open(t, r)
	assertLines(t, depsOf(t, ws, worktree, engine.MapQuery{Level: engine.Directories}),
		"dir:apps/web/api -> dir:packages/ui/src type-only weight=1",
		"dir:apps/web/pages -> dir:apps/web/api runtime weight=1",
		"dir:apps/web/pages -> dir:packages/ui/src runtime weight=4 (runtime=2 type-only=1 dynamic=1)",
	)
	assertLines(t, depsOf(t, ws, worktree, engine.MapQuery{Level: engine.Packages}),
		"pkg:apps/web -> pkg:packages/ui runtime weight=5 (runtime=2 type-only=2 dynamic=1)",
	)
	// test Files count when shown
	assertLines(t, depsOf(t, ws, worktree, engine.MapQuery{Level: engine.Packages, Tests: true}),
		"pkg:apps/web -> pkg:packages/ui runtime weight=6 (runtime=3 type-only=2 dynamic=1)",
	)
	// Within keeps the Dependencies between the Modules in view
	assertLines(t, depsOf(t, ws, worktree, engine.MapQuery{Level: engine.Directories, Within: "pkg:apps/web"}),
		"dir:apps/web/pages -> dir:apps/web/api runtime weight=1",
	)
}
