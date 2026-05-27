/**
 * Thin wrapper over the `git` CLI for reading checkpoint data without a checkout.
 *
 * Every function shells out to `git -C <root> ...`. Reads are done with `ls-tree`
 * and `show <ref>:<path>` so chisme never touches the working tree and never
 * writes to the `entire/checkpoints/v1` branch. Functions return `null` (or an
 * empty result) on failure rather than throwing, so callers can degrade.
 */
import { basename } from "node:path";
import type { CommitInfo, DiffStats } from "../types.ts";

/** The git branch Entire-compatible tooling writes checkpoints to. */
export const CHECKPOINTS_BRANCH = "entire/checkpoints/v1";

/** ASCII unit separator, used to split `git --format` fields safely. */
const FS = "\x1f";

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  ok: boolean;
}

/** Runs `git -C <root> <args...>` synchronously and captures its output. */
export function git(root: string, args: string[]): ExecResult {
  const proc = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    code: proc.exitCode ?? 1,
    ok: proc.exitCode === 0,
  };
}

/** Resolves the repository root for a working directory, or null if not a repo. */
export function gitRoot(cwd: string): string | null {
  const r = git(cwd, ["rev-parse", "--show-toplevel"]);
  return r.ok ? r.stdout.trim() : null;
}

/** Reads `remote.<name>.url`, defaulting to `origin`. */
export function remoteUrl(root: string, remote = "origin"): string | null {
  const r = git(root, ["config", "--get", `remote.${remote}.url`]);
  const url = r.stdout.trim();
  return r.ok && url ? url : null;
}

/**
 * Derives an `owner/repo` slug from a git remote URL, host-agnostic.
 * Handles `git@host:owner/repo.git` and `https://host/owner/repo(.git)`.
 * Returns null when the URL has fewer than two path segments.
 */
export function slugFromRemoteUrl(url: string): string | null {
  let path = url.trim();
  // scp-like syntax: git@host:owner/repo.git
  const scp = path.match(/^[^/@]+@[^:]+:(.+)$/);
  if (scp) {
    path = scp[1]!;
  } else {
    // strip scheme and host for URL forms
    path = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const slash = path.indexOf("/");
    if (slash !== -1) path = path.slice(slash + 1);
  }
  path = path.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return segments.slice(-2).join("/");
}

/**
 * The slug chisme indexes a repo under: `owner/repo` from the remote, or
 * `local/<dirname>` when there is no usable remote.
 */
export function repoSlug(
  root: string,
  remote = "origin",
): { slug: string; remoteUrl: string | null } {
  const url = remoteUrl(root, remote);
  const slug = url ? slugFromRemoteUrl(url) : null;
  return { slug: slug ?? `local/${basename(root)}`, remoteUrl: url };
}

/** Returns true if a ref resolves (exists). */
export function refExists(root: string, ref: string): boolean {
  return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).ok;
}

/**
 * Best-effort fetch of teammates' checkpoints into a tracking ref. Returns true
 * on success; failure (offline, no remote, branch missing) is non-fatal.
 */
export function fetchCheckpoints(root: string, remote = "origin"): boolean {
  const refspec = `+${CHECKPOINTS_BRANCH}:refs/remotes/${remote}/${CHECKPOINTS_BRANCH}`;
  return git(root, ["fetch", "--quiet", remote, refspec]).ok;
}

/**
 * Resolves which ref to read checkpoints from, in priority order: the remote
 * tracking ref, the local branch, then FETCH_HEAD. Returns null if none exist.
 */
export function resolveCheckpointsRef(root: string, remote = "origin"): string | null {
  const candidates = [
    `refs/remotes/${remote}/${CHECKPOINTS_BRANCH}`,
    CHECKPOINTS_BRANCH,
    "FETCH_HEAD",
  ];
  for (const ref of candidates) {
    if (refExists(root, ref)) return ref;
  }
  return null;
}

export interface TreeEntry {
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  /** Path relative to the repo root, as printed by `git ls-tree`. */
  path: string;
}

/** Lists a tree at `<ref>:<path>`. With `recursive`, descends; with `dirsOnly`, only trees. */
export function listTree(
  root: string,
  ref: string,
  path = "",
  opts: { recursive?: boolean; dirsOnly?: boolean } = {},
): TreeEntry[] {
  const args = ["ls-tree"];
  if (opts.recursive) args.push("-r");
  if (opts.dirsOnly) args.push("-d");
  args.push(ref);
  if (path) args.push(path.endsWith("/") ? path : `${path}/`);
  const r = git(root, args);
  if (!r.ok) return [];
  const entries: TreeEntry[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    // "<mode> <type> <sha>\t<path>"
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    if (meta.length < 3) continue;
    entries.push({
      mode: meta[0]!,
      type: meta[1] as TreeEntry["type"],
      sha: meta[2]!,
      path: line.slice(tab + 1),
    });
  }
  return entries;
}

