#!/usr/bin/env bun
/**
 * Bumps the chisme version everywhere it is recorded: every workspace package.json
 * and the two hardcoded version strings in source (the CLI dev fallback and the
 * server's reported version). Run from the repo root.
 *
 * Usage:
 *   bun run bump <major|minor|patch>   bump from the current root version
 *   bun run bump <x.y.z>               set an explicit version
 *
 * Edits files only: it does not commit, tag, or push. Each value is replaced with a
 * targeted regex so the surrounding formatting stays byte-identical.
 */
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = import.meta.dir;

// Every package.json carries the version; the first `"version"` key in each is the
// package's own (the regex is non-global, so it only touches that line).
const PACKAGE_JSONS = [
  "package.json",
  "apps/cli/package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/core/package.json",
];

const SEMVER = /^\d+\.\d+\.\d+$/;

function rootVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

function nextVersion(current: string, arg: string): string {
  if (SEMVER.test(arg)) return arg;
  const m = current.match(SEMVER) ? current.split(".").map(Number) : null;
  if (!m) throw new Error(`current version '${current}' is not x.y.z`);
  let [major, minor, patch] = m as [number, number, number];
  switch (arg) {
    case "major":
      major++;
      minor = 0;
      patch = 0;
      break;
    case "minor":
      minor++;
      patch = 0;
      break;
    case "patch":
      patch++;
      break;
    default:
      throw new Error(`invalid argument '${arg}'. Use major, minor, patch, or an explicit x.y.z.`);
  }
  return `${major}.${minor}.${patch}`;
}

/** Replaces the first match of `pattern` in a file. Returns true if it changed. */
function replaceInFile(relPath: string, pattern: RegExp, replacement: string): boolean {
  const path = join(ROOT, relPath);
  const text = readFileSync(path, "utf8");
  const next = text.replace(pattern, replacement);
  if (next === text) return false;
  writeFileSync(path, next);
  return true;
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: bun run bump <major|minor|patch|x.y.z>");
  process.exit(1);
}

const current = rootVersion();
const version = nextVersion(current, arg);
const changed: string[] = [];

for (const p of PACKAGE_JSONS) {
  if (replaceInFile(p, /("version":\s*")[^"]+(")/, `$1${version}$2`)) changed.push(p);
}

// CLI dev fallback. The shipped version is injected from package.json at build time
// (BUILD_VERSION); this string only shows when running via `bun` in dev.
if (
  replaceInFile(
    "apps/cli/src/main.ts",
    /(BUILD_VERSION !== "undefined" \? BUILD_VERSION : ")[^"]+(")/,
    `$1${version}-dev$2`,
  )
) {
  changed.push("apps/cli/src/main.ts");
}

// Server version, reported on /api/health.
if (replaceInFile("apps/server/src/main.ts", /(const VERSION = ")[^"]+(")/, `$1${version}$2`)) {
  changed.push("apps/server/src/main.ts");
}

console.log(`chisme ${current} -> ${version}`);
if (changed.length === 0) {
  console.log("  (already at this version; nothing changed)");
} else {
  for (const f of changed) console.log(`  updated ${f}`);
  console.log(`\nReview the diff, then commit and tag (git tag v${version}) when ready.`);
}
