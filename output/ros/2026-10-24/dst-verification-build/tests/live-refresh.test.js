import test from "node:test";
import assert from "node:assert/strict";
import { readConfiguredSnapshot } from "../src/application/live-refresh.js";
import { runRefresh } from "../src/pipeline/refresh.js";
import { loadRuntimeConfig } from "../src/config/runtime-config.js";
import { loadFixtureSnapshotSource } from "../src/knowledge/ingestion.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";
import { InMemoryV1Store } from "../src/history/v1-store.js";
import { ScoringRuleEngine } from "../src/rules/rule-engine.js";
import { DefaultDecisionEngine } from "../src/decisions/decision-engine.js";
import { DefaultRecommendationEngine } from "../src/recommendations/recommendation-engine.js";
test("configured fixture refresh validates identity and generates immutable unique ids", async () => {
    const config = loadRuntimeConfig({ platform: "fixture", leagueExternalId: "pmt-demo-football", teamExternalId: "team-001" });
    const first = await readConfiguredSnapshot(config);
    const second = await readConfiguredSnapshot(config);
    assert.notEqual(first.snapshot_id, second.snapshot_id);
    await assert.rejects(readConfiguredSnapshot({ ...config, leagueExternalId: "wrong-league" }), /differs/);
    await assert.rejects(readConfiguredSnapshot({ ...config, teamExternalId: "wrong-team" }), /Configured team/);
});
test("failed wrong-team refresh never advances valid last snapshot", async () => {
    const repository = new InMemoryKnowledgeRepository();
    const previous = await loadFixtureSnapshotSource("tests/fixtures/sample-football-league.json");
    await repository.saveLeagueSnapshot(previous);
    const ruleEngine = new ScoringRuleEngine();
    await assert.rejects(runRefresh({ fixturePath: "unused", snapshotSource: async () => previous,
        leagueExternalId: previous.league.external_id, teamExternalId: "wrong-team", repository,
        v1Store: new InMemoryV1Store(), ruleEngine, decisionEngine: new DefaultDecisionEngine(ruleEngine),
        recommendationEngine: new DefaultRecommendationEngine(ruleEngine) }), /Team/);
    assert.equal((await repository.getLatestLeagueSnapshot())?.snapshot_id, previous.snapshot_id);
});
