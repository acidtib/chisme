/**
 * upsert is idempotent: delete any existing row for `(repo_id, checkpoint_id)` and
 * its FTS/vec rows, then insert fresh, all in one transaction. FTS and vec key on
 * the checkpoint rowid, so both get re-linked to the new rowid on every write.
 */
import type { Database } from "bun:sqlite";

export interface CheckpointInput {
  repoId: number;
  checkpointId: string;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  author: string | null;
  authorEmail: string | null;
  createdAt: string | null;
  filesTouched: string[];
  strategy: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  additions: number | null;
  deletions: number | null;
  prompt: string;
  summary: string;
  transcriptText: string;
  /** 384-dim embedding, or null when semantic search is unavailable. */
  embedding: Float32Array | null;
}

export interface StoredCheckpoint {
  pk: number;
  repoId: number;
  slug: string;
  checkpointId: string;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  author: string | null;
  authorEmail: string | null;
  createdAt: string | null;
  filesTouched: string[];
  strategy: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  additions: number | null;
  deletions: number | null;
  prompt: string | null;
  summary: string | null;
}

interface CheckpointRow {
  pk: number;
  repo_id: number;
  slug: string;
  checkpoint_id: string;
  branch: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  author: string | null;
  author_email: string | null;
  created_at: string | null;
  files_touched: string | null;
  strategy: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  additions: number | null;
  deletions: number | null;
  prompt: string | null;
  summary: string | null;
}

/** Shared SELECT that joins repo slug; callers append WHERE/ORDER/LIMIT. */
export const CHECKPOINT_SELECT = `
  SELECT c.id AS pk, c.repo_id, r.slug, c.checkpoint_id, c.branch, c.commit_sha,
         c.commit_message, c.author, c.author_email, c.created_at, c.files_touched,
         c.strategy, c.input_tokens, c.output_tokens, c.additions, c.deletions,
         c.prompt, c.summary
  FROM checkpoints c
  JOIN repos r ON r.id = c.repo_id`;

export function mapStored(row: CheckpointRow): StoredCheckpoint {
  let files: string[] = [];
  if (row.files_touched) {
    try {
      const parsed = JSON.parse(row.files_touched);
      if (Array.isArray(parsed)) files = parsed as string[];
    } catch {
      // malformed JSON: leave files empty
    }
  }
  return {
    pk: row.pk,
    repoId: row.repo_id,
    slug: row.slug,
    checkpointId: row.checkpoint_id,
    branch: row.branch,
    commitSha: row.commit_sha,
    commitMessage: row.commit_message,
    author: row.author,
    authorEmail: row.author_email,
    createdAt: row.created_at,
    filesTouched: files,
    strategy: row.strategy,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    additions: row.additions,
    deletions: row.deletions,
    prompt: row.prompt,
    summary: row.summary,
  };
}

export function knownCheckpointIds(db: Database, repoId: number): Set<string> {
  const rows = db.query("SELECT checkpoint_id FROM checkpoints WHERE repo_id = ?").all(repoId) as {
    checkpoint_id: string;
  }[];
  return new Set(rows.map((r) => r.checkpoint_id));
}

