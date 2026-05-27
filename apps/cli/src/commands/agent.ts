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

interface AgentVariant {
  label: string;
  dir: string;
  file: string;
  template: string;
}

const VARIANTS: Record<string, AgentVariant> = {
  claude: {
    label: "Claude Code",
    dir: join(".claude", "agents"),
    file: "chisme-search.md",
    template: claudeTemplate,
  },
  codex: {
    label: "Codex",
    dir: join(".codex", "agents"),
    file: "chisme-search.toml",
    template: codexTemplate,
  },
  gemini: {
    label: "Gemini CLI",
    dir: join(".gemini", "agents"),
    file: "chisme-search.md",
    template: geminiTemplate,
  },
  cursor: {
    label: "Cursor",
    dir: join(".cursor", "commands"),
    file: "chisme-search.md",
    template: cursorTemplate,
  },
  pi: {
    label: "Pi",
    dir: join(".pi", "skills", "chisme-search"),
    file: "SKILL.md",
    template: piTemplate,
  },
};

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
    const variant = VARIANTS[name]!;
    const dir = join(process.cwd(), variant.dir);
    const dest = join(dir, variant.file);
    if (existsSync(dest) && !force) {
      console.error(`chisme: ${dest} already exists. Use --force to overwrite.`);
      skipped++;
      continue;
    }
    mkdirSync(dir, { recursive: true });
    await Bun.write(dest, await Bun.file(variant.template).text());
    console.log(`Wrote ${dest} (${variant.label})`);
    wrote++;
  }

  if (wrote > 0) console.log("The chisme-search subagent calls 'chisme search --json'.");
  else if (skipped > 0) process.exit(1);
}
