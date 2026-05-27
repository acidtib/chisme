#!/usr/bin/env bun
/**
 * chisme CLI entry point.
 *
 * Stage 1 skeleton: `version`, `help`, `status`, and `agent install` are
 * functional. `search`, `index`/`sync`, and `list` are declared but not yet
 * implemented; they exit non-zero with a pointer to PLAN.md. The dispatch,
 * embedding plumbing, and binary build are real so the rest can be filled in.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir, databasePath } from "@chisme/core";
import { loadVecExtension } from "./runtime/vec.ts";
import agentTemplatePath from "./agent/chisme-search.md" with { type: "file" };

// Replaced at build time via `--define BUILD_VERSION`; falls back in dev.
declare const BUILD_VERSION: string | undefined;
const VERSION = typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "0.1.0-dev";

const USAGE = `chisme ${VERSION} - local search for AI coding sessions

Usage: chisme <command> [options]

Commands:
  search [query]    Search indexed checkpoints (hybrid local search)
  index             Fetch latest checkpoints and rebuild the local index
  sync              Alias for index
  status            Show index and environment status
  list              List recent checkpoints
  agent install     Write the Claude Code search subagent (.claude/agents)
  help              Show this help
  version           Show version and capabilities

See PLAN.md for the build roadmap.`;

const NOT_IMPLEMENTED = new Set(["search", "index", "sync", "list"]);

async function cmdVersion(): Promise<void> {
  const db = new Database(":memory:");
  const vec = await loadVecExtension(db);
  db.close();
  console.log(`chisme ${VERSION}`);
  console.log(`bun ${Bun.version}`);
  console.log(`platform ${process.platform}-${process.arch}`);
  console.log(
    `semantic search: ${
      vec.available ? `available (sqlite-vec ${vec.version}, ${vec.source})` : "unavailable (keyword-only)"
    }`,
  );
}

async function cmdStatus(): Promise<void> {
  const db = new Database(":memory:");
  const vec = await loadVecExtension(db);
  db.close();
  const dbPath = databasePath();
  console.log(`chisme ${VERSION}`);
  console.log(`data dir:   ${dataDir()}`);
  console.log(`index db:   ${dbPath} ${existsSync(dbPath) ? "(present)" : "(not created yet)"}`);
  console.log(`keyword search (FTS5): available`);
  console.log(
    `semantic search:       ${vec.available ? `available (sqlite-vec ${vec.version})` : "unavailable (keyword-only)"}`,
  );
  console.log("");
  console.log("Indexing is not implemented in this build yet (Stage 1 in progress). See PLAN.md.");
}

async function cmdAgent(args: string[]): Promise<void> {
  if (args[0] !== "install") {
    console.error("usage: chisme agent install [--force]");
    process.exit(1);
  }
  const force = args.includes("--force");
  const dir = join(process.cwd(), ".claude", "agents");
  const dest = join(dir, "chisme-search.md");
  if (existsSync(dest) && !force) {
    console.error(`chisme: ${dest} already exists. Use --force to overwrite.`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  await Bun.write(dest, await Bun.file(agentTemplatePath).text());
  console.log(`Wrote ${dest}`);
  console.log("The chisme-search subagent calls 'chisme search --json'.");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "help";
  const rest = argv.slice(1);

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      await cmdVersion();
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    case "status":
      await cmdStatus();
      return;
    case "agent":
      await cmdAgent(rest);
      return;
    default:
      if (NOT_IMPLEMENTED.has(command)) {
        console.error(`chisme: '${command}' is not implemented yet in this build (Stage 1 in progress).`);
        console.error("See PLAN.md for the roadmap.");
        process.exit(1);
      }
      console.error(`chisme: unknown command '${command}'. Run 'chisme help'.`);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(`chisme: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
