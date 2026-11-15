import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { KnowledgeRepository } from "../knowledge/repository.js";
import type { V1Store } from "../history/v1-store.js";
import type { LeagueSnapshot, Recommendation } from "../models/types.js";
import type { RefreshSummary } from "../models/v1.js";
import type { DraftController } from "../draft/draft-controller.js";
import type { OllamaMessage } from "../llm/ollama.js";
import { buildRosterAnalytics, simulateFreeAgentScenario } from "../application/roster-analytics.js";
import { SqliteJobStore } from "../storage/sqlite-job-store.js";
import { SqliteActionQueueStore } from "../agents/sqlite-action-queue-store.js";
import { SqliteActionExecutionStore } from "../agents/sqlite-action-execution-store.js";
import { getCurrentScoringPeriod } from "../seasons/nfl-calendar.js";

export interface ApiServerDeps {
  readonly repository: KnowledgeRepository;
  readonly v1Store: V1Store;
  readonly refresh: () => Promise<RefreshSummary>;
  readonly initialSnapshot?: LeagueSnapshot;
  /** Resolve the most recent snapshot from the active platform at request time. */
  readonly getSnapshot?: () => Promise<LeagueSnapshot | undefined>;
  readonly teamId?: string;
  readonly dataDir?: string;
  readonly publicDir?: string;
  /** Root of the approved ChatPFT replay artifact directory. */
  readonly modelingDir?: string;
  readonly draft?: DraftController;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".sqlite": "application/vnd.sqlite3"
};

export interface ApiServer extends Server {
  leagueState: { snapshot?: LeagueSnapshot };
}

