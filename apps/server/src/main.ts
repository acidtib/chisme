#!/usr/bin/env bun
/**
 * @chisme/server: HTTP API over @chisme/core.
 *
 * Stage 2 stub. Only `/api/health` is implemented; the remaining routes are
 * declared so the shape is visible but return 501 until Stage 2 fills them in.
 * The real implementations will call into @chisme/core (search, list, status),
 * the same engine the CLI uses.
 */
import { openDatabase, countCheckpoints, allRepos } from "@chisme/core";

const PORT = Number(process.env.CHISME_PORT ?? 4123);
const VERSION = "0.1.0";

/** Planned routes. Implemented ones have a handler; the rest are stubs (501). */
const TODO_ROUTES = [
  "GET  /api/checkpoints           list recent checkpoints (paginated)",
  "GET  /api/checkpoints/:id       one checkpoint with sessions and transcript",
  "GET  /api/search?q=...          hybrid search (mirrors `chisme search --json`)",
  "GET  /api/repos                 indexed repos and their last-sync times",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const { db, vecAvailable } = await openDatabase();

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        version: VERSION,
        vecAvailable,
        repos: allRepos(db).length,
        checkpoints: countCheckpoints(db),
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return json(
        { error: "not implemented", message: "Stage 2 route. See server logs for the planned map." },
        501,
      );
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`@chisme/server ${VERSION} listening on http://localhost:${server.port}`);
console.log("Implemented: GET /api/health");
console.log("Planned (Stage 2):");
for (const route of TODO_ROUTES) console.log(`  ${route}`);
