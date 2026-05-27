# chisme

An Entire companion CLI. chisme indexes the AI coding sessions that
[Entire](https://entire.io) captures into a git branch and searches them on your
machine. No entire.io account, no hosted service, no GitHub app authorization.

> Status: Stage 1 complete. Indexing and hybrid search work, including semantic
> search inside the single binary. The server and web UI are Stage 2 stubs. See
> [PLAN.md](PLAN.md) for the roadmap.

## Why

Entire captures every AI agent session as a checkpoint and stores it locally in
git, on the `entire/checkpoints/v1` branch. That capture is useful and chisme
relies on it. But Entire's search is hosted: to search your own history you have
to authorize your repository to entire.io and use their web interface. chisme
replaces that hosted layer with a local one, so your session history stays on your
machine.

## Install

Once a release is published:

```sh
curl -fsSL https://raw.githubusercontent.com/acidtib/chisme/main/bin/install.sh | sh
```

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
chisme index               # fetch and index this repo's checkpoints   (planned)
chisme search "query"      # hybrid local search                       (planned)
                           #   flags: --json --limit --page
                           #          --author --branch --date --repo
chisme list                # list recent checkpoints                   (planned)
chisme status              # index and environment status              (works)
chisme agent install       # install the chisme-search Claude subagent (works)
chisme version             # version and capabilities                  (works)
chisme help                # help                                      (works)
```

`chisme agent install` writes a Claude Code subagent (`.claude/agents/chisme-search.md`)
that searches your history by calling `chisme search --json`.

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
- `apps/server` (`@chisme/server`) and `apps/web` (`@chisme/web`): Stage 2, stubs for now.

```sh
bun install
bun run chisme -- help          # run the CLI in dev
bun run --filter '*' typecheck  # typecheck every workspace
```

## License

MIT. See [LICENSE](LICENSE).
