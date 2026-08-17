import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import type { V1Store } from "../history/v1-store.js";
import type { LeagueSnapshot, Recommendation } from "../models/types.js";
import type { RefreshSummary } from "../models/v1.js";

export interface ApiServerDeps {
  readonly repository: KnowledgeRepository;
  readonly v1Store: V1Store;
  readonly refresh: () => Promise<RefreshSummary>;
  readonly initialSnapshot?: LeagueSnapshot;
  readonly publicDir?: string;
  /** Root of the approved ChatPFT replay artifact directory. */
  readonly modelingDir?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".sqlite": "application/vnd.sqlite3"
};

export interface ApiServer extends Server {
  leagueState: { snapshot?: LeagueSnapshot };
}

export function createApiServer(deps: ApiServerDeps): ApiServer {
  const publicDir = deps.publicDir ?? join(process.cwd(), "public");
  const modelingDir = resolve(deps.modelingDir ?? join(process.cwd(), "artifacts", "wr-2024-replay"));
  const state: { snapshot?: LeagueSnapshot } = { snapshot: deps.initialSnapshot };

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    });
  }) as ApiServer;

  server.leagueState = state;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/api/health") {
      sendJson(res, 200, { status: "ok", version: "0.2.0" });
      return;
    }

    if (path === "/api/league") {
      sendJson(res, 200, state.snapshot ?? null);
      return;
    }

    if (path === "/api/recommendations" && req.method === "GET") {
      const leagueId = state.snapshot?.league.league_id;
      const recommendations: Recommendation[] = leagueId ? await deps.repository.listRecommendations(leagueId) : [];
      sendJson(res, 200, recommendations);
      return;
    }

    if (path === "/api/alerts" && req.method === "GET") {
      const leagueId = state.snapshot?.league.league_id ?? "league-001";
      sendJson(res, 200, await deps.v1Store.getNotifications(leagueId));
      return;
    }

    if (path === "/api/manager-profiles" && req.method === "GET") {
      const leagueId = state.snapshot?.league.league_id ?? "league-001";
      sendJson(res, 200, await deps.v1Store.getManagerProfiles(leagueId));
      return;
    }

    if (path === "/api/news" && req.method === "GET") {
      const leagueId = state.snapshot?.league.league_id ?? "league-001";
      sendJson(res, 200, await deps.v1Store.getNews(leagueId));
      return;
    }

    if (path === "/api/refresh" && req.method === "POST") {
      const summary = await deps.refresh();
      const refreshed = state.snapshot
        ? await deps.repository.getLeagueSnapshot(summary.snapshot_id)
        : undefined;
      if (refreshed) state.snapshot = refreshed;
      sendJson(res, 200, summary);
      return;
    }

    if (path === "/modeling" || path === "/modeling.html") {
      await serveFile(res, join(publicDir, "modeling.html"), "text/html; charset=utf-8");
      return;
    }

    if (path === "/api/modeling/preview" && req.method === "GET") {
      const replay = await readModelingJson("walkforward-manifest.json").catch(() => undefined);
      sendJson(res, 200, {
        positions: ["QB", "RB", "WR", "TE", "K", "DST"],
        sources: ["historical", "razzball", "espn", "fftoday"],
        features: replay?.features ?? ["recent_points", "season_points", "availability", "team_pace", "qb_dependency", "offensive_line"],
        replay: replay ?? null
      });
      return;
    }

    if (path === "/api/modeling/replay" && req.method === "GET") {
      sendJson(res, 200, {
        preseason: await readModelingJson("manifest.json").catch(() => null),
        walkforward: await readModelingJson("walkforward-manifest.json").catch(() => null),
        promotion: await readModelingJson("promotion-decision.json").catch(() => null),
        metrics: await readModelingJson("weekly-metrics.json").catch(() => [])
      });
      return;
    }

    if (path === "/api/modeling/checkpoints" && req.method === "GET") {
      sendJson(res, 200, await readModelingJsonl("checkpoints.jsonl"));
      return;
    }

    if (path === "/api/modeling/metrics" && req.method === "GET") {
      sendJson(res, 200, {
        weekly: await readModelingJson("weekly-metrics.json").catch(() => []),
        subgroups: await readModelingJson("subgroup-metrics.json").catch(() => []),
        comparisons: await readModelingJson("model-comparisons.json").catch(() => [])
      });
      return;
    }

    if (path === "/api/modeling/predictions" && req.method === "GET") {
      const targetPeriod = url.searchParams.get("period");
      const playerId = url.searchParams.get("playerId");
      const regime = url.searchParams.get("regime");
      const rows = await readModelingJsonl("weekly-predictions.jsonl");
      sendJson(res, 200, rows.filter((row) =>
        (!targetPeriod || row.target_period === targetPeriod) &&
        (!playerId || row.player_id === playerId) &&
        (!regime || row.regime === regime)
      ));
      return;
    }

    if (path.startsWith("/api/modeling/artifact/") && req.method === "GET") {
      const name = decodeURIComponent(path.slice("/api/modeling/artifact/".length));
      const allowed = new Set([
        "manifest.json", "walkforward-manifest.json", "preseason_predictions.json", "features.jsonl", "results.json", "weekly-predictions.jsonl",
        "weekly-outcomes.jsonl", "weekly-metrics.json", "subgroup-metrics.json", "model-comparisons.json",
        "promotion-decision.json", "phase8-report.md", "attribution.jsonl", "rank-benchmark.svg", "checkpoints.sqlite"
      ]);
      if (!allowed.has(name) || name.includes("/") || name.includes("\\")) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      await serveFile(res, join(modelingDir, name));
      return;
    }

    if (path === "/" || path === "/index.html") {
      await serveFile(res, join(publicDir, "index.html"), "text/html; charset=utf-8");
      return;
    }

    if (path.startsWith("/public/") || extname(path) !== "") {
      const publicRoot = resolve(publicDir);
      const safePath = resolve(publicRoot, path.replace(/^\/public\//, ""));
      const outsideRoot = relative(publicRoot, safePath).startsWith("..") || resolve(safePath) === resolve("/");
      if (outsideRoot) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      await serveFile(res, safePath);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  }

  async function readModelingJson(name: string): Promise<any> {
    return JSON.parse(await readFile(join(modelingDir, name), "utf8"));
  }

  async function readModelingJsonl(name: string): Promise<any[]> {
    const raw = await readFile(join(modelingDir, name), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }

  async function serveFile(res: ServerResponse, filePath: string, forcedType?: string): Promise<void> {
    try {
      const data = await readFile(filePath);
      const type = forcedType ?? CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }
  }

  return server;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}
