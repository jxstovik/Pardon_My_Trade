import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionQueue, SqliteActionQueueStore } from "../src/agents/action-queue.js";
import { SqliteActionExecutionStore } from "../src/agents/action-executor.js";
import { SqliteJobStore } from "../src/storage/sqlite-job-store.js";
import { loadRuntimeConfig } from "../src/config/runtime-config.js";
import { SqliteKnowledgeRepository } from "../src/knowledge/sqlite-knowledge-repository.js";
import { makeSnapshot } from "./test-builders.js";

test("SQLite receipt reservation lets only one process reserve an action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-receipt-"));
  const filePath = join(dir, "pmt.sqlite");
  const first = new SqliteActionExecutionStore(filePath);
  const second = new SqliteActionExecutionStore(filePath);
  const receipt = {
    receiptId: "rcpt-one", actionId: "act-one", idempotencyKey: "key-one", payloadHash: "hash-one",
    status: "unknown" as const, recordedAt: new Date().toISOString()
  };
  try {
    const results = await Promise.all([first.reserveReceipt(receipt), second.reserveReceipt(receipt)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal((await first.getReceipt("act-one"))?.status, "unknown");
  } finally {
    first.close(); second.close(); await rm(dir, { recursive: true, force: true });
  }
});

test("SQLite queue compare-and-swap prevents a stale pending transition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-queue-"));
  const filePath = join(dir, "pmt.sqlite");
  const first = new SqliteActionQueueStore(filePath);
  const second = new SqliteActionQueueStore(filePath);
  try {
    const queue = new ActionQueue(first);
    const action = { type: "set_roster" as const, teamId: "team-1", starters: [] };
    const queued = await queue.enqueue(action, "low", "test", { preconditions: { leagueExternalId: "league-1", scoringPeriod: "2026-W01" } });
    const duplicate = await new ActionQueue(second).enqueue(action, "low", "same proposal", { preconditions: { leagueExternalId: "league-1", scoringPeriod: "2026-W01" } });
    assert.equal(duplicate.actionId, queued.actionId);
    const updated = { ...queued, status: "approved" as const, approvedBy: "reviewer" };
    assert.equal(await first.compareAndSwap!(queued.actionId, "pending", updated), true);
    assert.equal(await second.compareAndSwap!(queued.actionId, "pending", { ...queued, status: "rejected" }), false);
    assert.equal((await second.get(queued.actionId))?.status, "approved");
  } finally {
    first.close(); second.close(); await rm(dir, { recursive: true, force: true });
  }
});

test("durable job claims are exclusive and expired leases can be recovered", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmt-jobs-"));
  const filePath = join(dir, "pmt.sqlite");
  const first = new SqliteJobStore({ filePath });
  const second = new SqliteJobStore({ filePath });
  try {
    const now = new Date("2026-10-01T12:00:00.000Z");
    const queued = first.enqueue("refresh", { league: "league-1" }, { dedupeKey: "league-1:2026-W01", availableAt: now });
    const claim = first.claimJob(queued.jobId, "worker-a", { leaseMs: 30_000, now });
    assert.equal(claim?.status, "running");
    assert.equal(second.claimJob(queued.jobId, "worker-b", { now }), undefined);
    const recovered = second.claimJob(queued.jobId, "worker-b", { now: new Date(now.getTime() + 30_001) });
    assert.equal(recovered?.leaseOwner, "worker-b");
    assert.equal(recovered?.attempts, 2);
    assert.equal(second.complete(queued.jobId, "worker-b", { snapshotId: "snap-1" }), true);
    assert.deepEqual(second.get(queued.jobId)?.result, { snapshotId: "snap-1" });
  } finally {
    first.close(); second.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime config selects explicit ESPN identity and rejects missing live team", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-runtime-"));
  try {
    const config = loadRuntimeConfig({ PMT_DATA_DIR: dir, ESPN_LEAGUE_ID: " 123 ", PMT_TEAM_ID: " team-8 " });
    assert.equal(config.platform, "espn");
    assert.equal(config.leagueExternalId, "123");
    assert.equal(config.teamExternalId, "team-8");
    assert.equal(config.databasePath, join(dir, "pmt.sqlite"));
    assert.throws(() => loadRuntimeConfig({ PMT_PLATFORM: "espn", PMT_LEAGUE_ID: "league-1", PMT_TEAM_ID: " " }), /team id is required/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("SQLite latest pointer advances transactionally and refuses a second live league", async () => {
  const repository = new SqliteKnowledgeRepository({ memory: true });
  try {
    const fixture = makeSnapshot([], { snapshotId: "fixture", season: "2026" });
    await repository.saveLeagueSnapshot(fixture);
    const live = {
      ...makeSnapshot([], { snapshotId: "live-1", season: "2026" }),
      league: { ...fixture.league, platform: "espn" as const, external_id: "espn-100", league_id: "espn-100" }
    };
    await repository.saveLeagueSnapshot(live);
    assert.equal((await repository.getLatestLeagueSnapshot())?.snapshot_id, "live-1");
    const otherLive = {
      ...live,
      snapshot_id: "live-2",
      league: { ...live.league, external_id: "espn-200", league_id: "espn-200" }
    };
    await assert.rejects(() => repository.saveLeagueSnapshot(otherLive), /already contains live/i);
    await repository.saveLeagueSnapshot({ ...fixture, snapshot_id: "fixture-2" });
    assert.equal((await repository.getLatestLeagueSnapshot())?.snapshot_id, "live-1");
  } finally { repository.close(); }
});
