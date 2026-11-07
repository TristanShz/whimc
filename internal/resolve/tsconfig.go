package resolve

import (
	"encoding/json"
	"path"
	"sort"
	"strings"
)

// tsconfig is the part of a tsconfig that drives resolution, with `extends`
// applied and every folder made repository-relative.
type tsconfig struct {
	// baseURL is the folder non-relative specifiers resolve from; empty when
	// the config sets none.
	baseURL string
	// paths maps specifier patterns to targets, relative to baseURL when
	// set, to pathsDir (the folder of the config declaring paths) otherwise.
	paths    map[string][]string
	pathsDir string
}

// maxExtends bounds the `extends` chain, cycles included.
const maxExtends = 8

// configFor returns the tsconfig governing a File: the nearest
// `tsconfig.json` (or `jsconfig.json`) in its folder or above.
func (r *resolver) configFor(file string) *tsconfig {
	dir := path.Dir(file)
	for {
		if c, ok := r.configs[dir]; ok {
			return c
		}
		var c *tsconfig
		for _, name := range []string{"tsconfig.json", "jsconfig.json"} {
			if p := path.Join(dir, name); r.s.Configs[p] != nil {
				c = r.loadConfig(p, 0)
				break
			}
		}
		if c != nil || dir == "." {
			r.configs[path.Dir(file)] = c
			return c
		}
		dir = path.Dir(dir)
	}
}

// loadConfig reads the tsconfig at p, following `extends`. A missing or
// unreadable config is nil.
func (r *resolver) loadConfig(p string, depth int) *tsconfig {
	content, ok := r.s.Configs[p]
	if !ok || depth > maxExtends {
		return nil
	}
	var raw struct {
		Extends         json.RawMessage `json:"extends"`
		CompilerOptions struct {
			BaseURL *string             `json:"baseUrl"`
			Paths   map[string][]string `json:"paths"`
		} `json:"compilerOptions"`
	}
	if json.Unmarshal(stripJSONC(content), &raw) != nil {
		return nil
	}
	c := &tsconfig{}
	var parents []string
	if len(raw.Extends) > 0 {
		var one string
		if json.Unmarshal(raw.Extends, &one) == nil {
			parents = []string{one}
		} else {
			_ = json.Unmarshal(raw.Extends, &parents)
		}
	}
	dir := path.Dir(p)
	for _, ext := range parents { // later entries override earlier ones
		if parent := r.loadConfig(r.extendsPath(dir, ext), depth+1); parent != nil {
			if parent.baseURL != "" {
				c.baseURL = parent.baseURL
			}
			if parent.paths != nil {
				c.paths, c.pathsDir = parent.paths, parent.pathsDir
			}
		}
	}
	if raw.CompilerOptions.BaseURL != nil {
		if base, ok := joinRepo(dir, *raw.CompilerOptions.BaseURL); ok {
			c.baseURL = base
		}
	}
	if raw.CompilerOptions.Paths != nil {
		c.paths, c.pathsDir = raw.CompilerOptions.Paths, dir
	}
	return c
}

// extendsPath returns the repository path of an `extends` entry. Only
// relative entries are followed; a package name (`@tsconfig/node20`) names a
// config outside the repository.
func (r *resolver) extendsPath(dir, ext string) string {
	if !isRelative(ext) {
		return ""
	}
	p, ok := joinRepo(dir, ext)
	if !ok {
		return ""
	}
	if _, ok := r.s.Configs[p]; ok {
		return p
	}
	if _, ok := r.s.Configs[p+".json"]; ok {
		return p + ".json"
	}
	return path.Join(p, "tsconfig.json")
}

// candidates returns the paths a non-relative specifier may stand for under
// c: the `paths` substitutions of the best matching pattern, then baseUrl.
func (c *tsconfig) candidates(spec string) []string {
	var out []string
	if pattern, star, ok := c.match(spec); ok {
		base := c.baseURL
		if base == "" {
			base = c.pathsDir
		}
		for _, target := range c.paths[pattern] {
			if p, ok := joinRepo(base, strings.Replace(target, "*", star, 1)); ok {
				out = append(out, p)
			}
		}
	}
	if c.baseURL != "" {
		if p, ok := joinRepo(c.baseURL, spec); ok {
			out = append(out, p)
		}
	}
	return out
}

// match returns the `paths` pattern matching spec, preferring an exact
// pattern, then the wildcard pattern with the longest prefix, and the text
// the wildcard stands for.
func (c *tsconfig) match(spec string) (pattern, star string, ok bool) {
	if _, exact := c.paths[spec]; exact {
		return spec, "", true
	}
	patterns := make([]string, 0, len(c.paths))
	for p := range c.paths {
		patterns = append(patterns, p)
	}
	sort.Strings(patterns)
	best := -1
	for _, p := range patterns {
		prefix, suffix, wild := strings.Cut(p, "*")
		if !wild || !strings.HasPrefix(spec, prefix) || !strings.HasSuffix(spec, suffix) ||
			len(spec) < len(prefix)+len(suffix) {
			continue
		}
		if len(prefix) > best {
			best, pattern = len(prefix), p
			star = spec[len(prefix) : len(spec)-len(suffix)]
		}
	}
	return pattern, star, best >= 0
}

// stripJSONC turns JSON with comments and trailing commas, as tsconfig
// Files allow, into JSON.
func stripJSONC(in []byte) []byte {
	out := make([]byte, 0, len(in))
	for i := 0; i < len(in); i++ {
		c := in[i]
		switch {
		case c == '"':
			start := i
			for i++; i < len(in) && in[i] != '"'; i++ {
				if in[i] == '\\' {
					i++
				}
			}
			end := min(i+1, len(in))
			out = append(out, in[start:end]...)
		case c == '/' && i+1 < len(in) && in[i+1] == '/':
			for i < len(in) && in[i] != '\n' {
				i++
			}
			out = append(out, '\n')
		case c == '/' && i+1 < len(in) && in[i+1] == '*':
			i += 2
			for i+1 < len(in) && (in[i] != '*' || in[i+1] != '/') {
				i++
			}
			i++
		case c == '}' || c == ']':
			// drop a trailing comma before the closing bracket
			j := len(out) - 1
			for j >= 0 && (out[j] == ' ' || out[j] == '\t' || out[j] == '\n' || out[j] == '\r') {
				j--
			}
			if j >= 0 && out[j] == ',' {
				out = append(out[:j], out[j+1:]...)
			}
			out = append(out, c)
		default:
			out = append(out, c)
		}
	}
	return out
}
