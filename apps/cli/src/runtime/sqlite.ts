/**
 * Points bun:sqlite at an extension-capable SQLite on macOS.
 *
 * macOS's system SQLite (which Bun uses by default for a performance win) is built
 * without loadable extensions, so sqlite-vec can't load and semantic search degrades
 * to keyword-only. Database.setCustomSQLite() redirects bun:sqlite to a vanilla
 * SQLite that does support extensions. It must run before any Database is
 * constructed; setCustomSQLite throws once a database exists.
 *
 * Never throws out of here: on failure we stay on the system SQLite and search runs
 * keyword-only. No-op on Linux and Windows, where Bun's bundled SQLite already loads
 * extensions. Compiled macOS binaries use a self-contained libsqlite3 embedded by
 * build.ts; dev (running via bun) probes common Homebrew locations instead.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dataDir } from "@chisme/core";
import { customSqliteEmbeddedPath } from "../embedded/sqlite-lib.ts";

// Vanilla SQLite installs that ship with loadable extensions enabled (Homebrew).
const DEV_DARWIN_CANDIDATES = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon Homebrew
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel Homebrew
];

let installed = false;

async function resolveCustomSqlitePath(): Promise<string | null> {
  // 1. Embedded into a compiled binary: extract to the data dir, then use it.
  if (customSqliteEmbeddedPath) {
    try {
      const bytes = new Uint8Array(await Bun.file(customSqliteEmbeddedPath).arrayBuffer());
      const dir = join(dataDir(), "runtime");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, "libsqlite3.dylib");
      if (!existsSync(path)) writeFileSync(path, bytes);
      return path;
    } catch {
      // fall through to dev probing
    }
  }

  // 2. Dev: a Homebrew-installed vanilla SQLite, if present.
  for (const candidate of DEV_DARWIN_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * On macOS, redirect bun:sqlite to an extension-capable SQLite so sqlite-vec can
 * load. No-op on other platforms and idempotent. Call once at startup, before
 * opening any database.
 */
export async function installCustomSqlite(): Promise<void> {
  if (installed) return;
  installed = true;
  if (process.platform !== "darwin") return;

  const path = await resolveCustomSqlitePath();
  if (!path) return;
  try {
    Database.setCustomSQLite(path);
  } catch {
    // Already opened a database, or the library is unusable: stay on system SQLite.
  }
}
