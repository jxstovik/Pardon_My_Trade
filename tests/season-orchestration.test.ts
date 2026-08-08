import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteKnowledgeRepository } from "../src/knowledge/sqlite-knowledge-repository.js";
import { ActionQueue, InMemoryActionQueueStore } from "../src/agents/action-queue.js";
import { runSeasonOrchestration } from "../src/seasons/season-orchestration.js";
import { makePlayer, makeSnapshot } from "./test-builders.js";

test("runSeasonOrchestration reads the last snapshot and queues without executing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-orch-"));
  try {
    const repository = new SqliteKnowledgeRepository({ memory: true });
    const snapshot = makeSnapshot(
      [makePlayer({ full_name: "Christian McCaffrey", player_id: "p1", positions: ["RB"] })],
      { snapshotId: "snap-orch", season: "2026" }
    );
    await repository.saveLeagueSnapshot(snapshot);
    await writeFile(join(dir, "last-snapshot.json"), JSON.stringify({ snapshot_id: "snap-orch", league_id: "lg-1" }), "utf8");

    const store = new InMemoryActionQueueStore();
    const summary = await runSeasonOrchestration({
      repository,
      dataDir: dir,
      queue: new ActionQueue(store)
    });

    assert.equal(summary.teamId, "team-001");
    assert.equal(summary.leagueId, "lg-1");
    assert.ok(summary.starters.some((s) => s.playerId === "p1"));
    assert.ok(summary.lineupExpectedPoints > 0);
    // Every routed action waits for `pmt action-approve`.
    const queued = await store.list();
    assert.ok(queued.length >= 1);
    assert.ok(queued.every((action) => action.status === "pending"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSeasonOrchestration explains how to import when no snapshot exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-orch-"));
  try {
    const repository = new SqliteKnowledgeRepository({ memory: true });
    await assert.rejects(() => runSeasonOrchestration({ repository, dataDir: dir }), /import-espn/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
