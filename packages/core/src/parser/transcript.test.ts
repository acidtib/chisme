import { describe, expect, test } from "bun:test";
import { analyze, extractPlainText } from "./transcript.ts";

/** Builds a JSONL transcript from line objects, the on-disk format. */
function jsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

describe("extractPlainText", () => {
  test("returns empty string for empty input", () => {
    expect(extractPlainText("")).toBe("");
    expect(extractPlainText("\n\n  \n")).toBe("");
  });

  test("extracts plain string user content", () => {
    const input = jsonl([{ type: "user", message: { role: "user", content: "fix the auth bug" } }]);
    expect(extractPlainText(input)).toBe("fix the auth bug");
  });

  test("extracts text and thinking blocks from assistant content", () => {
    const input = jsonl([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "let me reason" },
            { type: "text", text: "here is the answer" },
          ],
        },
      },
    ]);
    expect(extractPlainText(input)).toBe("let me reason\nhere is the answer");
  });

  test("flattens tool_use into name plus stringified input", () => {
    const input = jsonl([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }],
        },
      },
    ]);
    expect(extractPlainText(input)).toBe('Bash {"command":"ls"}');
  });

  test("reads nested tool_result content", () => {
    const input = jsonl([
      {
        type: "tool_result",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: [{ type: "text", text: "command output" }] }],
        },
      },
    ]);
    expect(extractPlainText(input)).toBe("command output");
  });

  test("skips malformed lines and ignores bookkeeping types", () => {
    const input = [
      "not json at all",
      JSON.stringify({ type: "file-history-snapshot", message: { content: "ignored" } }),
      JSON.stringify({ type: "user", message: { role: "user", content: "kept" } }),
    ].join("\n");
    expect(extractPlainText(input)).toBe("kept");
  });
});

describe("analyze", () => {
  test("counts user and assistant messages and tool uses", () => {
    const input = jsonl([
      { type: "user", message: { role: "user", content: "hi" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "ok" },
            { type: "tool_use", name: "Read", input: {} },
            { type: "tool_use", name: "Bash", input: {} },
          ],
        },
      },
    ]);
    expect(analyze(input)).toEqual({
      messages: 2,
      userMessages: 1,
      assistantMessages: 1,
      toolUses: 2,
    });
  });

  test("returns zeroed stats for empty input", () => {
    expect(analyze("")).toEqual({
      messages: 0,
      userMessages: 0,
      assistantMessages: 0,
      toolUses: 0,
    });
  });
});
