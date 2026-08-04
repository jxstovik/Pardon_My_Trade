import assert from "node:assert/strict";
import test from "node:test";
import { SqliteKnowledgeRepository } from "../src/knowledge/sqlite-knowledge-repository.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";
import { makePlayer, makeProjection, makeSnapshot } from "./test-builders.js";

test("sqlite: upsertProjections persists and getProjections filters by period", async () => {
  const repo = new SqliteKnowledgeRepository({ memory: true });
  const snap = makeSnapshot([makePlayer({ full_name: "Christian McCaffrey", player_id: "p1", positions: ["RB"] })], { snapshotId: "snap-1" });
  await repo.saveLeagueSnapshot(snap);

  const ros = makeProjection({ player_id: "p1", source: "razzball-rb", scoring_period: "2026-ROS", projected_points: 280, floor: 240, ceiling: 320 });
  const wk = makeProjection({ player_id: "p1", source: "razzball-rb", scoring_period: "2026-W01", projected_points: 18 });
  await repo.upsertProjections([ros, wk]);

  const rosGot = await repo.getProjections("2026-ROS");
  assert.equal(rosGot.length, 1);
  assert.equal(rosGot[0].projected_points, 280);

  const wkGot = await repo.getProjections("2026-W01");
  assert.equal(wkGot.length, 1);
});

test("sqlite: getLeagueSnapshot attaches stored projections for the season", async () => {
  const repo = new SqliteKnowledgeRepository({ memory: true });
  const snap = makeSnapshot([makePlayer({ full_name: "Christian McCaffrey", player_id: "p1", positions: ["RB"] })], { snapshotId: "snap-2", season: "2026" });
  await repo.saveLeagueSnapshot(snap);
  assert.equal(snap.projections.length, 0);

  await repo.upsertProjections([
    makeProjection({ player_id: "p1", source: "razzball-rb", scoring_period: "2026-ROS", projected_points: 280 }),
    makeProjection({ player_id: "p1", source: "fftoday-rb", scoring_period: "2026-ROS", projected_points: 275 })
  ]);

  const loaded = await repo.getLeagueSnapshot("snap-2");
  assert.ok(loaded);
  // Both sources attached; embedded (empty) projections replaced/augmented.
  const sources = loaded.projections.map((p) => p.source).sort();
  assert.deepEqual(sources, ["fftoday-rb", "razzball-rb"]);
});

test("sqlite: upsertProjections overwrites prior row for same id", async () => {
  const repo = new SqliteKnowledgeRepository({ memory: true });
  const snap = makeSnapshot([makePlayer({ full_name: "A", player_id: "p1" })], { snapshotId: "snap-3" });
  await repo.saveLeagueSnapshot(snap);
  await repo.upsertProjections([makeProjection({ player_id: "p1", source: "espn", scoring_period: "2026-ROS", projected_points: 100 })]);
  await repo.upsertProjections([makeProjection({ player_id: "p1", source: "espn", scoring_period: "2026-ROS", projected_points: 150 })]);
  const got = await repo.getProjections("2026-ROS");
  assert.equal(got.length, 1);
  assert.equal(got[0].projected_points, 150);
});

test("in-memory: upsert + attach mirrors sqlite behaviour", async () => {
  const repo = new InMemoryKnowledgeRepository();
  const snap = makeSnapshot([makePlayer({ full_name: "A", player_id: "p1", positions: ["RB"] })], { snapshotId: "snap-im", season: "2026" });
  await repo.saveLeagueSnapshot(snap);

  await repo.upsertProjections([
    makeProjection({ player_id: "p1", source: "razzball-rb", scoring_period: "2026-ROS", projected_points: 280 }),
    makeProjection({ player_id: "p1", source: "fftoday-rb", scoring_period: "2026-ROS", projected_points: 275 })
  ]);

  const loaded = await repo.getLeagueSnapshot("snap-im");
  assert.ok(loaded);
  const sources = loaded.projections.map((p) => p.source).sort();
  assert.deepEqual(sources, ["fftoday-rb", "razzball-rb"]);
  assert.equal((await repo.getProjections("2026-ROS")).length, 2);
});

test("in-memory: immutable snapshot still rejects duplicate save", async () => {
  const repo = new InMemoryKnowledgeRepository();
  const snap = makeSnapshot([makePlayer({ full_name: "A", player_id: "p1" })], { snapshotId: "snap-dup" });
  await repo.saveLeagueSnapshot(snap);
  await assert.rejects(() => repo.saveLeagueSnapshot(snap), /immutable/i);
});
