/**
 * Public entry point for @chisme/core.
 *
 * Re-exports the stable surface so apps import from "@chisme/core" rather than
 * reaching into deep paths.
 */
export * from "./types.ts";
export * from "./config/paths.ts";

// git
export * from "./git/repo.ts";
export * from "./git/checkpoints.ts";

// parsing
export * from "./parser/transcript.ts";

// database
export * from "./db/database.ts";
export * from "./db/schema.ts";
export * from "./db/repos.ts";
export * from "./db/checkpoints.ts";

// embeddings
export * from "./embeddings/embedder.ts";

// indexing and search
export * from "./index/sync.ts";
export * from "./search/search.ts";
export * from "./search/fts.ts";
