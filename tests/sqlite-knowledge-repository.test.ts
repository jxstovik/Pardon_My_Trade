import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SqliteKnowledgeRepository } from "../src/knowledge/sqlite-knowledge-repository.js";
import { assertLeagueSnapshot } from "../src/models/validation.js";
import type { DecisionAudit, LeagueSnapshot, Recommendation } from "../src/models/types.js";

async function loadFixture(): Promise<LeagueSnapshot> {
  const raw = await readFile("tests/fixtures/sample-football-league.json", "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertLeagueSnapshot(parsed);
  return parsed;
}

test("sqlite repository stores and retrieves an immutable snapshot", async () => {
  const repo = new SqliteKnowledgeRepository({ memory: true });
  const snapshot = await loadFixture();

  await repo.saveLeagueSnapshot(snapshot);
  const roundTrip = await repo.getLeagueSnapshot(snapshot.snapshot_id);
  assert.ok(roundTrip);
  assert.equal(roundTrip?.league.league_id, snapshot.league.league_id);

  await assert.rejects(
    () => repo.saveLeagueSnapshot(snapshot),
    /already exists and is immutable/
  );
  repo.close();
});

test("sqlite repository persists recommendations and lists by league", async () => {
  const repo = new SqliteKnowledgeRepository({ memory: true });
  const snapshot = await loadFixture();

  const recommendation: Recommendation = {
    schema_version: "1.0.0",
    created_at: "2026-09-08T00:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    source_system: "decision-engine",
    recommendation_id: "rec-1",
    league_id: snapshot.league.league_id,
    team_id: "team-001",
    type: "weekly_report" as const,
    title: "Report",
    recommendation: "Do the thing.",
    reasoning: ["Because."],
    evidence: [],
    confidence: 0.6,
    risk: { level: "low" as const, factors: [] },
    expected_benefit: { metric: "points", value: 1, range: [0, 2] },
    assumptions: ["A"],
    alternatives: ["B"],
    generated_at: "2026-09-08T00:00:00Z",
    expiration: "2026-09-15T00:00:00Z",
    status: "ready" as const
  };

  await repo.saveRecommendation(recommendation);
  const fetched = await repo.getRecommendation("rec-1");
  assert.ok(fetched);
  assert.equal(fetched?.type, "weekly_report");

  const listed = await repo.listRecommendations(snapshot.league.league_id);
  assert.equal(listed.length, 1);
  repo.close();
});

test("sqlite repository stores decision audits", async () => {
  const repo = new SqliteKnowledgeRepository({ memory: true });
  const audit: DecisionAudit = {
    schema_version: "1.0.0",
    created_at: "2026-09-08T00:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    source_system: "decision-engine",
    audit_id: "audit-1",
    recommendation_id: "rec-1",
    inputs_hash: "abc",
    config_version: "0.1.0",
    engine_version: "0.1.0",
    provider_calls: [],
    validation_results: [],
    generated_at: "2026-09-08T00:00:00Z"
  };
  await repo.saveDecisionAudit(audit);
  const fetched = await repo.getDecisionAudit("audit-1");
  assert.ok(fetched);
  assert.equal(fetched?.audit_id, "audit-1");
  repo.close();
});
