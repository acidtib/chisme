/**
 * In dev this is a no-op (`embedderAssets` is null, the native onnxruntime-node
 * backend is used). In a compiled binary we extract the embedded onnxruntime-web WASM
 * and its mjs loader to the data dir, then force core's embedder onto the WASM backend
 * at those paths. Never throws; on failure the embedder stays unavailable.
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { configureEmbedder, dataDir } from "@chisme/core";
import { embedderAssets } from "../embedded/embedder-assets.ts";

async function extract(assetPath: string, destPath: string): Promise<void> {
  if (existsSync(destPath)) return;
  writeFileSync(destPath, new Uint8Array(await Bun.file(assetPath).arrayBuffer()));
}

export async function setupEmbedder(): Promise<void> {
  if (!embedderAssets) return; // dev / native backend: nothing to do

  try {
    const dir = join(dataDir(), "runtime");
    mkdirSync(dir, { recursive: true });
    const wasmPath = join(dir, "ort-wasm-simd-threaded.wasm");
    const mjsPath = join(dir, "ort-wasm-simd-threaded.mjs");
    await extract(embedderAssets.wasm, wasmPath);
    await extract(embedderAssets.loader, mjsPath);
    configureEmbedder({
      forceWebBackend: true,
      wasmPaths: { wasm: `file://${wasmPath}`, mjs: `file://${mjsPath}` },
    });
  } catch {
    // leave the embedder on its default path; it will report unavailable
  }
}
