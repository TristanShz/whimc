package modules

import (
	"bufio"
	"bytes"
	"encoding/json"
	"path"
	"regexp"
	"strings"
)

// Kind is what a path of the State is to the Map.
type Kind int

const (
	// Ignored paths play no part in the Map.
	Ignored Kind = iota
	// ManifestFile declares a Package (`package.json`, `go.mod`).
	ManifestFile
	// SourceFile is a File of a supported language.
	SourceFile
	// ConfigFile configures how imports resolve: `tsconfig*.json` and
	// `jsconfig*.json`.
	ConfigFile
)

var supportedExtensions = map[string]bool{
	".ts": true, ".tsx": true, ".mts": true, ".cts": true,
	".js": true, ".jsx": true, ".mjs": true, ".cjs": true,
	".go": true,
}

// excludedSegments mark vendored and build-output folders, anywhere in a path.
var excludedSegments = map[string]bool{
	"node_modules": true, "vendor": true, "dist": true, "build": true,
}

// Classify tells what a repository-relative slash path is to the Map, from
// the path alone. Files under vendored or build-output folders are Ignored.
func Classify(p string) Kind {
	segments := strings.Split(p, "/")
	for _, s := range segments[:len(segments)-1] {
		if excludedSegments[s] {
			return Ignored
		}
	}
	base := segments[len(segments)-1]
	if base == "package.json" || base == "go.mod" {
		return ManifestFile
	}
	if (strings.HasPrefix(base, "tsconfig") || strings.HasPrefix(base, "jsconfig")) && path.Ext(base) == ".json" {
		return ConfigFile
	}
	if supportedExtensions[path.Ext(base)] {
		return SourceFile
	}
	return Ignored
}

// IsTest reports whether a source File is a test File: `*.test.*`,
// `*.spec.*`, `*_test.go`, or anything under a `__tests__` folder.
func IsTest(p string) bool {
	base := path.Base(p)
	if strings.HasSuffix(base, "_test.go") || strings.Contains(base, ".test.") || strings.Contains(base, ".spec.") {
		return true
	}
	return strings.HasPrefix(p, "__tests__/") || strings.Contains(p, "/__tests__/")
}

// generatedHeaderLines is how many leading lines may carry the generated marker.
const generatedHeaderLines = 20

var generatedMarker = regexp.MustCompile(`Code generated .* DO NOT EDIT`)

// Facts are what the Map needs from a source File's content.
type Facts struct {
	// Size is the number of non-blank lines, comments included.
	Size int
	// Generated is set when a leading line carries a `Code generated … DO NOT
	// EDIT` marker; such Files are left out of the Map.
	Generated bool
}

// Analyze reads the Facts of a source File.
func Analyze(content []byte) Facts {
	var f Facts
	sc := bufio.NewScanner(bytes.NewReader(content))
	sc.Buffer(make([]byte, 0, 64*1024), len(content)+1)
	for line := 0; sc.Scan(); line++ {
		text := sc.Bytes()
		if line < generatedHeaderLines && generatedMarker.Match(text) {
			f.Generated = true
		}
		if len(bytes.TrimSpace(text)) > 0 {
			f.Size++
		}
	}
	return f
}

// ManifestName reads the Package name a manifest declares: the `name` of a
// `package.json`, the module path of a `go.mod`. It is empty when the
// manifest declares none or cannot be read.
func ManifestName(p string, content []byte) string {
	switch path.Base(p) {
	case "package.json":
		var pj struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(content, &pj) != nil {
			return ""
		}
		return pj.Name
	case "go.mod":
		sc := bufio.NewScanner(bytes.NewReader(content))
		for sc.Scan() {
			fields := strings.Fields(sc.Text())
			if len(fields) >= 2 && fields[0] == "module" {
				return strings.Trim(fields[1], `"`)
			}
		}
	}
	return ""
}
