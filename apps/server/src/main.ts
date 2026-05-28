#!/usr/bin/env bun
/**
 * Read-only JSON API over the same engine the CLI uses. Routes:
 *   GET /api/health                 service + index status
 *   GET /api/repos                  indexed repos with counts and last-sync
 *   GET /api/checkpoints            paginated recent checkpoints (?repo,&limit,&page)
 *   GET /api/checkpoints/:id        one checkpoint with its transcript (?repo)
 *   GET /api/search                 hybrid search (?q,&repo,&limit,&page,&author,&branch,&date,&semantic)
 *
 * Defaults to all indexed repos (not bound to a working directory). The web UI (Stage 2)
 * talks to these routes; in dev Vite proxies /api here, so same-origin. Permissive CORS
 * is set anyway since this is a local, read-only service over your own data.
 */
import {
  openDatabase,
  search,
  recentCheckpoints,
  getCheckpointDetail,
  getRepoBySlug,
  countCheckpoints,
  allRepos,
} from "@chisme/core";

const PORT = Number(process.env.CHISME_PORT ?? 4123);
const VERSION = "0.3.1";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const { db, vecAvailable } = await openDatabase();

/** Resolves a repo query param to a repo id. Returns undefined for all-repos. */
function resolveRepoId(repo: string | null): { repoId?: number; missing?: boolean } {
  if (!repo || repo === "*") return {};
  const found = getRepoBySlug(db, repo);
  return found ? { repoId: found.id } : { missing: true };
}

function handleRepos(): Response {
  const repos = allRepos(db).map((r) => ({
    slug: r.slug,
    remoteUrl: r.remoteUrl,
    rootPath: r.rootPath,
    lastSync: r.lastSync,
    checkpoints: countCheckpoints(db, r.id),
  }));
  return json({ repos });
}

function handleCheckpoints(url: URL): Response {
  const limit = intParam(url, "limit", 25);
  const page = intParam(url, "page", 1);
  const { repoId, missing } = resolveRepoId(url.searchParams.get("repo"));
  if (missing) return json({ results: [], total: 0, page, total_pages: 1, limit });

  const total = countCheckpoints(db, repoId);
  const results = recentCheckpoints(db, { repoId, limit, offset: (page - 1) * limit });
  return json({ results, total, page, total_pages: Math.max(1, Math.ceil(total / limit)), limit });
}

function handleCheckpointDetail(id: string, url: URL): Response {
  const repo = url.searchParams.get("repo") ?? undefined;
  const detail = getCheckpointDetail(db, id, repo);
  if (!detail) return json({ error: "not found", id }, 404);
  return json(detail);
}

async function handleSearch(url: URL): Promise<Response> {
  const dateRaw = url.searchParams.get("date");
  const { response } = await search(url.searchParams.get("q") ?? "", {
    db,
    vecAvailable,
    repo: url.searchParams.get("repo") ?? undefined,
    limit: intParam(url, "limit", 25),
    page: intParam(url, "page", 1),
    author: url.searchParams.get("author") ?? undefined,
    branch: url.searchParams.get("branch") ?? undefined,
    date: dateRaw === "week" || dateRaw === "month" ? dateRaw : undefined,
    semantic: url.searchParams.get("semantic") !== "false",
  });
  return json(response);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

    try {
      if (pathname === "/api/health") {
        return json({
          ok: true,
          version: VERSION,
          vecAvailable,
          repos: allRepos(db).length,
          checkpoints: countCheckpoints(db),
        });
      }
      if (pathname === "/api/repos") return handleRepos();
      if (pathname === "/api/checkpoints") return handleCheckpoints(url);
      if (pathname === "/api/search") return await handleSearch(url);

      const detail = pathname.match(/^\/api\/checkpoints\/(.+)$/);
      if (detail) return handleCheckpointDetail(decodeURIComponent(detail[1]!), url);

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json(
        { error: "internal error", message: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  },
});

console.log(`@chisme/server ${VERSION} listening on http://localhost:${server.port}`);
console.log("Routes: GET /api/health, /api/repos, /api/checkpoints[/:id], /api/search");
