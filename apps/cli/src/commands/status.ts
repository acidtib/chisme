/**
 * `chisme status` - index location, contents, and search capabilities.
 *
 * Reports without triggering side effects: capability checks use an in-memory db
 * and probe whether the embedder package and its model are present (both filesystem
 * checks, no model download). The index file is opened only if it already exists,
 * so status never creates it.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import {
  databasePath,
  dataDir,
  allRepos,
  countCheckpoints,
  isEmbedderInstalled,
  isModelInstalled,
  openDatabase,
} from "@chisme/core";
import { loadVecExtension } from "../runtime/vec.ts";
import { colors } from "../cli/colors.ts";

export async function cmdStatus(version: string): Promise<void> {
  const probe = new Database(":memory:");
  const vec = await loadVecExtension(probe);
  probe.close();
  const embedderInstalled = await isEmbedderInstalled();
  const modelCached = embedderInstalled ? await isModelInstalled() : false;

  const dbPath = databasePath();
  const present = existsSync(dbPath);

  console.log(colors.bold(`chisme ${version}`));
  console.log(`data dir:   ${dataDir()}`);
  console.log(
    `index db:   ${dbPath} ${present ? colors.green("(present)") : colors.dim("(not created yet)")}`,
  );
  console.log("");
  console.log(`keyword search (FTS5):  ${colors.green("available")}`);
  console.log(
    `semantic storage (vec): ${vec.available ? colors.green(`available (sqlite-vec ${vec.version})`) : colors.yellow("unavailable")}`,
  );
  const embedderState = embedderInstalled
    ? `${colors.green("installed")} ${colors.dim(modelCached ? "(model ready)" : "(model downloads on first index)")}`
    : colors.yellow("not installed");
  console.log(`embedder (transformers): ${embedderState}`);

  if (!present) {
    console.log("");
    console.log("No index yet. Run 'chisme sync' from inside an Entire-enabled repo.");
    return;
  }

  const { db, close } = await openDatabase({
    vecLoader: async (d) => (await loadVecExtension(d)).available,
  });
  try {
    const total = countCheckpoints(db);
    const repos = allRepos(db);
    console.log("");
    console.log(
      `indexed: ${colors.bold(String(total))} checkpoints across ${repos.length} repo(s)`,
    );
    for (const repo of repos) {
      const count = countCheckpoints(db, repo.id);
      const synced = repo.lastSync
        ? new Date(repo.lastSync).toISOString().slice(0, 16).replace("T", " ")
        : "never";
      console.log(
        `  ${repo.slug.padEnd(32)} ${String(count).padStart(5)}  ${colors.dim(`last sync ${synced}`)}`,
      );
    }
  } finally {
    close();
  }
}
