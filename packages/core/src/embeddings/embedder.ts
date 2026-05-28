/**
 * Local text embeddings via transformers.js (no API key, no daemon).
 *
 * The model (Xenova/all-MiniLM-L6-v2, 384-dim) and its runtime are loaded lazily
 * through a dynamic import inside try/catch, so the CLI still runs keyword-only if
 * the package or model is unavailable. The first call downloads the model into
 * `modelCacheDir()` (roughly 30 to 90 MB); subsequent calls hit the cache.
 *
 * Backend selection: in dev / `bun install`, transformers picks onnxruntime-node
 * (native, fast). A compiled binary cannot bundle that native addon, so the CLI
 * calls `configureEmbedder` with `forceWebBackend` plus the extracted WASM paths;
 * we then steer transformers onto its bundled onnxruntime-web (WASM) backend. The
 * two backends produce effectively identical vectors (cosine ~0.993).
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { modelCacheDir } from "../config/paths.ts";

const MODEL = "Xenova/all-MiniLM-L6-v2";

/** A transformers.js model-loading progress event (passed to `progress_callback`). */
export interface ModelProgress {
  status: string;
  name?: string;
  file?: string;
  /** 0..100 for the current file, present on `status: "progress"`. */
  progress?: number;
  loaded?: number;
  total?: number;
}

interface EmbedderConfig {
  /** Force the WASM backend even under a Node-like runtime (for compiled binaries). */
  forceWebBackend?: boolean;
  /** Local paths to the onnxruntime-web wasm binary and its mjs loader. */
  wasmPaths?: { wasm: string; mjs: string };
  /** Override the model cache directory. */
  cacheDir?: string;
  /** Called with transformers.js load events; fires only when files are downloaded. */
  onModelProgress?: (p: ModelProgress) => void;
}

type FeatureExtractor = (
  text: string,
  opts: Record<string, unknown>,
) => Promise<{ data: Float32Array }>;

let config: EmbedderConfig = {};
let pipe: FeatureExtractor | null = null;
let initPromise: Promise<void> | null = null;
let available = false;

/**
 * Configures how the embedder backend loads. Must be called before the first
 * `embed`/`isEmbedderAvailable` call (config applied during lazy init). A no-op
 * default keeps the dev path on the native backend.
 */
export function configureEmbedder(next: EmbedderConfig): void {
  config = { ...config, ...next };
}

async function init(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // Steer transformers onto its bundled WASM backend before it loads: its
      // backend choice keys on process.release.name === 'node'.
      if (config.forceWebBackend && process.release?.name === "node") {
        Object.defineProperty(process, "release", {
          value: { ...process.release, name: "chisme-bun" },
          configurable: true,
        });
      }

      const transformers = await import("@huggingface/transformers");
      transformers.env.cacheDir = config.cacheDir ?? modelCacheDir();

      if (config.wasmPaths) {
        const wasm = transformers.env.backends.onnx.wasm as {
          wasmPaths?: { wasm: string; mjs: string };
          numThreads?: number;
        };
        wasm.wasmPaths = config.wasmPaths;
        // Keep this at 1. numThreads > 1 makes onnxruntime-web spawn a Web Worker
        // thread pool, which Bun terminates ("Worker has been terminated"), so the
        // embedder would fail. A separate Bun worker pool was also investigated and
        // dropped (slower for normal-size indexes; see PLAN.md Section 10).
        wasm.numThreads = 1;
      }

      const options = config.onModelProgress
        ? { progress_callback: config.onModelProgress }
        : undefined;
      pipe = (await transformers.pipeline(
        "feature-extraction",
        MODEL,
        options,
      )) as unknown as FeatureExtractor;
      available = true;
    } catch {
      pipe = null;
      available = false;
    }
  })();
  return initPromise;
}

/**
 * Whether the embedder package can be imported at all, without loading the model.
 * Used by `status` so it does not trigger a model download.
 */
export async function isEmbedderInstalled(): Promise<boolean> {
  try {
    await import("@huggingface/transformers");
    return true;
  } catch {
    return false;
  }
}

function modelDir(): string {
  return join(config.cacheDir ?? modelCacheDir(), ...MODEL.split("/"));
}

/**
 * Whether the embedding model is already downloaded into the cache, checked from
 * disk without loading it (so it never triggers a download). Lets callers show
 * download feedback only on the first run. Conservative: true only when an .onnx
 * weight file is present, so an interrupted download still counts as not installed.
 */
export async function isModelInstalled(): Promise<boolean> {
  try {
    const dir = modelDir();
    if (!existsSync(dir)) return false;
    const onnxDir = join(dir, "onnx");
    const files = readdirSync(existsSync(onnxDir) ? onnxDir : dir);
    return files.some((f) => f.endsWith(".onnx"));
  } catch {
    return false;
  }
}

export async function isEmbedderAvailable(): Promise<boolean> {
  await init();
  return available;
}

/** Embeds text into a normalized 384-dim vector, or null if unavailable. */
export async function embed(text: string): Promise<Float32Array | null> {
  await init();
  if (!pipe) return null;
  try {
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return new Float32Array(output.data);
  } catch {
    return null;
  }
}
