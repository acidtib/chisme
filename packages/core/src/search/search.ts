/**
 * Hybrid local search over the index (PLAN.md Section 7).
 *
 * Keyword (FTS5 bm25) and semantic (sqlite-vec KNN) candidate lists are fused with
 * Reciprocal Rank Fusion, then structured filters (author, branch, date, repo) are
 * applied and the result is paginated. Keyword search always runs; semantic runs
 * only when the vec extension loaded and the query embeds. An empty query becomes
 * a match-all ordered by recency, so filter-only searches still work.
 */
import type { Database } from "bun:sqlite";
import type { MatchType, SearchResponse, SearchResult } from "../types.ts";
import {
  CHECKPOINT_SELECT,
  getCheckpointsByPks,
  mapStored,
  type StoredCheckpoint,
} from "../db/checkpoints.ts";
import { getRepoBySlug } from "../db/repos.ts";
import { gitRoot, repoSlug } from "../git/repo.ts";
import { sanitizeFtsQuery } from "./fts.ts";
import { embed } from "../embeddings/embedder.ts";

const POOL = 200;
const RRF_K = 60;

export interface SearchOptions {
  db: Database;
  vecAvailable: boolean;
  /** Used to resolve the current repo when `repo` is not given. */
  cwd?: string;
  /** "*" = all repos; "owner/repo" = that repo; undefined = current repo. */
  repo?: string;
  limit?: number;
  page?: number;
  author?: string;
  branch?: string;
  date?: "week" | "month";
  /** Attempt semantic search when available (default true). */
  semantic?: boolean;
}

export interface SearchInfo {
  /** Human description of what was searched (for non-JSON output). */
  scope: string;
  keywordUsed: boolean;
  semanticUsed: boolean;
  /** True when the current repo was not indexed and we searched all repos. */
  scopeFallback: boolean;
}

interface Filters {
  author?: string;
  branch?: string;
  dateThreshold?: string;
  /** null = no repo restriction; a set restricts to those repo ids. */
  repoIds: Set<number> | null;
}

