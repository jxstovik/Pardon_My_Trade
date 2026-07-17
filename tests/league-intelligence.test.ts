import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { analyzeLeague } from "../src/intelligence/league-intelligence.js";
import { assertLeagueSnapshot } from "../src/models/validation.js";
import type { LeagueSnapshot, Projection } from "../src/models/types.js";

async function loadFixture(): Promise<LeagueSnapshot> {
  const raw = await readFile("tests/fixtures/sample-football-league.json", "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertLeagueSnapshot(parsed);
  return parsed;
}

test("analyzeLeague ranks teams and surfaces waiver targets", async () => {
  const snapshot = await loadFixture();
  const projections: Projection[] = [
    { schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "f", source_record_id: "x",
      projection_id: "px", player_id: "fa-rb-001", source: "f", scoring_period: "W1",
      projected_stats: {}, projected_points: 14.1, floor: 7, ceiling: 21, confidence: 0.6 }
  ];

  const insight = analyzeLeague(snapshot, projections);
  assert.equal(insight.leagueId, "league-001");
  assert.equal(insight.standings.length, 4);
  assert.ok(insight.standings[0].pointsFor >= insight.standings[1].pointsFor);
  assert.ok(insight.waiverTargets.includes("fa-rb-001"));
});
