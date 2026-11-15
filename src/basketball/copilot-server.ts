import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { buildAdaptiveAdvice } from "./draft-adaptive.js";
import { DraftSessionSchema, canCompleteRoster, snakeTeam, type DraftSession } from "./draft.js";
import { DraftObservationSchema, type CopilotState, type DraftObservation, type MockPickIntent } from "./copilot-contracts.js";
import { DraftJournal } from "./draft-journal.js";
import { reconcileObservation } from "./draft-observer.js";
import { guardMockPick, verifyMockPickReceipt } from "./draft-browser-actor.js";
import { type DraftBoard } from "./forecast.js";
import type { ReconciliationResult } from "./reconcile.js";
import { contentHash } from "./store.js";

const ProfileSchema = z.enum(["balanced", "guards", "bigs"]);
const SlotSchema = z.enum(["G", "F/C", "Flx", "Res"]);
const MockActionSchema = z.object({
  action: z.enum(["start", "next-opponent", "burst", "queue", "choose-slot", "confirm-ownpick", "elapse-clock", "reset", "scenario"]),
  playerId: z.string().min(1).max(160).optional(),
  slot: SlotSchema.optional(),
  scenario: ProfileSchema.optional(),
  seconds: z.number().int().min(1).max(60).optional()
}).strict();
const MeasurementSchema = z.object({
  kind: z.enum(["browser-click", "browser-api", "browser-render"]), actionId: z.string().min(1).max(120),
  clientTimeMs: z.number().finite().nonnegative(), revision: z.string().max(200).optional()
}).strict();
const SavedControlSchema = z.object({ schemaVersion: z.literal(1), mode: z.enum(["mock", "coach"]), paused: z.boolean() }).strict();
const MAX_BODY_BYTES = 1_000_000;
const MAX_MEASUREMENTS = 1_000;
const MAX_EVENTS = 60;
const STATIC_FILES = new Map<string, readonly [string, string]>([["/", ["index.html", "text/html; charset=utf-8"]], ["/index.html", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/app.css", ["app.css", "text/css; charset=utf-8"]]]);
const MIME_BY_EXTENSION: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const PUBLIC_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public/basketball-copilot");

export interface StartCopilotServerOptions {
  board: DraftBoard;
  session: DraftSession;
  /** Optional review-only alternatives. This is read for display and never enters advice or session logic. */
  reconciliation?: Pick<ReconciliationResult, "report" | "correctedBoard" | "providerFirstRankOnly">;
  dataDir: string;
  port?: number;
  host?: string;
  mode?: "mock" | "coach";
}
export interface StartedCopilotServer { server: Server; url: string; close: () => Promise<void> }

interface LatestReceipt { overall: number; playerId: string; playerName: string; teamId: string; slot: string; slotAssignment?: string[]; verified: boolean; at: string }
interface LocalEvent { at: string; action: string; overall?: number; playerId?: string; teamId?: string; scenario?: string }
interface Measurement { kind: "browser-click" | "browser-api" | "browser-render"; actionId: string; clientTimeMs: number; receivedAt: string; revision?: string; elapsedMs?: number }
type RankedRow = DraftBoard["rows"][number];

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function randomSessionId(leagueId: string): string {
  return `${leagueId.slice(0, 80)}-${Date.now().toString(36)}-${createHash("sha256").update(`${process.pid}:${Math.random()}:${Date.now()}`).digest("hex").slice(0, 16)}`;
}
function latestTeamId(session: DraftSession): string | null {
  if (session.phase !== "live" || session.picks.length >= 112) return null;
  return snakeTeam(session.teamOrder, session.picks.length + 1);
}
function localObservation(session: DraftSession, sessionId: string, sequence: number, pageUrl: string, now: Date, clockSeconds?: number): DraftObservation {
  return DraftObservationSchema.parse({ schemaVersion: 1, sessionId, venue: "local-mock", pageUrl, receivedAt: now.toISOString(),
    sequence, completeHistory: true, identityVerified: true, currentTeamId: latestTeamId(session),
    clockSeconds: session.phase === "live" && session.picks.length < 112 ? (clockSeconds ?? 60) : null, correction: false, session });
}
function assertLoopback(host: string): void {
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(host.toLowerCase())) throw new Error("Copilot server must use a loopback host: localhost, 127.0.0.1, or ::1");
}
function originFor(host: string, port: number): string {
  const urlHost = host === "::1" || host === "[::1]" ? "[::1]" : host;
  return `http://${urlHost}:${port}`;
}
function sendJson(response: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(body);
}
function sendFailure(response: ServerResponse, error: unknown): void {
  const status = error instanceof HttpError ? error.status : 400;
  sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : "Request failed" });
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "Write requests require application/json");
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > MAX_BODY_BYTES) throw new HttpError(413, "JSON request exceeds the 1 MB limit");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "JSON request exceeds the 1 MB limit");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new HttpError(400, "Request body must contain valid JSON"); }
}
function safePlayer(player: RankedRow) {
  return { playerId: player.fantraxId, name: player.name, school: player.school, eligibleGroups: player.eligibleGroups, adp: player.adp, draftRank: player.draftRank, rank: player.rank, categoryScore: player.categoryScore, positionValue: player.positionValue, flags: player.flags, reviewRequired: player.reviewRequired };
}
function assignRosterSlots(owned: RankedRow[], candidate: RankedRow, target: z.infer<typeof SlotSchema>): { legal: boolean; assignment: string[] } {
  const slots: Array<{ name: string; group: "G" | "F/C" | "Flx" }> = [
    ...Array.from({ length: 4 }, (_, index) => ({ name: `G${index + 1}`, group: "G" as const })),
    ...Array.from({ length: 4 }, (_, index) => ({ name: `F/C${index + 1}`, group: "F/C" as const })),
    ...Array.from({ length: 2 }, (_, index) => ({ name: `Flx${index + 1}`, group: "Flx" as const }))
  ];
  const candidateSlot = target === "G" || target === "F/C" ? slots.findIndex(slot => slot.group === target) : target === "Flx" ? slots.findIndex(slot => slot.group === "Flx") : -1;
  if (target !== "Res" && (candidateSlot < 0 || (target !== "Flx" && !candidate.eligibleGroups.includes(target)))) return { legal: false, assignment: [] };
  const remainingSlots = slots.filter((_, index) => index !== candidateSlot);
  const players = [...owned, candidate];
  const otherIndices = players.map((_, index) => index).filter(index => index !== players.length - 1);
  const matched = Array<number>(remainingSlots.length).fill(-1);
  const assign = (playerIndex: number, seen: Set<number>): boolean => {
    const player = players[playerIndex]!;
    for (let slotIndex = 0; slotIndex < remainingSlots.length; slotIndex++) {
      const slot = remainingSlots[slotIndex]!;
      if (seen.has(slotIndex) || (slot.group !== "Flx" && !player.eligibleGroups.includes(slot.group))) continue;
      seen.add(slotIndex);
      if (matched[slotIndex] === -1 || assign(matched[slotIndex]!, seen)) { matched[slotIndex] = playerIndex; return true; }
    }
    return false;
  };
  let active = 0;
  for (const index of otherIndices) if (assign(index, new Set())) active++;
  const reserves = players.length - active - Number(target !== "Res");
  const legal = players.length <= 14 && reserves >= 0 && reserves <= 4;
  const assignment: string[] = [];
  if (target !== "Res") assignment.push(`${slots[candidateSlot]!.name}: ${candidate.name}`);
  else assignment.push(`Res: ${candidate.name}`);
  for (let index = 0; index < matched.length; index++) {
    const playerIndex = matched[index]!;
    if (playerIndex >= 0) assignment.push(`${remainingSlots[index]!.name}: ${players[playerIndex]!.name}`);
  }
  const assignedIds = new Set(matched.filter(index => index >= 0).map(index => players[index]!.fantraxId));
  for (const player of players) if (!assignedIds.has(player.fantraxId) && player.fantraxId !== candidate.fantraxId) assignment.push(`Res: ${player.name}`);
  return { legal, assignment };
}
function withObservedAt(session: DraftSession, now: Date, changes: Partial<Pick<DraftSession, "phase" | "picks" | "sourceKind" | "unavailablePlayerIds" | "draftStart">> = {}): DraftSession {
  return DraftSessionSchema.parse({ ...session, ...changes, observedAt: now.toISOString() });
}
function canBindToMockPage(observation: DraftObservation): boolean {
  try { const url = new URL(observation.pageUrl); return url.protocol === "http:" && new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname.toLowerCase()); }
  catch { return false; }
}

