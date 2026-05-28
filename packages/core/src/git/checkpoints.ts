/**
 * On-disk layout is sharded by checkpoint id: `<id[:2]>/<id[2:]>/`, with sessions in
 * numeric subdirs (`0/`, `1/`, ...). We enumerate sessions from git rather than the
 * `sessions[]` paths in the top metadata, which may be absent or absolute.
 */
import type { CheckpointSummary, RawCheckpoint, RawSession, SessionMetadata } from "../types.ts";
import { catFileBatch, git, listTree, readBlob } from "./repo.ts";

/** Matches a checkpoint directory: a two-hex shard plus the rest of the id. */
const CHECKPOINT_DIR = /^([0-9a-f]{2})\/([0-9a-f]+)$/;

export function checkpointPath(id: string): string {
  return `${id.slice(0, 2)}/${id.slice(2)}`;
}

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
 * Newest-first. Entire commits each checkpoint as its own commit adding
 * `<shard>/<rest>/metadata.json`, so one `git log` over the ref yields recency order
 * cheaply, without reading every checkpoint's metadata. Used by `sync --limit N`.
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

function readJson<T>(root: string, ref: string, path: string): T | null {
  const raw = readBlob(root, ref, path);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function sessionIndices(root: string, ref: string, path: string): number[] {
  const indices: number[] = [];
  for (const entry of listTree(root, ref, path)) {
    if (entry.type !== "tree") continue;
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (/^\d+$/.test(name)) indices.push(Number(name));
  }
  return indices.sort((a, b) => a - b);
}

/** Returns null only if the top metadata is unreadable; missing session files are tolerated. */
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

interface SessionBlobs {
  index: number;
  metaSha: string | null;
  transcriptSha: string | null;
  promptSha: string | null;
}

interface CheckpointBlobs {
  summarySha: string | null;
  sessions: Map<number, SessionBlobs>;
}

/** Maps each checkpoint id to the blob shas of its files, for batch reading. */
export type CheckpointBlobIndex = Map<string, CheckpointBlobs>;

/** Top-level `<shard>/<rest>/metadata.json`. */
const TOP_META = /^([0-9a-f]{2})\/([0-9a-f]+)\/metadata\.json$/;
/** Per-session `<shard>/<rest>/<index>/(metadata.json|full.jsonl|prompt.txt)`. */
const SESSION_FILE =
  /^([0-9a-f]{2})\/([0-9a-f]+)\/(\d+)\/(metadata\.json|full\.jsonl|prompt\.txt)$/;

/**
 * Indexes every checkpoint's file shas in one recursive `ls-tree`, so a sync can
 * then read all blobs through a single `git cat-file --batch` instead of several
 * `git show` spawns per checkpoint (the dominant indexing cost, see syncRepo).
 */
export function indexCheckpointBlobs(root: string, ref: string): CheckpointBlobIndex {
  const index: CheckpointBlobIndex = new Map();
  const cpFor = (id: string): CheckpointBlobs => {
    let cp = index.get(id);
    if (!cp) {
      cp = { summarySha: null, sessions: new Map() };
      index.set(id, cp);
    }
    return cp;
  };
  const sessionFor = (cp: CheckpointBlobs, i: number): SessionBlobs => {
    let s = cp.sessions.get(i);
    if (!s) {
      s = { index: i, metaSha: null, transcriptSha: null, promptSha: null };
      cp.sessions.set(i, s);
    }
    return s;
  };

  for (const entry of listTree(root, ref, "", { recursive: true })) {
    if (entry.type !== "blob") continue;
    const top = entry.path.match(TOP_META);
    if (top) {
      cpFor(top[1]! + top[2]!).summarySha = entry.sha;
      continue;
    }
    const sf = entry.path.match(SESSION_FILE);
    if (!sf) continue;
    const session = sessionFor(cpFor(sf[1]! + sf[2]!), Number(sf[3]));
    if (sf[4] === "metadata.json") session.metaSha = entry.sha;
    else if (sf[4] === "full.jsonl") session.transcriptSha = entry.sha;
    else session.promptSha = entry.sha; // prompt.txt
  }
  return index;
}

/**
 * Reads a batch of checkpoints from a prebuilt blob index in a single
 * `git cat-file --batch`. Same shape and fallbacks as `readCheckpoint` (missing
 * summary degrades to `{ checkpoint_id }`, missing session files to empty), but
 * one git process for the whole batch instead of several per checkpoint.
 */
export function readCheckpointsBatch(
  root: string,
  ids: string[],
  index: CheckpointBlobIndex,
): Map<string, RawCheckpoint> {
  const shas: string[] = [];
  for (const id of ids) {
    const cp = index.get(id);
    if (!cp) continue;
    if (cp.summarySha) shas.push(cp.summarySha);
    for (const s of cp.sessions.values()) {
      if (s.metaSha) shas.push(s.metaSha);
      if (s.transcriptSha) shas.push(s.transcriptSha);
      if (s.promptSha) shas.push(s.promptSha);
    }
  }
  const blobs = catFileBatch(root, shas);
  const parse = <T>(sha: string | null): T | null => {
    if (!sha) return null;
    const raw = blobs.get(sha);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const result = new Map<string, RawCheckpoint>();
  for (const id of ids) {
    const cp = index.get(id);
    const summary =
      parse<CheckpointSummary>(cp?.summarySha ?? null) ??
      ({ checkpoint_id: id } as CheckpointSummary);
    const sessions: RawSession[] = [];
    if (cp) {
      for (const s of [...cp.sessions.values()].sort((a, b) => a.index - b.index)) {
        const metadata = parse<SessionMetadata>(s.metaSha) ?? {};
        const transcriptJsonl = (s.transcriptSha && blobs.get(s.transcriptSha)) || "";
        const prompt = ((s.promptSha && blobs.get(s.promptSha)) || "").trim();
        sessions.push({ index: s.index, metadata, transcriptJsonl, prompt });
      }
    }
    result.set(id, { id, path: checkpointPath(id), summary, sessions });
  }
  return result;
}
