/**
 * `chisme list [flags]` - show recent checkpoints from the index.
 */
import { recentCheckpoints, getRepoBySlug } from "@chisme/core";
import { parseListArgs } from "../cli/args.ts";
import { openDb } from "../cli/db.ts";
import { printListHuman, printListJson, shouldUseJson } from "../cli/output.ts";

const HELP = `chisme list [flags]

List the most recent indexed checkpoints.

Flags:
  --repo <owner/repo>  scope to a repo ('*' or omitted = all indexed repos)
  --limit <N>          how many to show (default 25)
  --json               machine-readable output (auto when piped)`;

export async function cmdList(argv: string[]): Promise<void> {
  const args = parseListArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  const { db, close } = await openDb();
  try {
    let repoId: number | undefined;
    if (args.repo && args.repo !== "*") {
      const repo = getRepoBySlug(db, args.repo);
      if (!repo) {
        if (shouldUseJson(args.json)) printListJson([]);
        else console.log(`${args.repo} is not indexed. Run 'chisme index' inside it.`);
        return;
      }
      repoId = repo.id;
    }

    const rows = recentCheckpoints(db, { repoId, limit: args.limit });
    if (shouldUseJson(args.json)) printListJson(rows);
    else printListHuman(rows);
  } finally {
    close();
  }
}
