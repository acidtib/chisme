/**
 * Points at a vanilla SQLite dylib embedded into a compiled macOS binary (so bun:sqlite
 * can load sqlite-vec; see ../runtime/sqlite.ts). Null in dev and on every non-macOS
 * target. `apps/cli/build.ts` overwrites this file during `bun build --compile` for
 * darwin targets to embed the dylib via `import ... with { type: "file" }`, then
 * restores this placeholder. Do not commit the embedding variant.
 */
export const customSqliteEmbeddedPath: string | null = null;
