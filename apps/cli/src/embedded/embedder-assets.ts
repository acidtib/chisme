/**
 * Points at the onnxruntime-web WASM assets embedded into a compiled binary.
 *
 * In dev (and when assets are unavailable) this is null, and the embedder uses the
 * native onnxruntime-node backend resolved from node_modules instead.
 *
 * `apps/cli/build.ts` overwrites this file during `bun build --compile` to embed
 * the WASM binary and its mjs loader via `import ... with { type: "file" }`, then
 * restores this placeholder afterwards. The WASM is platform-independent, so it is
 * embedded for every target. Do not commit the embedding variant.
 */
export const embedderAssets: { wasm: string; loader: string } | null = null;
