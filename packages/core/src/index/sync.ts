/**
 * Incremental, team-aware indexing of one repo's checkpoints (PLAN.md Section 6).
 * Indexes only ids not already present; `full` wipes the repo's rows first.
 * Embeddings are attempted only when vec storage is available; failing to embed a
 * checkpoint degrades it to keyword-only without failing the sync.
 */
import type { Database } from "bun:sqlite";
import type { CommitInfo, RawCheckpoint } from "../types.ts";
import {
  buildCheckpointCommitMap,
  getDiffStats,
  gitRoot,
  fetchCheckpoints,
  repoSlug,
  resolveCheckpointsRef,
} from "../git/repo.ts";
import {
  indexCheckpointBlobs,
  readCheckpointsBatch,
  scanCheckpointIds,
  scanCheckpointIdsByRecency,
} from "../git/checkpoints.ts";
import { extractPlainText } from "../parser/transcript.ts";
import { upsertRepo, setLastSync } from "../db/repos.ts";
import {
  clearRepo,
  knownCheckpointIds,
  upsertCheckpoint,
  type CheckpointInput,
} from "../db/checkpoints.ts";
import { embed } from "../embeddings/embedder.ts";

export interface SyncOptions {
  cwd: string;
  db: Database;
  vecAvailable: boolean;
  full?: boolean;
  remote?: string;
  /** Index only the newest N checkpoints (by branch commit recency). */
  limit?: number;
  /** Attempt embeddings when vec storage is available (default true). */
  embeddings?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/** Wall-clock spent in each indexing phase, in milliseconds (for diagnosing slow syncs). */
export interface SyncTimings {
  /** One-pass build of the checkpoint id -> commit map. */
  commitMapMs: number;
  /** Reading checkpoint trees and blobs from git. */
  readMs: number;
  /** Building rows: diff stats (git) plus transcript text extraction (cpu). */
  buildMs: number;
  /** Computing embeddings (the single-thread WASM path in the compiled binary). */
  embedMs: number;
  /** Writing rows to SQLite. */
  dbMs: number;
}

function zeroTimings(): SyncTimings {
  return { commitMapMs: 0, readMs: 0, buildMs: 0, embedMs: 0, dbMs: 0 };
}

export interface SyncResult {
  slug: string;
  ref: string | null;
  synced: number;
  skipped: number;
  failed: number;
  durationMs: number;
  /** Total checkpoints present on the ref. */
  total: number;
  /** True when no checkpoints branch/ref exists for this repo. */
  noCheckpoints: boolean;
  /** True if at least one checkpoint was embedded. */
  embedderUsed: boolean;
  /** Per-phase wall-clock, for diagnosing where a sync spends its time. */
  timings: SyncTimings;
}

function normalizeDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? raw : new Date(t).toISOString();
}

/** Joins the fields we embed, truncated so the model stays fast. */
function embedText(input: CheckpointInput): string {
  return [input.prompt, input.summary, input.commitMessage ?? "", input.filesTouched.join(" ")]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
}

function buildInput(
  root: string,
  repoId: number,
  raw: RawCheckpoint,
  commit: CommitInfo | null,
): CheckpointInput {
  const firstSession = raw.sessions[0];
  const commitSha = commit?.hash ?? null;
  const diff = commitSha ? getDiffStats(root, commitSha) : null;

  const branch = raw.summary.branch ?? firstSession?.metadata.branch ?? null;
  const tokens = raw.summary.token_usage ?? firstSession?.metadata.token_usage ?? {};
  const createdAt =
    normalizeDate(firstSession?.metadata.created_at) ??
    normalizeDate(raw.summary.created_at) ??
    normalizeDate(commit?.date);

  const transcriptText = raw.sessions
    .map((s) => extractPlainText(s.transcriptJsonl))
    .filter(Boolean)
    .join("\n");

  return {
    repoId,
    checkpointId: raw.id,
    branch,
    commitSha,
    commitMessage: commit?.subject ?? null,
    author: commit?.author ?? null,
    authorEmail: commit?.email ?? null,
    createdAt,
    filesTouched: raw.summary.files_touched ?? [],
    strategy: raw.summary.strategy ?? firstSession?.metadata.strategy ?? null,
    inputTokens: tokens.input_tokens ?? null,
    outputTokens: tokens.output_tokens ?? null,
    additions: diff?.additions ?? null,
    deletions: diff?.deletions ?? null,
    prompt: firstSession?.prompt ?? "",
    summary: firstSession?.metadata.summary?.text ?? "",
    transcriptText,
    embedding: null,
  };
}

