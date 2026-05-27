/**
 * Points at the sqlite-vec loadable extension embedded into a compiled binary.
 *
 * In dev (and in keyword-only builds) this is null, and the extension is resolved
 * from node_modules at runtime instead (see ../runtime/vec.ts).
 *
 * `apps/cli/build.ts` overwrites this file during `bun build --compile` to embed
 * the per-platform extension via `import ... with { type: "file" }`, then restores
 * this placeholder afterwards. Do not commit the embedding variant.
 */
export const vec0EmbeddedPath: string | null = null;
