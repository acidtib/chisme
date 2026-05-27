/**
 * Turns arbitrary user text into a safe FTS5 MATCH expression.
 *
 * Raw input passed to MATCH is a top crash source: `"`, `*`, `:`, `-`, `(`, and
 * the bare operators `OR` / `NEAR` / `AND` / `NOT` can throw or behave oddly. We
 * tokenize on whitespace, drop tokens with no word characters, and wrap each
 * remaining token in double quotes (doubling any embedded quote). Quoted tokens
 * are treated as literal phrases by FTS5, so operators are neutralized. Tokens are
 * joined with spaces, which FTS5 reads as implicit AND.
 */

/** Builds a safe MATCH string, or "" when the input has no usable terms. */
export function sanitizeFtsQuery(input: string): string {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const quoted: string[] = [];
  for (const token of tokens) {
    // Keep only tokens that contain at least one alphanumeric/underscore character.
    if (!/[\p{L}\p{N}_]/u.test(token)) continue;
    quoted.push(`"${token.replace(/"/g, '""')}"`);
  }
  return quoted.join(" ");
}
