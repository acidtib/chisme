/**
 * These types mirror the on-disk layout Entire-compatible tooling writes to the
 * `entire/checkpoints/v1` git branch. chisme only ever reads it: it never captures
 * sessions or writes to that branch.
 */

export interface RepoRecord {
  id: number;
  /** `owner/repo`, derived from the git remote URL. */
  slug: string;
  remoteUrl: string | null;
  rootPath: string;
  lastSync: string | null;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  api_call_count?: number;
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

/** Paths to a single session's files within a checkpoint directory. */
export interface SessionFilePaths {
  metadata?: string;
  transcript?: string;
  context?: string;
  prompt?: string;
  content_hash?: string;
}

/** Top-level `metadata.json` for a checkpoint (the "checkpoint summary"). */
export interface CheckpointSummary {
  checkpoint_id: string;
  strategy?: string;
  branch?: string;
  checkpoints_count?: number;
  files_touched?: string[];
  sessions?: SessionFilePaths[];
  token_usage?: TokenUsage;
  created_at?: string;
  commit_hash?: string;
}

/** Per-session `metadata.json` (one level below the checkpoint summary). */
export interface SessionMetadata {
  checkpoint_id?: string;
  session_id?: string;
  strategy?: string;
  agent?: string;
  created_at?: string;
  branch?: string;
  token_usage?: TokenUsage;
  summary?: { text?: string; tool_breakdown?: Record<string, number> };
}

/** Git commit metadata linked to a checkpoint via its `Entire-Checkpoint` trailer. */
export interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  email: string;
  date: string;
}

/** A checkpoint as read from git, before it is indexed. */
export interface RawCheckpoint {
  id: string;
  /** Path within the checkpoints branch, e.g. `a3/b2c4d5e6f7`. */
  path: string;
  summary: CheckpointSummary;
  sessions: RawSession[];
}

export interface RawSession {
  index: number;
  metadata: SessionMetadata;
  /** Raw JSONL transcript text (may be empty if unavailable). */
  transcriptJsonl: string;
  prompt: string;
}

/** Which retrieval list(s) surfaced a result. */
export type MatchType = "keyword" | "semantic" | "both";

/** A single search result's payload. Mirrors Entire's `--json` schema exactly. */
export interface SearchResultData {
  id: string;
  prompt: string;
  commitMessage: string | null;
  commitSha: string | null;
  branch: string | null;
  /** Owner half of the `owner/repo` slug. */
  org: string | null;
  /** Repo half of the `owner/repo` slug. */
  repo: string | null;
  author: string | null;
  /** Always null locally; chisme has no entire.io account to resolve usernames. */
  authorUsername: string | null;
  createdAt: string | null;
  filesTouched: string[];
}

export interface SearchMeta {
  matchType: MatchType;
  score: number;
  snippet: string;
}

export interface SearchResult {
  type: "checkpoint";
  data: SearchResultData;
  searchMeta: SearchMeta;
}

/** The full `chisme search --json` response. */
export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  total_pages: number;
  limit: number;
}
