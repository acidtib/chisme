/**
 * Argument parsing for the chisme CLI.
 *
 * Wraps Node's built-in `util.parseArgs` (available in Bun) and adds the inline
 * filter parser: `author:`, `date:`, `branch:`, and `repo:` embedded in the query
 * string, with optional quoted values. Explicit flags take precedence over inline
 * filters when both are present.
 */
import { parseArgs } from "node:util";

export interface InlineFilters {
  text: string;
  author?: string;
  branch?: string;
  date?: string;
  repo?: string;
}

const INLINE = /\b(author|date|branch|repo):("([^"]*)"|'([^']*)'|(\S+))/gi;

/** Pulls `key:value` filters out of a query string, returning them and the rest. */
export function parseInlineFilters(query: string): InlineFilters {
  const filters: InlineFilters = { text: "" };
  const stripped = query.replace(INLINE, (_m, key: string, _v, dq, sq, bare) => {
    const value: string = dq ?? sq ?? bare ?? "";
    const field = key.toLowerCase() as "author" | "date" | "branch" | "repo";
    filters[field] = value;
    return " ";
  });
  filters.text = stripped.replace(/\s+/g, " ").trim();
  return filters;
}

function toInt(value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function coerceDate(value: string | undefined): "week" | "month" | undefined {
  return value === "week" || value === "month" ? value : undefined;
}

export interface SearchArgs {
  query: string;
  json: boolean;
  limit: number;
  page: number;
  author?: string;
  branch?: string;
  date?: "week" | "month";
  repo?: string;
  semantic: boolean;
  help: boolean;
}

export function parseSearchArgs(argv: string[]): SearchArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      limit: { type: "string" },
      page: { type: "string" },
      author: { type: "string" },
      branch: { type: "string" },
      date: { type: "string" },
      repo: { type: "string" },
      semantic: { type: "boolean" },
      "no-semantic": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const inline = parseInlineFilters(positionals.join(" "));

  return {
    query: inline.text,
    json: Boolean(values.json),
    limit: toInt(values.limit, 25),
    page: toInt(values.page, 1),
    author: values.author ?? inline.author,
    branch: values.branch ?? inline.branch,
    date: coerceDate(values.date ?? inline.date),
    repo: values.repo ?? inline.repo,
    semantic: !values["no-semantic"],
    help: Boolean(values.help),
  };
}

export interface SyncArgs {
  full: boolean;
  remote: string;
  limit?: number;
  help: boolean;
}

export function parseSyncArgs(argv: string[]): SyncArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      full: { type: "boolean" },
      remote: { type: "string" },
      limit: { type: "string" },
      // The timing breakdown is always printed now; still accepted so an explicit
      // `--timings` does not error.
      timings: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const limit = values.limit != null ? Number.parseInt(values.limit, 10) : undefined;
  return {
    full: Boolean(values.full),
    remote: values.remote ?? "origin",
    limit: limit != null && Number.isFinite(limit) && limit > 0 ? limit : undefined,
    help: Boolean(values.help),
  };
}

export interface EnableArgs {
  /** The Entire `--agent` value, needed to pick the chisme-search variant. */
  agent?: string;
  help: boolean;
  /** Arguments to pass to `entire enable`: the caller's argv plus injected defaults. */
  forward: string[];
}

/**
 * Parses `chisme enable` arguments. Unlike the other commands we do not validate
 * flags here: everything is forwarded to `entire enable`, so any flag that CLI
 * accepts works. We only pull out `--agent` (to choose the chisme-search variant)
 * and `--help`/`-h` (to show chisme's help instead of running anything).
 *
 * We inject `--telemetry=false` and `--yes` as defaults so `chisme enable` is
 * private and non-interactive out of the box. Each is added only when the caller
 * did not already set it (so `--telemetry`/`--telemetry=true` or `-y`/`--yes`
 * still wins, with no duplicate flag).
 */
export function parseEnableArgs(argv: string[]): EnableArgs {
  let agent: string | undefined;
  let help = false;
  let hasTelemetry = false;
  let hasYes = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--agent") agent = argv[i + 1];
    else if (arg.startsWith("--agent=")) agent = arg.slice("--agent=".length);
    else if (arg === "--telemetry" || arg.startsWith("--telemetry=")) hasTelemetry = true;
    else if (arg === "--yes" || arg === "-y") hasYes = true;
  }
  const defaults: string[] = [];
  if (!hasTelemetry) defaults.push("--telemetry=false");
  if (!hasYes) defaults.push("--yes");
  return { agent, help, forward: [...defaults, ...argv] };
}

export interface ListArgs {
  repo?: string;
  limit: number;
  json: boolean;
  help: boolean;
}

export function parseListArgs(argv: string[]): ListArgs {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  return {
    repo: values.repo,
    limit: toInt(values.limit, 25),
    json: Boolean(values.json),
    help: Boolean(values.help),
  };
}
