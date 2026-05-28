import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.ts";
import { upsertRepo } from "../db/repos.ts";
import { type CheckpointInput, upsertCheckpoint } from "../db/checkpoints.ts";
import { search, type SearchOptions } from "./search.ts";

function makeInput(
  over: Partial<CheckpointInput> & { repoId: number; checkpointId: string },
): CheckpointInput {
  return {
    branch: null,
    commitSha: null,
    commitMessage: null,
    author: null,
    authorEmail: null,
    createdAt: null,
    filesTouched: [],
    strategy: null,
    inputTokens: null,
    outputTokens: null,
    additions: null,
    deletions: null,
    prompt: "",
    summary: "",
    transcriptText: "",
    embedding: null,
    ...over,
  };
}

function freshDb(): Database {
  const db = new Database(":memory:");
  applySchema(db, false);
  return db;
}

// Keyword-only: no cwd (so scope is "all repos" without touching git) and vec off.
function run(db: Database, query: string, opts: Partial<SearchOptions> = {}) {
  return search(query, { db, vecAvailable: false, repo: "*", ...opts });
}

describe("search (keyword path)", () => {
  test("returns only matching checkpoints, marked as keyword matches", async () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "cp1", prompt: "implement oauth login flow" }),
      false,
    );
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "cp2", prompt: "refactor database schema" }),
      false,
    );

    const { response, info } = await run(db, "oauth");
    expect(response.total).toBe(1);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]!.data.id).toBe("cp1");
    expect(response.results[0]!.searchMeta.matchType).toBe("keyword");
    expect(info.keywordUsed).toBe(true);
    expect(info.semanticUsed).toBe(false);
  });

  test("empty query falls back to match-all ordered by recency", async () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
      false,
    );
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "new", createdAt: "2026-05-01T00:00:00.000Z" }),
      false,
    );

    const { response, info } = await run(db, "   ");
    expect(info.keywordUsed).toBe(false);
    expect(response.total).toBe(2);
    expect(response.results.map((r) => r.data.id)).toEqual(["new", "old"]);
  });

  test("author filter matches a case-insensitive substring", async () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");
    upsertCheckpoint(
      db,
      makeInput({
        repoId: repo.id,
        checkpointId: "cp1",
        prompt: "shared topic",
        author: "Ada Lovelace",
      }),
      false,
    );
    upsertCheckpoint(
      db,
      makeInput({
        repoId: repo.id,
        checkpointId: "cp2",
        prompt: "shared topic",
        author: "Alan Turing",
      }),
      false,
    );

    const { response } = await run(db, "topic", { author: "lovelace" });
    expect(response.results.map((r) => r.data.id)).toEqual(["cp1"]);
  });

  test("branch filter is an exact, case-insensitive match", async () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "cp1", prompt: "shared topic", branch: "Main" }),
      false,
    );
    upsertCheckpoint(
      db,
      makeInput({
        repoId: repo.id,
        checkpointId: "cp2",
        prompt: "shared topic",
        branch: "feature",
      }),
      false,
    );

    const { response } = await run(db, "topic", { branch: "main" });
    expect(response.results.map((r) => r.data.id)).toEqual(["cp1"]);
  });

  test("date filter drops checkpoints older than the window", async () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const stale = new Date(Date.now() - 60 * 86_400_000).toISOString();
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "recent", createdAt: recent }),
      false,
    );
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "stale", createdAt: stale }),
      false,
    );

    const { response } = await run(db, "", { date: "week" });
    expect(response.results.map((r) => r.data.id)).toEqual(["recent"]);
  });

  test("repo scope restricts results to one indexed repo", async () => {
    const db = freshDb();
    const a = upsertRepo(db, "owner/a", null, "/tmp/a");
    const b = upsertRepo(db, "owner/b", null, "/tmp/b");
    upsertCheckpoint(
      db,
      makeInput({ repoId: a.id, checkpointId: "a1", prompt: "shared topic" }),
      false,
    );
    upsertCheckpoint(
      db,
      makeInput({ repoId: b.id, checkpointId: "b1", prompt: "shared topic" }),
      false,
    );

    const all = await run(db, "topic", { repo: "*" });
    expect(all.response.total).toBe(2);

    const scoped = await run(db, "topic", { repo: "owner/a" });
    expect(scoped.response.results.map((r) => r.data.id)).toEqual(["a1"]);
  });

  test("an unindexed repo scope matches nothing", async () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "cp1", prompt: "topic" }),
      false,
    );

    const { response, info } = await run(db, "topic", { repo: "no/such" });
    expect(response.total).toBe(0);
    expect(response.results).toHaveLength(0);
    expect(info.scope).toContain("not indexed");
  });

  test("paginates by limit and reports total pages", async () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");
    for (const id of ["cp1", "cp2", "cp3"]) {
      upsertCheckpoint(
        db,
        makeInput({ repoId: repo.id, checkpointId: id, prompt: "shared topic" }),
        false,
      );
    }

    const page1 = await run(db, "topic", { limit: 2, page: 1 });
    expect(page1.response.total).toBe(3);
    expect(page1.response.total_pages).toBe(2);
    expect(page1.response.results).toHaveLength(2);

    const page2 = await run(db, "topic", { limit: 2, page: 2 });
    expect(page2.response.results).toHaveLength(1);
  });
});
