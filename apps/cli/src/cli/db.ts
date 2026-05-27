/**
 * Opens the index database with the CLI's vec loader.
 *
 * Core's default loader resolves sqlite-vec from node_modules. The CLI overrides
 * it with `loadVecExtension`, which also handles the copy embedded into a compiled
 * binary (see ../runtime/vec.ts). Either way, failure degrades to keyword-only.
 */
import { openDatabase, type ChismeDb } from "@chisme/core";
import { loadVecExtension } from "../runtime/vec.ts";

export function openDb(): Promise<ChismeDb> {
  return openDatabase({
    vecLoader: async (db) => (await loadVecExtension(db)).available,
  });
}
