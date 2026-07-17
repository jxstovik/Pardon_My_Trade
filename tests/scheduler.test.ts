import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryScheduler } from "../src/scheduler/scheduler.js";

test("scheduler registers, lists, and cancels jobs", () => {
  const scheduler = new InMemoryScheduler();
  scheduler.register({ jobId: "j1", name: "morning", time: "07:00", handler: async () => {} });
  scheduler.register({ jobId: "j2", name: "evening", time: "19:00", handler: async () => {} });
  assert.equal(scheduler.listJobs().length, 2);
  scheduler.cancel("j1");
  assert.equal(scheduler.listJobs().length, 1);
  scheduler.stop();
});

test("scheduler runDue fires only jobs matching the clock time", async () => {
  const fired: string[] = [];
  const scheduler = new InMemoryScheduler();
  scheduler.register({ jobId: "j1", name: "morning", time: "07:00", handler: () => { fired.push("j1"); } });
  scheduler.register({ jobId: "j2", name: "evening", time: "19:00", handler: () => { fired.push("j2"); } });

  const morning = new Date(2026, 0, 1, 7, 0, 0);
  const firedIds = await scheduler.runDue(morning);
  assert.deepEqual(firedIds, ["j1"]);
  assert.deepEqual(fired, ["j1"]);
  scheduler.stop();
});

test("scheduler isolates job failures", async () => {
  let goodRan = false;
  const scheduler = new InMemoryScheduler();
  scheduler.register({ jobId: "bad", name: "bad", time: "07:00", handler: () => { throw new Error("boom"); } });
  scheduler.register({ jobId: "good", name: "good", time: "07:00", handler: () => { goodRan = true; } });

  const fired = await scheduler.runDue(new Date(2026, 0, 1, 7, 0, 0));
  assert.ok(goodRan);
  assert.deepEqual(fired.sort(), ["bad", "good"]);
  scheduler.stop();
});
