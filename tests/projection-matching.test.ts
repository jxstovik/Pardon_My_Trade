import assert from "node:assert/strict";
import test from "node:test";
import { matchProjectionsToRoster, normalizeName } from "../src/projections/projection-matching.js";
import type { Player } from "../src/models/types.js";
import type { ProjectionCandidate } from "../src/projections/projection-source.js";

function player(playerId: string, fullName: string, team: string): Player {
  return {
    schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "sleeper", source_record_id: playerId,
    player_id: playerId, external_id: playerId, sport: "football", full_name: fullName, team,
    positions: ["RB"], status: "active", injury_status: "active",
    eligibility: { eligible_slots: ["RB"], injured_reserve_eligible: false, taxi_eligible: false }, external_ids: {}
  };
}

test("normalizeName strips suffixes and punctuation", () => {
  assert.equal(normalizeName("Christian McCaffrey Jr."), normalizeName("Christian McCaffrey"));
  assert.equal(normalizeName("CeeDee Lamb"), "ceedeelamb");
});

test("matchProjectionsToRoster re-keys ESPN projections to roster player_id", () => {
  const players = [player("sl-1", "Christian McCaffrey", "SF"), player("sl-2", "CeeDee Lamb", "DAL")];
  const candidates: ProjectionCandidate[] = [
    { name: "Christian McCaffrey", team: "SF", positions: ["RB"], projected_stats: { rushing_yards: 95 }, projected_points: 21.4, floor: 15, ceiling: 28, confidence: 0.7 },
    { name: "CeeDee Lamb", team: "DAL", positions: ["WR"], projected_stats: { receiving_yards: 84 }, projected_points: 18.1, floor: 12, ceiling: 24, confidence: 0.7 },
    { name: "Unmatched Player", team: "GB", positions: ["QB"], projected_stats: {}, projected_points: 12, floor: 8, ceiling: 16, confidence: 0.7 }
  ];

  const projections = matchProjectionsToRoster(candidates, players, "2025-W01", "espn");
  assert.equal(projections.length, 2);
  const cmc = projections.find((p) => p.player_id === "sl-1");
  assert.ok(cmc);
  assert.equal(cmc?.source, "espn");
  assert.equal(cmc?.projected_stats.rushing_yards, 95);
  assert.equal(cmc?.projection_id, "espn-sl-1-2025-W01");
});

test("matchProjectionsToRoster falls back by name when team mismatches", () => {
  const players = [player("sl-1", "Christian McCaffrey", "SF")];
  const candidates: ProjectionCandidate[] = [
    { name: "Christian McCaffrey", team: "XX", positions: ["RB"], projected_stats: {}, projected_points: 20, floor: 14, ceiling: 26, confidence: 0.7 }
  ];
  const projections = matchProjectionsToRoster(candidates, players, "2025-W01", "espn");
  assert.equal(projections.length, 1);
  assert.equal(projections[0].player_id, "sl-1");
});
