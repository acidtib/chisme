/**
 * CRUD for the `repos` table. Each repo is keyed by its `owner/repo` slug (or
 * `local/<dirname>` when there is no remote), so the index is multi-repo.
 */
import type { Database } from "bun:sqlite";
import type { RepoRecord } from "../types.ts";

interface RepoRow {
  id: number;
  slug: string;
  remote_url: string | null;
  root_path: string | null;
  last_sync: string | null;
}

function toRecord(row: RepoRow): RepoRecord {
  return {
    id: row.id,
    slug: row.slug,
    remoteUrl: row.remote_url,
    rootPath: row.root_path ?? "",
    lastSync: row.last_sync,
  };
}

/** Inserts or updates a repo by slug, returning the stored record. */
export function upsertRepo(
  db: Database,
  slug: string,
  remoteUrl: string | null,
  rootPath: string,
): RepoRecord {
  db.query(
    `INSERT INTO repos (slug, remote_url, root_path)
     VALUES (?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET remote_url = excluded.remote_url, root_path = excluded.root_path`,
  ).run(slug, remoteUrl, rootPath);
  return getRepoBySlug(db, slug)!;
}

export function getRepoBySlug(db: Database, slug: string): RepoRecord | null {
  const row = db.query("SELECT * FROM repos WHERE slug = ?").get(slug) as RepoRow | null;
  return row ? toRecord(row) : null;
}

export function allRepos(db: Database): RepoRecord[] {
  const rows = db.query("SELECT * FROM repos ORDER BY slug").all() as RepoRow[];
  return rows.map(toRecord);
}

export function setLastSync(db: Database, repoId: number, iso: string): void {
  db.query("UPDATE repos SET last_sync = ? WHERE id = ?").run(iso, repoId);
}
