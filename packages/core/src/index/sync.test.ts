import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.ts";
import { getCheckpointDetail, knownCheckpointIds } from "../db/checkpoints.ts";
import { search } from "../search/search.ts";
import { syncRepo } from "./sync.ts";

const tmpDirs: string[] = [];

function gitc(dir: string, args: string[]): void {
  const r = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
}

function initRepo(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), "chisme-sync-"));
  tmpDirs.push(dir);
  const r = Bun.spawnSync(["git", "init", "-q", "-b", branch, dir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`git init failed: ${r.stderr.toString()}`);
  gitc(dir, ["config", "user.email", "test@example.com"]);
  gitc(dir, ["config", "user.name", "Test Author"]);
  gitc(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

interface CheckpointSpec {
  id: string;
  branch: string;
  createdAt: string;
  files: string[];
  summary: string;
  prompt: string;
  transcript: string;
}

function writeCheckpoint(dir: string, c: CheckpointSpec): void {
  const base = join(dir, c.id.slice(0, 2), c.id.slice(2));
  mkdirSync(join(base, "0"), { recursive: true });
  writeFileSync(
    join(base, "metadata.json"),
    JSON.stringify({
      checkpoint_id: c.id,
      branch: c.branch,
      created_at: c.createdAt,
      files_touched: c.files,
      strategy: "implement",
      token_usage: { input_tokens: 100, output_tokens: 50 },
    }),
  );
  writeFileSync(
    join(base, "0", "metadata.json"),
    JSON.stringify({ created_at: c.createdAt, summary: { text: c.summary } }),
  );
  writeFileSync(join(base, "0", "full.jsonl"), `${c.transcript}\n`);
  writeFileSync(join(base, "0", "prompt.txt"), c.prompt);
}

// Each checkpoint is added in its own commit whose message carries the
// `Entire-Checkpoint` trailer, mirroring how Entire records checkpoints.
function commitCheckpoint(dir: string, c: CheckpointSpec, subject: string): void {
  writeCheckpoint(dir, c);
  gitc(dir, ["add", "-A"]);
  gitc(dir, ["commit", "-q", "-m", `${subject}\n\nEntire-Checkpoint: ${c.id}`]);
}

let repo: string;
let emptyRepo: string;

beforeAll(() => {
  // A repo whose only branch is the checkpoints branch (chisme only reads refs,
  // never the working tree), with two checkpoints committed oldest-first.
  repo = initRepo("entire/checkpoints/v1");
  commitCheckpoint(
    repo,
    {
      id: "abc123",
      branch: "feature/oauth",
      createdAt: "2026-05-01T10:00:00Z",
      files: ["src/auth.ts", "src/login.ts"],
      summary: "Implemented OAuth login flow",
      prompt: "implement oauth login flow",
      transcript: '{"type":"user","message":{"role":"user","content":"add oauth"}}',
    },
    "feat: implement oauth login",
  );
  commitCheckpoint(
    repo,
    {
      id: "def456",
      branch: "main",
      createdAt: "2026-05-10T12:00:00Z",
      files: ["README.md"],
      summary: "Updated the docs",
      prompt: "update readme docs",
      transcript: '{"type":"user","message":{"role":"user","content":"docs"}}',
    },
    "docs: update readme",
  );

  // A plain repo with no checkpoints branch at all.
  emptyRepo = initRepo("main");
  writeFileSync(join(emptyRepo, "file.txt"), "hello");
  gitc(emptyRepo, ["add", "-A"]);
  gitc(emptyRepo, ["commit", "-q", "-m", "init"]);
});

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Database {
  const db = new Database(":memory:");
  applySchema(db, false);
  return db;
}

describe("syncRepo", () => {
  test("indexes checkpoints with their linked commit metadata", async () => {
    const db = freshDb();
    const result = await syncRepo({ cwd: repo, db, vecAvailable: false });

    expect(result.noCheckpoints).toBe(false);
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(2);
    expect(result.slug.startsWith("local/")).toBe(true);

    const detail = getCheckpointDetail(db, "abc123");
    expect(detail).not.toBeNull();
    expect(detail!.commitMessage).toBe("feat: implement oauth login");
    expect(detail!.author).toBe("Test Author");
    expect(detail!.branch).toBe("feature/oauth");
    expect(detail!.createdAt).toBe("2026-05-01T10:00:00.000Z");
    expect(detail!.filesTouched).toEqual(["src/auth.ts", "src/login.ts"]);

    // The indexed prompt is searchable through the keyword path.
    const { response } = await search("oauth", { db, vecAvailable: false, repo: "*" });
    expect(response.results.map((r) => r.data.id)).toEqual(["abc123"]);
  });

  test("re-syncing is idempotent: known checkpoints are skipped", async () => {
    const db = freshDb();
    await syncRepo({ cwd: repo, db, vecAvailable: false });
    const second = await syncRepo({ cwd: repo, db, vecAvailable: false });

    expect(second.synced).toBe(0);
    expect(second.skipped).toBe(2);
    expect(knownCheckpointIds(db, 1)).toEqual(new Set(["abc123", "def456"]));
  });

  test("--limit indexes only the newest checkpoint", async () => {
    const db = freshDb();
    const result = await syncRepo({ cwd: repo, db, vecAvailable: false, limit: 1 });

    expect(result.synced).toBe(1);
    expect(getCheckpointDetail(db, "def456")).not.toBeNull();
    expect(getCheckpointDetail(db, "abc123")).toBeNull();
  });

  test("--full wipes and reindexes without duplicating", async () => {
    const db = freshDb();
    await syncRepo({ cwd: repo, db, vecAvailable: false });
    const full = await syncRepo({ cwd: repo, db, vecAvailable: false, full: true });

    expect(full.synced).toBe(2);
    expect(knownCheckpointIds(db, 1).size).toBe(2);
  });

  test("reports noCheckpoints when the branch is absent", async () => {
    const db = freshDb();
    const result = await syncRepo({ cwd: emptyRepo, db, vecAvailable: false });

    expect(result.noCheckpoints).toBe(true);
    expect(result.ref).toBeNull();
    expect(result.synced).toBe(0);
  });
});
