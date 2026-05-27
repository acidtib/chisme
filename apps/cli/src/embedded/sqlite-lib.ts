/**
 * Points at a vanilla SQLite dynamic library embedded into a compiled macOS binary.
 *
 * macOS ships Apple's system SQLite, which Bun uses by default and which is built
 * without loadable-extension support, so bun:sqlite cannot load sqlite-vec there.
 * To restore semantic search we embed a self-contained libsqlite3 (built with FTS5
 * and extension loading) and point bun:sqlite at it via Database.setCustomSQLite()
 * before any database opens (see ../runtime/sqlite.ts).
 *
 * Null in dev and on every non-macOS target. `apps/cli/build.ts` overwrites this
 * file during `bun build --compile` for darwin targets to embed the dylib via
 * `import ... with { type: "file" }`, then restores this placeholder afterwards.
 * Do not commit the embedding variant.
 */
export const customSqliteEmbeddedPath: string | null = null;