export async function syncRepo(opts: SyncOptions): Promise<SyncResult> {
  const started = Date.now();
  const remote = opts.remote ?? "origin";
  const root = gitRoot(opts.cwd);
  if (!root) throw new Error("not a git repository (run chisme sync from inside a repo)");

  const { slug, remoteUrl } = repoSlug(root, remote);
  const repo = upsertRepo(opts.db, slug, remoteUrl, root);

  // Best effort: pick up teammates' pushed checkpoints. Ignore failure.
  if (remoteUrl) fetchCheckpoints(root, remote);

  const ref = resolveCheckpointsRef(root, remote);
  if (!ref) {
    return {
      slug,
      ref: null,
      synced: 0,
      skipped: 0,
      failed: 0,
      durationMs: Date.now() - started,
      total: 0,
      noCheckpoints: true,
      embedderUsed: false,
      timings: zeroTimings(),
    };
  }

  // Recency order only when limiting (newest N); otherwise the cheaper tree scan.
  const ids =
    opts.limit != null ? scanCheckpointIdsByRecency(root, ref) : scanCheckpointIds(root, ref);
  if (opts.full) clearRepo(opts.db, repo.id, opts.vecAvailable);
  const known = opts.full ? new Set<string>() : knownCheckpointIds(opts.db, repo.id);
  let newIds = ids.filter((id) => !known.has(id));
  if (opts.limit != null) newIds = newIds.slice(0, opts.limit);

  const tryEmbed = opts.vecAvailable && opts.embeddings !== false;
  let synced = 0;
  let failed = 0;
  let embedderUsed = false;
  const timings = zeroTimings();

  // Link checkpoints to commits in one pass over history, rather than a
  // per-checkpoint `git log --all --grep` that each rescans the whole history.
  let mark = performance.now();
  const commitMap =
    newIds.length > 0 ? buildCheckpointCommitMap(root) : new Map<string, CommitInfo>();
  timings.commitMapMs = performance.now() - mark;

  // Index every checkpoint's blob shas once, then read each chunk through a single
  // `git cat-file --batch` rather than several `git show` spawns per checkpoint
  // (process spawn dominates indexing, especially on macOS). Chunked to bound memory.
  mark = performance.now();
  const blobIndex = newIds.length > 0 ? indexCheckpointBlobs(root, ref) : new Map();
  timings.readMs += performance.now() - mark;

  const CHUNK = 100;
  let processed = 0;
  for (let i = 0; i < newIds.length; i += CHUNK) {
    const chunk = newIds.slice(i, i + CHUNK);
    mark = performance.now();
    const batch = readCheckpointsBatch(root, chunk, blobIndex);
    timings.readMs += performance.now() - mark;

    for (const id of chunk) {
      try {
        const raw = batch.get(id);
        if (!raw) {
          failed++;
          continue;
        }

        mark = performance.now();
        const input = buildInput(root, repo.id, raw, commitMap.get(id) ?? null);
        timings.buildMs += performance.now() - mark;

        if (tryEmbed) {
          mark = performance.now();
          const vector = await embed(embedText(input));
          timings.embedMs += performance.now() - mark;
          if (vector) {
            input.embedding = vector;
            embedderUsed = true;
          }
        }

        mark = performance.now();
        upsertCheckpoint(opts.db, input, opts.vecAvailable);
        timings.dbMs += performance.now() - mark;
        synced++;
      } catch {
        failed++;
      }
      processed++;
      opts.onProgress?.(processed, newIds.length);
    }
  }

  setLastSync(opts.db, repo.id, new Date().toISOString());

  return {
    slug,
    ref,
    synced,
    skipped: ids.length - newIds.length,
    failed,
    durationMs: Date.now() - started,
    total: ids.length,
    noCheckpoints: false,
    embedderUsed,
    timings,
  };
}
