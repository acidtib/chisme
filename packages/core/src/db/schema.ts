/**
 * SQLite schema and migrations for the global multi-repo index.
 *
 * The base schema (meta, repos, checkpoints, FTS5) is always created. The vec0
 * virtual table is created only when sqlite-vec loaded, since it depends on the
 * extension. Migrations are keyed on `meta.schema_version`; bump SCHEMA_VERSION
 * and add a case to `migrate` when the shape changes.
 */
import type { Database } from "bun:sqlite";

export const SCHEMA_VERSION = 1;

/** Embedding dimensionality for Xenova/all-MiniLM-L6-v2. */
export const EMBEDDING_DIMS = 384;

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS repos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,
  remote_url TEXT,
  root_path  TEXT,
  last_sync  TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  checkpoint_id   TEXT NOT NULL,
  branch          TEXT,
  commit_sha      TEXT,
  commit_message  TEXT,
  author          TEXT,
  author_email    TEXT,
  created_at      TEXT,
  files_touched   TEXT,
  strategy        TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  additions       INTEGER,
  deletions       INTEGER,
  prompt          TEXT,
  summary         TEXT,
  transcript_text TEXT,
  indexed_at      TEXT,
  UNIQUE(repo_id, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_repo    ON checkpoints(repo_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(created_at);
CREATE INDEX IF NOT EXISTS idx_checkpoints_author  ON checkpoints(author);
CREATE INDEX IF NOT EXISTS idx_checkpoints_branch  ON checkpoints(branch);

CREATE VIRTUAL TABLE IF NOT EXISTS checkpoints_fts USING fts5(
  checkpoint_pk UNINDEXED,
  prompt,
  summary,
  commit_message,
  files,
  transcript_text,
  tokenize = 'porter unicode61'
);
`;

const VEC_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_checkpoints USING vec0(
  checkpoint_rowid INTEGER PRIMARY KEY,
  embedding FLOAT[${EMBEDDING_DIMS}]
);
`;

function currentVersion(db: Database): number {
  try {
    const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | null;
    return row ? Number(row.value) : 0;
  } catch {
    return 0;
  }
}

/**
 * Creates the schema and runs any pending migrations. Idempotent: safe to call on
 * every open. `vecAvailable` controls whether the vec0 table is created.
 */
export function applySchema(db: Database, vecAvailable: boolean): void {
  db.exec(BASE_SCHEMA);
  if (vecAvailable) db.exec(VEC_SCHEMA);

  const from = currentVersion(db);
  if (from < SCHEMA_VERSION) {
    // No destructive migrations yet; future versions add cases here.
    db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION),
    );
  }
}
