import { search } from "@chisme/core";
import { parseSearchArgs } from "../cli/args.ts";
import { openDb } from "../cli/db.ts";
import { setupEmbedder } from "../runtime/embedder.ts";
import { printSearchHuman, printSearchJson, shouldUseJson } from "../cli/output.ts";

const HELP = `chisme search [query] [flags]

Search indexed checkpoints with hybrid keyword + semantic ranking.

Flags:
  --json              machine-readable output (auto when piped)
  --limit <N>         results per page (default 25)
  --page <N>          1-based page (default 1)
  --author <name>     filter by commit author
  --branch <name>     filter by branch
  --date <week|month> recency window
  --repo <owner/repo> scope to a repo ('*' = all; omitted = current repo)
  --no-semantic       keyword-only, even if semantic is available

Inline filters also work in the query: author:, date:, branch:, repo:
e.g. chisme search "auth middleware" author:"alice smith" date:month`;

export async function cmdSearch(argv: string[]): Promise<void> {
  const args = parseSearchArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  await setupEmbedder();
  const useJson = shouldUseJson(args.json);
  const { db, vecAvailable, close } = await openDb();
  try {
    const { response, info } = await search(args.query, {
      db,
      vecAvailable,
      cwd: process.cwd(),
      repo: args.repo,
      limit: args.limit,
      page: args.page,
      author: args.author,
      branch: args.branch,
      date: args.date,
      semantic: args.semantic,
    });
    if (useJson) printSearchJson(response);
    else printSearchHuman(response, info);
  } finally {
    close();
  }
}
