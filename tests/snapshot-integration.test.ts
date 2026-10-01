import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LeagueSnapshot } from "../src/models/types.js";
import {
  buildPriorsFromSnapshot,
  buildOrchestratorInputFromSnapshot,
  mergeProjectionCandidates,
  primaryModelPosition,
  toWeeklyProjectionPoints
} from "../src/agents/snapshot-integration.js";
import { buildModelsForOrchestrator } from "../src/agents/ff-orchestrator.js";

async function loadFixture(): Promise<LeagueSnapshot> {
  const raw = await readFile(resolve("tests/fixtures/sample-football-league.json"), "utf8");
  return JSON.parse(raw) as LeagueSnapshot;
}

test("primaryModelPosition picks the first model-eligible position", () => {
  assert.equal(primaryModelPosition(["RB", "FLEX"]), "RB");
  assert.equal(primaryModelPosition(["SUPER_FLEX"]), undefined);
  assert.equal(primaryModelPosition(["FLEX"]), "FLEX");
});

test("buildPriorsFromSnapshot uses projections then baselines", async () => {
  const snapshot = await loadFixture();
  const priors = buildPriorsFromSnapshot(snapshot);
  const byId = new Map(priors.map((p) => [p.playerId, p]));
  assert.ok(Math.abs(byId.get("player-qb-001")!.historyMean - 20.1) < 1e-9, "projected qb");
  assert.ok(Math.abs(byId.get("fa-rb-001")!.historyMean - 14.1) < 1e-9, "projected fa");
  assert.equal(byId.get("player-wr-002")!.historyMean, 10, "baseline WR");
});

test("rest-of-season projections are rescaled to weekly, weekly sources pass through", async () => {
  const snapshot = await loadFixture();
  const rosProjections = [
    { player_id: "player-qb-001", source: "fantasypros-qb-ros", scoring_period: "2026-W02", projected_points: 381.9 },
    { player_id: "fa-rb-001", source: "fantasypros-rb-ros", scoring_period: "2026-W02", projected_points: 238 }
  ];
  const withRos = {
    ...snapshot,
    projections: [...snapshot.projections, ...rosProjections]
  } as LeagueSnapshot;

  const priors = buildPriorsFromSnapshot(withRos, { weeksRemaining: 17 });
  const byId = new Map(priors.map((p) => [p.playerId, p]));
  assert.ok(
    Math.abs(byId.get("player-qb-001")!.historyMean - 381.9 / 17) < 1e-9,
    "season total divided by weeks remaining"
  );
  assert.ok(
    Math.abs(byId.get("fa-rb-001")!.historyMean - 238 / 17) < 1e-9,
    "ros source divided by weeks remaining"
  );

  // Weekly-scale sources (espn, fixture, razzball-PPG) must never be divided.
  assert.equal(toWeeklyProjectionPoints(21.4, "espn", 17), 21.4);
  assert.equal(toWeeklyProjectionPoints(14.1, "fixture", 17), 14.1);
  assert.equal(toWeeklyProjectionPoints(17.5, "razzball-qb", 17), 17.5, "razzball emits PPG weekly");
  assert.equal(toWeeklyProjectionPoints(381.9, "fantasypros-qb-ros", 17), 381.9 / 17);
  assert.equal(toWeeklyProjectionPoints(381.9, "razzball-qb"), 381.9, "unknown scale passes through");
});

test("buildOrchestratorInputFromSnapshot maps roster, counts, free agents, opponents", async () => {
  const snapshot = await loadFixture();
  const priors = buildPriorsFromSnapshot(snapshot);
  const models = buildModelsForOrchestrator(priors, []);
  const input = buildOrchestratorInputFromSnapshot(snapshot, "team-001", models);

  assert.equal(input.teamId, "team-001");
  assert.equal(input.rosterSlots.length, 15, "9 starters + 6 bench; IR players are unavailable to start");
  assert.equal(input.starterCounts.length, 7);
  assert.ok(input.starterCounts.some((c) => c.slot === "RB" && c.count === 2));

  const fa = input.freeAgents.find((f) => f.playerId === "fa-rb-001");
  assert.ok(fa, "free agent present");
  assert.ok(Math.abs(fa!.projectedPoints - 14.1) < 1e-9, "free agent projected from model");

  assert.ok(input.opponents, "opponents derived");
  assert.equal(input.opponents!.length, 3, "other three teams");
  assert.throws(() => buildOrchestratorInputFromSnapshot(snapshot, "missing-team", models), /not present in snapshot/i);
});

test("mergeProjectionCandidates prefers the native ID and skips already projected players", async () => {
  const loaded = await loadFixture();
  const snapshot = {
    ...loaded,
    free_agents: loaded.free_agents.map((player) => player.player_id === "fa-wr-001"
      ? { ...player, external_ids: { ...player.external_ids, espn: "999" } }
      : player)
  };
  const before = snapshot.projections.length;
  const merged = mergeProjectionCandidates(snapshot, [
    { player_id: "999", scoring_period: "2026-W02", observed_at: "2026-09-10T12:00:00.000Z", name: "Renamed Source Name", team: "GB", positions: ["WR"], projected_stats: {}, projected_points: 12.5, floor: 6, ceiling: 18, confidence: 0.5 },
    { name: "Caleb Meridian", team: "CHI", positions: ["QB"], projected_stats: {}, projected_points: 99, floor: 1, ceiling: 1, confidence: 0.5 }
  ]);
  assert.equal(merged.projections.length, before + 1, "only the unprojected player added");
  const matched = merged.projections.find((p) => p.player_id === "fa-wr-001");
  assert.ok(matched);
  assert.equal(matched!.projected_points, 12.5);
  assert.equal(matched!.scoring_period, "2026-W02");
  assert.equal(matched!.created_at, "2026-09-10T12:00:00.000Z");
  // original snapshot untouched (immutability)
  assert.equal(snapshot.projections.length, before);
});

test("projection name fallback ignores ambiguous names", async () => {
  const loaded = await loadFixture();
  const duplicate = { ...loaded.free_agents[0]!, player_id: "ambiguous-copy" };
  const snapshot = { ...loaded, free_agents: [...loaded.free_agents, duplicate] };
  const before = snapshot.projections.length;
  const merged = mergeProjectionCandidates(snapshot, [{
    name: loaded.free_agents[0]!.full_name, team: "", positions: ["RB"], projected_stats: {},
    projected_points: 11, floor: 5, ceiling: 17, confidence: 0.5
  }]);
  assert.equal(merged.projections.length, before);
});
