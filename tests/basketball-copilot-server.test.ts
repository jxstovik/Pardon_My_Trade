import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/basketball/contracts.js";
import { normalizeHistory, type readHistory } from "../src/basketball/history.js";
import { buildDraftBoard, type DraftBoard } from "../src/basketball/forecast.js";
import { activeSlotCount, canCompleteRoster, snakeTeam, type DraftSession } from "../src/basketball/draft.js";
import { startCopilotServer } from "../src/basketball/copilot-server.js";
import { contentHash } from "../src/basketball/store.js";

const config = ConfigSchema.parse(JSON.parse(await readFile("config/basketball/banging-3s.json", "utf8")));

function syntheticFixture(rowCount = 24): { board: DraftBoard; session: DraftSession } {
  const now = new Date();
  const observedAt = new Date(now.getTime() - 60_000).toISOString();
  const source = { schemaVersion: 1, leagueId: config.leagueId, leagueName: config.leagueName, leagueSeason: "2026-27",
    sourceUrl: `https://www.fantrax.com/fantasy/league/${config.leagueId}/players`, observedAt, kind: "official-csv-export",
    statsSeason: "2025-26", statsLabel: "2025-26 Reg Season - YTD", statsBasis: "per-game", filter: "all-available-players",
    completeness: "all-matching-export-rows", scopeVerification: "browser-league-header-and-selected-filters", statView: "standard", displayCountDecimals: 1 };
  const header = ["ID", "Player", "Team", "Position", "RkOv", "Status", "Score", "%D", "ADP", "GP", "MIN", "FGM", "FGA", "FG%", "FTM", "FTA", "FT%", "3PTM", "REB", "AST", "ST", "BLK", "TO", "PTS"];
  const rows = Array.from({ length: rowCount }, (_, i) => {
    const j = i % 12, fga = 10 + j * .2, fgm = 4 + j * .1, fta = 4 + j * .1, ftm = 3 + j * .1, three = 1 + j * .1;
    const group = rowCount > 24 ? (i % 2 === 0 ? "G" : "F/C") : (i < 12 ? "G" : "F/C");
    return [`sp${i}`, `Synthetic ${i}`, "SYN", group, i + 1, "FA", 100, 50, 20 + i, 30, 30 + j * .1,
      fgm.toFixed(1), fga.toFixed(1), (fgm / fga).toFixed(3), ftm.toFixed(1), fta.toFixed(1), (ftm / fta).toFixed(3), three.toFixed(1),
      (group === "G" ? 3 : 7) + j * .1, 2 + j * .1, (1 + j * .1).toFixed(1), (.2 + j * .1).toFixed(1), 2,
      (2 * fgm + three + ftm).toFixed(1)];
  });
  const csv = [header.join(","), ...rows.map(row => row.join(","))].join("\n");
  const history = { schemaVersion: 1, analysisVersion: "historical-display-v1", leagueId: config.leagueId, rawSha256: "b".repeat(64), revision: "a".repeat(64), directory: "synthetic-only", ...normalizeHistory(config, source, csv) } as Awaited<ReturnType<typeof readHistory>>;
  const supplement = { schemaVersion: 1, season: "2026-27", source: { provider: "RotoWire", url: "https://www.rotowire.com/cbasketball/article/2026-27-college-basketball-player-rankings-fantasy-141463", observedAt, publishedLabel: "Synthetic test data", scope: "Local test only" },
    players: (rowCount > 24 ? [0, 1] : [0, 12]).map((index, rank) => ({ fantraxId: `sp${index}`, name: `Synthetic ${index}`, schoolLabel: "SYN", providerRank: rank + 1, minutes: 30, PTS: 16, REB: index === 0 ? 4 : 8, AST: index === 0 ? 6 : 2, notes: "Synthetic test projection", matchMethod: "Exact synthetic ID/name/school" })) };
  const board = buildDraftBoard(config, history, supplement, now);
  const teamOrder = ["team-a", "team-b", "team-c", "team-d", "team-e", config.teamId, "team-g", "team-h"];
  const session: DraftSession = { schemaVersion: 1, leagueId: board.leagueId, teamId: board.teamId, boardRevision: board.revision,
    sourceKind: "manual-local", observedAt: now.toISOString(), draftStart: new Date(now.getTime() + 3_600_000).toISOString(), phase: "pre-draft",
    teamOrder, rounds: 14, unavailablePlayerIds: [], picks: [] };
  return { board, session };
}

