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
  assert.equal(isTerminal("approved"), true);
});
