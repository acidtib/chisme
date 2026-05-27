/**
 * `chisme index` (alias `chisme sync`) - fetch remote checkpoints and (re)index.
 */
import { syncRepo } from "@chisme/core";
import { parseSyncArgs } from "../cli/args.ts";
import { openDb } from "../cli/db.ts";
import { colors } from "../cli/colors.ts";

const HELP = `chisme index [flags]   (alias: chisme sync)

Fetch the latest remote checkpoints and incrementally index this repo.

Flags:
  --full            wipe this repo's rows and reindex from scratch
  --remote <name>   git remote to fetch from (default origin)`;

export async function cmdSync(argv: string[]): Promise<void> {
  const args = parseSyncArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  const isTty = Boolean(process.stderr.isTTY);
  const { db, vecAvailable, close } = await openDb();
  try {
    const result = await syncRepo({
      cwd: process.cwd(),
      db,
      vecAvailable,
      full: args.full,
      remote: args.remote,
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
      console.log(colors.dim("  semantic search unavailable (sqlite-vec not loaded); keyword-only index."));
    } else if (result.synced > 0 && !result.embedderUsed) {
      console.log(colors.dim("  embeddings unavailable; new checkpoints indexed keyword-only."));
    }
  } finally {
    close();
  }
}