/** Reads a blob at `<ref>:<path>`, or null if it does not exist. */
export function readBlob(root: string, ref: string, path: string): string | null {
  const r = git(root, ["show", `${ref}:${path}`]);
  return r.ok ? r.stdout : null;
}

/**
 * Reads many git objects in a single `git cat-file --batch` process, keyed by sha.
 *
 * Spawning one `git show` per blob is the dominant cost when indexing (a checkpoint
 * needs several blobs, and process spawn is slow, especially on macOS). This feeds
 * all shas to one long-lived git process and parses its binary batch protocol:
 * for each input line, `<sha> <type> <size>\n`, then `<size>` content bytes, then a
 * `\n`; a missing object yields `<sha> missing\n`. Content is decoded as UTF-8.
 */
export function catFileBatch(root: string, shas: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (shas.length === 0) return out;
  const proc = Bun.spawnSync(["git", "-C", root, "cat-file", "--batch"], {
    stdin: new TextEncoder().encode(`${shas.join("\n")}\n`),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return out;
  const buf = proc.stdout;
  const decoder = new TextDecoder();
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break;
    const header = decoder.decode(buf.subarray(pos, nl));
    pos = nl + 1;
    const sp = header.lastIndexOf(" ");
    const size = sp === -1 ? Number.NaN : Number(header.slice(sp + 1));
    if (!Number.isFinite(size)) continue; // "<sha> missing" or unexpected line
    const sha = header.slice(0, header.indexOf(" "));
    out.set(sha, decoder.decode(buf.subarray(pos, pos + size)));
    pos += size + 1; // skip content and its trailing newline
  }
  return out;
}

/** Reverse lookup: the commit whose message carries this checkpoint's trailer. */
export function findCommitByCheckpointId(root: string, id: string): string | null {
  const r = git(root, ["log", "--all", "--grep", `Entire-Checkpoint: ${id}`, "--format=%H", "-1"]);
  const sha = r.stdout.trim();
  return r.ok && sha ? sha : null;
}

/** Commit metadata for a sha, or null if the sha is unknown. */
export function getCommitInfo(root: string, sha: string): CommitInfo | null {
  const fmt = ["%H", "%s", "%an", "%ae", "%aI"].join(FS);
  const r = git(root, ["show", "-s", `--format=${fmt}`, sha]);
  if (!r.ok) return null;
  const [hash, subject, author, email, date] = r.stdout.trim().split(FS);
  if (!hash) return null;
  return {
    hash,
    subject: subject ?? "",
    author: author ?? "",
    email: email ?? "",
    date: date ?? "",
  };
}

/**
 * Maps every checkpoint id to its linked commit in a single pass over all history.
 *
 * Calling findCommitByCheckpointId per checkpoint runs one `git log --all --grep`
 * per id, and each walks the whole history, so indexing is O(checkpoints x commits).
 * This reads every commit's trailer once, O(commits), and captures the commit
 * metadata in the same pass so callers need no follow-up getCommitInfo. git streams
 * commits newest-first, so the first commit seen for an id wins, matching
 * findCommitByCheckpointId's `-1` (most recent match).
 */
export function buildCheckpointCommitMap(root: string): Map<string, CommitInfo> {
  // RS goes at the start of each commit's output so the hash field stays clean (the
  // previous commit's trailing newline lands before this separator, not in the hash).
  const RS = "\x1e";
  const fmt = RS + ["%H", "%s", "%an", "%ae", "%aI", "%B"].join(FS);
  const r = git(root, ["log", "--all", `--format=${fmt}`]);
  const map = new Map<string, CommitInfo>();
  if (!r.ok) return map;
  const trailer = /^Entire-Checkpoint:[ \t]*(\S+)/gm;
  for (const record of r.stdout.split(RS)) {
    if (!record) continue;
    const [hash, subject, author, email, date, body = ""] = record.split(FS);
    if (!hash) continue;
    const info: CommitInfo = {
      hash,
      subject: subject ?? "",
      author: author ?? "",
      email: email ?? "",
      date: date ?? "",
    };
    trailer.lastIndex = 0;
    for (let m = trailer.exec(body); m; m = trailer.exec(body)) {
      const id = m[1]!;
      if (!map.has(id)) map.set(id, info);
    }
  }
  return map;
}

/** Sums additions and deletions across a commit's diff (binary files count as 0). */
export function getDiffStats(root: string, sha: string): DiffStats {
  const r = git(root, ["show", "--numstat", "--format=", sha]);
  let additions = 0;
  let deletions = 0;
  if (r.ok) {
    for (const line of r.stdout.split("\n")) {
      if (!line) continue;
      const [add, del] = line.split("\t");
      if (add && add !== "-") additions += Number(add) || 0;
      if (del && del !== "-") deletions += Number(del) || 0;
    }
  }
  return { additions, deletions };
}
