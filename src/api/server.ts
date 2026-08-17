import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import type { V1Store } from "../history/v1-store.js";
import type { LeagueSnapshot, Recommendation } from "../models/types.js";
import type { RefreshSummary } from "../models/v1.js";
import type { DraftController } from "../draft/draft-controller.js";
import type { OllamaMessage } from "../llm/ollama.js";

export interface ApiServerDeps {
  readonly repository: KnowledgeRepository;
  readonly v1Store: V1Store;
  readonly refresh: () => Promise<RefreshSummary>;
  readonly initialSnapshot?: LeagueSnapshot;
  readonly publicDir?: string;
  readonly draft?: DraftController;
  /** When set, refresh requires `Authorization: Bearer <token>`. */
  readonly refreshToken?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export interface ApiServer extends Server {
  leagueState: { snapshot?: LeagueSnapshot };
}

export function createApiServer(deps: ApiServerDeps): ApiServer {
  const publicDir = deps.publicDir ?? join(process.cwd(), "public");
  const publicRoot = resolve(publicDir);
  const state: { snapshot?: LeagueSnapshot } = { snapshot: deps.initialSnapshot };
  let refreshInFlight = false;

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
      if (!isLoopbackRequest(req, url)) {
        sendJson(res, 403, { error: "refresh is available only from localhost" });
        return;
      }
      if (deps.refreshToken && req.headers.authorization !== `Bearer ${deps.refreshToken}`) {
        sendJson(res, 401, { error: "refresh authorization required" });
        return;
      }
      if (refreshInFlight) {
        sendJson(res, 409, { error: "refresh already in progress" });
        return;
      }
      refreshInFlight = true;
      try {
        const summary = await deps.refresh();
        const refreshed = state.snapshot
          ? await deps.repository.getLeagueSnapshot(summary.snapshot_id)
          : undefined;
        if (refreshed) state.snapshot = refreshed;
        sendJson(res, 200, summary);
      } finally {
        refreshInFlight = false;
      }
      return;
    }

    if (path === "/draft" || path === "/draft.html") {
      await serveFile(res, join(publicDir, "draft.html"), "text/html; charset=utf-8");
      return;
    }

    if (path === "/api/draft/state" && req.method === "GET") {
      if (!deps.draft) {
        sendJson(res, 404, { error: "draft harness not enabled" });
        return;
      }
      sendJson(res, 200, deps.draft.currentSnapshot());
      return;
    }

    if (path === "/api/draft/pick" && req.method === "POST") {
      if (!deps.draft) {
        sendJson(res, 404, { error: "draft harness not enabled" });
        return;
      }
      const body = await readJson<ManualPickBody>(req);
      const snapshot = deps.draft.recordManualPick({
        round: Number(body.round),
        roundPick: Number(body.roundPick),
        teamId: String(body.teamId),
        playerExternalId: String(body.playerExternalId),
        pickNo: body.pickNo !== undefined ? Number(body.pickNo) : undefined
      });
      sendJson(res, 200, { ok: true, snapshot });
      return;
    }

    if (path === "/api/draft/chat" && req.method === "POST") {
      if (!deps.draft) {
        sendJson(res, 404, { error: "draft harness not enabled" });
        return;
      }
      const body = await readJson<{ messages?: OllamaMessage[] }>(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      try {
        const reply = await deps.draft.chat(messages);
        sendJson(res, 200, { reply });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 502, { error: `ollama chat failed: ${message}` });
      }
      return;
    }

    if (path === "/" || path === "/index.html") {
      await serveFile(res, join(publicDir, "index.html"), "text/html; charset=utf-8");
      return;
    }

    if (path.startsWith("/public/") || extname(path) !== "") {
      let requestedPath: string;
      try {
        requestedPath = decodeURIComponent(path.replace(/^\/public\//, ""));
      } catch {
        sendJson(res, 400, { error: "invalid path" });
        return;
      }
      const safePath = resolve(publicRoot, requestedPath);
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

function isLoopbackRequest(req: IncomingMessage, url: URL): boolean {
  const host = (req.headers.host ?? url.host).split(":")[0].replace(/^\[/, "").replace(/\]$/, "");
  if (!(["localhost", "127.0.0.1", "::1"].includes(host))) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).hostname;
    return ["localhost", "127.0.0.1", "::1"].includes(originHost);
  } catch {
    return false;
  }
}

interface ManualPickBody {
  readonly round?: number;
  readonly roundPick?: number;
  readonly teamId?: string;
  readonly playerExternalId?: string;
  readonly pickNo?: number;
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}