function dateThreshold(date: "week" | "month" | undefined): string | undefined {
  if (!date) return undefined;
  const days = date === "week" ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function passesFilters(c: StoredCheckpoint, f: Filters): boolean {
  if (f.repoIds && !f.repoIds.has(c.repoId)) return false;
  if (f.author && !(c.author ?? "").toLowerCase().includes(f.author.toLowerCase())) return false;
  if (f.branch && (c.branch ?? "").toLowerCase() !== f.branch.toLowerCase()) return false;
  if (f.dateThreshold && (!c.createdAt || c.createdAt < f.dateThreshold)) return false;
  return true;
}

function splitSlug(slug: string): { org: string | null; repo: string | null } {
  const i = slug.indexOf("/");
  if (i === -1) return { org: null, repo: slug };
  return { org: slug.slice(0, i), repo: slug.slice(i + 1) };
}

function excerpt(text: string | null, max = 180): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function toResult(c: StoredCheckpoint, matchType: MatchType, score: number, snippet: string): SearchResult {
  const { org, repo } = splitSlug(c.slug);
  return {
    type: "checkpoint",
    data: {
      id: c.checkpointId,
      prompt: c.prompt ?? "",
      commitMessage: c.commitMessage,
      commitSha: c.commitSha,
      branch: c.branch,
      org,
      repo,
      author: c.author,
      authorUsername: null,
      createdAt: c.createdAt,
      filesTouched: c.filesTouched,
    },
    searchMeta: { matchType, score, snippet },
  };
}

/** Resolves the repo scope into a concrete repo-id filter plus a description. */
function resolveScope(opts: SearchOptions): {
  repoIds: Set<number> | null;
  scope: string;
  scopeFallback: boolean;
} {
  if (opts.repo === "*") return { repoIds: null, scope: "all repos", scopeFallback: false };

  if (opts.repo) {
    const repo = getRepoBySlug(opts.db, opts.repo);
    if (repo) return { repoIds: new Set([repo.id]), scope: repo.slug, scopeFallback: false };
    // Asked for a specific repo we have not indexed: match nothing.
    return { repoIds: new Set(), scope: `${opts.repo} (not indexed)`, scopeFallback: false };
  }

  const root = opts.cwd ? gitRoot(opts.cwd) : null;
  if (root) {
    const { slug } = repoSlug(root);
    const repo = getRepoBySlug(opts.db, slug);
    if (repo) return { repoIds: new Set([repo.id]), scope: repo.slug, scopeFallback: false };
    return { repoIds: null, scope: "all repos (current repo not indexed)", scopeFallback: true };
  }
  return { repoIds: null, scope: "all repos", scopeFallback: false };
}

interface Candidate {
  pk: number;
  bm25?: number;
  snippet?: string;
  distance?: number;
}

/** Keyword candidates via FTS5 bm25 (lower is better). */
function keywordCandidates(db: Database, match: string): Candidate[] {
  const rows = db
    .query(
      `SELECT checkpoint_pk AS pk, bm25(checkpoints_fts) AS s,
              snippet(checkpoints_fts, -1, '[', ']', '...', 12) AS snip
       FROM checkpoints_fts
       WHERE checkpoints_fts MATCH ?
       ORDER BY s
       LIMIT ?`,
    )
    .all(match, POOL) as { pk: number; s: number; snip: string }[];
  return rows.map((r) => ({ pk: r.pk, bm25: r.s, snippet: r.snip }));
}

/** Semantic candidates via vec0 KNN (lower distance is better). */
function semanticCandidates(db: Database, vector: Float32Array): Candidate[] {
  const rows = db
    .query(
      `SELECT checkpoint_rowid AS pk, distance
       FROM vec_checkpoints
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance`,
    )
    .all(new Uint8Array(vector.buffer), POOL) as { pk: number; distance: number }[];
  return rows.map((r) => ({ pk: r.pk, distance: r.distance }));
}

/** Match-all path: most recent checkpoints matching the structured filters. */
function searchMatchAll(
  db: Database,
  filters: Filters,
  limit: number,
  page: number,
): SearchResponse {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.repoIds) {
    if (filters.repoIds.size === 0) {
      return { results: [], total: 0, page, total_pages: 1, limit };
    }
    const ids = [...filters.repoIds];
    clauses.push(`c.repo_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (filters.author) {
    clauses.push("LOWER(c.author) LIKE ?");
    params.push(`%${filters.author.toLowerCase()}%`);
  }
  if (filters.branch) {
    clauses.push("LOWER(c.branch) = ?");
    params.push(filters.branch.toLowerCase());
  }
  if (filters.dateThreshold) {
    clauses.push("c.created_at >= ?");
    params.push(filters.dateThreshold);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const total = (
    db.query(`SELECT COUNT(*) AS n FROM checkpoints c ${where}`).get(...params) as { n: number }
  ).n;
  const offset = (page - 1) * limit;
  const rows = db
    .query(`${CHECKPOINT_SELECT} ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Parameters<typeof mapStored>[0][];

  const results = rows.map((row) => {
    const c = mapStored(row);
    return toResult(c, "keyword", 0, excerpt(c.prompt ?? c.summary));
  });

  return {
    results,
    total,
    page,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    limit,
  };
}

export async function search(
  query: string,
  opts: SearchOptions,
): Promise<{ response: SearchResponse; info: SearchInfo }> {
  const limit = opts.limit ?? 25;
  const page = opts.page ?? 1;
  const text = query.trim();

  const { repoIds, scope, scopeFallback } = resolveScope(opts);
  const filters: Filters = {
    author: opts.author,
    branch: opts.branch,
    dateThreshold: dateThreshold(opts.date),
    repoIds,
  };

  const match = sanitizeFtsQuery(text);

  // No usable query text: fall back to recency plus filters.
  if (!match) {
    return {
      response: searchMatchAll(opts.db, filters, limit, page),
      info: { scope, keywordUsed: false, semanticUsed: false, scopeFallback },
    };
  }

  // Keyword list (always) and semantic list (when available).
  const keyword = keywordCandidates(opts.db, match);
  let semantic: Candidate[] = [];
  let semanticUsed = false;
  if (opts.vecAvailable && opts.semantic !== false) {
    const vector = await embed(text);
    if (vector) {
      semantic = semanticCandidates(opts.db, vector);
      semanticUsed = true;
    }
  }

  // Reciprocal Rank Fusion over the two ranked lists.
  const scores = new Map<number, number>();
  const inKeyword = new Set<number>();
  const inSemantic = new Set<number>();
  const snippets = new Map<number, string>();

  keyword.forEach((c, rank) => {
    inKeyword.add(c.pk);
    if (c.snippet) snippets.set(c.pk, c.snippet);
    scores.set(c.pk, (scores.get(c.pk) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  semantic.forEach((c, rank) => {
    inSemantic.add(c.pk);
    scores.set(c.pk, (scores.get(c.pk) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  const hydrated = getCheckpointsByPks(opts.db, [...scores.keys()]);

  const ranked: { c: StoredCheckpoint; score: number; matchType: MatchType; snippet: string }[] = [];
  for (const [pk, score] of scores) {
    const c = hydrated.get(pk);
    if (!c || !passesFilters(c, filters)) continue;
    const matchType: MatchType =
      inKeyword.has(pk) && inSemantic.has(pk) ? "both" : inKeyword.has(pk) ? "keyword" : "semantic";
    const snippet = snippets.get(pk) ?? excerpt(c.prompt ?? c.summary);
    ranked.push({ c, score, matchType, snippet });
  }

  // Stable order: score desc, then recency, then id, for deterministic pages.
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = a.c.createdAt ?? "";
    const dbb = b.c.createdAt ?? "";
    if (da !== dbb) return da < dbb ? 1 : -1;
    return b.c.pk - a.c.pk;
  });

  const total = ranked.length;
  const offset = (page - 1) * limit;
  const results = ranked
    .slice(offset, offset + limit)
    .map((r) => toResult(r.c, r.matchType, r.score, r.snippet));

  return {
    response: {
      results,
      total,
      page,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      limit,
    },
    info: { scope, keywordUsed: true, semanticUsed, scopeFallback },
  };
}