type JsonRecord = Record<string, unknown>;
function isRecord(value: unknown): value is JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }
function finiteNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function textValue(value: unknown): string | null { return typeof value === "string" ? value : null; }
function hashedPayload(value: unknown, description: string): { record: JsonRecord; revision: string } {
  if (!isRecord(value) || typeof value.revision !== "string" || !/^[a-f0-9]{64}$/.test(value.revision)) throw new Error(`${description} is missing a valid content revision`);
  const { revision, ...payload } = value;
  if (contentHash(payload) !== revision) throw new Error(`${description} content hash mismatch`);
  return { record: value, revision };
}

/** Validate the research bundle once, then expose only a small display-safe projection over GET. */
function reconciliationDisplay(bundle: StartCopilotServerOptions["reconciliation"], activeBoard: DraftBoard): JsonRecord {
  if (!bundle) return { available: false, reason: "No reconciliation candidates were supplied at startup." };
  const reportHash = hashedPayload(bundle.report, "Reconciliation report");
  const correctedHash = hashedPayload(bundle.correctedBoard, "Corrected candidate board");
  const report = reportHash.record;
  const corrected = correctedHash.record;
  const provider = bundle.providerFirstRankOnly as unknown;
  if (!isRecord(report) || report.schemaVersion !== 1 || report.kind !== "basketball-draft-reconciliation-candidate") throw new Error("Reconciliation report has an unsupported schema or kind");
  const baseline = report.baseline;
  const reportEvidenceHash = report.evidenceHash;
  if (!isRecord(baseline) || baseline.revision !== activeBoard.revision) throw new Error("Reconciliation baseline revision does not match the active board");
  if (typeof reportEvidenceHash !== "string" || !/^[a-f0-9]{64}$/.test(reportEvidenceHash)) throw new Error("Reconciliation report is missing its evidence hash");
  if (report.activeBoardChanged !== false || report.activeStrategyChanged !== false || report.sessionChanged !== false || report.modelPromoted !== false || report.platformActionsExecuted !== 0 || report.liveActionsExecuted !== 0) {
    throw new Error("Reconciliation report does not declare review-only, no-action scope");
  }
  if (corrected.leagueId !== activeBoard.leagueId || corrected.teamId !== activeBoard.teamId || corrected.season !== activeBoard.season) throw new Error("Corrected candidate board scope does not match the active board");
  if (!isRecord(corrected.inputs) || corrected.inputs.baselineRevision !== activeBoard.revision || corrected.inputs.reconciliationEvidenceHash !== reportEvidenceHash) throw new Error("Corrected candidate board does not bind to the active baseline and evidence hashes");
  const candidateBoards = report.candidateBoards;
  if (!isRecord(candidateBoards) || !isRecord(candidateBoards.correctedCategoryValue) || candidateBoards.correctedCategoryValue.revision !== correctedHash.revision || candidateBoards.correctedCategoryValue.rows !== (Array.isArray(corrected.rows) ? corrected.rows.length : -1)) throw new Error("Reconciliation report does not bind the corrected candidate board hash and row count");
  if (!isRecord(provider) || provider.schemaVersion !== 1 || provider.kind !== "provider-first-rank-only-review-candidate" || provider.statisticsIncluded !== false || provider.sourceFieldsOnly !== true) throw new Error("Provider-first candidate must be a rank-only review artifact");
  if (provider.baselineRevision !== activeBoard.revision || provider.reconciliationRevision !== reportHash.revision || provider.evidenceHash !== reportEvidenceHash) throw new Error("Provider-first candidate does not bind to the active baseline, report, and evidence hashes");
  const providerRowKeys = new Set(["fantraxId", "name", "school", "eligibleGroups", "providerRank", "modelRank", "rankSource", "sourceObservedAt", "rankFreshness", "forecastAvailable", "nativeImportBlocked", "status", "rank"]);
  if (!Array.isArray(provider.rows) || provider.rows.some((row, index) => !isRecord(row) || Object.keys(row).some(key => !providerRowKeys.has(key)) || row.rank !== index + 1 ||
    !(typeof row.fantraxId === "string" || row.fantraxId === null) || typeof row.name !== "string" || !(typeof row.school === "string" || row.school === null) ||
    !(row.providerRank === null || (Number.isInteger(row.providerRank) && Number(row.providerRank) > 0)) || !(row.modelRank === null || (Number.isInteger(row.modelRank) && Number(row.modelRank) > 0)) ||
    typeof row.rankSource !== "string" || !(typeof row.sourceObservedAt === "string" || row.sourceObservedAt === null) || typeof row.rankFreshness !== "string" ||
    typeof row.forecastAvailable !== "boolean" || typeof row.nativeImportBlocked !== "boolean" || typeof row.status !== "string")) throw new Error("Provider-first candidate contains malformed rows or projected statistics");
  if (!isRecord(candidateBoards.providerFirst) || candidateBoards.providerFirst.rows !== provider.rows.length || typeof candidateBoards.providerFirst.rowsHash !== "string" || contentHash(provider.rows) !== candidateBoards.providerFirst.rowsHash) throw new Error("Provider-first candidate rows do not match the hash recorded by the reconciliation report");

  const diagnostic = isRecord(report.diagnostics) ? report.diagnostics : {};
  const contributions = new Map<string, JsonRecord>();
  if (Array.isArray(diagnostic.exactEightCategoryContributions)) for (const entry of diagnostic.exactEightCategoryContributions) {
    if (!isRecord(entry) || typeof entry.fantraxId !== "string" || !isRecord(entry.categoryContributions)) continue;
    const values = Object.fromEntries(Object.entries(entry.categoryContributions).filter(([, value]) => finiteNumber(value) !== null)) as JsonRecord;
    contributions.set(entry.fantraxId, values);
  }
  const safeBoardRows = (rows: unknown): JsonRecord[] => {
    if (!Array.isArray(rows)) return [];
    return rows.filter(isRecord).slice().sort((a, b) => (finiteNumber(a.draftRank) ?? Infinity) - (finiteNumber(b.draftRank) ?? Infinity) || String(a.fantraxId ?? "").localeCompare(String(b.fantraxId ?? ""))).slice(0, 12).map(row => ({
      playerId: textValue(row.fantraxId), name: textValue(row.name), school: textValue(row.school), rank: finiteNumber(row.draftRank) ?? finiteNumber(row.rank),
      categoryContributions: isRecord(row.categoryZ) ? row.categoryZ : (contributions.get(String(row.fantraxId)) ?? null),
      totalAverage: finiteNumber(row.categoryScore), reviewRequired: row.reviewRequired === true,
      flags: Array.isArray(row.flags) ? row.flags.filter((flag): flag is string => typeof flag === "string").slice(0, 6) : []
    }));
  };
  const providerRows = provider.rows.filter(isRecord).slice(0, 12).map(row => ({
    playerId: textValue(row.fantraxId), name: textValue(row.name), school: textValue(row.school), rank: finiteNumber(row.rank),
    providerRank: finiteNumber(row.providerRank), modelRank: finiteNumber(row.modelRank), rankSource: textValue(row.rankSource),
    rankFreshness: textValue(row.rankFreshness) ?? textValue(row.status), sourceObservedAt: textValue(row.sourceObservedAt)
  }));
  const coverage = isRecord(report.coverage) ? report.coverage : {};
  const sourceCoverage = Array.isArray(coverage.sourceCoverage) ? coverage.sourceCoverage.filter(isRecord).map(source => ({
    provider: textValue(source.provider), kind: textValue(source.kind), observedAt: textValue(source.observedAt), publishedAt: textValue(source.publishedAt),
    matched: finiteNumber(source.matched), unmatched: finiteNumber(source.unmatched), updated: finiteNumber(source.updated)
  })) : [];
  const newestObservation = sourceCoverage.map(source => source.observedAt).filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const outlierCards = isRecord(report.outlierCards) ? report.outlierCards : {};
  const topOutliers = Array.isArray(outlierCards.top20Outliers) ? outlierCards.top20Outliers.filter(isRecord).slice(0, 7).map(card => ({
    playerId: textValue(card.fantraxId), name: textValue(card.name), school: textValue(card.school), providerRank: finiteNumber(card.providerRank),
    modelRank: finiteNumber(card.modelCategoryRank), rankGap: finiteNumber(card.rankGap), reason: textValue(card.reason)
  })) : [];
  const historicalOnly = Array.isArray(outlierCards.historicalOnly) ? outlierCards.historicalOnly.filter(isRecord).slice(0, 5).map(card => ({
    playerId: textValue(card.fantraxId), name: textValue(card.name), school: textValue(card.school), modelRank: finiteNumber(card.modelCategoryRank), reason: textValue(card.reason)
  })) : [];
  return {
    available: true,
    scope: { leagueId: activeBoard.leagueId, teamId: activeBoard.teamId, season: activeBoard.season, baselineRevision: activeBoard.revision, reconciliationRevision: reportHash.revision, correctedBoardRevision: correctedHash.revision },
    generatedAt: textValue(report.generatedAt), evidenceHash: reportEvidenceHash, newestEvidenceObservedAt: newestObservation,
    evidenceAgeHours: newestObservation ? Math.max(0, (Date.now() - Date.parse(newestObservation)) / 3_600_000) : null,
    coverage: { availablePool: finiteNumber(coverage.availablePool), availableForecastRows: finiteNumber(coverage.availableForecastRows), unforecastedCurrentPoolRows: finiteNumber(coverage.unforecastedCurrentPoolRows), rankedProviderIdentities: finiteNumber(coverage.rankedProviderIdentities), staleProviderRanks: finiteNumber(coverage.staleProviderRanks), uncoveredIdentities: finiteNumber(coverage.uncoveredIdentities), sources: sourceCoverage },
    candidates: { original: { label: "Original active board", rows: safeBoardRows(activeBoard.rows) }, correctedCategory: { label: "Corrected category-value", rows: safeBoardRows(corrected.rows) }, providerFirst: { label: "Provider-first rank-only", statisticsIncluded: false, rows: providerRows } },
    explanations: { topOutliers, historicalOnly, limitations: Array.isArray(report.limitations) ? report.limitations.filter((item): item is string => typeof item === "string").slice(0, 8) : [] }
  };
}

