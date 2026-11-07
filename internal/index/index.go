// Package index is whimc's persistent memory of a repository: a SQLite
// database in the user cache holding what was learnt about each blob (its
// Size, whether it is generated, its parse result), the paths each commit
// touched (for Churn), and the frozen layout of the Map. Blobs and commits
// are immutable, so their rows never go stale; any State of the repository
// only computes what the index has never seen.
package index

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/TristanShz/whimc/internal/gitrepo"
	"github.com/TristanShz/whimc/internal/parse"

	_ "modernc.org/sqlite" // the pure-Go SQLite driver
)

// schemaVersion is bumped whenever a table changes or what is stored under a
// key changes meaning (a parser that extracts more, a new Size rule): an index
// of another version is dropped and rebuilt.
const schemaVersion = 1

const schema = `
CREATE TABLE blobs (
	blob      TEXT    NOT NULL,
	grammar   TEXT    NOT NULL,
	size      INTEGER NOT NULL,
	generated INTEGER NOT NULL,
	parse     BLOB,
	PRIMARY KEY (blob, grammar)
) WITHOUT ROWID;
CREATE TABLE commits (
	hash    TEXT PRIMARY KEY,
	changes BLOB NOT NULL
) WITHOUT ROWID;
CREATE TABLE layout (
	module TEXT PRIMARY KEY,
	x      REAL NOT NULL,
	y      REAL NOT NULL
) WITHOUT ROWID;
`

// Dir returns the directory holding the index of the repository whose git
// common directory is commonDir, under cacheDir: every worktree of a
// repository shares its common directory, so they share one index.
func Dir(cacheDir, commonDir string) string {
	sum := sha256.Sum256([]byte(commonDir))
	return filepath.Join(cacheDir, hex.EncodeToString(sum[:]))
}

// DefaultCacheDir is where indexes go by default: whimc's folder in the user
// cache directory.
func DefaultCacheDir() (string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("no user cache directory for the index: %w", err)
	}
	return filepath.Join(dir, "whimc"), nil
}

// Index is an open index database. It is safe for concurrent use, also by
// several processes.
type Index struct{ db *sql.DB }

// Open opens the index in dir, creating it when needed.
func Open(dir string) (*Index, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create the index directory: %w", err)
	}
	dsn := "file:" + filepath.ToSlash(filepath.Join(dir, "index.db")) +
		"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open the index: %w", err)
	}
	ix := &Index{db: db}
	if err := ix.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("open the index in %s: %w", dir, err)
	}
	return ix, nil
}

func (ix *Index) migrate() error {
	tx, err := ix.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version int
	if err := tx.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version == schemaVersion {
		return nil
	}
	for _, table := range []string{"blobs", "commits", "layout"} {
		if _, err := tx.Exec("DROP TABLE IF EXISTS " + table); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(schema); err != nil {
		return err
	}
	if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
		return err
	}
	return tx.Commit()
}

// Close closes the database.
func (ix *Index) Close() error { return ix.db.Close() }

// BlobKey identifies what is known of a blob read as one grammar: the same
// content parses differently as TS and as TSX.
type BlobKey struct {
	Blob    string
	Grammar string
}

// Blob is what the index knows of a source File's blob.
type Blob struct {
	Size      int
	Generated bool
	// Parse is the parse result; nil for a generated File, never parsed.
	Parse *parse.Result
}

// Blobs returns what the index knows of keys; unknown keys are absent.
func (ix *Index) Blobs(keys []BlobKey) (map[BlobKey]Blob, error) {
	found := make(map[BlobKey]Blob, len(keys))
	if len(keys) == 0 {
		return found, nil
	}
	tx, err := ix.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare("SELECT size, generated, parse FROM blobs WHERE blob = ? AND grammar = ?")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()
	for _, k := range keys {
		var b Blob
		var raw []byte
		err := stmt.QueryRow(k.Blob, k.Grammar).Scan(&b.Size, &b.Generated, &raw)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if raw != nil {
			b.Parse = new(parse.Result)
			if err := json.Unmarshal(raw, b.Parse); err != nil {
				continue // unreadable: computed again
			}
		}
		found[k] = b
	}
	return found, nil
}

// PutBlobs stores what was learnt of blobs.
func (ix *Index) PutBlobs(blobs map[BlobKey]Blob) error {
	if len(blobs) == 0 {
		return nil
	}
	return ix.write("INSERT OR REPLACE INTO blobs (blob, grammar, size, generated, parse) VALUES (?, ?, ?, ?, ?)",
		func(stmt *sql.Stmt) error {
			for k, b := range blobs {
				var raw []byte
				if b.Parse != nil {
					var err error
					if raw, err = json.Marshal(b.Parse); err != nil {
						return err
					}
				}
				if _, err := stmt.Exec(k.Blob, k.Grammar, b.Size, b.Generated, raw); err != nil {
					return err
				}
			}
			return nil
		})
}

// Commits returns the paths each of hashes touched, for the commits the index
// knows.
func (ix *Index) Commits(hashes []string) (map[string][]gitrepo.Change, error) {
	found := make(map[string][]gitrepo.Change, len(hashes))
	if len(hashes) == 0 {
		return found, nil
	}
	tx, err := ix.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare("SELECT changes FROM commits WHERE hash = ?")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()
	for _, h := range hashes {
		var raw []byte
		err := stmt.QueryRow(h).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		var changes []gitrepo.Change
		if err := json.Unmarshal(raw, &changes); err != nil {
			continue // unreadable: read again from git
		}
		found[h] = changes
	}
	return found, nil
}

// PutCommits stores the paths commits touched.
func (ix *Index) PutCommits(commits map[string][]gitrepo.Change) error {
	if len(commits) == 0 {
		return nil
	}
	return ix.write("INSERT OR REPLACE INTO commits (hash, changes) VALUES (?, ?)",
		func(stmt *sql.Stmt) error {
			for h, changes := range commits {
				if changes == nil {
					changes = []gitrepo.Change{}
				}
				raw, err := json.Marshal(changes)
				if err != nil {
					return err
				}
				if _, err := stmt.Exec(h, raw); err != nil {
					return err
				}
			}
			return nil
		})
}

// write runs fill with query prepared in one transaction.
func (ix *Index) write(query string, fill func(*sql.Stmt) error) error {
	tx, err := ix.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(query)
	if err != nil {
		return err
	}
	defer stmt.Close()
	if err := fill(stmt); err != nil {
		return err
	}
	return tx.Commit()
}
