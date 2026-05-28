import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "./schema.ts";
import { upsertRepo } from "./repos.ts";
import {
  type CheckpointInput,
  clearRepo,
  countCheckpoints,
  knownCheckpointIds,
  recentCheckpoints,
  upsertCheckpoint,
} from "./checkpoints.ts";

function freshDb(): Database {
  const db = new Database(":memory:");
  applySchema(db, false);
  return db;
}

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

function ftsCount(db: Database, term: string): number {
  const row = db
    .query("SELECT COUNT(*) AS n FROM checkpoints_fts WHERE checkpoints_fts MATCH ?")
    .get(term) as { n: number };
  return row.n;
}

describe("upsertCheckpoint", () => {
  test("re-upserting the same id keeps a single row and applies the latest fields", () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");

    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "cp1", prompt: "first" }),
      false,
    );
    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "cp1", prompt: "second" }),
      false,
    );

    expect(countCheckpoints(db, repo.id)).toBe(1);
    const stored = recentCheckpoints(db, { repoId: repo.id });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.prompt).toBe("second");
  });

  test("re-upsert relinks FTS without leaving the old text behind", () => {
    const db = freshDb();
    const repo = upsertRepo(db, "owner/repo", null, "/tmp/repo");

    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "cp1", prompt: "alpha" }),
      false,
    );
    expect(ftsCount(db, "alpha")).toBe(1);

    upsertCheckpoint(
      db,
      makeInput({ repoId: repo.id, checkpointId: "cp1", prompt: "beta" }),
      false,
    );
    expect(ftsCount(db, "alpha")).toBe(0);
    expect(ftsCount(db, "beta")).toBe(1);
  });
});

describe("knownCheckpointIds", () => {
  test("returns only the ids belonging to the given repo", () => {
    const db = freshDb();
    const a = upsertRepo(db, "owner/a", null, "/tmp/a");
    const b = upsertRepo(db, "owner/b", null, "/tmp/b");
    upsertCheckpoint(db, makeInput({ repoId: a.id, checkpointId: "a1" }), false);
    upsertCheckpoint(db, makeInput({ repoId: a.id, checkpointId: "a2" }), false);
    upsertCheckpoint(db, makeInput({ repoId: b.id, checkpointId: "b1" }), false);

    expect(knownCheckpointIds(db, a.id)).toEqual(new Set(["a1", "a2"]));
    expect(knownCheckpointIds(db, b.id)).toEqual(new Set(["b1"]));
  });
});

describe("clearRepo", () => {
  test("removes rows and FTS entries for one repo only", () => {
    const db = freshDb();
    const a = upsertRepo(db, "owner/a", null, "/tmp/a");
    const b = upsertRepo(db, "owner/b", null, "/tmp/b");
    upsertCheckpoint(db, makeInput({ repoId: a.id, checkpointId: "a1", prompt: "keepme" }), false);
    upsertCheckpoint(db, makeInput({ repoId: b.id, checkpointId: "b1", prompt: "dropme" }), false);

    clearRepo(db, b.id, false);

    expect(countCheckpoints(db, a.id)).toBe(1);
    expect(countCheckpoints(db, b.id)).toBe(0);
    expect(ftsCount(db, "dropme")).toBe(0);
    expect(ftsCount(db, "keepme")).toBe(1);
  });
});

describe("recentCheckpoints", () => {
  test("orders by created_at desc, then id desc", () => {
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

    const ids = recentCheckpoints(db, { repoId: repo.id }).map((c) => c.checkpointId);
    expect(ids).toEqual(["new", "old"]);
  });
});
