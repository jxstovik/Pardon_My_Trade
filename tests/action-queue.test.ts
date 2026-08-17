import assert from "node:assert/strict";
import test from "node:test";
import { ActionQueue, InMemoryActionQueueStore, classifyRisk, isTerminal } from "../src/agents/action-queue.js";
import type { AgentAction } from "../src/agents/types.js";

const setRoster: AgentAction = { type: "set_roster", teamId: "1", starters: [] };
const trade: AgentAction = { type: "propose_trade", fromTeamId: "1", toTeamId: "2", givePlayerIds: ["a"], receivePlayerIds: ["b"] };

test("classifyRisk marks set_roster low and trades high", () => {
  assert.equal(classifyRisk(setRoster), "low");
  assert.equal(classifyRisk(trade), "high");
});

test("enqueue then approve transitions status", async () => {
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const queued = await queue.enqueue(trade, "high", "test");
  assert.equal(queued.status, "pending");
  const approved = await queue.approve(queued.actionId);
  assert.equal(approved.status, "approved");
  assert.ok(approved.resolvedAt);
});

test("cannot modify a resolved action", async () => {
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const queued = await queue.enqueue(trade, "high", "test");
  await queue.reject(queued.actionId);
  await assert.rejects(() => queue.approve(queued.actionId));
});

test("expireOverdue cancels stale pending actions", async () => {
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const queued = await queue.enqueue(trade, "high", "test", -1000);
  const expired = await queue.expireOverdue();
  assert.equal(expired, 1);
  const reloaded = await queue.get(queued.actionId);
  assert.equal(reloaded?.status, "expired");
});

test("isTerminal reflects pending", () => {
  assert.equal(isTerminal("pending"), false);
  assert.equal(isTerminal("approved"), false);
  assert.equal(isTerminal("executed"), true);
});

test("execute requires human approval and records a typed provider response", async () => {
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const queued = await queue.enqueue(trade, "high", "test");
  let calls = 0;
  const provider = async (action: typeof trade, context: { readonly actionId: string; readonly idempotencyKey: string }) => {
    calls += 1;
    assert.equal(action, trade);
    assert.equal(context.actionId, queued.actionId);
    return { providerActionId: "provider-1" };
  };

  await assert.rejects(() => queue.execute(queued.actionId, provider), /must be approved/);
  await queue.approve(queued.actionId);
  const executed = await queue.execute(queued.actionId, provider);
  assert.equal(executed.status, "executed");
  assert.deepEqual(executed.execution?.providerResponse, { providerActionId: "provider-1" });
  assert.equal(executed.execution?.attempts, 1);
  assert.equal(calls, 1);
});

test("successful execution is idempotent and provider errors are recorded", async () => {
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const queued = await queue.enqueue(trade, "high", "test");
  await queue.approve(queued.actionId);
  let calls = 0;
  const provider = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("provider rejected"), { code: "RATE_LIMIT" });
    return "ok";
  };

  await assert.rejects(() => queue.execute(queued.actionId, provider), /provider rejected/);
  const failed = await queue.get(queued.actionId);
  assert.equal(failed?.status, "approved");
  assert.deepEqual(failed?.execution?.error, { name: "Error", message: "provider rejected", code: "RATE_LIMIT" });
  const executed = await queue.execute(queued.actionId, provider);
  const replay = await queue.execute(queued.actionId, provider);
  assert.equal(executed.execution?.attempts, 2);
  assert.equal(replay.execution?.attempts, 2);
  assert.equal(calls, 2);
});
