/**
 * Opens the chisme index database and wires up optional semantic search.
 *
 * Keyword search (FTS5) is built into bun:sqlite and always works. The sqlite-vec
 * extension is loaded through a caller-supplied `vecLoader` so the binary (which
 * embeds the extension) and dev (node_modules) can differ. If no loader is given,
 * or it fails, we fall back to resolving the extension from node_modules; if that
 * also fails we run keyword-only. Loading never throws out of here.
 */
import { Database } from "bun:sqlite";
import { databasePath, ensureDataDir } from "../config/paths.ts";
import { applySchema } from "./schema.ts";

/** Loads sqlite-vec into a db. Returns true if semantic search is usable. */
export type VecLoader = (db: Database) => boolean | Promise<boolean>;

export interface OpenOptions {
  /** Database file path; defaults to the global index. Use ":memory:" for tests. */
  path?: string;
  /** Caller-provided extension loader (the CLI injects its embedded-aware one). */
  vecLoader?: VecLoader;
}

export interface ChismeDb {
  db: Database;
  /** True when sqlite-vec loaded and the vec0 table exists. */
  vecAvailable: boolean;
  path: string;
  close(): void;
}

/** Default loader: resolve the extension from node_modules (dev / `bun install`). */
async function defaultVecLoader(db: Database): Promise<boolean> {
  try {
    const { getLoadablePath } = await import("sqlite-vec");
    db.loadExtension(getLoadablePath(), "sqlite3_vec_init");
    return true;
  } catch {
    return false;
  }
}

export async function openDatabase(opts: OpenOptions = {}): Promise<ChismeDb> {
  const path = opts.path ?? databasePath();
  if (path !== ":memory:") ensureDataDir();

  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  const loader = opts.vecLoader ?? defaultVecLoader;
  let vecAvailable = false;
  try {
    vecAvailable = await loader(db);
  } catch {
    vecAvailable = false;
  }

  applySchema(db, vecAvailable);

  return {
    db,
    vecAvailable,
    path,
    close: () => db.close(),
  };
}
