# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

chisme is an Entire companion CLI. It indexes the AI coding sessions Entire captures on the
`entire/checkpoints/v1` git branch into a local SQLite database and searches them on your machine,
with no entire.io account and no hosted service.

## Start here

Read `PLAN.md` before writing any code. It is the source of truth for the architecture, the locked
decisions, the source data format, the SQLite schema, the sync and search flows, the CLI surface,
and the file-by-file build plan. Do not relitigate decisions recorded there without asking the user.

## Layout

- `packages/core` (`@chisme/core`): git checkpoint reading, the SQLite index, embeddings, hybrid search.
- `apps/cli` (`chisme`): the command-line tool. Stage 1, complete.
- `apps/server` (`@chisme/server`): read-only HTTP API over core (Stage 2). Routes implemented.
- `apps/web` (`@chisme/web`): browser UI. Stage 2, placeholder (not built yet).

## Commands

- `bun install`: install all workspaces.
- `bun run chisme -- <args>`: run the CLI in dev (e.g. `bun run chisme -- search "auth"`).
- `bun run build:cli`: compile the single `chisme` binary to `./chisme`.
- `bun run install:cli`: build then install the binary to `~/.local/bin` (override `CHISME_INSTALL_DIR`).
- `bun run bump <major|minor|patch|x.y.z>`: set the version across every package.json and the two
  hardcoded version strings in source. Edits files only; commit and tag (`git tag vX.Y.Z`) separately.
- `bun run dev:server`: run the Stage 2 HTTP API on http://localhost:4123.
- `bun run --filter '*' typecheck`: typecheck every workspace.
- `bun test`: run the test suite (Bun's built-in runner; tests are `*.test.ts` co-located with the
  module they cover).
- `bun run check`: Biome lint + format with `--write` (fixes in place). `bun run lint` and
  `bun run format` run those halves alone; `bun run ci` is the read-only check CI uses.

CI (`.github/workflows/ci.yml`) runs typecheck, `bun run ci`, and `bun test` on every push to `main`
and every pull request. `release.yml` still owns the per-platform binary build and smoke test on tags.

## Conventions

### Writing style

Applies to code comments, docs, commit messages, PR descriptions, and chat responses.

- No emojis. Anywhere.
- No em-dashes (the `—` character). Use a comma, a colon, parentheses, or rewrite the sentence.
- Plain, direct language. No summary or marketing filler ("comprehensive", "seamless", "robust
  solution", "let's dive in", "in conclusion", "it's worth noting that"). State the thing and stop.

### Git

- Never add a `Co-Authored-By: Claude ...` trailer, a "Generated with Claude Code" line, or any
  other Claude or Anthropic attribution to commits or pull requests. Commits are authored by the
  user only.
- Commit or push only when the user asks. Work is trunk-based: commits land directly on `main`.

### Engineering

- Keyword search (FTS5) must always work. Semantic search (sqlite-vec + transformers.js) is optional
  and loaded via dynamic import inside try/catch; degrade to keyword-only if it is unavailable.
- chisme is read-only over git checkpoint data. It never writes to the `entire/checkpoints/v1`
  branch and never installs agent hooks.
- Keep writes to the index idempotent so re-syncs are safe.
- The compiled binary embeds the sqlite-vec extension and the onnxruntime-web WASM, and stubs the
  native `onnxruntime-node` / `sharp` imports at build time. On macOS it also embeds a vanilla
  `libsqlite3` and calls `Database.setCustomSQLite()` at startup (see `src/runtime/sqlite.ts`),
  because Apple's system SQLite (Bun's default) cannot load extensions, so sqlite-vec would fail
  there otherwise. Read PLAN.md Sections 10 and 11 before changing `build.ts`.
- Build with Bun >= 1.3.13. Bun 1.3.12 has a `bun build --compile` regression that emits a truncated
  macOS code signature, so the arm64/x64 binaries are SIGKILLed by AMFI on launch (just prints
  "killed"); it shipped in v0.2.1. CI pins a fixed Bun and release.yml runs `codesign --verify` on the
  macOS binaries so a future signing regression fails the release instead of shipping an unrunnable binary.
- Embeddings run single-threaded (`numThreads = 1`). Multi-threaded WASM fails under Bun ("Worker
  has been terminated") and a worker pool was investigated and dropped. Do not reintroduce threading
  without re-reading PLAN.md Section 10.
- Lint and format are Biome (`biome.json`). The `noNonNullAssertion` rule is off on purpose: tsconfig
  sets `noUncheckedIndexedAccess`, so `!` on known-safe indexed and regex-match access is the intended
  escape hatch. The build.ts platform matrix is kept aligned with a `// biome-ignore format:` line.
  `biome.json` must stay strict JSON (no comments); only `biome.jsonc` allows them.
