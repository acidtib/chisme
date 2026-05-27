/**
 * Resolves where chisme stores its global, multi-repo index.
 *
 * Follows the XDG Base Directory spec on Linux/macOS, falling back to sensible
 * per-platform defaults. Honors CHISME_DATA_DIR for tests and power users.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Root directory for chisme's persistent data (the SQLite index lives here). */
export function dataDir(): string {
  const override = process.env.CHISME_DATA_DIR;
  if (override) return override;

  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "chisme");

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "chisme");
  }

  return join(homedir(), ".local", "share", "chisme");
}

/** Absolute path to the global index database. */
export function databasePath(): string {
  return join(dataDir(), "chisme.db");
}

/** Directory transformers.js uses to cache downloaded embedding models. */
export function modelCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg ? join(xdg, "chisme") : join(homedir(), ".cache", "chisme");
  return join(base, "models");
}

/** Ensures the data directory exists and returns it. */
export function ensureDataDir(): string {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
