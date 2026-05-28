/**
 * `chisme enable --agent <name> [entire enable flags]` - enable Entire for an
 * agent, then swap Entire's `entire-search` subagent for chisme's `chisme-search`.
 *
 * This shells out to `entire enable`, forwarding the arguments you pass (plus
 * `--telemetry=false` and `--yes` as defaults, see parseEnableArgs), so any flag
 * the installed Entire CLI accepts works here (telemetry, repo bootstrap,
 * --force, --local, ...). After Entire succeeds we remove the `entire-search`
 * file it wrote (which searches the hosted service) and install ours in its
 * place (which searches the local chisme index). chisme stays read-only over the
 * checkpoint branch: it only touches the agent's own search-subagent file.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { installVariant, VARIANT_BY_ENTIRE_NAME, VARIANTS } from "./agent.ts";
import { parseEnableArgs } from "../cli/args.ts";
import { colors } from "../cli/colors.ts";

const HELP = `chisme enable --agent <name> [entire enable flags]

Enable Entire for an AI agent, then replace Entire's entire-search subagent with
chisme-search so history search runs against the local chisme index.

This runs 'entire enable' with every flag you pass, so anything that command
accepts works here. --agent is required (it selects the chisme-search variant).

Agents with a chisme-search subagent: claude-code, codex, gemini, cursor, pi.
Other agents Entire supports still get enabled; chisme skips the subagent swap.

Examples:
  chisme enable --agent claude-code
  chisme enable --agent codex

Run 'entire enable --help' for the full list of Entire flags.`;

export async function cmdEnable(argv: string[]): Promise<void> {
  const args = parseEnableArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (!args.agent) {
    console.error(
      "usage: chisme enable --agent <name> [entire enable flags]\n" +
        `chisme: --agent is required. Agents with a chisme-search subagent: ${Object.values(
          VARIANTS,
        )
          .map((v) => v.entireName)
          .join(", ")}.`,
    );
    process.exit(1);
  }

  // 1. Run `entire enable` with the user's arguments, inheriting stdio so its
  //    prompts and progress show through.
  let result: { exitCode: number | null };
  try {
    result = Bun.spawnSync(["entire", "enable", ...args.forward], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch {
    console.error(
      `${colors.red("chisme:")} could not run 'entire'. Install the Entire CLI and put it on PATH: https://github.com/entireio/cli`,
    );
    process.exit(1);
  }
  if (result.exitCode !== 0) {
    console.error(
      `${colors.red("chisme:")} entire enable exited with code ${result.exitCode}; leaving subagent files untouched.`,
    );
    process.exit(result.exitCode ?? 1);
  }

  // 2. Swap the search subagent, but only for agents chisme ships one for.
  const variant = VARIANT_BY_ENTIRE_NAME[args.agent];
  if (!variant) {
    console.log(
      colors.dim(`  chisme: no chisme-search subagent for '${args.agent}'; enabled Entire only.`),
    );
    return;
  }

  const entireSearch = join(process.cwd(), variant.entireSearch);
  if (existsSync(entireSearch)) {
    rmSync(entireSearch, { recursive: variant.entireSearchIsDir, force: true });
    console.log(`Removed ${entireSearch} (Entire's search subagent)`);
  }

  await installVariant(variant, true);
  console.log("The chisme-search subagent calls 'chisme search --json'.");
}
