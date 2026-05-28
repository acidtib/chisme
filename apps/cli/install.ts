/**
 * Run after `bun run build:cli` (the root `install:cli` chains them): copies the
 * repo-root binary to `$CHISME_INSTALL_DIR` (default `~/.local/bin`), marks it
 * executable, and prints PATH guidance if that dir is not on PATH.
 */
import { homedir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "../..");
const isWindows = process.platform === "win32";
const binName = isWindows ? "chisme.exe" : "chisme";
const src = join(ROOT, binName);

if (!existsSync(src)) {
  console.error(`chisme: binary not found at ${src}. Run 'bun run build:cli' first.`);
  process.exit(1);
}

const installDir = process.env.CHISME_INSTALL_DIR ?? join(homedir(), ".local", "bin");
mkdirSync(installDir, { recursive: true });

const dest = join(installDir, binName);
copyFileSync(src, dest);
if (!isWindows) chmodSync(dest, 0o755);

console.log(`Installed ${dest}`);

const onPath = (process.env.PATH ?? "").split(delimiter).includes(installDir);
if (onPath) {
  console.log("Run 'chisme version' to verify.");
} else {
  console.log(`\nNote: ${installDir} is not on your PATH. Add it, for example:`);
  console.log(`  export PATH="${installDir}:$PATH"`);
}
