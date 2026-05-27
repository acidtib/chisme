import { describe, expect, test } from "bun:test";
import { parseInlineFilters, parseListArgs, parseSearchArgs, parseSyncArgs } from "./args.ts";

describe("parseInlineFilters", () => {
  test("pulls a bare key:value out of the query", () => {
    const f = parseInlineFilters("auth bug author:alice");
    expect(f.text).toBe("auth bug");
    expect(f.author).toBe("alice");
  });

  test("supports quoted values with spaces", () => {
    expect(parseInlineFilters('author:"Jane Doe"').author).toBe("Jane Doe");
    expect(parseInlineFilters("branch:'feature/x'").branch).toBe("feature/x");
  });

  test("parses every supported field and leaves the rest as text", () => {
    const f = parseInlineFilters("date:week repo:chisme branch:main fix login");
    expect(f.date).toBe("week");
    expect(f.repo).toBe("chisme");
    expect(f.branch).toBe("main");
    expect(f.text).toBe("fix login");
  });

  test("returns empty text when the query is only filters", () => {
    expect(parseInlineFilters("author:bob").text).toBe("");
  });
});

describe("parseSearchArgs", () => {
  test("applies defaults", () => {
    const a = parseSearchArgs(["auth"]);
    expect(a.query).toBe("auth");
    expect(a.limit).toBe(25);
    expect(a.page).toBe(1);
    expect(a.json).toBe(false);
    expect(a.semantic).toBe(true);
  });

  test("--no-semantic disables semantic search", () => {
    expect(parseSearchArgs(["auth", "--no-semantic"]).semantic).toBe(false);
  });

  test("explicit flags win over inline filters", () => {
    const a = parseSearchArgs(["auth", "author:inline", "--author", "flag"]);
    expect(a.author).toBe("flag");
    expect(a.query).toBe("auth");
  });

  test("falls back to defaults for non-positive or non-numeric limit", () => {
    expect(parseSearchArgs(["q", "--limit", "0"]).limit).toBe(25);
    expect(parseSearchArgs(["q", "--limit", "abc"]).limit).toBe(25);
    expect(parseSearchArgs(["q", "--limit", "10"]).limit).toBe(10);
  });

  test("coerces date to the allowed window values only", () => {
    expect(parseSearchArgs(["q", "--date", "week"]).date).toBe("week");
    expect(parseSearchArgs(["q", "--date", "year"]).date).toBeUndefined();
  });
});

describe("parseSyncArgs", () => {
  test("applies defaults", () => {
    const a = parseSyncArgs([]);
    expect(a.full).toBe(false);
    expect(a.remote).toBe("origin");
    expect(a.limit).toBeUndefined();
  });

  test("reads flags and clamps a non-positive limit to undefined", () => {
    const a = parseSyncArgs(["--full", "--remote", "upstream", "--limit", "5"]);
    expect(a.full).toBe(true);
    expect(a.remote).toBe("upstream");
    expect(a.limit).toBe(5);
    expect(parseSyncArgs(["--limit", "0"]).limit).toBeUndefined();
  });
});

describe("parseListArgs", () => {
  test("applies defaults and reads repo/limit/json", () => {
    expect(parseListArgs([]).limit).toBe(25);
    const a = parseListArgs(["--repo", "chisme", "--limit", "3", "--json"]);
    expect(a.repo).toBe("chisme");
    expect(a.limit).toBe(3);
    expect(a.json).toBe(true);
  });
});
