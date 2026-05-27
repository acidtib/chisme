/**
 * Resolves where chisme stores its global, multi-repo index.
 *
 * Uses each OS's native convention: `~/Library/Application Support` and
 * `~/Library/Caches` on macOS, `%APPDATA%` on Windows, and the XDG Base Directory
 * spec on Linux. `CHISME_DATA_DIR` overrides the data dir everywhere (tests and
 * power users); XDG vars are honored on Linux only.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Root directory for chisme's persistent data (the SQLite index lives here). */
export function dataDir(): string {
  const override = process.env.CHISME_DATA_DIR;
  if (override) return override;

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "chisme");
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "chisme");
  }

  // Linux and other unix: XDG.
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "chisme");
  return join(homedir(), ".local", "share", "chisme");
}

/** Absolute path to the global index database. */
export function databasePath(): string {
  return join(dataDir(), "chisme.db");
}

/** Directory transformers.js uses to cache downloaded embedding models. */
export function modelCacheDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "chisme", "models");
  }

  // Linux and other unix: XDG cache. (Windows has no native ML-cache convention
  // we rely on, so it falls through to the same per-user cache dir.)
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
