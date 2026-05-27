#!/usr/bin/env bun
/**
 * chisme CLI entry point and command dispatch.
 *
 * Local search and viewer for AI coding sessions captured as Entire checkpoints.
 * Keyword search always works; semantic search is enabled when sqlite-vec and the
 * embedding model are available, and degrades gracefully otherwise.
 */
import { Database } from "bun:sqlite";
import { isEmbedderInstalled } from "@chisme/core";
import { loadVecExtension } from "./runtime/vec.ts";
import { colors } from "./cli/colors.ts";
import { cmdSearch } from "./commands/search.ts";
import { cmdSync } from "./commands/sync.ts";
import { cmdList } from "./commands/list.ts";
import { cmdStatus } from "./commands/status.ts";
import { cmdAgent } from "./commands/agent.ts";

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
  help [command]    Show help
  version           Show version and capabilities

Run 'chisme <command> --help' for command-specific flags.`;

async function cmdVersion(): Promise<void> {
  const db = new Database(":memory:");
  const vec = await loadVecExtension(db);
  db.close();
  const embedder = await isEmbedderInstalled();
  console.log(`chisme ${VERSION}`);
  console.log(`bun ${Bun.version}`);
  console.log(`platform ${process.platform}-${process.arch}`);
  console.log(
    `semantic search: ${
      vec.available
        ? `${embedder ? "available" : "storage only (embedder not installed)"} (sqlite-vec ${vec.version}, ${vec.source})`
        : "unavailable (keyword-only)"
    }`,
  );
}

const COMMANDS = new Set(["search", "index", "sync", "list", "status", "agent"]);

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
    case "-h": {
      // `chisme help <command>` delegates to that command's own --help.
      const target = rest[0];
      if (target && COMMANDS.has(target)) {
        await dispatch(target, ["--help"]);
      } else {
        console.log(USAGE);
      }
      return;
    }
    case "search":
    case "index":
    case "sync":
    case "list":
    case "status":
    case "agent":
      await dispatch(command, rest);
      return;
    default:
      console.error(`chisme: unknown command '${command}'. Run 'chisme help'.`);
      process.exit(1);
  }
}

async function dispatch(command: string, rest: string[]): Promise<void> {
  switch (command) {
    case "search":
      return cmdSearch(rest);
    case "index":
    case "sync":
      return cmdSync(rest);
    case "list":
      return cmdList(rest);
    case "status":
      return cmdStatus(VERSION);
    case "agent":
      return cmdAgent(rest);
  }
}

main().catch((error: unknown) => {
  console.error(`${colors.red("chisme:")} ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
