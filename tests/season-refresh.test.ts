import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteKnowledgeRepository } from "../src/knowledge/sqlite-knowledge-repository.js";
import { runSeasonRefresh } from "../src/season-refresh.js";
import { makePlayer, makeSnapshot } from "./test-builders.js";

function fakeFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

test("runSeasonRefresh pulls espn, persists matched projections, rebuilds models", async () => {
  const fixture = JSON.parse(await readFile("tests/fixtures/espn-projections.json", "utf8"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch(fixture) as typeof fetch;
  const dir = await mkdtemp(join(tmpdir(), "pmt-season-"));
  try {
    const repository = new SqliteKnowledgeRepository({ memory: true });
    const snapshot = makeSnapshot(
      [makePlayer({ full_name: "Christian McCaffrey", player_id: "p1", positions: ["RB"] })],
      { snapshotId: "snap-sr", season: "2026" }
    );
    await repository.saveLeagueSnapshot(snapshot);
    await writeFile(join(dir, "last-snapshot.json"), JSON.stringify({ snapshot_id: "snap-sr", league_id: "lg-1" }), "utf8");

    const summary = await runSeasonRefresh({ repository, dataDir: dir, sources: "espn" });

    assert.equal(summary.season, "2026");
    assert.equal(summary.scoringPeriod, "2026-ROS");
    // Only Christian McCaffrey is in the imported roster, so 1 of 3 ESPN
    // candidates matches and is persisted.
    assert.equal(summary.sources.espn, 1);
    assert.ok(summary.projectionsStored >= 1, "at least the matched player is stored");
    assert.ok(summary.playersUpdated >= 1);
    assert.ok(summary.modelsRebuilt >= 1);

    // Persisted projections are queryable and attached to the snapshot.
    const stored = await repository.getProjections("2026-ROS");
    assert.ok(stored.some((p) => p.player_id === "p1" && p.source === "espn"));
    const loaded = await repository.getLeagueSnapshot("snap-sr");
    assert.ok(loaded?.projections.some((p) => p.player_id === "p1"));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSeasonRefresh errors clearly when no snapshot is imported", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-season-"));
  try {
    const repository = new SqliteKnowledgeRepository({ memory: true });
    await assert.rejects(() => runSeasonRefresh({ repository, dataDir: dir, sources: "espn" }), /import-espn/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
