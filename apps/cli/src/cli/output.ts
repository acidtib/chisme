/**
 * Rendering for the CLI: a compact human table and machine JSON.
 *
 * When stdout is not a TTY we default to JSON, so pipes and the search subagent
 * always receive structured output without needing `--json`.
 */
import type { SearchResponse, SearchInfo, StoredCheckpoint } from "@chisme/core";
import { colors } from "./colors.ts";

/** JSON output is forced by `--json` or whenever stdout is not a terminal. */
export function shouldUseJson(flagJson: boolean): boolean {
  return flagJson || !process.stdout.isTTY;
}

function shortDate(iso: string | null): string {
  if (!iso) return "-".padEnd(16);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time}`;
}

function firstLine(text: string | null, max = 100): string {
  if (!text) return "";
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const clean = line.trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

export function printSearchJson(response: SearchResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

export function printSearchHuman(response: SearchResponse, info: SearchInfo): void {
  const caps = info.semanticUsed ? "hybrid (keyword + semantic)" : "keyword-only";
  console.log(colors.dim(`scope: ${info.scope}  |  ${caps}`));

  if (response.total === 0) {
    console.log("\nNo matching checkpoints. Try a broader query or run 'chisme index'.");
    return;
  }

  console.log("");
  for (const { data, searchMeta } of response.results) {
    const head = [
      colors.gray(shortDate(data.createdAt)),
      colors.cyan(data.id),
      colors.green(data.author ?? "unknown"),
      `${data.org ?? "?"}/${data.repo ?? "?"}`,
      colors.yellow(data.branch ?? "-"),
      colors.dim(`[${searchMeta.matchType}]`),
    ].join("  ");
    console.log(head);
    const prompt = firstLine(data.prompt);
    if (prompt) console.log(`  ${prompt}`);
    if (searchMeta.snippet) console.log(colors.dim(`  ${searchMeta.snippet.replace(/\s+/g, " ").trim()}`));
    console.log("");
  }

  const start = (response.page - 1) * response.limit + 1;
  const end = start + response.results.length - 1;
  console.log(
    colors.dim(
      `Showing ${start}-${end} of ${response.total} (page ${response.page}/${response.total_pages})`,
    ),
  );
}

export function printListJson(rows: StoredCheckpoint[]): void {
  process.stdout.write(`${JSON.stringify(rows)}\n`);
}

export function printListHuman(rows: StoredCheckpoint[]): void {
  if (rows.length === 0) {
    console.log("No checkpoints indexed. Run 'chisme index' from inside an Entire-enabled repo.");
    return;
  }
  for (const c of rows) {
    const head = [
      colors.gray(shortDate(c.createdAt)),
      colors.cyan(c.checkpointId),
      colors.green(c.author ?? "unknown"),
      c.slug,
      colors.yellow(c.branch ?? "-"),
    ].join("  ");
    console.log(head);
    const prompt = firstLine(c.prompt ?? c.commitMessage);
    if (prompt) console.log(`  ${prompt}`);
  }
}
