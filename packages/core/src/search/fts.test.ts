import { describe, expect, test } from "bun:test";
import { sanitizeFtsQuery } from "./fts.ts";

describe("sanitizeFtsQuery", () => {
  test("returns empty string for empty or whitespace input", () => {
    expect(sanitizeFtsQuery("")).toBe("");
    expect(sanitizeFtsQuery("   \t \n ")).toBe("");
  });

  test("quotes a single term", () => {
    expect(sanitizeFtsQuery("auth")).toBe('"auth"');
  });

  test("joins multiple terms with spaces (implicit AND)", () => {
    expect(sanitizeFtsQuery("auth token refresh")).toBe('"auth" "token" "refresh"');
  });

  test("neutralizes FTS5 operators by quoting them as literal terms", () => {
    expect(sanitizeFtsQuery("cats OR dogs")).toBe('"cats" "OR" "dogs"');
    expect(sanitizeFtsQuery("a NEAR b NOT c AND d")).toBe('"a" "NEAR" "b" "NOT" "c" "AND" "d"');
  });

  test("doubles embedded double quotes so the term stays literal", () => {
    expect(sanitizeFtsQuery('say"hi')).toBe('"say""hi"');
  });

  test("drops tokens with no word characters", () => {
    expect(sanitizeFtsQuery("foo --- bar")).toBe('"foo" "bar"');
    expect(sanitizeFtsQuery("* : ( )")).toBe("");
  });

  test("keeps punctuation that sits alongside word characters", () => {
    expect(sanitizeFtsQuery("foo!!!")).toBe('"foo!!!"');
  });

  test("keeps unicode word characters", () => {
    expect(sanitizeFtsQuery("café")).toBe('"café"');
  });

  test("collapses repeated whitespace between terms", () => {
    expect(sanitizeFtsQuery("  a    b  ")).toBe('"a" "b"');
  });
});
