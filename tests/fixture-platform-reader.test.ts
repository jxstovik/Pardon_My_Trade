import assert from "node:assert/strict";
import test from "node:test";
import { FixturePlatformReader } from "../src/adapters/fixture/fixture-platform-reader.js";
import { assertLeagueSnapshot, assertRecommendation } from "../src/models/validation.js";
import { readFile } from "node:fs/promises";

const fixturePath = "tests/fixtures/sample-football-league.json";

test("fixture snapshot validates against canonical MVP shape", async () => {
  const raw = await readFile(fixturePath, "utf8");
  const parsed = JSON.parse(raw);

  assert.doesNotThrow(() => assertLeagueSnapshot(parsed));
});

test("fixture platform reader imports a complete sample league", async () => {
  const reader = new FixturePlatformReader(fixturePath);

  const league = await reader.getLeague("pmt-demo-football", "2026");
  const teams = await reader.getTeams("pmt-demo-football");
  const roster = await reader.getRoster("pmt-demo-football", "team-001");
  const freeAgents = await reader.getFreeAgents("pmt-demo-football");
  const waiverState = await reader.getWaiverState("pmt-demo-football");

  assert.equal(league.name, "Pardon My Trade Demo League");
  assert.equal(teams.length, 4);
  assert.equal(roster.starters.length, 9);
  assert.ok(freeAgents.length >= 3);
  assert.equal(waiverState.league_id, league.league_id);
});

test("recommendation validator enforces explainability contract", () => {
  assert.doesNotThrow(() => assertRecommendation({
    schema_version: "1.0.0",
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    source_system: "fixture",
    recommendation_id: "rec-001",
    league_id: "league-001",
    team_id: "team-001",
    type: "lineup",
    title: "Start the highest projected legal lineup",
    recommendation: "Start the projected lineup from the fixture.",
    reasoning: ["All required starter slots are filled with eligible players."],
    evidence: [],
    confidence: 0.75,
    risk: { level: "low", factors: [] },
    expected_benefit: { metric: "projected_points", value: 4.2, range: [2.1, 6.3] },
    assumptions: ["Fixture projections are current."],
    alternatives: ["Re-run after injury updates."],
    generated_at: "2026-07-10T00:00:00Z",
    expiration: "2026-09-13T17:00:00Z",
    status: "ready"
  }));
});
