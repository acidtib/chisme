/**
 * `chisme sync` - fetch remote checkpoints and (re)index this repo.
 */
import { syncRepo, configureEmbedder, isModelInstalled, type ModelProgress } from "@chisme/core";
import { parseSyncArgs } from "../cli/args.ts";
import { openDb } from "../cli/db.ts";
import { setupEmbedder } from "../runtime/embedder.ts";
import { colors } from "../cli/colors.ts";

/**
 * Reports the embedding model download to stderr. Wired only on the first index
 * (model not yet cached), so it prints nothing on subsequent runs. transformers.js
 * fires `progress` events only while fetching, so a cached read stays silent too.
 */
function makeModelDownloadReporter(isTty: boolean): (p: ModelProgress) => void {
  let started = false;
  return (p) => {
    if (p.status === "progress" && typeof p.progress === "number") {
      if (!started) {
        started = true;
        if (!isTty) process.stderr.write("Downloading embedding model (first run, ~30-90 MB)...\n");
      }
      if (isTty) {
        const pct = Math.min(100, Math.max(0, Math.round(p.progress)));
        process.stderr.write(`\r\x1b[K  downloading embedding model ${pct}%`);
      }
    } else if (p.status === "ready" && started) {
      started = false;
      if (isTty) process.stderr.write("\r\x1b[K");
    }
  };
}

const HELP = `chisme sync [flags]

Fetch the latest remote checkpoints and incrementally index this repo.

Flags:
  --full            wipe this repo's rows and reindex from scratch
  --limit <N>       index only the newest N checkpoints
  --remote <name>   git remote to fetch from (default origin)`;

export async function cmdSync(argv: string[]): Promise<void> {
  const args = parseSyncArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  await setupEmbedder();
  const isTty = Boolean(process.stderr.isTTY);
  const { db, vecAvailable, close } = await openDb();
  try {
    // Show model-download feedback only on the first index: when vector storage is
    // available (so the embedder will run) and the model is not cached yet.
    if (vecAvailable && !(await isModelInstalled())) {
      configureEmbedder({ onModelProgress: makeModelDownloadReporter(isTty) });
    }

    const result = await syncRepo({
      cwd: process.cwd(),
      db,
      vecAvailable,
      full: args.full,
      remote: args.remote,
      limit: args.limit,
      onProgress: isTty
        ? (done, total) => process.stderr.write(`\r  indexing ${done}/${total}`)
        : undefined,
    });
    if (isTty) process.stderr.write("\r\x1b[K");

    if (result.noCheckpoints) {
      console.log(
        `No checkpoints found on entire/checkpoints/v1 for ${result.slug}. Is this repo using Entire?`,
      );
      return;
    }

    const summary = `synced ${result.synced}, skipped ${result.skipped}, failed ${result.failed} in ${result.durationMs}ms`;
    console.log(`${colors.green("Indexed")} ${result.slug}: ${summary}`);

    if (!vecAvailable) {
      console.log(
        colors.dim("  semantic search unavailable (sqlite-vec not loaded); keyword-only index."),
      );
    } else if (result.synced > 0 && !result.embedderUsed) {
      console.log(colors.dim("  embeddings unavailable; new checkpoints indexed keyword-only."));
    }
  } finally {
    close();
  }
}
