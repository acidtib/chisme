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
export function repoSlug(root: string, remote = "origin"): { slug: string; remoteUrl: string | null } {
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
  return { hash, subject: subject ?? "", author: author ?? "", email: email ?? "", date: date ?? "" };
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
