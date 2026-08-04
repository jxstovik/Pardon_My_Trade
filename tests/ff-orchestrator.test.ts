import assert from "node:assert/strict";
import test from "node:test";
import { runOrchestrator, buildModelsForOrchestrator } from "../src/agents/ff-orchestrator.js";
import { ActionQueue, InMemoryActionQueueStore } from "../src/agents/action-queue.js";
import type { ModelPrior, Observation } from "../src/probabilistic/bayesian-model.js";
import type { OrchestratorInput } from "../src/agents/types.js";

const priors: ModelPrior[] = [
  { playerId: "101", playerName: "Q", position: "QB", historyMean: 18, historyVar: 4 },
  { playerId: "102", playerName: "RB1", position: "RB", historyMean: 14, historyVar: 4 },
  { playerId: "103", playerName: "RB2", position: "RB", historyMean: 9, historyVar: 4 },
  { playerId: "104", playerName: "WR1", position: "WR", historyMean: 13, historyVar: 4 },
  { playerId: "105", playerName: "WR2", position: "WR", historyMean: 11, historyVar: 4 },
  { playerId: "106", playerName: "TE1", position: "TE", historyMean: 8, historyVar: 4 },
  { playerId: "107", playerName: "Flex", position: "RB", historyMean: 12, historyVar: 4 },
  { playerId: "108", playerName: "K1", position: "K", historyMean: 9, historyVar: 1 },
  { playerId: "109", playerName: "DST1", position: "DST", historyMean: 7, historyVar: 1 },
  { playerId: "110", playerName: "Bench", position: "WR", historyMean: 4, historyVar: 4 },
  { playerId: "201", playerName: "OppRB", position: "RB", historyMean: 20, historyVar: 4 },
  { playerId: "202", playerName: "OppRB2", position: "RB", historyMean: 15, historyVar: 4 },
  { playerId: "301", playerName: "FreeRB", position: "RB", historyMean: 25, historyVar: 4 }
];

const input: OrchestratorInput = {
  teamId: "1",
  rosterSlots: [
    { playerId: "101", slot: "QB" },
    { playerId: "102", slot: "RB" },
    { playerId: "103", slot: "RB" },
    { playerId: "104", slot: "WR" },
    { playerId: "105", slot: "WR" },
    { playerId: "106", slot: "TE" },
    { playerId: "107", slot: "FLEX" },
    { playerId: "108", slot: "K" },
    { playerId: "109", slot: "DST" },
    { playerId: "110", slot: "BN" }
  ],
  starterCounts: [
    { slot: "QB", count: 1 },
    { slot: "RB", count: 2 },
    { slot: "WR", count: 2 },
    { slot: "TE", count: 1 },
    { slot: "FLEX", count: 1 },
    { slot: "K", count: 1 },
    { slot: "DST", count: 1 }
  ],
  freeAgents: [{ playerId: "301", position: "RB", projectedPoints: 25 }],
  opponents: [
    {
      teamId: "2",
      players: [
        { playerId: "201", position: "RB" },
        { playerId: "202", position: "RB" }
      ]
    }
  ]
};

function makeQueue(): ActionQueue {
  return new ActionQueue(new InMemoryActionQueueStore());
}

test("buildModelsForOrchestrator applies observations", () => {
  const observations: Observation[] = [{ playerId: "101", week: 1, points: 30 }];
  const models = buildModelsForOrchestrator(priors, observations);
  assert.ok(models.get("101")!.weeksObserved === 1);
});

test("orchestrator produces optimal lineup", async () => {
  const result = await runOrchestrator({ input, priors, queue: makeQueue() });
  const starterIds = result.lineup.map((s) => s.playerId).sort();
  assert.deepEqual(starterIds, ["101", "102", "103", "104", "105", "106", "107", "108", "109"]);
  assert.ok(!starterIds.includes("110"), "bench player kept on bench");
  assert.ok(result.lineupExpectedPoints > 100);
});

test("orchestrator finds a +EV waiver add/drop", async () => {
  const result = await runOrchestrator({ input, priors, queue: makeQueue() });
  assert.equal(result.waiverCandidates.length, 1);
  assert.deepEqual(result.waiverCandidates[0].addPlayerIds, ["301"]);
  assert.deepEqual(result.waiverCandidates[0].dropPlayerIds, ["110"]);
});

test("orchestrator proposes a +EV trade to a surplus opponent", async () => {
  const result = await runOrchestrator({ input, priors, queue: makeQueue() });
  assert.equal(result.tradeCandidates.length, 1);
  assert.equal(result.tradeCandidates[0].toTeamId, "2");
  assert.deepEqual(result.tradeCandidates[0].receivePlayerIds, ["202"]);
});

test("without auto-approve all actions are queued for humans", async () => {
  const result = await runOrchestrator({ input, priors, queue: makeQueue(), autoApproveLowRisk: false });
  assert.equal(result.queued.length, 3, "set roster + waiver + trade queued");
  assert.equal(result.executed.length, 0);
});

test("with auto-approve low-risk set_roster executes, high-risk stays queued", async () => {
  const result = await runOrchestrator({ input, priors, queue: makeQueue(), autoApproveLowRisk: true });
  assert.equal(result.executed.length, 1);
  assert.equal(result.executed[0].type, "set_roster");
  assert.equal(result.queued.length, 2, "waiver + trade require human approval");
});