async function fixtureDirectory(): Promise<string> { return mkdtemp(join(tmpdir(), "pmt-cbb-copilot-")); }
async function getJson(url: string) {
  const response = await fetch(url);
  return { response, body: await response.json() as Record<string, any> };
}
async function postJson(origin: string, path: string, body: unknown, includeOrigin = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (includeOrigin) headers.origin = origin;
  const response = await fetch(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { response, body: await response.json() as Record<string, any> };
}

function reconciliationFixture(board: DraftBoard) {
  const evidenceHash = "c".repeat(64);
  const { revision: _baselineRevision, ...boardContent } = structuredClone(board);
  const correctedPayload = { ...boardContent, generatedAt: new Date().toISOString(), status: "experimental-reconciliation-candidate-review-only",
    strategy: "balanced", inputs: { ...board.inputs, baselineRevision: board.revision, reconciliationEvidenceHash: evidenceHash } };
  const correctedBoard = { revision: contentHash(correctedPayload), ...correctedPayload };
  const providerRows = board.rows.slice(0, 4).map((row, index) => ({ rank: index + 1, fantraxId: row.fantraxId, name: row.name, school: row.school, eligibleGroups: row.eligibleGroups,
    providerRank: index < 2 ? index + 1 : null, modelRank: index + 1, rankSource: index < 2 ? "RotoWire" : "model-category-fallback",
    sourceObservedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(), rankFreshness: index < 2 ? "stale" : "uncovered", forecastAvailable: true, nativeImportBlocked: false, status: index < 2 ? "stale" : "uncovered" }));
  const reportContent = { schemaVersion: 1, kind: "basketball-draft-reconciliation-candidate", generatedAt: new Date().toISOString(),
    baseline: { revision: board.revision, sha256: "a".repeat(64), path: "fixture/active-board.json" }, evidenceHash,
    activeBoardChanged: false, activeStrategyChanged: false, sessionChanged: false, modelPromoted: false, platformActionsExecuted: 0, liveActionsExecuted: 0,
    candidateBoards: { correctedCategoryValue: { revision: correctedBoard.revision, rows: correctedBoard.rows.length }, providerFirst: { rows: providerRows.length, rowsHash: contentHash(providerRows) } },
    coverage: { availablePool: board.counts.availablePool, availableForecastRows: board.rows.length, unforecastedCurrentPoolRows: board.excluded.length,
      rankedProviderIdentities: 2, staleProviderRanks: 2, uncoveredIdentities: board.rows.length - 2,
      sourceCoverage: [{ provider: "RotoWire", kind: "provider-rank", observedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(), matched: 2, unmatched: 0, updated: 0 }] },
    diagnostics: { exactEightCategoryContributions: correctedBoard.rows.map(row => ({ fantraxId: row.fantraxId, categoryContributions: (row as unknown as { categoryZ?: Record<string, number> }).categoryZ ?? {}, totalAverage: 0 })) },
    outlierCards: { top20Outliers: [{ fantraxId: board.rows[0]!.fantraxId, name: board.rows[0]!.name, school: board.rows[0]!.school,
      providerRank: 1, modelCategoryRank: 87, rankGap: 86, reason: "Synthetic fixture discrepancy for human review." }], historicalOnly: [] },
    limitations: ["Review-only fixture; no candidate is an automatic pick."] };
  const report = { revision: contentHash(reportContent), ...reportContent };
  const providerFirstRankOnly = { schemaVersion: 1, kind: "provider-first-rank-only-review-candidate", generatedAt: report.generatedAt,
    baselineRevision: board.revision, reconciliationRevision: report.revision, evidenceHash, sourceOrder: "Provider ranks first; uncovered identities follow by category rank.",
    rankFreshness: {}, rows: providerRows, statisticsIncluded: false, sourceFieldsOnly: true, limitations: ["Rank-only fixture."] };
  return { report, correctedBoard, providerFirstRankOnly } as unknown as NonNullable<Parameters<typeof startCopilotServer>[0]["reconciliation"]>;
}

test("standalone dashboard is loopback scoped, journal revisions advance, and browser timings pair click to render", async () => {
  const { board, session } = syntheticFixture();
  const dataDir = await fixtureDirectory();
  const started = await startCopilotServer({ board, session, dataDir, host: "127.0.0.1", port: 0, mode: "mock" });
  try {
    assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const dashboard = await fetch(started.url);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /Mock pick desk/);
    const health = await getJson(new URL("/api/health", started.url).href);
    assert.equal(health.body.data.liveActionsExecuted, 0);
    assert.equal(health.body.data.mode, "mock");
    const before = await getJson(new URL("/api/state", started.url).href);
    const beforeRevision = before.body.data.copilotState.revision;
    const origin = new URL(started.url).origin;
    const noOrigin = await postJson(origin, "/api/profile", { profile: "guards" }, false);
    assert.equal(noOrigin.response.status, 403);
    const start = await postJson(origin, "/api/mock-actions", { action: "start" });
    assert.equal(start.response.status, 200);
    assert.notEqual(start.body.data.copilotState.revision, beforeRevision);
    assert.equal(start.body.data.session.phase, "live");
    assert.equal(start.body.data.liveActionsExecuted, 0);

    const actionId = "browser-measurement-test";
    await postJson(origin, "/api/measurement", { kind: "browser-click", actionId, clientTimeMs: 100, revision: start.body.data.renderRevision });
    await postJson(origin, "/api/measurement", { kind: "browser-render", actionId, clientTimeMs: 143.5, revision: start.body.data.renderRevision });
    const measurements = await getJson(new URL("/api/measurements", started.url).href);
    assert.equal(measurements.body.data.at(-1).elapsedMs, 43.5);
  } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test("serialized mock turn races allow one progression and one own pick with an exact local receipt", async () => {
  const { board, session } = syntheticFixture();
  const dataDir = await fixtureDirectory();
  const started = await startCopilotServer({ board, session, dataDir, port: 0, mode: "mock" });
  try {
    const origin = new URL(started.url).origin;
    await postJson(origin, "/api/mock-actions", { action: "start" });
    const raced = await Promise.all([
      postJson(origin, "/api/mock-actions", { action: "burst", scenario: "balanced" }),
      postJson(origin, "/api/mock-actions", { action: "burst", scenario: "guards" })
    ]);
    assert.equal(raced.filter(item => item.response.status === 200).length, 1);
    assert.equal(raced.filter(item => item.response.status === 409).length, 1);
    const atOwnTurn = await getJson(new URL("/api/state", started.url).href);
    assert.equal(atOwnTurn.body.data.session.picks.length, 5);
    assert.equal(atOwnTurn.body.data.advice.ownTurn, true);
    const candidate = atOwnTurn.body.data.availablePlayers[0];
    assert.ok(candidate);
    const slot = candidate.eligibleGroups.includes("G") ? "G" : "F/C";
    assert.equal((await postJson(origin, "/api/mock-actions", { action: "queue", playerId: candidate.playerId })).response.status, 200);
    const confirmations = await Promise.all([
      postJson(origin, "/api/mock-actions", { action: "confirm-ownpick", slot }),
      postJson(origin, "/api/mock-actions", { action: "confirm-ownpick", slot })
    ]);
    assert.equal(confirmations.filter(item => item.response.status === 200).length, 1);
    assert.equal(confirmations.filter(item => item.response.status === 409).length, 1);
    const after = await getJson(new URL("/api/state", started.url).href);
    assert.equal(after.body.data.session.picks.length, 6);
    assert.equal(after.body.data.latestReceipt.overall, 6);
    assert.equal(after.body.data.latestReceipt.playerId, candidate.playerId);
    assert.equal(after.body.data.latestReceipt.verified, true);
    assert.equal(after.body.data.localMockActions, 6);
    assert.equal(after.body.data.liveActionsExecuted, 0);
  } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test("an expired synthetic own-turn clock cannot be renewed by confirm", async () => {
  const { board, session } = syntheticFixture();
  const dataDir = await fixtureDirectory();
  const started = await startCopilotServer({ board, session, dataDir, port: 0, mode: "mock" });
  try {
    const origin = new URL(started.url).origin;
    await postJson(origin, "/api/mock-actions", { action: "start" });
    await postJson(origin, "/api/mock-actions", { action: "burst" });
    const atOwnTurn = await getJson(new URL("/api/state", started.url).href);
    const candidate = atOwnTurn.body.data.availablePlayers[0];
    assert.ok(candidate);
    const slot = candidate.eligibleGroups.includes("G") ? "G" : "F/C";
    await postJson(origin, "/api/mock-actions", { action: "queue", playerId: candidate.playerId });
    const elapsed = await postJson(origin, "/api/mock-actions", { action: "elapse-clock", seconds: 60 });
    assert.equal(elapsed.response.status, 200);
    assert.equal(elapsed.body.data.copilotState.observation.clockSeconds, 0);
    const confirmation = await postJson(origin, "/api/mock-actions", { action: "confirm-ownpick", slot });
    assert.equal(confirmation.response.status, 409);
    const after = await getJson(new URL("/api/state", started.url).href);
    assert.equal(after.body.data.session.picks.length, 5);
    assert.equal(after.body.data.copilotState.observation.clockSeconds, 0);
  } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test("scripted Balanced, Guards, and Bigs opponents finish with feasible eight-team rosters", async () => {
  for (const scenario of ["balanced", "guards", "bigs"] as const) {
    // Eight legal rosters can collectively use up to eighty of one group.
    // Supply eighty of each so this tests the actor rather than pool starvation.
    const { board, session } = syntheticFixture(160);
    const dataDir = await fixtureDirectory();
    const started = await startCopilotServer({ board, session, dataDir, port: 0, mode: "mock" });
    try {
      const origin = new URL(started.url).origin;
      await postJson(origin, "/api/mock-actions", { action: "start" });
      await postJson(origin, "/api/mock-actions", { action: "scenario", scenario });
      let state = (await getJson(new URL("/api/state", started.url).href)).body.data;
      while (state.session.picks.length < 112) {
        const overall = state.session.picks.length + 1;
        if (snakeTeam(state.session.teamOrder, overall) === state.session.teamId) {
          const candidate = state.availablePlayers[0];
          assert.ok(candidate, `${scenario} scenario should leave a legal own-roster candidate at ${overall}`);
          const queued = await postJson(origin, "/api/mock-actions", { action: "queue", playerId: candidate.playerId });
          assert.equal(queued.response.status, 200, queued.body.error);
          const confirmed = await postJson(origin, "/api/mock-actions", { action: "confirm-ownpick" });
          assert.equal(confirmed.response.status, 200, confirmed.body.error);
          state = confirmed.body.data;
        } else {
          const advanced = await postJson(origin, "/api/mock-actions", { action: "burst" });
          assert.equal(advanced.response.status, 200, advanced.body.error);
          state = advanced.body.data;
        }
      }
      assert.equal(state.session.phase, "complete");
      for (const teamId of state.session.teamOrder) {
        const roster = state.session.picks.filter((pick: { teamId: string }) => pick.teamId === teamId)
          .map((pick: { playerId: string }) => board.rows.find((row) => row.fantraxId === pick.playerId)!);
        assert.equal(roster.length, 14, `${scenario}: ${teamId} should have fourteen players`);
        assert.ok(canCompleteRoster(roster), `${scenario}: ${teamId} roster is not feasible`);
        assert.ok(activeSlotCount(roster) >= 10, `${scenario}: ${teamId} needs ten active slots`);
      }
    } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); }
  }
});

test("coach mode ingests no implicit mock authority and rejects every pick-control route", async () => {
  const { board, session } = syntheticFixture();
  const dataDir = await fixtureDirectory();
  const started = await startCopilotServer({ board, session, dataDir, port: 0, mode: "coach" });
  try {
    const origin = new URL(started.url).origin;
    const initial = await getJson(new URL("/api/state", started.url).href);
    assert.equal(initial.body.data.mode, "coach");
    assert.equal(initial.body.data.copilotState, null);
    for (const action of ["start", "queue", "confirm-ownpick", "reset"]) {
      const response = await postJson(origin, "/api/mock-actions", { action, playerId: board.rows[0]?.fantraxId, slot: "G" });
      assert.equal(response.response.status, 403, `${action} should be disabled in coach mode`);
    }
    assert.equal((await getJson(new URL("/api/state", started.url).href)).body.data.session.picks.length, 0);
    const health = await getJson(new URL("/api/health", started.url).href);
    assert.equal(health.body.data.liveActionsExecuted, 0);
    assert.equal(health.body.data.localMockActions, 0);
  } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test("server rejects session scope mismatch before binding", async () => {
  const { board, session } = syntheticFixture();
  const dataDir = await fixtureDirectory();
  try {
    await assert.rejects(startCopilotServer({ board, session: { ...session, teamId: "other-team" }, dataDir, port: 0 }), /scope mismatch/);
    await assert.rejects(startCopilotServer({ board, session, dataDir, host: "0.0.0.0", port: 0 }), /loopback/);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("reconciliation comparison is read-only and rejects foreign or tampered candidate bundles", async () => {
  const { board, session } = syntheticFixture();
  const reconciliation = reconciliationFixture(board);
  const dataDir = await fixtureDirectory();
  const started = await startCopilotServer({ board, session, dataDir, port: 0, mode: "coach", reconciliation });
  try {
    const origin = new URL(started.url).origin;
    const before = (await getJson(`${origin}/api/state`)).body.data;
    const display = await getJson(`${origin}/api/reconciliation?view=correctedCategory`);
    assert.equal(display.response.status, 200);
    assert.equal(display.body.data.available, true);
    assert.equal(display.body.data.scope.baselineRevision, board.revision);
    assert.equal(display.body.data.candidates.correctedCategory.rows.length, 12);
    assert.equal(display.body.data.candidates.providerFirst.statisticsIncluded, false);
    assert.equal(display.body.data.candidates.providerFirst.rows[0].rankFreshness, "stale");
    assert.equal(display.body.data.explanations.topOutliers[0].name, board.rows[0]!.name);
    const after = (await getJson(`${origin}/api/state`)).body.data;
    assert.deepEqual(after.session, before.session);
    assert.equal(after.selectedProfile, before.selectedProfile);
    assert.equal(after.advice.selectedProfile, before.advice.selectedProfile);
    assert.equal(after.copilotState, before.copilotState);

    const foreignDataDir = await fixtureDirectory();
    const { revision: _reportRevision, ...reportContent } = reconciliation.report as unknown as Record<string, unknown>;
    const foreignReportContent = { ...reportContent, baseline: { ...(reportContent.baseline as Record<string, unknown>), revision: "f".repeat(64) } };
    const foreignReport = { revision: contentHash(foreignReportContent), ...foreignReportContent };
    const foreignBundle = { ...reconciliation, report: foreignReport, providerFirstRankOnly: { ...reconciliation.providerFirstRankOnly, reconciliationRevision: foreignReport.revision } };
    await assert.rejects(startCopilotServer({ board, session, dataDir: foreignDataDir, port: 0, reconciliation: foreignBundle as typeof reconciliation }), /baseline revision does not match/);
    await rm(foreignDataDir, { recursive: true, force: true });

    const tamperedDataDir = await fixtureDirectory();
    const changedRows = [...reconciliation.providerFirstRankOnly.rows];
    changedRows[0] = { ...changedRows[0]!, name: "Tampered provider identity" };
    const tamperedBundle = { ...reconciliation, providerFirstRankOnly: { ...reconciliation.providerFirstRankOnly, rows: changedRows } };
    await assert.rejects(startCopilotServer({ board, session, dataDir: tamperedDataDir, port: 0, reconciliation: tamperedBundle as typeof reconciliation }), /rows do not match the hash/);
    await rm(tamperedDataDir, { recursive: true, force: true });
  } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test("coach reads expire without cache renewal and rejected history persists a blocked last-good board", async (t) => {
  const { board, session } = syntheticFixture();
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  const dataDir = await fixtureDirectory();
  const started = await startCopilotServer({ board, session, dataDir, port: 0, mode: "coach" });
  const origin = new URL(started.url).origin;
  const observation = (sequence: number) => ({ schemaVersion: 1, sessionId: "verified-fixture-coach", venue: "fantrax-league",
    pageUrl: `https://www.fantrax.com/fantasy/league/${board.leagueId}/draft`, receivedAt: new Date().toISOString(), sequence,
    completeHistory: true, identityVerified: true, currentTeamId: session.teamOrder[0], clockSeconds: 60, correction: false,
    session: { ...session, sourceKind: "browser-dom", observedAt: new Date(Date.now() - 10_000).toISOString(), draftStart: new Date(now - 60_000).toISOString(), phase: "live" } });
  try {
    assert.equal((await postJson(origin, "/api/observation", { observation: observation(1) })).response.status, 200);
    const fresh = (await getJson(`${origin}/api/state`)).body.data;
    assert.equal(fresh.sourceAgeSeconds, 10, "Receipt time must not renew the source capture age");
    assert.ok(fresh.advice.profiles.balanced.recommendations.length > 0);
    t.mock.timers.tick(21_000);
    const stale = (await getJson(`${origin}/api/state`)).body.data;
    assert.equal(stale.advice.status, "stale-state");
    assert.equal(stale.advice.ownTurn, false);
    assert.equal(stale.advice.profiles.balanced.recommendations.length, 0);
    assert.equal((await postJson(origin, "/api/observation", { observation: observation(2) })).response.status, 200);
    const rejected = await postJson(origin, "/api/observation", { observation: { ...observation(3), completeHistory: false } });
    assert.equal(rejected.response.status, 409);
    const blocked = (await getJson(`${origin}/api/state`)).body.data;
    assert.equal(blocked.copilotState.status, "blocked");
    assert.equal(blocked.advice.status, "blocked");
    assert.equal(blocked.session.picks.length, 0);
    assert.equal(blocked.advice.profiles.balanced.recommendations.length, 0);
    assert.equal((await postJson(origin, "/api/observation", { observation: observation(4) })).response.status, 200);
    assert.equal((await getJson(`${origin}/api/state`)).body.data.copilotState.status, "ready");
  } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); t.mock.timers.reset(); }
});

test("clean server restart retains the journal and pause blocks further synthetic progression", async () => {
  const { board, session } = syntheticFixture();
  const dataDir = await fixtureDirectory();
  let started = await startCopilotServer({ board, session, dataDir, port: 0, mode: "mock" });
  try {
    let origin = new URL(started.url).origin;
    await postJson(origin, "/api/mock-actions", { action: "start" });
    await postJson(origin, "/api/mock-actions", { action: "burst" });
    await postJson(origin, "/api/pause", { paused: true });
    const before = (await getJson(`${origin}/api/state`)).body.data;
    await started.close();
    started = await startCopilotServer({ board, session, dataDir, port: 0, mode: "mock" });
    origin = new URL(started.url).origin;
    const after = (await getJson(`${origin}/api/state`)).body.data;
    assert.deepEqual(after.session.picks, before.session.picks);
    assert.equal(after.paused, true);
    assert.equal(after.advice.profiles.balanced.recommendations.length, 0);
    assert.equal((await postJson(origin, "/api/mock-actions", { action: "next-opponent" })).response.status, 423);
    assert.equal(after.liveActionsExecuted, 0);
  } finally { await started.close(); await rm(dataDir, { recursive: true, force: true }); }
});