export function createApiServer(deps: ApiServerDeps): ApiServer {
  const publicDir = deps.publicDir ?? join(process.cwd(), "public");
  const modelingDir = resolve(deps.modelingDir ?? join(process.cwd(), "artifacts", "wr-2024-replay"));
  const artifactsRoot = resolve(join(process.cwd(), "artifacts"));
  const state: { snapshot?: LeagueSnapshot } = { snapshot: deps.initialSnapshot };
  const webPassword = process.env.PMT_WEB_PASSWORD;
  const sessionSecret = process.env.PMT_WEB_SESSION_SECRET ?? webPassword;
  const sessionLifetimeSeconds = 12 * 60 * 60;
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
      sendJson(res, status, { error: message });
    });
  }) as ApiServer;

  server.leagueState = state;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const activeModelingDir = modelingDirectory(url);

    if (path === "/api/auth/session" && req.method === "GET") {
      const session = verifySession(req);
      if (!webPassword && isLoopbackRequest(req)) {
        sendJson(res, 200, { authenticated: true, csrfToken: "local-development" });
      } else if (session) {
        sendJson(res, 200, { authenticated: true, csrfToken: session.csrf });
      } else {
        sendJson(res, 200, { authenticated: false });
      }
      return;
    }

    if (path === "/api/auth/login" && req.method === "POST") {
      if (!webPassword || !sessionSecret) {
        sendJson(res, 503, { error: "Web password authentication is not configured" });
        return;
      }
      const insecureLoopbackDevelopment = process.env.PMT_COOKIE_SECURE === "false" && isLoopbackRequest(req);
      if (!isSecureRequest(req) && !insecureLoopbackDevelopment) {
        sendJson(res, 426, { error: "HTTPS is required for sign-in" });
        return;
      }
      const ip = req.socket.remoteAddress ?? "unknown";
      const attempts = loginAttempts.get(ip);
      if (attempts && attempts.resetAt > Date.now() && attempts.count >= 8) {
        sendJson(res, 429, { error: "Too many sign-in attempts" });
        return;
      }
      const body = await readJson<{ password?: unknown }>(req, 2_048);
      const supplied = typeof body.password === "string" ? body.password : "";
      const matches = safeStringEqual(supplied, webPassword);
      if (!matches) {
        const current = attempts && attempts.resetAt > Date.now()
          ? attempts
          : { count: 0, resetAt: Date.now() + 15 * 60_000 };
        current.count += 1;
        loginAttempts.set(ip, current);
        sendJson(res, 401, { error: "Invalid password" });
        return;
      }
      loginAttempts.delete(ip);
      const csrf = randomBytes(24).toString("base64url");
      const expires = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds;
      const token = `${expires}.${csrf}.${sign(`${expires}.${csrf}`, sessionSecret)}`;
      const secureCookie = process.env.PMT_COOKIE_SECURE !== "false";
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `pmt_session=${token}; Path=/; HttpOnly;${secureCookie ? " Secure;" : ""} SameSite=Strict; Max-Age=${sessionLifetimeSeconds}`,
        "cache-control": "no-store"
      });
      res.end(JSON.stringify({ authenticated: true, csrfToken: csrf }));
      return;
    }

    if (path === "/api/auth/logout" && req.method === "POST") {
      if (!authorizeMutation(req, res)) return;
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `pmt_session=; Path=/; HttpOnly;${process.env.PMT_COOKIE_SECURE === "false" && isLoopbackRequest(req) ? "" : " Secure;"} SameSite=Strict; Max-Age=0`,
        "cache-control": "no-store"
      });
      res.end(JSON.stringify({ authenticated: false }));
      return;
    }

    if (webPassword) {
      const authPage = !path.startsWith("/api/") && (path === "/" || path === "/index.html" || path === "/roster" || path === "/roster.html" || path === "/scout" || path === "/scout/players" || path === "/login" || extname(path) !== "");
      const authEndpoint = path === "/api/auth/session" || path === "/api/auth/login";
      const publicHealth = path === "/api/health" && req.method === "GET";
      if (!authPage && !authEndpoint && !publicHealth && !verifySession(req)) {
        sendJson(res, 401, { error: "Authentication required" });
        return;
      }
      if (!authPage && !authEndpoint && req.method && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !authorizeMutation(req, res)) return;
    } else if (!isLoopbackRequest(req)) {
      sendJson(res, 503, { error: "Remote access requires PMT_WEB_PASSWORD" });
      return;
    }

    if (path === "/api/free-agent-scenarios" && req.method === "POST") {
      const body = await readJson<{ addPlayerId?: string; dropPlayerId?: string; period?: string; samples?: number; seed?: number }>(req, 16_384);
      if (!body.addPlayerId || !body.dropPlayerId) {
        sendJson(res, 400, { error: "addPlayerId and dropPlayerId are required" });
        return;
      }
      const snapshot = await latestSnapshot();
      if (!snapshot) { sendJson(res, 503, { error: "No league snapshot is available" }); return; }
      const teamId = activeTeamId(snapshot);
      if (!teamId) { sendJson(res, 404, { error: "No active team is configured" }); return; }
      const result = await simulateFreeAgentScenario(snapshot, teamId, {
        addPlayerId: body.addPlayerId,
        dropPlayerId: body.dropPlayerId,
        period: body.period,
        samples: boundedInteger(body.samples, 2_000, 100, 20_000),
        seed: body.seed,
        dataDir: deps.dataDir
      });
      sendJson(res, 200, result);
      return;
    }

    if (path === "/api/roster-analytics" && req.method === "GET") {
      const snapshot = await latestSnapshot();
      if (!snapshot) { sendJson(res, 503, { error: "No league snapshot is available" }); return; }
      const teamId = activeTeamId(snapshot);
      if (!teamId) { sendJson(res, 404, { error: "No active team is configured" }); return; }
      const samplesParam = Number(url.searchParams.get("samples"));
      const seedParam = Number(url.searchParams.get("seed"));
      const result = await buildRosterAnalytics(snapshot, teamId, {
        period: url.searchParams.get("period") ?? undefined,
        samples: boundedInteger(samplesParam, 2_000, 100, 20_000),
        seed: Number.isFinite(seedParam) ? seedParam : undefined,
        dataDir: deps.dataDir
      });
      sendJson(res, 200, result);
      return;
    }

    if (path === "/api/agent-status" && req.method === "GET") {
      const dataDir = deps.dataDir;
      const snapshot = await latestSnapshot();
      const teamId = snapshot ? activeTeamId(snapshot) : undefined;
      const team = snapshot?.league.teams.find((candidate) => candidate.team_id === teamId);
      const period = snapshot && teamId
        ? url.searchParams.get("period") ?? (snapshot.league.platform === "fixture"
          ? snapshot.league.schedule.find((matchup) => matchup.team_id === teamId)?.scoring_period
          : getCurrentScoringPeriod(new Date(), snapshot.league.season))
        : undefined;
      const importedAt = snapshot?.league.import_metadata.imported_at;
      const ageSeconds = importedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(importedAt)) / 1000)) : undefined;
      const coveredStarters = snapshot && team && period
        ? new Set(snapshot.projections.filter((projection) => normalizeScoringPeriod(projection.scoring_period) === normalizeScoringPeriod(period)).map((projection) => projection.player_id))
        : new Set<string>();
      let jobs: unknown[] = [];
      let jobCounts: Record<string, number> = {};
      let pendingActions = 0;
      let receiptCount = 0;
      let auditCount = 0;
      if (dataDir) {
        const filePath = join(dataDir, "pmt.sqlite");
        const jobStore = new SqliteJobStore({ filePath });
        const actionStore = new SqliteActionQueueStore({ filePath });
        const executionStore = new SqliteActionExecutionStore({ filePath });
        try {
          const allJobs = jobStore.list();
          const allActions = await actionStore.list();
          const receipts = await executionStore.listReceipts();
          const audit = await executionStore.listAudit();
          jobs = allJobs.slice(-8).reverse().map(({ jobId, type, status, attempts, availableAt, lastError }) => ({ jobId, type, status, attempts, availableAt, lastError }));
          jobCounts = Object.fromEntries(["queued", "running", "succeeded", "failed"].map((status) => [status, allJobs.filter((job) => job.status === status).length]));
          pendingActions = allActions.filter((action) => action.status === "pending").length;
          receiptCount = receipts.length;
          auditCount = audit.length;
        } finally {
          jobStore.close(); actionStore.close(); executionStore.close();
        }
      }
      sendJson(res, 200, {
        executionEnabled: false,
        teamId,
        jobs,
        jobCounts,
        pendingActions,
        receiptCount,
        auditCount,
        snapshot: snapshot ? {
          snapshotId: snapshot.snapshot_id,
          importedAt,
          ageSeconds,
          projectionPeriod: period,
          starterCount: team?.roster.starters.filter((slot) => slot.player_id).length ?? 0,
          coveredStarters: team?.roster.starters.filter((slot) => slot.player_id && coveredStarters.has(slot.player_id)).length ?? 0
        } : null
      });
      return;
    }

    if (path === "/api/health") {
      sendJson(res, 200, { status: "ok", version: "0.2.0" });
      return;
    }

    if (path === "/api/league") {
      sendJson(res, 200, await latestSnapshot() ?? null);
      return;
    }

    if (path === "/api/recommendations" && req.method === "GET") {
      const activeSnapshot = await latestSnapshot();
      const leagueId = activeSnapshot?.league.league_id;
      const recommendations: Recommendation[] = leagueId ? await deps.repository.listRecommendations(leagueId) : [];
      sendJson(res, 200, recommendations);
      return;
    }

    if (path === "/api/alerts" && req.method === "GET") {
      const leagueId = (await latestSnapshot())?.league.league_id ?? "league-001";
      sendJson(res, 200, await deps.v1Store.getNotifications(leagueId));
      return;
    }

    if (path === "/api/manager-profiles" && req.method === "GET") {
      const leagueId = (await latestSnapshot())?.league.league_id ?? "league-001";
      sendJson(res, 200, await deps.v1Store.getManagerProfiles(leagueId));
      return;
    }

    if (path === "/api/news" && req.method === "GET") {
      const leagueId = (await latestSnapshot())?.league.league_id ?? "league-001";
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

    if (path === "/scout") {
      await serveFile(res, join(publicDir, "scout.html"), "text/html; charset=utf-8");
      return;
    }

    if (path === "/scout/players") {
      await serveFile(res, join(publicDir, "player-comparison.html"), "text/html; charset=utf-8");
      return;
    }

    if (path === "/api/modeling/preview" && req.method === "GET") {
      const replay = await readModelingJson("walkforward-manifest.json", activeModelingDir).catch(() => undefined);
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
        preseason: await readModelingJson("manifest.json", activeModelingDir).catch(() => null),
        walkforward: await readModelingJson("walkforward-manifest.json", activeModelingDir).catch(() => null),
        promotion: await readModelingJson("promotion-decision.json", activeModelingDir).catch(() => null),
        metrics: await readModelingJson("weekly-metrics.json", activeModelingDir).catch(() => [])
      });
      return;
    }

    if (path === "/api/modeling/checkpoints" && req.method === "GET") {
      sendJson(res, 200, await readModelingJsonl("checkpoints.jsonl", activeModelingDir));
      return;
    }

    if (path === "/api/modeling/metrics" && req.method === "GET") {
      sendJson(res, 200, {
        weekly: await readModelingJson("weekly-metrics.json", activeModelingDir).catch(() => []),
        subgroups: await readModelingJson("subgroup-metrics.json", activeModelingDir).catch(() => []),
        comparisons: await readModelingJson("model-comparisons.json", activeModelingDir).catch(() => [])
      });
      return;
    }

    if (path === "/api/modeling/predictions" && req.method === "GET") {
      const targetPeriod = url.searchParams.get("period");
      const playerId = url.searchParams.get("playerId");
      const regime = url.searchParams.get("regime");
      const rows = await readModelingJsonl("weekly-predictions.jsonl", activeModelingDir);
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
        "manifest.json", "walkforward-manifest.json", "preseason_predictions.json", "predictions.json", "features.jsonl", "results.json", "weekly-predictions.jsonl",
        "weekly-outcomes.jsonl", "weekly-metrics.json", "subgroup-metrics.json", "model-comparisons.json",
        "promotion-decision.json", "phase8-report.md", "attribution.jsonl", "rank-benchmark.svg", "checkpoints.sqlite", "qb-preseason.sqlite", "rb-preseason.sqlite", "wr-preseason.sqlite", "te-preseason.sqlite"
      ]);
      if (!allowed.has(name) || name.includes("/") || name.includes("\\")) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      await serveFile(res, join(activeModelingDir, name));
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

    if (path === "/") {
      await serveFile(res, join(publicDir, "roster.html"), "text/html; charset=utf-8");
      return;
    }

    if (path === "/legacy" || path === "/index.html") {
      await serveFile(res, join(publicDir, "index.html"), "text/html; charset=utf-8");
      return;
    }

    if (path === "/roster" || path === "/roster.html") {
      await serveFile(res, join(publicDir, "roster.html"), "text/html; charset=utf-8");
      return;
    }

    if (path.startsWith("/public/") || extname(path) !== "") {
      const publicRoot = resolve(publicDir);
      const safePath = resolve(publicRoot, path.replace(/^\/public\//, "").replace(/^\/+/, ""));
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

  function modelingDirectory(url: URL): string {
    const season = url.searchParams.get("season");
    const position = url.searchParams.get("position")?.toLowerCase();
    if (!season || !position || !["qb", "rb", "wr", "te"].includes(position)) return modelingDir;
    const suffix = season === "2026" ? "preseason" : "replay";
    return resolve(join(artifactsRoot, `${position}-${season}-${suffix}`));
  }

  async function readModelingJson(name: string, directory = modelingDir): Promise<any> {
    return JSON.parse(await readFile(join(directory, name), "utf8"));
  }

  async function readModelingJsonl(name: string, directory = modelingDir): Promise<any[]> {
    const raw = await readFile(join(directory, name), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }

  async function serveFile(res: ServerResponse, filePath: string, forcedType?: string): Promise<void> {
    try {
      const data = await readFile(filePath);
      const type = forcedType ?? CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff", "referrer-policy": "same-origin" });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }
  }

  async function latestSnapshot(): Promise<LeagueSnapshot | undefined> {
    const fresh = await deps.getSnapshot?.();
    if (fresh) { state.snapshot = fresh; return fresh; }
    if (deps.dataDir) {
      try {
        const pointer = JSON.parse(await readFile(join(deps.dataDir, "last-snapshot.json"), "utf8")) as { snapshot_id?: unknown };
        if (typeof pointer.snapshot_id === "string") {
          const snapshot = await deps.repository.getLeagueSnapshot(pointer.snapshot_id);
          if (snapshot) { state.snapshot = snapshot; return snapshot; }
        }
      } catch { /* No persisted latest-snapshot pointer; retain the active snapshot. */ }
    }
    return state.snapshot;
  }

  function activeTeamId(snapshot: LeagueSnapshot): string | undefined {
    const configured = deps.teamId
      ? snapshot.league.teams.find((team) => team.team_id === deps.teamId || team.external_id === deps.teamId)
      : undefined;
    if (configured) return configured.team_id;
    return snapshot.league.platform === "fixture" ? snapshot.league.teams[0]?.team_id : undefined;
  }

  function authorizeMutation(req: IncomingMessage, res: ServerResponse): boolean {
    if (!webPassword) return true;
    const session = verifySession(req);
    if (!session) { sendJson(res, 401, { error: "Authentication required" }); return false; }
    const supplied = req.headers["x-csrf-token"];
    if (typeof supplied !== "string" || !safeStringEqual(supplied, session.csrf)) {
      sendJson(res, 403, { error: "Invalid CSRF token" }); return false;
    }
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) { sendJson(res, 403, { error: "Cross-origin request rejected" }); return false; }
      } catch { sendJson(res, 403, { error: "Cross-origin request rejected" }); return false; }
    }
    return true;
  }

  function verifySession(req: IncomingMessage): { csrf: string } | undefined {
    if (!webPassword) return isLoopbackRequest(req) ? { csrf: "local-development" } : undefined;
    if (!sessionSecret) return undefined;
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.pmt_session;
    if (!token) return undefined;
    const [expiresText, csrf, mac, extra] = token.split(".");
    if (extra || !expiresText || !csrf || !mac || !/^\d+$/.test(expiresText) || Number(expiresText) < Date.now() / 1000) return undefined;
    return safeStringEqual(mac, sign(`${expiresText}.${csrf}`, sessionSecret)) ? { csrf } : undefined;
  }

  function isSecureRequest(req: IncomingMessage): boolean {
    return Boolean((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted) || req.headers["x-forwarded-proto"] === "https";
  }

  return server;
}

interface ManualPickBody {
  readonly round?: number;
  readonly roundPick?: number;
  readonly teamId?: string;
  readonly playerExternalId?: string;
  readonly pickNo?: number;
}

async function readJson<T>(req: IncomingMessage, maxBytes = 65_536): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin"
  });
  res.end(JSON.stringify(body, null, 2));
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(raw: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const item of raw?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    try { cookies[key] = decodeURIComponent(item.slice(separator + 1).trim()); } catch { /* Ignore malformed cookie values. */ }
  }
  return cookies;
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  const loopback = address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
  // A local reverse proxy must not inherit the passwordless developer path.
  return loopback && !req.headers["x-forwarded-for"];
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function normalizeScoringPeriod(value: string): string {
  return value.replace(/^(\d{4})-W(\d{1,2})$/, (_match, season: string, week: string) => `${season}-W${week.padStart(2, "0")}`);
}
