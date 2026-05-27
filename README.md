# chisme

An Entire companion CLI. chisme indexes the AI coding sessions that
[Entire](https://entire.io) captures into a git branch and searches them on your
machine. No entire.io account, no hosted service, no GitHub app authorization.

> Status: Stage 1 complete. Indexing and hybrid search work, including semantic
> search inside the single binary. The HTTP API (server) is implemented; the web
> UI is still a Stage 2 placeholder. See [PLAN.md](PLAN.md) for the roadmap.

## Why

Entire captures every AI agent session as a checkpoint and stores it locally in
git, on the `entire/checkpoints/v1` branch. But Entire's search is hosted: to
search your own history you have to authorize your repository to entire.io and use
their web interface. chisme replaces that hosted layer with a local one, so your
session history stays on your machine.

## Install

Linux and macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/acidtib/chisme/main/bin/install.sh | sh
```

This downloads the right binary for your OS and architecture from the
[latest release](https://github.com/acidtib/chisme/releases/latest), verifies its
checksum, and installs it to `~/.local/bin` (override with `CHISME_INSTALL_DIR`).
On Windows, download `chisme-windows-x64.exe` from the
[releases page](https://github.com/acidtib/chisme/releases).

Or build from source (requires [Bun](https://bun.sh)):

```sh
git clone https://github.com/acidtib/chisme
cd chisme
bun install
bun run install:cli   # builds and installs ./chisme to ~/.local/bin
```

`install:cli` builds the binary and copies it onto your PATH. Override the target
with `CHISME_INSTALL_DIR=/some/bin bun run install:cli`. To build without
installing, use `bun run build:cli` (produces `./chisme` at the repo root).

## Usage

```
chisme sync                    # fetch and index this repo's checkpoints
chisme search "query"          # hybrid local search
                               #   flags: --json --limit --page
                               #          --author --branch --date --repo
                               #   inline filters: author: date: branch: repo:
chisme list                    # list recent checkpoints
chisme status                  # index and environment status
chisme agent install <agent>   # install the chisme-search subagent (agent required)
                               #   agent: claude | codex | gemini | cursor | pi | all
chisme version                 # version and capabilities
chisme help                    # help
```

`chisme agent install <agent>` writes a chisme-search subagent that searches your
history by calling `chisme search --json`. The agent is required. Supported agents: Claude Code
(`.claude/agents/chisme-search.md`), Codex
(`.codex/agents/chisme-search.toml`), Gemini CLI (`.gemini/agents/chisme-search.md`),
Cursor (`.cursor/commands/chisme-search.md`), and Pi
(`.pi/skills/chisme-search/SKILL.md`). Use `all` to install every variant.

## How it works

- Reads the `entire/checkpoints/v1` git branch. chisme is read-only over checkpoint
  data: it never writes to that branch and never installs capture hooks.
- Indexes checkpoints into a local SQLite database in your data directory, tagged by
  repository so one index can span all the repos you work in.
- Hybrid search: SQLite FTS5 keyword search plus `sqlite-vec` semantic search, with
  local embeddings via transformers.js. It degrades to keyword-only when the semantic
  pieces are unavailable, so search always works.

## Development

This is a Bun workspace monorepo:

- `packages/core` (`@chisme/core`): git checkpoint reading, the SQLite index, embeddings, search.
- `apps/cli` (`chisme`): the command-line tool.
- `apps/server` (`@chisme/server`): read-only HTTP API over core (Stage 2, implemented).
- `apps/web` (`@chisme/web`): browser UI (Stage 2, placeholder).

```sh
bun install
bun run chisme -- help          # run the CLI in dev
bun run dev:server              # run the HTTP API on http://localhost:4123
bun run --filter '*' typecheck  # typecheck every workspace
```

## License

MIT. See [LICENSE](LICENSE).
