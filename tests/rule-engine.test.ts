import assert from "node:assert/strict";
import test from "node:test";
import { ScoringRuleEngine } from "../src/rules/rule-engine.js";
import type { League, Player, Projection, Roster, ScoringSettings } from "../src/models/types.js";

const scoring: ScoringSettings = {
  scoring_type: "ppr",
  rules: [
    { rule_id: "rec", category: "receiving", stat: "receptions", points: 1, conditions: {}, applies_to_positions: ["RB", "WR", "TE"] },
    { rule_id: "rec-yd", category: "receiving", stat: "receiving_yards", points: 0.1, conditions: {}, applies_to_positions: ["RB", "WR", "TE"] },
    { rule_id: "pass-yd", category: "passing", stat: "passing_yards", points: 0.04, conditions: {}, applies_to_positions: ["QB"] }
  ]
};

const projections: Projection[] = [
  {
    schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "fixture", source_record_id: "p1",
    projection_id: "p1", player_id: "wr-a", source: "fixture", scoring_period: "W1",
    projected_stats: { receptions: 8, receiving_yards: 100 }, projected_points: 18, floor: 10, ceiling: 25, confidence: 0.7
  },
  {
    schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "fixture", source_record_id: "p2",
    projection_id: "p2", player_id: "wr-b", source: "fixture", scoring_period: "W1",
    projected_stats: {}, projected_points: 5, floor: 2, ceiling: 9, confidence: 0.6
  }
];

function rosterWith(starters: Array<{ id: string; type: "WR" | "QB"; pos: string[] }>): Roster {
  return {
    team_id: "team-1",
    starters: starters.map((s, i) => ({
      slot_id: `st-${i}`, slot_type: s.type, allowed_positions: s.pos as never, locked: false, player_id: s.id
    })),
    bench: [], injured_reserve: [], taxi: [], last_updated_at: ""
  };
}

test("calculateProjectedScore scores from projected stats under league settings", () => {
  const engine = new ScoringRuleEngine();
  const roster = rosterWith([{ id: "wr-a", type: "WR", pos: ["WR"] }]);
  const score = engine.calculateProjectedScore(scoring, projections, roster);
  assert.equal(score, 18);
});

test("calculateProjectedScore falls back to projected_points when no stats", () => {
  const engine = new ScoringRuleEngine();
  const roster = rosterWith([{ id: "wr-b", type: "WR", pos: ["WR"] }]);
  const score = engine.calculateProjectedScore(scoring, projections, roster);
  assert.equal(score, 5);
});

test("validateLineup flags duplicate player assignments", () => {
  const engine = new ScoringRuleEngine();
  const league = {
    roster_settings: { slots: [{ slot: "WR" as const, count: 1, positions: ["WR"] }], bench_count: 0, injured_reserve_count: 0, taxi_count: 0 }
  } as unknown as League;
  const roster = rosterWith([
    { id: "wr-a", type: "WR", pos: ["WR"] },
    { id: "wr-a", type: "WR", pos: ["WR"] }
  ]);
  const evaluation = engine.validateLineup(league, roster);
  assert.equal(evaluation.valid, false);
  assert.ok(evaluation.violations.some((v) => v.ruleId === "roster-slot-legality"));
});

test("validateWaiverRecommendation requires a drop when roster is full", () => {
  const engine = new ScoringRuleEngine();
  const league = {
    roster_settings: { slots: [], bench_count: 0, injured_reserve_count: 0, taxi_count: 0 }
  } as unknown as League;
  const roster: Roster = {
    team_id: "team-1", starters: [{ slot_id: "s", slot_type: "WR", allowed_positions: ["WR"], locked: false, player_id: "x" }],
    bench: [], injured_reserve: [], taxi: [], last_updated_at: ""
  };
  const addPlayer = { player_id: "fa-1", eligibility: { eligible_slots: ["WR"], injured_reserve_eligible: false, taxi_eligible: false } } as unknown as Player;
  const evaluation = engine.validateWaiverRecommendation(league, roster, addPlayer);
  assert.equal(evaluation.valid, false);
  assert.ok(evaluation.violations.some((v) => v.ruleId === "waiver-drop-required"));
});

test("validateRecommendationCompleteness enforces confidence bounds", () => {
  const engine = new ScoringRuleEngine();
  const evaluation = engine.validateRecommendationCompleteness({
    confidence: 1.5
  } as unknown as Parameters<typeof engine.validateRecommendationCompleteness>[0]);
  assert.equal(evaluation.valid, false);
});
