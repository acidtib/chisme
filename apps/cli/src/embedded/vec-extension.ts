/**
 * Points at the sqlite-vec extension embedded into a compiled binary; null in dev and
 * keyword-only builds (resolved from node_modules instead, see ../runtime/vec.ts).
 * `apps/cli/build.ts` overwrites this file during `bun build --compile` to embed the
 * per-platform extension via `import ... with { type: "file" }`, then restores this
 * placeholder. Do not commit the embedding variant.
 */
export const vec0EmbeddedPath: string | null = null;
