/**
 * `chisme agent install <agent>` - write the chisme-search subagent.
 *
 * Mirrors the search subagents Entire ships, adapted to call `chisme search --json`
 * against the local index. One template per supported tool, each shipped embedded
 * in the binary via `with { type: "file" }`:
 *   claude -> .claude/agents/chisme-search.md
 *   codex  -> .codex/agents/chisme-search.toml
 *   gemini -> .gemini/agents/chisme-search.md
 *   cursor -> .cursor/commands/chisme-search.md
 *   pi     -> .pi/skills/chisme-search/SKILL.md
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import claudeTemplate from "../agent/chisme-search.claude.md" with { type: "file" };
import codexTemplate from "../agent/chisme-search.codex.toml" with { type: "file" };
import geminiTemplate from "../agent/chisme-search.gemini.md" with { type: "file" };
import cursorTemplate from "../agent/chisme-search.cursor.md" with { type: "file" };
import piTemplate from "../agent/chisme-search.pi.md" with { type: "file" };

export interface AgentVariant {
  label: string;
  dir: string;
  file: string;
  template: string;
  /** The Entire CLI `--agent` value this variant corresponds to. */
  entireName: string;
  /**
   * Path (relative to the repo root) where `entire enable` writes its own
   * `entire-search` subagent, which `chisme enable` removes in favor of ours.
   * Entire only ships one for some agents; the path is still defined so a future
   * Entire release that adds it gets cleaned up too.
   */
  entireSearch: string;
  /** Whether `entireSearch` is a directory to remove wholesale (Pi's skill dir). */
  entireSearchIsDir: boolean;
}

export const VARIANTS: Record<string, AgentVariant> = {
  claude: {
    label: "Claude Code",
    dir: join(".claude", "agents"),
    file: "chisme-search.md",
    template: claudeTemplate,
    entireName: "claude-code",
    entireSearch: join(".claude", "agents", "entire-search.md"),
    entireSearchIsDir: false,
  },
  codex: {
    label: "Codex",
    dir: join(".codex", "agents"),
    file: "chisme-search.toml",
    template: codexTemplate,
    entireName: "codex",
    entireSearch: join(".codex", "agents", "entire-search.toml"),
    entireSearchIsDir: false,
  },
  gemini: {
    label: "Gemini CLI",
    dir: join(".gemini", "agents"),
    file: "chisme-search.md",
    template: geminiTemplate,
    entireName: "gemini",
    entireSearch: join(".gemini", "agents", "entire-search.md"),
    entireSearchIsDir: false,
  },
  cursor: {
    label: "Cursor",
    dir: join(".cursor", "commands"),
    file: "chisme-search.md",
    template: cursorTemplate,
    entireName: "cursor",
    entireSearch: join(".cursor", "commands", "entire-search.md"),
    entireSearchIsDir: false,
  },
  pi: {
    label: "Pi",
    dir: join(".pi", "skills", "chisme-search"),
    file: "SKILL.md",
    template: piTemplate,
    entireName: "pi",
    entireSearch: join(".pi", "skills", "entire-search"),
    entireSearchIsDir: true,
  },
};

/** Looks up a variant by the Entire CLI agent name (e.g. `claude-code`). */
export const VARIANT_BY_ENTIRE_NAME: Record<string, AgentVariant> = Object.fromEntries(
  Object.values(VARIANTS).map((v) => [v.entireName, v]),
);

/**
 * Writes one variant's subagent into the current repo. Returns whether it wrote
 * or skipped (an existing file without `--force`). Shared by `agent install` and
 * `enable`.
 */
export async function installVariant(
  variant: AgentVariant,
  force: boolean,
): Promise<"wrote" | "skipped"> {
  const dir = join(process.cwd(), variant.dir);
  const dest = join(dir, variant.file);
  if (existsSync(dest) && !force) {
    console.error(`chisme: ${dest} already exists. Use --force to overwrite.`);
    return "skipped";
  }
  mkdirSync(dir, { recursive: true });
  await Bun.write(dest, await Bun.file(variant.template).text());
  console.log(`Wrote ${dest} (${variant.label})`);
  return "wrote";
}

const HELP = `chisme agent install <agent> [--force]

Write the chisme-search subagent (it calls 'chisme search --json') for an AI coding tool.
An agent is required.

Agents:
  claude   Claude Code   .claude/agents/chisme-search.md
  codex    Codex         .codex/agents/chisme-search.toml
  gemini   Gemini CLI    .gemini/agents/chisme-search.md
  cursor   Cursor        .cursor/commands/chisme-search.md
  pi       Pi            .pi/skills/chisme-search/SKILL.md
  all      install every variant above

Flags:
  --force   overwrite an existing subagent file`;

export async function cmdAgent(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (argv[0] !== "install") {
    console.error("usage: chisme agent install <agent> [--force]");
    process.exit(1);
  }

  const force = argv.includes("--force");
  const target = argv.slice(1).find((a) => !a.startsWith("-"));
  if (!target) {
    console.error(
      `usage: chisme agent install <agent> [--force]\n` +
        `chisme: an agent is required. Choose one of: ${Object.keys(VARIANTS).join(", ")}, all.`,
    );
    process.exit(1);
  }

  let names: string[];
  if (target === "all") {
    names = Object.keys(VARIANTS);
  } else if (VARIANTS[target]) {
    names = [target];
  } else {
    console.error(
      `chisme: unknown agent '${target}'. Choose one of: ${Object.keys(VARIANTS).join(", ")}, all.`,
    );
    process.exit(1);
  }

  let wrote = 0;
  let skipped = 0;
  for (const name of names) {
    const result = await installVariant(VARIANTS[name]!, force);
    if (result === "wrote") wrote++;
    else skipped++;
  }

  if (wrote > 0) console.log("The chisme-search subagent calls 'chisme search --json'.");
  else if (skipped > 0) process.exit(1);
}
