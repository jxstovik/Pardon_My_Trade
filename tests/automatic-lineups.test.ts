import assert from "node:assert/strict";
import test from "node:test";
import { ActionQueue, InMemoryActionQueueStore } from "../src/agents/action-queue.js";
import { executeAutomaticLineup, validateLineupAuthorization, type LineupAuthorization } from "../src/agents/automatic-lineups.js";
import type { AgentAction } from "../src/agents/types.js";

const authorization: LineupAuthorization = { enabled: true, leagueId: "98806880", teamId: "7", season: "2026", authorizedBy: "test-user" };
const lineup: AgentAction = { type: "set_roster", teamId: "7", starters: [{ playerId: "123", slot: "QB" }] };
async function setup(action = lineup) {
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const queued = await queue.enqueue(action, "low", "model lineup", { preconditions: { leagueExternalId: "98806880", scoringPeriod: "2026-W9", expectedRosterHashes: { "7": "fresh-roster" } } });
  return { queue, queued };
}

test("standing lineup permission previews, approves with attributable actor, then executes", async () => {
  const { queue, queued } = await setup();
  const steps: string[] = [];
  const result = await executeAutomaticLineup({ authorization, queue, actionId: queued.actionId,
    preview: async () => { steps.push("preview"); assert.equal((await queue.get(queued.actionId))?.status, "pending"); },
    executor: { execute: async (id, options) => { steps.push("execute"); assert.equal(options.leagueExternalId, authorization.leagueId); assert.equal((await queue.get(id))?.approvedBy, "standing-lineup:test-user"); return { actionId: id, status: "executed" }; } }
  });
  assert.deepEqual(steps, ["preview", "execute"]);
  assert.equal(result.status, "executed");
});

test("standing permission rejects acquisitions and trades even if mislabeled low risk", async () => {
  const actions: AgentAction[] = [
    { type: "add_drop", teamId: "7", addPlayerIds: ["1"], dropPlayerIds: ["2"] },
    { type: "waiver_claim", teamId: "7", addPlayerId: "1" },
    { type: "propose_trade", fromTeamId: "7", toTeamId: "8", givePlayerIds: ["2"], receivePlayerIds: ["1"] }
  ];
  for (const action of actions) {
    const { queue, queued } = await setup(action);
    await assert.rejects(executeAutomaticLineup({ authorization, queue, actionId: queued.actionId, preview: async () => { assert.fail("preview must not run"); }, executor: { execute: async () => { throw new Error("must not execute"); } } }), /set_roster only/);
    assert.equal((await queue.get(queued.actionId))?.status, "pending");
  }
});

test("disabled, cross-scope, stale, unbound and tampered proposals fail closed", async () => {
  const { queued } = await setup();
  for (const policy of [{ ...authorization, enabled: false }, { ...authorization, teamId: "8" }, { ...authorization, leagueId: "other" }, { ...authorization, season: "2025" }]) assert.throws(() => validateLineupAuthorization(policy, queued));
  for (const proposal of [
    { ...queued, expiresAt: "2020-01-01" }, { ...queued, expiresAt: "invalid" },
    { ...queued, payloadHash: "tampered" }, { ...queued, preconditions: { ...queued.preconditions, expectedRosterHashes: {} } },
    { ...queued, status: "unknown" as const }, { ...queued, status: "executed" as const }, { ...queued, risk: "high" as const }
  ]) assert.throws(() => validateLineupAuthorization(authorization, proposal));
});

test("failed fresh preview never approves or executes", async () => {
  const { queue, queued } = await setup();
  await assert.rejects(executeAutomaticLineup({ authorization, queue, actionId: queued.actionId,
    preview: async () => { throw new Error("locked player"); },
    executor: { execute: async () => { throw new Error("must not execute"); } }
  }), /locked player/);
  assert.equal((await queue.get(queued.actionId))?.status, "pending");
});

test("changed queue status during preview prevents submission", async () => {
  const { queue, queued } = await setup();
  await assert.rejects(executeAutomaticLineup({ authorization, queue, actionId: queued.actionId,
    preview: async () => { await queue.reject(queued.actionId); },
    executor: { execute: async () => { throw new Error("must not execute"); } }
  }), /rejected/);
});