/** A separate loopback-only CBB dashboard and synthetic draft simulator. It contains no Fantrax writer. */
export async function startCopilotServer(options: StartCopilotServerOptions): Promise<StartedCopilotServer> {
  const { board, dataDir } = options;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const mode = options.mode ?? "mock";
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid local server port");
  if (mode !== "mock" && mode !== "coach") throw new Error("Mode must be mock or coach");
  assertLoopback(host);
  const baseSession = DraftSessionSchema.parse(options.session);
  if (baseSession.leagueId !== board.leagueId || baseSession.teamId !== board.teamId || baseSession.boardRevision !== board.revision) throw new Error("Session league/team/board scope mismatch");
  const reconciliation = reconciliationDisplay(options.reconciliation, board);
  await mkdir(dataDir, { recursive: true });
  const journal = new DraftJournal(resolve(dataDir, "journal"));
  await journal.open();
  const controlPath = resolve(dataDir, `copilot-control-${mode}.json`);
  let savedPaused = false;
  try { savedPaused = SavedControlSchema.parse(JSON.parse(await readFile(controlPath, "utf8"))).paused; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") { await journal.close(); throw new Error("Saved copilot control state is invalid"); } }

  let currentState: CopilotState | null = await journal.current();
  let session: DraftSession = baseSession;
  let sessionId = randomSessionId(board.leagueId);
  let selectedProfile: z.infer<typeof ProfileSchema> = "balanced";
  let scenario: z.infer<typeof ProfileSchema> = "balanced";
  let queuedPlayerId: string | null = null;
  let selectedSlot: z.infer<typeof SlotSchema> = "G";
  let latestReceipt: LatestReceipt | null = null;
  let coachPaused = savedPaused;
  let lastActionMessage: string | null = null;
  let lastActionOk = true;
  let localMockActions = 0;
  let renderCounter = 0;
  let adviceCacheKey = "";
  let adviceCache: Record<string, unknown> | null = null;
  let mutationTail: Promise<unknown> = Promise.resolve();
  const events: LocalEvent[] = [];
  const measurements: Measurement[] = [];
  const clickMeasurements = new Map<string, Measurement>();
  const allPlayers = new Map([...board.rows, ...board.excluded.map((player) => ({ ...player, draftRank: null, rank: null, categoryScore: null, positionValue: null, flags: [], reviewRequired: true } as unknown as RankedRow))].map((player) => [player.fantraxId, player]));

  if (currentState) {
    if (currentState.observation.session.leagueId !== board.leagueId || currentState.observation.session.teamId !== board.teamId || currentState.observation.session.boardRevision !== board.revision) {
      await journal.close(); throw new Error("Saved copilot journal belongs to a different league, team, or board revision");
    }
    if (mode === "mock" && currentState.observation.venue !== "local-mock") { await journal.close(); throw new Error("Saved coach observations cannot be opened as a synthetic mock session"); }
    if (mode === "coach" && currentState.observation.venue === "local-mock") { await journal.close(); throw new Error("Synthetic mock history cannot be opened in coach mode"); }
    session = currentState.session;
    sessionId = currentState.observation.sessionId;
    if (mode === "mock") localMockActions = session.picks.length;
    const last = session.picks.at(-1);
    if (last && mode === "mock") latestReceipt = { overall: last.overall, playerId: last.playerId, playerName: allPlayers.get(last.playerId)?.name ?? last.playerId, teamId: last.teamId, slot: "recorded", verified: true, at: currentState.observation.receivedAt };
  } else if (mode === "mock") {
    session = withObservedAt(baseSession, new Date(), { phase: "pre-draft", picks: [], sourceKind: "local-simulator", unavailablePlayerIds: [] });
    const initial = reconcileObservation(board, localObservation(session, sessionId, 1, "http://127.0.0.1", new Date()), null, new Date());
    currentState = { ...initial, paused: false };
    await journal.append(currentState);
  }
  if (currentState?.paused) lastActionMessage = "Session resumed paused from its journal.";
  else if (mode === "coach" && coachPaused) lastActionMessage = "Coach resumed paused from its local control file.";

  const selectedIds = () => new Set(session.picks.map((pick) => pick.playerId));
  const availableRows = (forOwnRoster = true): RankedRow[] => {
    const unavailable = new Set([...selectedIds(), ...session.unavailablePlayerIds, ...board.statusObservations.map((status) => status.fantraxId)]);
    const ownPlayers = session.picks.filter((pick) => pick.teamId === session.teamId).map((pick) => board.rows.find((row) => row.fantraxId === pick.playerId)).filter((player): player is RankedRow => Boolean(player));
    return [...board.rows].filter((player) => !unavailable.has(player.fantraxId) && (!forOwnRoster || canCompleteRoster([...ownPlayers, player])))
      .sort((a, b) => (a.draftRank ?? Number.POSITIVE_INFINITY) - (b.draftRank ?? Number.POSITIVE_INFINITY) || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  };
  const addEvent = (event: LocalEvent) => { events.push(event); if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS); };
  const appendState = async (state: CopilotState) => { await journal.append(state); currentState = state; session = state.session; adviceCacheKey = ""; };
  const savePause = async (paused: boolean) => {
    const temporary = `${controlPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, mode, paused })}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, controlPath);
  };
  const nextObservation = (nextSession: DraftSession, now: Date, correction = false, clockSeconds?: number): DraftObservation => {
    if (!currentState) throw new Error("No current local state");
    const prior = currentState.observation;
    const sameTurn = nextSession.phase === "live" && session.phase === "live" && nextSession.picks.length === session.picks.length;
    const elapsedSeconds = Math.max(0, (now.getTime() - Date.parse(prior.receivedAt)) / 1000);
    const preservedClock = sameTurn && prior.clockSeconds !== null ? Math.max(0, prior.clockSeconds - elapsedSeconds) : undefined;
    return DraftObservationSchema.parse({ ...localObservation(nextSession, sessionId, prior.sequence + 1, "http://127.0.0.1", now, clockSeconds ?? preservedClock), correction });
  };
  const reconcileLocal = async (nextSession: DraftSession, now: Date, correction = false, clockSeconds?: number): Promise<CopilotState> => {
    const observation = nextObservation(nextSession, now, correction, clockSeconds);
    const next = reconcileObservation(board, observation, currentState, now);
    if (next.status !== "ready" || next.issues.length) throw new HttpError(409, `Simulator reconciliation blocked: ${next.issues.join("; ")}`);
    await appendState(next);
    return next;
  };
  const refreshMockObservation = async (now: Date): Promise<CopilotState> => {
    if (!currentState || mode !== "mock") throw new HttpError(403, "Local simulator state is unavailable");
    const fresh = withObservedAt(session, now);
    return reconcileLocal(fresh, now);
  };

  const buildAdvice = (): Record<string, unknown> => {
    const currentRevision = currentState?.revision ?? `${session.boardRevision}:${session.observedAt}`;
    const key = `${currentRevision}:${selectedProfile}:${session.observedAt}:${currentState?.observation.receivedAt ?? "no-observation"}:${currentState?.status ?? "unobserved"}:${currentState?.paused ?? coachPaused}:${currentState?.issues.join("|") ?? ""}`;
    if (key !== adviceCacheKey || !adviceCache) {
      const started = performance.now();
      try {
        const result = buildAdaptiveAdvice(board, session, new Date(), { selectedProfile });
        const elapsedMs = performance.now() - started;
        adviceCache = { ...result, engineElapsedMs: elapsedMs } as unknown as Record<string, unknown>;
      } catch (error) {
        adviceCache = { status: "blocked", leagueId: board.leagueId, teamId: board.teamId, boardRevision: board.revision,
          generatedAt: new Date().toISOString(), stateObservedAt: currentState?.observation.receivedAt ?? session.observedAt,
          ageSeconds: Math.max(0, (Date.now() - Date.parse(currentState?.observation.receivedAt ?? session.observedAt)) / 1000),
          ownSelected: session.picks.filter((pick) => pick.teamId === session.teamId).length,
          nextOwnOverall: null, ownTurn: false, selectedProfile, suggestedProfile: selectedProfile,
          profiles: {}, trends: [], coverage: board.counts, readyForPlatformExecution: false, liveActionsExecuted: 0,
          warnings: [`Advice could not be calculated: ${error instanceof Error ? error.message : String(error)}`], engineElapsedMs: performance.now() - started };
      }
      adviceCacheKey = key;
    }
    const base = adviceCache!;
    const now = Date.now();
    const ageSeconds = Math.max(0, (now - Date.parse(session.observedAt)) / 1000);
    const inputAgesHours = {
      board: Math.max(0, (now - Date.parse(board.generatedAt)) / 3_600_000),
      pool: Math.max(0, (now - Date.parse(board.inputs.historySource.observedAt)) / 3_600_000),
      provider: Math.max(0, (now - Date.parse(board.inputs.provider.observedAt)) / 3_600_000)
    };
    const stale = session.phase === "live" && (ageSeconds > 20 || Object.values(inputAgesHours).some(hours => hours > 24));
    const issues = currentState?.issues ?? [];
    const blocked = Boolean(issues.length || (currentState && currentState.status !== "ready") || (mode === "coach" && !currentState));
    const paused = currentState?.paused ?? coachPaused;
    const warnings = [
      ...((base.warnings as string[] | undefined) ?? []),
      ...(issues.length ? issues.map(issue => `Observation blocked: ${issue}`) : []),
      ...(mode === "coach" && !currentState ? ["Awaiting an explicit browser observation; no live board is inferred from the supplied session file."] : []),
      ...(paused ? ["Copilot is paused; pick recommendations are suppressed."] : []),
      ...(stale ? ["The latest draft state or a required board source is stale; pick recommendations are suppressed."] : [])
    ];
    const suppress = blocked || paused || stale;
    const profiles = base.profiles && typeof base.profiles === "object"
      ? Object.fromEntries(Object.entries(base.profiles as Record<string, Record<string, unknown>>).map(([name, profile]) => [name, suppress ? { ...profile, recommendations: [] } : profile]))
      : base.profiles;
    return { ...base, status: blocked ? "blocked" : paused ? "paused" : stale ? "stale-state" : base.status,
      ageSeconds, stateObservedAt: session.observedAt, inputAgesHours, staleInputs: Object.values(inputAgesHours).some(hours => hours > 24),
      ownTurn: suppress ? false : base.ownTurn, recommendations: suppress ? [] : base.recommendations,
      profiles, readyForPlatformExecution: false, liveActionsExecuted: 0, warnings };
  };

  const currentSnapshot = () => {
    const advice = buildAdvice();
    const allAvailable = availableRows(true);
    const availablePlayers = allAvailable.slice(0, 24).map(safePlayer);
    const playerIds = new Set([...session.picks.map((pick) => pick.playerId), ...availablePlayers.map((player) => player.playerId)]);
    const playerCatalog = [...playerIds].map((id) => {
      const player = allPlayers.get(id);
      return player ? { playerId: player.fantraxId, name: player.name, school: player.school, eligibleGroups: player.eligibleGroups } : null;
    }).filter((player) => player !== null);
    const observedAt = currentState?.observation.receivedAt ?? session.observedAt;
    const renderRevision = `${currentState?.revision ?? "unobserved"}:${++renderCounter}`;
    const latestObservation = currentState?.observation ?? null;
    return {
      ok: true,
      data: {
        schemaVersion: 1, mode, label: mode === "mock" ? "SYNTHETIC LOCAL DRAFT" : "COACH · EXPLICIT OBSERVATIONS",
        session, copilotState: currentState, advice, selectedProfile, suggestedProfile: (advice as { suggestedProfile?: string }).suggestedProfile ?? selectedProfile,
        paused: currentState?.paused ?? coachPaused, stateStatus: currentState?.status ?? (coachPaused ? "paused" : mode === "coach" ? "awaiting-observation" : "ready"),
        stateIssues: currentState?.issues ?? [], queuedPlayerId, selectedSlot, scenario, latestReceipt,
        availablePlayers, availableCount: allAvailable.length, playerCatalog,
        events: [...events], sourceAgeSeconds: latestObservation ? Math.max(0, (Date.now() - Date.parse(latestObservation.session.observedAt)) / 1000) : null,
        sourceAgeLabel: latestObservation?.venue ?? "awaiting-explicit-observation", localMockActions, liveActionsExecuted: 0,
        renderRevision, serverTime: new Date().toISOString(), engineElapsedMs: (advice as { engineElapsedMs?: number }).engineElapsedMs ?? 0,
        lastActionMessage, lastActionOk
      }
    };
  };
  const stateData = () => currentSnapshot().data as Record<string, unknown>;
  const serializedMutation = <T>(work: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(work, work) as Promise<T>;
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const assertSameOrigin = (request: IncomingMessage) => {
    const origin = request.headers.origin;
    if (!origin || origin !== baseOrigin) throw new HttpError(403, "Write requests must come from this dashboard origin");
  };
  const setActionResult = (message: string, ok = true) => { lastActionMessage = message; lastActionOk = ok; };

  const applyMockAction = async (input: z.infer<typeof MockActionSchema>): Promise<string> => {
    if (mode !== "mock") throw new HttpError(403, "Mock controls are disabled in coach mode");
    if (!currentState) throw new HttpError(409, "Simulator state is unavailable");
    const now = new Date();
    if (currentState.paused && input.action !== "reset") throw new HttpError(423, "Simulator is paused; resume it before changing or advancing picks");
    if (input.action === "scenario") {
      if (!input.scenario) throw new HttpError(400, "Choose a supported opponent scenario");
      scenario = input.scenario; return `Opponent scenario set to ${scenario}.`;
    }
    if (input.action === "queue") {
      if (!input.playerId) throw new HttpError(400, "Choose a candidate before queueing");
      const player = availableRows(true).find((row) => row.fantraxId === input.playerId);
      if (!player) throw new HttpError(409, "That player is no longer available on the local board");
      queuedPlayerId = input.playerId;
      const owned = session.picks.filter((pick) => pick.teamId === session.teamId).map((pick) => board.rows.find((row) => row.fantraxId === pick.playerId)).filter((row): row is RankedRow => Boolean(row));
      const slotOptions: Array<z.infer<typeof SlotSchema>> = [selectedSlot, ...player.eligibleGroups, "Flx", "Res"];
      const legalSlot = [...new Set(slotOptions)].find((slot) => assignRosterSlots(owned, player, slot).legal);
      if (!legalSlot) throw new HttpError(409, "That candidate cannot fit the current local roster");
      selectedSlot = legalSlot;
      return `Queued ${player.name} for local review.`;
    }
    if (input.action === "choose-slot") {
      if (!input.slot) throw new HttpError(400, "Choose a roster slot");
      selectedSlot = input.slot; return `Selected ${selectedSlot} for the local pick.`;
    }
    if (input.action === "reset") {
      sessionId = randomSessionId(board.leagueId);
      queuedPlayerId = null; selectedSlot = "G"; latestReceipt = null; scenario = "balanced"; localMockActions = 0;
      events.splice(0, events.length);
      const reset = withObservedAt(baseSession, now, { phase: "pre-draft", picks: [], sourceKind: "local-simulator", unavailablePlayerIds: [] });
      const initial = reconcileObservation(board, localObservation(reset, sessionId, 1, "http://127.0.0.1", now), null, now);
      await appendState({ ...initial, paused: false });
      addEvent({ at: now.toISOString(), action: "reset" });
      return "Started a fresh synthetic session with a new identity.";
    }
    if (input.action === "start") {
      if (session.phase === "complete") throw new HttpError(409, "Draft is complete; reset to begin a new synthetic session");
      if (session.phase === "live") return "Synthetic draft is already running.";
      const started = withObservedAt(session, now, { phase: "live", sourceKind: "local-simulator", draftStart: now.toISOString() });
      await reconcileLocal(started, now);
      addEvent({ at: now.toISOString(), action: "start" });
      return "Synthetic eight-team draft started with 60-second own-turn clocks.";
    }
    if (session.phase !== "live") throw new HttpError(409, "Start the synthetic draft before advancing picks");
    if (input.action === "elapse-clock") {
      if (!input.seconds) throw new HttpError(400, "Choose how many seconds to advance the synthetic clock");
      const clock = currentState.observation.clockSeconds;
      if (clock === null) throw new HttpError(409, "There is no active displayed clock");
      const remaining = Math.max(0, clock - input.seconds);
      await reconcileLocal(withObservedAt(session, now), now, false, remaining);
      addEvent({ at: now.toISOString(), action: "elapse-clock" });
      return `Advanced the synthetic clock by ${input.seconds}s; ${Math.floor(remaining)}s remain.`;
    }
    if (input.action === "confirm-ownpick") {
      if (!queuedPlayerId) throw new HttpError(409, "Queue a candidate before confirming your local pick");
      if (input.slot) selectedSlot = input.slot;
      const player = board.rows.find((row) => row.fantraxId === queuedPlayerId);
      if (!player) throw new HttpError(409, "Queued player has no forecast row in this board");
      const owned = session.picks.filter((pick) => pick.teamId === session.teamId).map((pick) => board.rows.find((row) => row.fantraxId === pick.playerId)).filter((row): row is RankedRow => Boolean(row));
      const slotPlan = assignRosterSlots(owned, player, selectedSlot);
      if (!slotPlan.legal) throw new HttpError(409, `Selected ${selectedSlot} slot cannot produce a legal roster assignment; choose another open slot`);
      await refreshMockObservation(now);
      const overall = session.picks.length + 1;
      const intent: MockPickIntent = { sessionId, stateRevision: currentState!.revision, overall, playerId: player.fantraxId,
        teamId: session.teamId, slot: selectedSlot, expiresAt: new Date(now.getTime() + 30_000).toISOString() };
      const guard = guardMockPick(board, currentState!, intent, now);
      if (!guard.allowed) throw new HttpError(409, `Local pick blocked: ${guard.reasons.join("; ")}`);
      const afterSession = withObservedAt(session, now, { phase: overall === 112 ? "complete" : "live", picks: [...session.picks, { overall, teamId: session.teamId, playerId: player.fantraxId }] });
      const afterObservation = nextObservation(afterSession, now);
      const after = reconcileObservation(board, afterObservation, currentState, now);
      if (!verifyMockPickReceipt(currentState!, after, intent)) throw new HttpError(409, "Local simulator receipt did not match the approved pick intent");
      await appendState(after);
      latestReceipt = { overall, playerId: player.fantraxId, playerName: player.name, teamId: session.teamId, slot: selectedSlot, slotAssignment: slotPlan.assignment, verified: true, at: now.toISOString() };
      localMockActions++;
      queuedPlayerId = null;
      addEvent({ at: now.toISOString(), action: "confirm-ownpick", overall, playerId: player.fantraxId, teamId: session.teamId });
      return `Confirmed synthetic pick ${overall}: ${player.name} in ${selectedSlot}.`;
    }
    const isBurst = input.action === "burst";
    if (input.action !== "next-opponent" && !isBurst) throw new HttpError(400, "Unsupported local simulator action");
    let advanced = 0;
    const max = isBurst ? 8 : 1;
    while (advanced < max && session.phase === "live" && session.picks.length < 112) {
      const overall = session.picks.length + 1;
      const teamId = snakeTeam(session.teamOrder, overall);
      if (teamId === session.teamId) {
        if (advanced === 0) throw new HttpError(409, "It is already your turn. Queue a candidate and confirm your own mock pick.");
        break;
      }
      const selected = selectedIds();
      const owned = session.picks.filter((pick) => pick.teamId === teamId).map((pick) => board.rows.find((row) => row.fantraxId === pick.playerId)).filter((row): row is RankedRow => Boolean(row));
      const available = board.rows.filter((player) => !selected.has(player.fantraxId) && !session.unavailablePlayerIds.includes(player.fantraxId) && !board.statusObservations.some((status) => status.fantraxId === player.fantraxId) && canCompleteRoster([...owned, player]));
      const targetGroup = scenario === "guards" ? "G" : scenario === "bigs" ? "F/C" : null;
      const pool = targetGroup ? available.filter((player) => player.eligibleGroups.includes(targetGroup)) : available;
      const chosen = [...(pool.length ? pool : available)].sort((a, b) => {
        const aMarket = a.adp ?? a.draftRank ?? Infinity, bMarket = b.adp ?? b.draftRank ?? Infinity;
        return aMarket - bMarket || (a.draftRank ?? Infinity) - (b.draftRank ?? Infinity) || a.fantraxId.localeCompare(b.fantraxId);
      })[0];
      if (!chosen) throw new HttpError(409, "No forecasted player remains for a scripted opponent pick");
      const botSession = withObservedAt(session, new Date(), { phase: overall === 112 ? "complete" : "live", picks: [...session.picks, { overall, teamId, playerId: chosen.fantraxId }] });
      const reconciled = reconcileObservation(board, nextObservation(botSession, new Date()), currentState, new Date());
      if (reconciled.status !== "ready" || reconciled.issues.length) throw new HttpError(409, `Scripted pick blocked by roster or observation validation: ${reconciled.issues.join("; ")}`);
      await appendState(reconciled);
      latestReceipt = { overall, playerId: chosen.fantraxId, playerName: chosen.name, teamId, slot: "auto", verified: true, at: new Date().toISOString() };
      localMockActions++;
      addEvent({ at: new Date().toISOString(), action: "scripted-opponent-pick", overall, playerId: chosen.fantraxId, teamId, scenario });
      advanced++;
    }
    if (!advanced) throw new HttpError(409, "No opponent selection was made");
    return isBurst ? `Advanced ${advanced} scripted opponent pick${advanced === 1 ? "" : "s"}; current pick is ${session.picks.length + 1}.` : `Scripted opponent made pick ${session.picks.length}: ${latestReceipt?.playerName}.`;
  };

  let baseOrigin = "";
  const server = createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, { ok: true, data: { status: currentState?.status ?? (coachPaused ? "paused" : mode === "coach" ? "awaiting-observation" : "ready"), mode, paused: currentState?.paused ?? coachPaused, revision: currentState?.revision ?? null, stateIssues: currentState?.issues ?? [], liveActionsExecuted: 0, localMockActions } }); return;
    }
    if (request.method === "GET" && pathname === "/api/reconciliation") {
      const newestObservedAt = reconciliation.newestEvidenceObservedAt;
      const evidenceAgeHours = typeof newestObservedAt === "string" && Number.isFinite(Date.parse(newestObservedAt))
        ? Math.max(0, (Date.now() - Date.parse(newestObservedAt)) / 3_600_000) : null;
      sendJson(response, 200, { ok: true, data: { ...reconciliation, evidenceAgeHours } }); return;
    }
    if (request.method === "GET" && pathname === "/api/state") {
      try {
        // The simulator is its own authoritative source. A read captures its
        // current board while carrying the same turn's elapsed clock forward.
        // Coach mode must never renew an external observation this way.
        const snapshot = await serializedMutation(async () => {
          if (mode === "mock") await refreshMockObservation(new Date());
          return currentSnapshot();
        });
        sendJson(response, 200, snapshot);
      } catch (error) { sendFailure(response, error); }
      return;
    }
    if (request.method === "GET" && pathname === "/api/measurements") { sendJson(response, 200, { ok: true, data: [...measurements] }); return; }
    if (request.method === "GET" && STATIC_FILES.has(pathname)) {
      try {
        const [file, mime] = STATIC_FILES.get(pathname)!;
        const content = await readFile(resolve(PUBLIC_DIRECTORY, file));
        response.writeHead(200, { "content-type": mime, "content-length": content.byteLength, "cache-control": "no-store" }); response.end(content);
      } catch { sendJson(response, 404, { ok: false, error: "Dashboard asset is unavailable" }); }
      return;
    }
    const allowedWrite = request.method === "POST" && new Set(["/api/profile", "/api/pause", "/api/observation", "/api/mock-actions", "/api/measurement"]).has(pathname);
    if (!allowedWrite) { sendJson(response, 404, { ok: false, error: "Not found" }); return; }
    try {
      assertSameOrigin(request);
      const raw = await readJson(request);
      if (pathname === "/api/profile") {
        const body = z.object({ profile: ProfileSchema }).strict().parse(raw);
        const result = await serializedMutation(async () => { selectedProfile = body.profile; adviceCacheKey = ""; setActionResult(`Selected ${selectedProfile} profile.`); return { ...stateData(), message: lastActionMessage }; });
        sendJson(response, 200, { ok: true, data: result }); return;
      }
      if (pathname === "/api/pause") {
        const body = z.object({ paused: z.boolean() }).strict().parse(raw);
        const result = await serializedMutation(async () => {
          coachPaused = body.paused;
          if (currentState) {
            const updated = { ...currentState, paused: body.paused };
            await appendState(updated);
          }
          await savePause(body.paused);
          setActionResult(body.paused ? "Copilot paused; local actions are disabled." : "Copilot resumed.");
          return { ...stateData(), message: lastActionMessage };
        });
        sendJson(response, 200, { ok: true, data: result }); return;
      }
      if (pathname === "/api/observation") {
        const body = z.object({ observation: DraftObservationSchema }).strict().parse(raw);
        if (mode === "mock") throw new HttpError(403, "Mock mode accepts simulator controls only; browser observations belong in coach mode");
        const observation = body.observation;
        if (observation.venue === "local-mock") throw new HttpError(403, "Synthetic local observations cannot enter coach mode");
        const result = await serializedMutation(async () => {
          const reconciled = reconcileObservation(board, observation, currentState, new Date());
          if (reconciled.status !== "ready" || reconciled.issues.length) {
            const blocked = { ...reconciled, paused: currentState?.paused ?? coachPaused };
            await appendState(blocked);
            const message = `Observation rejected; last good board retained: ${reconciled.issues.join("; ")}`;
            setActionResult(message, false);
            return { accepted: false, message, snapshot: stateData() };
          }
          await appendState({ ...reconciled, paused: currentState?.paused ?? coachPaused });
          sessionId = observation.sessionId;
          setActionResult("Explicit browser observation reconciled for advice. No platform action was made.");
          return { accepted: true, ...stateData(), message: lastActionMessage };
        });
        if (!result.accepted) { sendJson(response, 409, { ok: false, error: result.message, data: result.snapshot }); return; }
        const { accepted: _accepted, ...data } = result;
        sendJson(response, 200, { ok: true, data }); return;
      }
      if (pathname === "/api/mock-actions") {
        const body = MockActionSchema.parse(raw);
        const message = await serializedMutation(async () => {
          try { const result = await applyMockAction(body); setActionResult(result); return result; }
          catch (error) { setActionResult(error instanceof Error ? error.message : String(error), false); throw error; }
        });
        sendJson(response, 200, { ok: true, data: { ...stateData(), message } }); return;
      }
      if (pathname === "/api/measurement") {
        const body = MeasurementSchema.parse(raw);
        const event: Measurement = { ...body, receivedAt: new Date().toISOString() };
        if (body.kind === "browser-click") clickMeasurements.set(body.actionId, event);
        else {
          const start = clickMeasurements.get(body.actionId);
          if (start) {
            event.elapsedMs = Math.max(0, body.clientTimeMs - start.clientTimeMs);
            if (body.kind === "browser-render") clickMeasurements.delete(body.actionId);
          }
        }
        measurements.push(event); if (measurements.length > MAX_MEASUREMENTS) measurements.splice(0, measurements.length - MAX_MEASUREMENTS);
        if (clickMeasurements.size > MAX_MEASUREMENTS) clickMeasurements.delete(clickMeasurements.keys().next().value as string);
        sendJson(response, 202, { ok: true, data: { recorded: true, kind: body.kind, actionId: body.actionId, elapsedMs: event.elapsedMs ?? null } }); return;
      }
    } catch (error) { sendFailure(response, error); }
  });

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(port, host, () => { server.off("error", rejectListen); resolveListen(); });
    });
  } catch (error) { await journal.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); await journal.close(); throw new Error("Could not determine the local copilot address"); }
  const actualPort = address.port;
  baseOrigin = originFor(host, actualPort);
  const url = `${baseOrigin}/`;
  return {
    server, url,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
      await journal.close();
    }
  };
}

async function runStandalone(args: string[]): Promise<void> {
  const value = (flag: string, fallback?: string): string | undefined => {
    const index = args.indexOf(flag); if (index < 0) return fallback;
    const result = args[index + 1]; if (!result || result.startsWith("--")) throw new Error(`Missing value for ${flag}`); return result;
  };
  const required = (flag: string): string => { const result = value(flag); if (!result) throw new Error(`Required ${flag}`); return result; };
  const boardPath = resolve(required("--board"));
  const statePath = resolve(required("--state"));
  const dataDir = resolve(required("--data-dir"));
  const port = z.coerce.number().int().min(0).max(65535).parse(value("--port", "0"));
  const mode = z.enum(["mock", "coach"]).parse(value("--mode", "mock"));
  const board = JSON.parse(await readFile(boardPath, "utf8")) as DraftBoard;
  const { revision, ...content } = board;
  if (contentHash(content) !== revision) throw new Error("Draft board hash mismatch");
  const rawState = JSON.parse(await readFile(statePath, "utf8")) as unknown;
  const candidate = rawState && typeof rawState === "object" && "session" in rawState ? (rawState as { session: unknown }).session : rawState;
  const session = DraftSessionSchema.parse(candidate);
  const started = await startCopilotServer({ board, session, dataDir, port, mode });
  process.stdout.write(`${JSON.stringify({ status: "ready", url: started.url, mode, liveActionsExecuted: 0 })}\n`);
  const stop = () => { void started.close().finally(() => { process.exitCode = 0; }); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  void runStandalone(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ status: "failed", message: error instanceof Error ? error.message : String(error), liveActionsExecuted: 0 })}\n`);
    process.exitCode = 1;
  });
}
