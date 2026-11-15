import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ConfigSchema, CATEGORIES } from "../src/basketball/contracts.js";
import type { StatLine } from "../src/basketball/categories.js";
import { normalizeHistory, type readHistory } from "../src/basketball/history.js";
import { buildDraftBoard, type DraftBoard } from "../src/basketball/forecast.js";
import { activeSlotCount, snakeTeam, type DraftSession } from "../src/basketball/draft.js";
import { buildAdaptiveAdvice } from "../src/basketball/draft-adaptive.js";

const config = ConfigSchema.parse(JSON.parse(await readFile("config/basketball/banging-3s.json", "utf8")));
const at = new Date("2026-10-28T20:00:00Z");

function fixture(statusInput?: unknown, turnoverRate = 2): DraftBoard {
  // Fictional athlete rows; metadata keeps the existing history normalizer's test contract.
  const source = {
    schemaVersion: 1, leagueId: config.leagueId, leagueName: config.leagueName, leagueSeason: "2026-27",
    sourceUrl: `https://www.fantrax.com/fantasy/league/${config.leagueId}/players`, observedAt: "2026-10-28T19:00:00Z",
    kind: "official-csv-export", statsSeason: "2025-26", statsLabel: "2025-26 Reg Season - YTD", statsBasis: "per-game",
    filter: "all-available-players", completeness: "all-matching-export-rows", scopeVerification: "browser-league-header-and-selected-filters",
    statView: "standard", displayCountDecimals: 1
  };
  const header = ["ID", "Player", "Team", "Position", "RkOv", "Status", "Score", "%D", "ADP", "GP", "MIN", "FGM", "FGA", "FG%", "FTM", "FTA", "FT%", "3PTM", "REB", "AST", "ST", "BLK", "TO", "PTS"];
  const rows = Array.from({ length: 36 }, (_, i) => {
    const role = i < 12 ? "G" : i < 24 ? "F/C" : "G,F/C";
    const j = i % 6;
    const guard = i < 12;
    const frontcourt = i >= 12 && i < 24;
    const fga = guard ? 9.6 + j * 0.2 : frontcourt ? 11.2 + j * 0.2 : 10.2 + j * 0.2;
    const fg = guard ? 0.44 + j * 0.006 : frontcourt ? 0.56 + j * 0.006 : 0.50 + j * 0.006;
    const fgm = fga * fg;
    const fta = guard ? 4.2 + j * 0.1 : frontcourt ? 3.1 + j * 0.1 : 3.7 + j * 0.1;
    const ft = guard ? 0.86 - j * 0.004 : frontcourt ? 0.69 - j * 0.004 : 0.77 - j * 0.004;
    const ftm = fta * ft;
    const three = guard ? 2.1 + j * 0.1 : frontcourt ? 0.65 + j * 0.05 : 1.35 + j * 0.05;
    const reb = guard ? 3.2 + j * 0.15 : frontcourt ? 8.2 + j * 0.15 : 5.8 + j * 0.15;
    const ast = guard ? 6.1 + j * 0.15 : frontcourt ? 2.0 + j * 0.1 : 4.0 + j * 0.1;
    const st = guard ? 1.15 + j * 0.03 : frontcourt ? 0.75 + j * 0.02 : 0.95 + j * 0.02;
    const blk = guard ? 0.25 + j * 0.02 : frontcourt ? 1.7 + j * 0.04 : 0.95 + j * 0.03;
    const points = 2 * fgm + three + ftm;
    return [`p${i}`, `Synthetic ${i}`, "SYN", role, i + 1, "FA", 100, 50, i + 1, 30, (31 + j * 0.1).toFixed(1),
      fgm.toFixed(1), fga.toFixed(1), fg.toFixed(3), ftm.toFixed(1), fta.toFixed(1), ft.toFixed(3), three.toFixed(1),
      reb.toFixed(1), ast.toFixed(1), st.toFixed(1), blk.toFixed(1), (turnoverRate * (i + 1)).toFixed(1), points.toFixed(1)];
  });
  rows.push(["cold", "Synthetic Cold", "SYN", "G", 37, "FA", 0, 0, 70, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  rows.push(["unmodeled", "Synthetic Unmodeled", "SYN", "G", 38, "FA", 0, 0, 90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
  const history = {
    schemaVersion: 1, analysisVersion: "historical-display-v1", leagueId: config.leagueId,
    rawSha256: "b".repeat(64), revision: "a".repeat(64), directory: "synthetic-only", ...normalizeHistory(config, source, csv)
  } as Awaited<ReturnType<typeof readHistory>>;
  const supplement = {
    schemaVersion: 1, season: "2026-27",
    source: { provider: "RotoWire", url: "https://www.rotowire.com/cbasketball/article/2026-27-college-basketball-player-rankings-fantasy-141463", observedAt: "2026-10-28T19:00:00Z", publishedLabel: "Synthetic test source", scope: "Synthetic fixture only" },
    players: [
      { fantraxId: "p0", name: "Synthetic 0", schoolLabel: "SYN", providerRank: 1, minutes: 32, PTS: 17, REB: 4, AST: 7, notes: "Synthetic guard", matchMethod: "Exact synthetic name/school" },
      { fantraxId: "cold", name: "Synthetic Cold", schoolLabel: "SYN", providerRank: 2, minutes: 28, PTS: 14, REB: 4, AST: 3, notes: "Synthetic freshman", matchMethod: "Exact synthetic name/school" }
    ]
  };
  const status = statusInput ?? { schemaVersion: 1, season: "2026-27", observations: [] };
  const board = buildDraftBoard(config, history, supplement, at, status);
  // Controlled synthetic vectors make profile behavior testable without claiming forecast accuracy.
  for (const row of board.rows) {
    const index = Number(row.fantraxId.replace("p", ""));
    const vector = !Number.isFinite(index)
      ? { PTS: 0.25, REB: 0.1, AST: 0.1, ST: 0.1, BLK: 0.1, "3PTM": 0.1, "FG%": 0.1, "FT%": 0.1 }
      : index < 12
      ? { PTS: 1.0, REB: -0.4, AST: 1.5, ST: 1.2, BLK: -0.4, "3PTM": 1.6, "FG%": 0.3, "FT%": 1.4 }
      : index < 24
        ? { PTS: 0.9, REB: 1.5, AST: -0.45, ST: 0.4, BLK: 1.6, "3PTM": -0.2, "FG%": 1.4, "FT%": 0.2 }
        : { PTS: 0.8, REB: 0.8, AST: 0.6, ST: 0.8, BLK: 0.8, "3PTM": 0.7, "FG%": 0.8, "FT%": 0.6 };
    const offset = Number.isFinite(index) ? (index % 6) * 0.025 : 0;
    row.categoryZ = Object.fromEntries(CATEGORIES.map(category => [category, vector[category] + offset])) as typeof row.categoryZ;
    row.categoryScore = CATEGORIES.reduce((sum, category) => sum + row.categoryZ[category], 0) / CATEGORIES.length;
  }
  return board;
}

function blankSession(board: DraftBoard): DraftSession {
  return {
    schemaVersion: 1, leagueId: board.leagueId, teamId: board.teamId, boardRevision: board.revision,
    sourceKind: "local-simulator", observedAt: at.toISOString(), draftStart: "2026-10-28T21:00:00Z", phase: "pre-draft",
    teamOrder: ["t0", "t1", "t2", "t3", "t4", board.teamId, "t6", "t7"], rounds: 14, unavailablePlayerIds: [], picks: []
  };
}

function sessionWithOwnPicks(board: DraftBoard, ownPlayerIds: string[]): DraftSession {
  const session = blankSession(board);
  if (!ownPlayerIds.length) return session;
  const ownTurns = Array.from({ length: 112 }, (_, i) => i + 1).filter(overall => snakeTeam(session.teamOrder, overall) === session.teamId);
  const lastOverall = ownTurns[ownPlayerIds.length - 1]!;
  const reserved = new Set(ownPlayerIds);
  const used = new Set<string>();
  const opponents = [...board.rows, ...board.excluded].filter(p => !reserved.has(p.fantraxId))
    .sort((a,b) => Number(b.eligibleGroups.length === 1 && b.eligibleGroups.includes("G")) - Number(a.eligibleGroups.length === 1 && a.eligibleGroups.includes("G")) || a.fantraxId.localeCompare(b.fantraxId, undefined, { numeric: true }));
  let otherIndex = 0;
  let ownIndex = 0;
  session.phase = "live";
  session.draftStart = "2026-10-28T19:00:00Z";
  for (let overall = 1; overall <= lastOverall; overall++) {
    const teamId = snakeTeam(session.teamOrder, overall);
    let playerId: string;
    if (teamId === session.teamId) playerId = ownPlayerIds[ownIndex++]!;
    else {
      while (used.has(opponents[otherIndex]?.fantraxId ?? "") || !opponents[otherIndex]) otherIndex++;
      playerId = opponents[otherIndex++]!.fantraxId;
    }
    used.add(playerId);
    session.picks.push({ overall, teamId, playerId });
  }
  return session;
}

test("adaptive profiles build legal active-ten/reserve-four paths with shared eight-category and summed shooting evaluation", () => {
  const board = fixture();
  const result = buildAdaptiveAdvice(board, blankSession(board), at, { limit: 8 });
  const guards = result.profiles.guards;
  const bigs = result.profiles.bigs;
  assert.equal(result.coverage.availableForecasted, board.rows.length);
  assert.notDeepEqual(guards.construction.map((p: { playerId: string }) => p.playerId), bigs.construction.map((p: { playerId: string }) => p.playerId));
  assert.deepEqual(Object.keys(result.evaluation.profileComparisons.balanced.categoryZ), [...CATEGORIES]);
  for (const profile of Object.values(result.profiles) as any[]) {
    assert.ok(profile.searchBounds.recommendationCandidates <= 24);
    assert.ok(profile.searchBounds.constructionWorkingPool <= 160);
    assert.ok(profile.searchBounds.opponentScenarioPool <= 112);
    const path = profile.projectedRoster;
    assert.equal(path.players.length, 14);
    assert.equal(path.active.length, 10);
    assert.equal(path.reserve.length, 4);
    assert.equal(path.legalRoster, true);
    assert.equal(new Set(path.players.map((p: { playerId: string }) => p.playerId)).size, 14);
    assert.ok(path.active.every((p: { slot: string; eligibleGroups: string[] }) => p.slot.startsWith("Flx") || p.eligibleGroups.includes(p.slot.startsWith("G") ? "G" : "F/C")));
  }
  const balanced = result.profiles.balanced.projectedRoster;
  const activeStats = balanced.active.filter((p: { stats: unknown }) => p.stats !== null).map((p: { stats: any }) => p.stats);
  const fgm = activeStats.reduce((sum: number, p: any) => sum + p.FGM, 0);
  const fga = activeStats.reduce((sum: number, p: any) => sum + p.FGA, 0);
  const ftm = activeStats.reduce((sum: number, p: any) => sum + p.FTM, 0);
  const fta = activeStats.reduce((sum: number, p: any) => sum + p.FTA, 0);
  const arithmeticMeanFG = activeStats.reduce((sum: number, p: any) => sum + p.FGM / p.FGA, 0) / activeStats.length;
  const arithmeticMeanFT = activeStats.reduce((sum: number, p: any) => sum + p.FTM / p.FTA, 0) / activeStats.length;
  assert.ok(Math.abs(balanced.evaluation.fgExposure.made - fgm) < 1e-8);
  assert.ok(Math.abs(balanced.evaluation.fgExposure.attempts - fga) < 1e-8);
  assert.ok(Math.abs(balanced.evaluation.fgExposure.rate - fgm / fga) < 1e-8);
  assert.ok(Math.abs(balanced.evaluation.fgExposure.rate - arithmeticMeanFG) > 1e-5);
  assert.ok(Math.abs(balanced.evaluation.ftExposure.made - ftm) < 1e-8);
  assert.ok(Math.abs(balanced.evaluation.ftExposure.attempts - fta) < 1e-8);
  assert.ok(Math.abs(balanced.evaluation.ftExposure.rate - ftm / fta) < 1e-8);
  assert.ok(Math.abs(balanced.evaluation.ftExposure.rate - arithmeticMeanFT) > 1e-5);
  assert.ok(balanced.evaluation.minutesStressCases.low.categoryZ["FG%"] !== undefined);
  assert.equal(result.evaluation.categoryCount, 8);
  assert.equal(result.readyForPlatformExecution, false);
  assert.equal(result.liveActionsExecuted, 0);
  for (const scenario of guards.nextPickScenarios) {
    assert.equal(scenario.beforeFirstOwnPick.length, 5);
    const consumed = new Set(scenario.beforeFirstOwnPick.map((p: {playerId:string}) => p.playerId));
    assert.ok(scenario.bestPair);
    assert.ok(!consumed.has(scenario.bestPair.first.playerId));
    assert.ok(!consumed.has(scenario.bestPair.second?.playerId));
  }
});

test("active ten maximizes the shared eight-category score within each constructed roster", () => {
  const board = fixture();
  const result = buildAdaptiveAdvice(board, blankSession(board), at, { limit: 4 });
  type ForecastedPlayer = { playerId: string; eligibleGroups: ("G" | "F/C")[]; stats: StatLine };
  const players = (result.profiles.balanced.projectedRoster.players as unknown[])
    .filter((value): value is ForecastedPlayer => {
      const player = value as Partial<ForecastedPlayer>;
      return player.stats !== null && player.stats !== undefined;
    });
  const legalScore = (subset: ForecastedPlayer[]) => {
    const lines: StatLine[] = subset.map(player => player.stats);
    const count = lines.length;
    const z = CATEGORIES.map(category => {
      const total = category === "FG%"
        ? lines.reduce((sum, line) => sum + line.FGM - board.reference.refFG * line.FGA, 0)
        : category === "FT%"
          ? lines.reduce((sum, line) => sum + line.FTM - board.reference.refFT * line.FTA, 0)
          : lines.reduce((sum, line) => sum + line[category], 0);
      const moments = board.reference.moments[category];
      return (total - count * moments.mean) / (Math.sqrt(Math.max(1, count)) * moments.sd);
    });
    return z.reduce((sum, value) => sum + value, 0) / CATEGORIES.length;
  };
  let max = -Infinity;
  const chosen: ForecastedPlayer[] = [];
  const enumerate = (start: number) => {
    if (chosen.length === 10) {
      const eligibility = chosen.map(player => ({ fantraxId: player.playerId, eligibleGroups: player.eligibleGroups }));
      if (activeSlotCount(eligibility) === 10) max = Math.max(max, legalScore(chosen));
      return;
    }
    const need = 10 - chosen.length;
    for (let index = start; index <= players.length - need; index++) {
      chosen.push(players[index]);
      enumerate(index + 1);
      chosen.pop();
    }
  };
  enumerate(0);
  assert.ok(Number.isFinite(max));
  assert.ok(Math.abs(result.profiles.balanced.projectedRoster.evaluation.score - max) < 1e-10);
  assert.ok(result.warnings.some((warning: string) => warning.includes("not globally optimized")));
});

test("recommendations adapt to roster imbalance and observed guard run while exposing deterministic next-pick cases", () => {
  const board = fixture();
  const empty = buildAdaptiveAdvice(board, blankSession(board), at, { selectedProfile: "balanced" });
  const rosteredSession = sessionWithOwnPicks(board, ["p0", "p1", "p2", "p3"]);
  const rostered = buildAdaptiveAdvice(board, rosteredSession, at, { selectedProfile: "balanced" });
  assert.notEqual(empty.profiles.balanced.recommendations[0]?.player.playerId, rostered.profiles.balanced.recommendations[0]?.player.playerId);
  const trendAdvice = buildAdaptiveAdvice(board, sessionWithOwnPicks(board, ["p0"]), at, { selectedProfile: "balanced" });
  assert.equal(trendAdvice.trends.currentRun.group, "G");
  assert.equal(trendAdvice.trends.currentRun.count, 6);
  assert.equal(trendAdvice.trends.lastSixGroupCounts.G, 6);
  assert.deepEqual(trendAdvice.trends.scenarios.map((s: { scenario: string }) => s.scenario), ["adp-reference", "guard-demand", "big-demand"]);
  for (const scenario of trendAdvice.trends.scenarios) {
    assert.equal(scenario.opponentPicks.length, scenario.secondOwnOverall - scenario.firstOwnOverall - 1);
    assert.ok(scenario.bestPair?.first?.playerId);
    assert.ok(scenario.waitCase);
    assert.equal("survivalProbability" in scenario, false);
  }
  assert.equal(rostered.nextOwnOverall, 38);
});

test("known status blocks a forecasted player, and stale live state suppresses recommendations", () => {
  const unblocked = fixture();
  const target = buildAdaptiveAdvice(unblocked, blankSession(unblocked), at).profiles.guards.recommendations[0]!.player;
  assert.ok(target.playerId);
  const statusBoard = fixture({ schemaVersion: 1, season: "2026-27", observations: [{
    fantraxId: target.playerId, status: "out", draftAction: "manual-review-only", observedAt: at.toISOString(),
    sourceUrl: "https://www.rotowire.com/cbasketball/player/synthetic", sourcePublishedAt: "2026-10-28", reason: "Synthetic test status"
  }] });
  const advised = buildAdaptiveAdvice(statusBoard, blankSession(statusBoard), at);
  for (const profile of Object.values(advised.profiles) as any[]) assert.ok(profile.recommendations.every((p: any) => p.player.playerId !== target.playerId));
  assert.ok(advised.warnings.some(w => w.includes("known status observations")));

  const live = blankSession(statusBoard);
  live.phase = "live";
  live.draftStart = "2026-10-28T19:00:00Z";
  live.observedAt = at.toISOString();
  const stale = buildAdaptiveAdvice(statusBoard, live, new Date(at.getTime() + 21_000));
  assert.equal(stale.status, "stale-state");
  assert.equal(stale.profiles.balanced.recommendations.length, 0);
  assert.ok(stale.warnings.some(w => w.includes("20-second live advice threshold")));
});

test("unforecasted own selection keeps eligibility visible and is omitted from invented category totals", () => {
  const board = fixture();
  const session = sessionWithOwnPicks(board, ["unmodeled"]);
  const advice = buildAdaptiveAdvice(board, session, at);
  assert.ok(advice.ownRoster.players.some((p: { playerId: string; forecasted: boolean }) => p.playerId === "unmodeled" && !p.forecasted));
  assert.ok(advice.ownRoster.evaluation.unforecastedActivePlayers > 0);
  assert.ok(advice.warnings.some(w => w.includes("no forecast")));
  assert.deepEqual(Object.keys(advice.ownRoster.evaluation.categoryZ), [...CATEGORIES]);
  assert.equal("TO" in advice.ownRoster.evaluation.categoryZ, false);
});

test("identical board and session produce byte-stable advisory data with source ages", () => {
  const board = fixture();
  const session = blankSession(board);
  const first = buildAdaptiveAdvice(board, session, at, { selectedProfile: "bigs", limit: 6 });
  const second = buildAdaptiveAdvice(board, session, at, { selectedProfile: "bigs", limit: 6 });
  assert.deepEqual(second, first);
  assert.equal(first.selectedProfile, "bigs");
  assert.equal(first.inputAgesHours.board, 0);
  assert.equal(first.inputAgesHours.pool, 1);
  assert.equal(first.trends.sourceAgeHours.state, 0);
  const highTurnoverBoard = fixture(undefined, 999);
  const highTurnovers = buildAdaptiveAdvice(highTurnoverBoard, blankSession(highTurnoverBoard), at, { selectedProfile: "bigs", limit: 6 });
  assert.deepEqual(highTurnovers, first);
});
