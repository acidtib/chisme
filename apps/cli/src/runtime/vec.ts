/**
 * Loads the sqlite-vec extension into a bun:sqlite database.
 *
 * Tries the binary-embedded copy first (compiled builds), then falls back to the
 * node_modules copy (dev / `bun install`). Never throws: if neither works, the
 * caller runs keyword-only. The explicit `sqlite3_vec_init` entry point makes the
 * load independent of the extracted file name.
 */
import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dataDir } from "@chisme/core";
import { vec0EmbeddedPath } from "../embedded/vec-extension.ts";

const VEC_ENTRY_POINT = "sqlite3_vec_init";

export interface VecStatus {
  available: boolean;
  source: "embedded" | "node_modules" | "none";
  version?: string;
  error?: string;
}

function runtimeExtensionName(): string {
  if (process.platform === "win32") return "vec0.dll";
  if (process.platform === "darwin") return "vec0.dylib";
  return "vec0.so";
}

function vecVersion(db: Database): string | undefined {
  try {
    return (db.query("select vec_version() as v").get() as { v: string } | null)?.v;
  } catch {
    return undefined;
  }
}

export async function loadVecExtension(db: Database): Promise<VecStatus> {
  // 1. Extension embedded into a compiled binary: extract to the data dir, then load.
  if (vec0EmbeddedPath) {
    try {
      const bytes = new Uint8Array(await Bun.file(vec0EmbeddedPath).arrayBuffer());
      const dir = join(dataDir(), "runtime");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, runtimeExtensionName());
      if (!existsSync(path)) writeFileSync(path, bytes);
      db.loadExtension(path, VEC_ENTRY_POINT);
      return { available: true, source: "embedded", version: vecVersion(db) };
    } catch {
      // fall through to node_modules
    }
  }

  // 2. Extension resolved from node_modules (dev).
  try {
    const { getLoadablePath } = await import("sqlite-vec");
    db.loadExtension(getLoadablePath(), VEC_ENTRY_POINT);
    return { available: true, source: "node_modules", version: vecVersion(db) };
  } catch (error) {
    return { available: false, source: "none", error: String(error).slice(0, 200) };
  }
}
