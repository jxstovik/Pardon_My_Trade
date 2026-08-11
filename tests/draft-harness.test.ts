import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultConfig } from "../src/config/app-config.js";
import { loadFixtureSnapshotSource } from "../src/knowledge/ingestion.js";
import {
  applyPick,
  createDraftState,
  picksUntilMyNext,
  rosterNeeds,
  seatForPick,
  totalRounds
} from "../src/draft/state.js";
import { DraftController } from "../src/draft/draft-controller.js";
import { buildValuationModels, rankBestAvailable, survivalProbability } from "../src/draft/valuation/valuation.js";
import type { ModelPosition } from "../src/probabilistic/bayesian-model.js";

test("snake draft seat mapping alternates each round", () => {
  assert.equal(seatForPick(1, 12), 1);
  assert.equal(seatForPick(12, 12), 12);
  assert.equal(seatForPick(13, 12), 12);
  assert.equal(seatForPick(24, 12), 1);
});

test("picksUntilMyNext counts to the seat on the clock", () => {
  const state = createDraftState({ format: "snake", teams: 4, myTeamId: "team-001", draftPosition: 3 });
  assert.equal(picksUntilMyNext(state), 3);
  const withPick = applyPick(state, {
    pickNo: 1,
    round: 1,
    roundPick: 1,
    teamId: "team-001",
    playerExternalId: "p1",
    source: "manual",
    timestamp: 0
  });
  assert.equal(picksUntilMyNext(withPick), 2);
});

test("rosterNeeds reflects slot counts from the fixture league", async () => {
  const snapshot = await loadFixtureSnapshotSource(createDefaultConfig().fixturePath);
  const state = createDraftState({ format: "snake", teams: 4, myTeamId: "team-001", draftPosition: 1 });
  const needs = rosterNeeds(state, snapshot);
  const qb = needs.find((n) => n.slot === "QB");
  assert.ok(qb);
  assert.equal(qb.required, 1);
  assert.equal(totalRounds(snapshot.league.roster_settings), 1 + 2 + 2 + 1 + 1 + 1 + 1 + 6 + 1);
});

test("valuation ranks available players with expected points and upside", async () => {
  const snapshot = await loadFixtureSnapshotSource(createDefaultConfig().fixturePath);
  const models = buildValuationModels(snapshot, { useProjections: true });
  assert.ok(models.size > 0);
  const ranked = rankBestAvailable(models.values(), [], 5);
  assert.equal(ranked.length, 5);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].value >= ranked[i].value);
  }
  const top = ranked[0];
  assert.ok(Number.isFinite(top.expectedPoints));
  assert.ok(top.probabilities[8] >= 0 && top.probabilities[8] <= 1);
});

test("survival decreases as more picks occur before my turn", () => {
  const model = {
    playerId: "x",
    playerName: "X",
    position: "RB" as ModelPosition,
    expectedPoints: 15,
    value: 15,
    probabilities: { 8: 0.8, 12: 0.5, 18: 0.2 },
    tier: 1,
    survival: 1
  };
  const near = survivalProbability(model, 1);
  const far = survivalProbability(model, 10);
  assert.ok(near >= far);
  assert.ok(far >= 0 && far <= 1);
});

test("DraftController records a manual pick and updates the board", async () => {
  const snapshot = await loadFixtureSnapshotSource(createDefaultConfig().fixturePath);
  const controller = new DraftController({
    snapshot,
    config: { format: "snake", teams: 4, myTeamId: "team-001", draftPosition: 1 },
    dataDir: undefined
  });
  await controller.init();
  const updated = controller.recordManualPick({
    round: 1,
    roundPick: 1,
    teamId: "team-001",
    playerExternalId: "player-qb-001"
  });
  assert.equal(updated.board.length, 1);
  assert.equal(updated.board[0].playerExternalId, "player-qb-001");
  assert.equal(updated.nextPick, 2);
  const advice = controller.advice();
  assert.equal(advice.recommendation.type, "draft_pick");
});
