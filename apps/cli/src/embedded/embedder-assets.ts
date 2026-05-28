/**
 * Points at the onnxruntime-web WASM assets embedded into a compiled binary; null in
 * dev (the native onnxruntime-node backend is used instead). `apps/cli/build.ts`
 * overwrites this file during `bun build --compile` to embed the WASM and its mjs
 * loader via `import ... with { type: "file" }` (platform-independent, every target),
 * then restores this placeholder. Do not commit the embedding variant.
 */
export const embedderAssets: { wasm: string; loader: string } | null = null;
