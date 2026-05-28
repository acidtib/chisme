/**
 * Flattens a session's JSONL transcript into one plain-text blob for FTS indexing.
 * We pull text from the message types that carry it (`user`, `assistant`,
 * `tool_result`) and ignore bookkeeping types (permission-mode, file-history-snapshot,
 * attachment, ...). Malformed lines are skipped: best-effort recall, not fidelity.
 */

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

interface TranscriptLine {
  type?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

function stringifyInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

function textFromContent(content: string | ContentBlock[] | undefined, out: string[]): void {
  if (typeof content === "string") {
    if (content.trim()) out.push(content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
        if (block.text) out.push(block.text);
        break;
      case "thinking":
        if (block.thinking) out.push(block.thinking);
        break;
      case "tool_use": {
        const input = stringifyInput(block.input);
        if (block.name || input) out.push(`${block.name ?? "tool"} ${input}`.trim());
        break;
      }
      case "tool_result":
        // Nested tool_result content can itself be a string or block array.
        textFromContent(block.content as string | ContentBlock[] | undefined, out);
        break;
    }
  }
}

export function extractPlainText(jsonl: string): string {
  const out: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    switch (obj.type) {
      case "user":
      case "assistant":
      case "tool_result":
        textFromContent(obj.message?.content, out);
        break;
    }
  }
  return out.join("\n").trim();
}

export interface TranscriptStats {
  messages: number;
  userMessages: number;
  assistantMessages: number;
  toolUses: number;
}

export function analyze(jsonl: string): TranscriptStats {
  const stats: TranscriptStats = {
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolUses: 0,
  };
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let obj: TranscriptLine;
    try {
      obj = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    if (obj.type === "user") {
      stats.messages++;
      stats.userMessages++;
    } else if (obj.type === "assistant") {
      stats.messages++;
      stats.assistantMessages++;
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) if (block?.type === "tool_use") stats.toolUses++;
      }
    }
  }
  return stats;
}
