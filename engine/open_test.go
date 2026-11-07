package engine_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/TristanShz/whimc/engine"
)

func TestOpenFailsOutsideAGitRepository(t *testing.T) {
	dir := t.TempDir()

	_, err := engine.Open(context.Background(), dir, engine.Options{})

	if !errors.Is(err, engine.ErrNotARepository) {
		t.Fatalf("Open error = %v, want ErrNotARepository", err)
	}
	if !strings.Contains(err.Error(), dir) || !strings.Contains(err.Error(), "git init") {
		t.Errorf("error %q should name the path and suggest `git init`", err)
	}
}

func TestOpenFailsOnAMissingPath(t *testing.T) {
	dir := t.TempDir() + "/missing"

	_, err := engine.Open(context.Background(), dir, engine.Options{})

	if err == nil || !strings.Contains(err.Error(), dir) {
		t.Fatalf("Open error = %v, want an error naming %s", err, dir)
	}
}

func TestOpenFailsWhenGitIsNotOnPath(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	_, err := engine.Open(context.Background(), t.TempDir(), engine.Options{})

	if !errors.Is(err, engine.ErrGitNotFound) {
		t.Fatalf("Open error = %v, want ErrGitNotFound", err)
	}
	if !strings.Contains(err.Error(), "install git") {
		t.Errorf("error %q should tell how to fix it", err)
	}
}
