# Build and check whimc. The web UI (web/, added with `whimc serve`) is built
# first when it exists, so that go:embed picks up its dist/.

.PHONY: build web test vet golden

build: web
	go build ./cmd/whimc

web:
	@if [ -f web/package.json ]; then pnpm -C web install --frozen-lockfile && pnpm -C web build; fi

test:
	go test ./...

vet:
	go vet ./...

# golden rewrites the golden files of the command-line tests.
golden:
	go test ./cmd/whimc -run Golden -update
