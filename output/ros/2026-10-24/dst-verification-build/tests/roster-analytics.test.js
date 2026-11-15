import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildRosterAnalytics, simulateFreeAgentScenario } from "../src/application/roster-analytics.js";
import { optimizeLineup } from "../src/agents/skills/lineup-optimizer.js";
import { createModel } from "../src/probabilistic/bayesian-model.js";
async function completeProjectionSnapshot() {
    const raw = await readFile(resolve("tests/fixtures/sample-football-league.json"), "utf8");
    const snapshot = JSON.parse(raw);
    const allPlayers = [...snapshot.players, ...snapshot.free_agents];
    const projections = allPlayers.map((player) => ({
        schema_version: "1.0.0",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
        source_system: "test",
        source_record_id: `test-${player.player_id}`,
        projection_id: `test-${player.player_id}-2026-W01`,
        player_id: player.player_id,
        source: "test-weekly",
        scoring_period: "2026-W01",
        projected_stats: {},
        projected_points: player.player_id === "fa-rb-001" ? 40 : 10,
        floor: player.player_id === "fa-rb-001" ? 25 : 0,
        ceiling: player.player_id === "fa-rb-001" ? 55 : 20,
        confidence: 0.9
    }));
    return { ...snapshot, projections };
}
test("roster analytics returns repeatable distributions and coverage histograms", async () => {
    const snapshot = await completeProjectionSnapshot();
    const dir = await mkdtemp(join(tmpdir(), "pmt-roster-analytics-"));
    try {
        const first = await buildRosterAnalytics(snapshot, "team-001", { period: "2026-W01", samples: 80, seed: 42, dataDir: dir });
        const second = await buildRosterAnalytics(snapshot, "team-001", { period: "2026-W01", samples: 80, seed: 42, dataDir: dir });
        assert.equal(first.metadata.snapshotId, snapshot.snapshot_id);
        assert.equal(first.lineups.optimized.distribution.samples, 80);
        assert.deepEqual(first.lineups.optimized.distribution, second.lineups.optimized.distribution);
        assert.equal(first.lineups.optimized.distribution.histogram.reduce((sum, bucket) => sum + bucket.count, 0), 80);
        assert.equal(first.freeAgents.coverage.uncovered, 0);
        assert.equal(first.roster.current?.samples, 80);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("scenario compares an add/drop on paired seeded outcomes", async () => {
    const snapshot = await completeProjectionSnapshot();
    const dir = await mkdtemp(join(tmpdir(), "pmt-roster-scenario-"));
    try {
        const result = await simulateFreeAgentScenario(snapshot, "team-001", {
            addPlayerId: "fa-rb-001",
            dropPlayerId: "player-rb-004",
            period: "2026-W01",
            samples: 100,
            seed: 11,
            dataDir: dir
        });
        assert.equal(result.delta.distribution.samples, 100);
        assert.ok(result.delta.mean > 0);
        assert.equal(result.delta.distribution.histogram.reduce((sum, bucket) => sum + bucket.count, 0), 100);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("analytics rejects an uncovered required starter instead of imputing zero", async () => {
    const raw = await readFile(resolve("tests/fixtures/sample-football-league.json"), "utf8");
    const snapshot = JSON.parse(raw);
    const firstStarter = snapshot.league.teams[0].roster.starters[0].player_id;
    const missing = { ...snapshot, projections: snapshot.projections.filter((projection) => projection.player_id !== firstStarter) };
    const dir = await mkdtemp(join(tmpdir(), "pmt-roster-uncovered-"));
    try {
        await assert.rejects(() => buildRosterAnalytics(missing, "team-001", { period: "2026-W01", samples: 10, dataDir: dir }), /required starter .* uncovered .*2026-W01/i);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("optimizer assigns multi-eligible players legally and preserves locked slots", () => {
    const makeModel = (playerId, position, mean) => createModel({
        playerId, playerName: playerId, position, historyMean: mean, historyVar: 1
    });
    const models = new Map([
        ["flex", makeModel("flex", "WR", 40)],
        ["qb", makeModel("qb", "QB", 30)],
        ["wr", makeModel("wr", "WR", 12)]
    ]);
    const players = [
        { playerId: "flex", slot: "WR", eligiblePositions: ["QB", "WR"] },
        { playerId: "qb", slot: "QB", eligiblePositions: ["QB"] },
        { playerId: "wr", slot: "WR", eligiblePositions: ["WR"] }
    ];
    const optimal = optimizeLineup(players, [{ slot: "QB", count: 1 }, { slot: "WR", count: 1 }], models);
    assert.deepEqual(new Map(optimal.starters.map((starter) => [starter.slot, starter.playerId])), new Map([["QB", "qb"], ["WR", "flex"]]));
    const locked = optimizeLineup([
        { playerId: "locked", slot: "WR", currentSlot: "WR", locked: true, eligiblePositions: ["WR"] },
        { playerId: "bench", slot: "WR", currentSlot: "BN", locked: true, eligiblePositions: ["WR"] }
    ], [{ slot: "WR", count: 1 }], new Map([
        ["locked", makeModel("locked", "WR", 1)],
        ["bench", makeModel("bench", "WR", 100)]
    ]));
    assert.deepEqual(locked.starters.map((starter) => starter.playerId), ["locked"]);
});
test("runtime resolver treats padded weekly targets as equivalent and ignores future model state", async () => {
    const { resolveRuntimeModels } = await import("../src/application/roster-analytics.js");
    const { writeFile } = await import("node:fs/promises");
    const snapshot = await completeProjectionSnapshot();
    const starterId = snapshot.league.teams[0].roster.starters[0].player_id;
    const starter = snapshot.players.find(player => player.player_id === starterId);
    const dir = await mkdtemp(join(tmpdir(), "pmt-causal-state-"));
    try {
        const baseline = await resolveRuntimeModels(snapshot, dir, "2026-W1");
        assert.ok(baseline.has(starterId), "W01 projections cover W1 targets");
        const model = baseline.get(starterId);
        await writeFile(join(dir, "models.json"), JSON.stringify({ models: [{ ...model, weeksObserved: 3, sigma: 50, lastUpdatedScoringPeriod: "2026-W2" }] }));
        const resolved = await resolveRuntimeModels(snapshot, dir, "2026-W01");
        assert.equal(resolved.get(starterId)?.weeksObserved, 0);
        assert.ok(resolved.get(starterId).sigma < 50);
        assert.equal(resolved.get(starterId)?.position, starter.positions[0]);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
