/**
 * Local text embeddings via transformers.js (no API key, no daemon).
 *
 * The model (Xenova/all-MiniLM-L6-v2, 384-dim) and its runtime are loaded lazily
 * through a dynamic import inside try/catch, so the CLI still runs keyword-only if
 * the package or model is unavailable. The first call downloads the model into
 * `modelCacheDir()` (roughly 30 to 90 MB); subsequent calls hit the cache.
 */
import { modelCacheDir } from "../config/paths.ts";

const MODEL = "Xenova/all-MiniLM-L6-v2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FeatureExtractor = (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;

let pipe: FeatureExtractor | null = null;
let initPromise: Promise<void> | null = null;
let available = false;

async function init(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const transformers = await import("@huggingface/transformers");
      transformers.env.cacheDir = modelCacheDir();
      pipe = (await transformers.pipeline("feature-extraction", MODEL)) as unknown as FeatureExtractor;
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

/** True once the model pipeline has loaded successfully. */
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
