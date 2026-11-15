import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionCapacity, injuryScenario } from "../src/agents/transaction-protocol.js";
import { ActionQueue, InMemoryActionQueueStore } from "../src/agents/action-queue.js";
import type { ActionReceipt } from "../src/agents/action-executor.js";

test("five-cap counts completed pairs and deduplicates submitted claims versus pending moves", async () => {
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const options = { preconditions: { leagueExternalId: "lg", scoringPeriod: "2026-W9" } };
  const add = await queue.enqueue({ type: "add_drop", teamId: "7", addPlayerIds: ["1"], dropPlayerIds: ["2"] }, "high", "test", options);
  const claim = await queue.enqueue({ type: "waiver_claim", teamId: "7", addPlayerId: "3" }, "high", "test", options);
  const receipts = [add, claim].map(q => ({ actionId: q.actionId, status: "executed" }) as ActionReceipt);
  const scope = { leagueId: "lg", teamId: "7", period: "2026-W9" };
  assert.deepEqual(acquisitionCapacity(await queue.list(), receipts, ["3", "4"], scope), { used: 3, remaining: 2, limit: 5 });
  assert.equal(acquisitionCapacity([{ ...add, preconditions: { ...add.preconditions, scoringPeriod: "2026-W09" } }], receipts, [], scope).used, 1);
  assert.equal(acquisitionCapacity(await queue.list(), receipts, ["3", "4", "5", "6", "7"], scope).remaining, 0);
  assert.throws(() => acquisitionCapacity([add], [{ actionId: add.actionId, status: "unknown" } as ActionReceipt], [], scope), /Unresolved/);
});

test("uncertain injury does not zero an owned player's healthy-return value", () => {
  const p = { playerId: "1", position: "RB" as const, weeks: [9, 10, 11].map(week => ({ week, mean: 12, quantiles: { "5": 1, "95": 20 } })) };
  assert.deepEqual(injuryScenario(p, undefined, true, 9).weeks.map(w => w.mean), [12, 12, 12]);
  assert.deepEqual(injuryScenario(p, undefined, false, 9).weeks.map(w => w.mean), [0, 0, 0]);
  const now = new Date("2026-11-05T12:00:00Z");
  const evidence = { playerId: "1", sourceUrl: "https://example.com/report", publishedAt: now.toISOString(), quote: "Could return in Week 10 or 11", earliestReturnWeek: 10, latestReturnWeek: 11 };
  assert.deepEqual(injuryScenario(p, evidence, true, 9, now).weeks.map(w => w.mean), [0, 12, 12]);
  assert.deepEqual(injuryScenario(p, evidence, false, 9, now).weeks.map(w => w.mean), [0, 0, 12]);
  assert.throws(() => injuryScenario(p, { ...evidence, latestReturnWeek: 9 }, true, 9, now), /window/);
});
