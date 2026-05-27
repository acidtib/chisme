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
- `apps/cli` (`chisme`): the command-line tool. Stage 1 focus.
- `apps/server` (`@chisme/server`): HTTP API over core. Stage 2, stub for now.
- `apps/web` (`@chisme/web`): browser UI. Stage 2, stub for now.

## Commands

- `bun install`: install all workspaces.
- `bun run chisme -- <args>`: run the CLI in dev (e.g. `bun run chisme -- search "auth"`).
- `bun run build:cli`: compile the single `chisme` binary.
- `bun run --filter '*' typecheck`: typecheck every workspace.

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
- Commit or push only when the user asks. This project directory may not be a git repo yet; do not
  run `git init` without asking.

### Engineering

- Keyword search (FTS5) must always work. Semantic search (sqlite-vec + transformers.js) is optional
  and loaded via dynamic import inside try/catch; degrade to keyword-only if it is unavailable.
- chisme is read-only over git checkpoint data. It never writes to the `entire/checkpoints/v1`
  branch and never installs agent hooks.
- Keep writes to the index idempotent so re-syncs are safe.
