/**
 * Reads checkpoint trees off the `entire/checkpoints/v1` branch.
 *
 * On-disk layout is sharded by checkpoint id: `<id[:2]>/<id[2:]>/`. Sessions are
 * numeric subdirectories (`0/`, `1/`, ...). We enumerate sessions from git rather
 * than trusting the `sessions[]` paths in the top metadata, which may be absent or
 * use absolute-style paths. Missing files are tolerated.
 */
import type { CheckpointSummary, RawCheckpoint, RawSession, SessionMetadata } from "../types.ts";
import { git, listTree, readBlob } from "./repo.ts";

/** Matches a checkpoint directory: a two-hex shard plus the rest of the id. */
const CHECKPOINT_DIR = /^([0-9a-f]{2})\/([0-9a-f]+)$/;

/** The in-git path for a checkpoint id, e.g. `9e7799d7465b` to `9e/7799d7465b`. */
export function checkpointPath(id: string): string {
  return `${id.slice(0, 2)}/${id.slice(2)}`;
}

/**
 * Lists every checkpoint id present on a ref. One recursive `ls-tree -d` lists all
 * directories; we keep the depth-2 ones that look like checkpoint dirs.
 */
export function scanCheckpointIds(root: string, ref: string): string[] {
  const ids: string[] = [];
  for (const entry of listTree(root, ref, "", { recursive: true, dirsOnly: true })) {
    const m = entry.path.match(CHECKPOINT_DIR);
    if (m) ids.push(m[1]! + m[2]!);
  }
  return ids;
}

/** Matches the top-level metadata path a checkpoint commit adds. */
const TOP_METADATA = /^([0-9a-f]{2})\/([0-9a-f]+)\/metadata\.json$/;

/**
 * Lists checkpoint ids newest-first. Entire commits each checkpoint as its own
 * commit that adds `<shard>/<rest>/metadata.json`, so one `git log` over the ref
 * yields recency order cheaply (no need to read every checkpoint's metadata).
 * Used by `index --limit N` to index only the most recent checkpoints.
 */
export function scanCheckpointIdsByRecency(root: string, ref: string): string[] {
  const r = git(root, ["log", ref, "--diff-filter=A", "--name-only", "--format="]);
  if (!r.ok) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const line of r.stdout.split("\n")) {
    const m = line.match(TOP_METADATA);
    if (!m) continue;
    const id = m[1]! + m[2]!;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Parses JSON from a blob, returning null on missing or malformed content. */
function readJson<T>(root: string, ref: string, path: string): T | null {
  const raw = readBlob(root, ref, path);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Numeric subdirectory names under a checkpoint, sorted ascending (`0`, `1`, ...). */
function sessionIndices(root: string, ref: string, path: string): number[] {
  const indices: number[] = [];
  for (const entry of listTree(root, ref, path)) {
    if (entry.type !== "tree") continue;
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (/^\d+$/.test(name)) indices.push(Number(name));
  }
  return indices.sort((a, b) => a - b);
}

/**
 * Reads one checkpoint: its top metadata plus every session's metadata, prompt,
 * and transcript. Returns null only if the top metadata is unreadable.
 */
export function readCheckpoint(root: string, ref: string, id: string): RawCheckpoint | null {
  const path = checkpointPath(id);
  const summary =
    readJson<CheckpointSummary>(root, ref, `${path}/metadata.json`) ??
    ({ checkpoint_id: id } as CheckpointSummary);

  const sessions: RawSession[] = [];
  for (const index of sessionIndices(root, ref, path)) {
    const base = `${path}/${index}`;
    const metadata = readJson<SessionMetadata>(root, ref, `${base}/metadata.json`) ?? {};
    const transcriptJsonl = readBlob(root, ref, `${base}/full.jsonl`) ?? "";
    const prompt = (readBlob(root, ref, `${base}/prompt.txt`) ?? "").trim();
    sessions.push({ index, metadata, transcriptJsonl, prompt });
  }

  return { id, path, summary, sessions };
}
