/**
 * `chisme agent install` - write the Claude Code search subagent.
 *
 * The template ships embedded in the binary via `with { type: "file" }`. We write
 * it to `.claude/agents/chisme-search.md` in the current repo, refusing to clobber
 * an existing file unless `--force` is given.
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import agentTemplatePath from "../agent/chisme-search.md" with { type: "file" };

const HELP = `chisme agent install [--force]

Write the Claude Code search subagent to .claude/agents/chisme-search.md.
It calls 'chisme search --json' against your local index.

Flags:
  --force   overwrite an existing subagent file`;

export async function cmdAgent(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (argv[0] !== "install") {
    console.error("usage: chisme agent install [--force]");
    process.exit(1);
  }

  const force = argv.includes("--force");
  const dir = join(process.cwd(), ".claude", "agents");
  const dest = join(dir, "chisme-search.md");
  if (existsSync(dest) && !force) {
    console.error(`chisme: ${dest} already exists. Use --force to overwrite.`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  await Bun.write(dest, await Bun.file(agentTemplatePath).text());
  console.log(`Wrote ${dest}`);
  console.log("The chisme-search subagent calls 'chisme search --json'.");
}