export function upsertCheckpoint(
  db: Database,
  input: CheckpointInput,
  vecAvailable: boolean,
): void {
  const run = db.transaction(() => {
    const existing = db
      .query("SELECT id FROM checkpoints WHERE repo_id = ? AND checkpoint_id = ?")
      .get(input.repoId, input.checkpointId) as { id: number } | null;

    if (existing) {
      db.query("DELETE FROM checkpoints_fts WHERE checkpoint_pk = ?").run(existing.id);
      if (vecAvailable) {
        db.query("DELETE FROM vec_checkpoints WHERE checkpoint_rowid = ?").run(existing.id);
      }
      db.query("DELETE FROM checkpoints WHERE id = ?").run(existing.id);
    }

    const filesJson = JSON.stringify(input.filesTouched);
    const result = db
      .query(
        `INSERT INTO checkpoints (
           repo_id, checkpoint_id, branch, commit_sha, commit_message, author, author_email,
           created_at, files_touched, strategy, input_tokens, output_tokens, additions, deletions,
           prompt, summary, transcript_text, indexed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.repoId,
        input.checkpointId,
        input.branch,
        input.commitSha,
        input.commitMessage,
        input.author,
        input.authorEmail,
        input.createdAt,
        filesJson,
        input.strategy,
        input.inputTokens,
        input.outputTokens,
        input.additions,
        input.deletions,
        input.prompt,
        input.summary,
        input.transcriptText,
        new Date().toISOString(),
      );

    const pk = Number(result.lastInsertRowid);

    db.query(
      `INSERT INTO checkpoints_fts (checkpoint_pk, prompt, summary, commit_message, files, transcript_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      pk,
      input.prompt,
      input.summary,
      input.commitMessage ?? "",
      input.filesTouched.join(" "),
      input.transcriptText,
    );

    if (vecAvailable && input.embedding) {
      db.query("INSERT INTO vec_checkpoints (checkpoint_rowid, embedding) VALUES (?, ?)").run(
        pk,
        new Uint8Array(input.embedding.buffer),
      );
    }
  });
  run();
}

/** Used by `--full`. */
export function clearRepo(db: Database, repoId: number, vecAvailable: boolean): void {
  const run = db.transaction(() => {
    const pks = db.query("SELECT id FROM checkpoints WHERE repo_id = ?").all(repoId) as {
      id: number;
    }[];
    for (const { id } of pks) {
      db.query("DELETE FROM checkpoints_fts WHERE checkpoint_pk = ?").run(id);
      if (vecAvailable) db.query("DELETE FROM vec_checkpoints WHERE checkpoint_rowid = ?").run(id);
    }
    db.query("DELETE FROM checkpoints WHERE repo_id = ?").run(repoId);
  });
  run();
}

export function recentCheckpoints(
  db: Database,
  opts: { repoId?: number; limit?: number; offset?: number } = {},
): StoredCheckpoint[] {
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  const where = opts.repoId != null ? "WHERE c.repo_id = ?" : "";
  const sql = `${CHECKPOINT_SELECT} ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`;
  const params = opts.repoId != null ? [opts.repoId, limit, offset] : [limit, offset];
  const rows = db.query(sql).all(...params) as CheckpointRow[];
  return rows.map(mapStored);
}

export interface CheckpointDetail extends StoredCheckpoint {
  transcriptText: string | null;
}

/** `repoSlug` disambiguates when the same id exists in more than one indexed repo. */
export function getCheckpointDetail(
  db: Database,
  checkpointId: string,
  repoSlug?: string,
): CheckpointDetail | null {
  const clauses = ["c.checkpoint_id = ?"];
  const params: (string | number)[] = [checkpointId];
  if (repoSlug) {
    clauses.push("r.slug = ?");
    params.push(repoSlug);
  }
  const sql = `
    SELECT c.id AS pk, c.repo_id, r.slug, c.checkpoint_id, c.branch, c.commit_sha,
           c.commit_message, c.author, c.author_email, c.created_at, c.files_touched,
           c.strategy, c.input_tokens, c.output_tokens, c.additions, c.deletions,
           c.prompt, c.summary, c.transcript_text
    FROM checkpoints c
    JOIN repos r ON r.id = c.repo_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY c.id DESC
    LIMIT 1`;
  const row = db.query(sql).get(...params) as
    | (CheckpointRow & { transcript_text: string | null })
    | null;
  if (!row) return null;
  return { ...mapStored(row), transcriptText: row.transcript_text };
}

export function getCheckpointsByPks(db: Database, pks: number[]): Map<number, StoredCheckpoint> {
  const map = new Map<number, StoredCheckpoint>();
  if (pks.length === 0) return map;
  const placeholders = pks.map(() => "?").join(",");
  const rows = db
    .query(`${CHECKPOINT_SELECT} WHERE c.id IN (${placeholders})`)
    .all(...pks) as CheckpointRow[];
  for (const row of rows) map.set(row.pk, mapStored(row));
  return map;
}

export function countCheckpoints(db: Database, repoId?: number): number {
  const sql =
    repoId != null
      ? "SELECT COUNT(*) AS n FROM checkpoints WHERE repo_id = ?"
      : "SELECT COUNT(*) AS n FROM checkpoints";
  const row = (repoId != null ? db.query(sql).get(repoId) : db.query(sql).get()) as { n: number };
  return row.n;
}
