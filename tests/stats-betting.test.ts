import assert from "node:assert/strict";
import test from "node:test";
import type { ScoringSettings } from "../src/models/types.js";
import { aggregateTeamScenarios, evaluatePlayerProp, scorePlayerSamples, scoreRawStats } from "../src/stats-betting/bridge.js";

const scoring: ScoringSettings = {
  scoring_type: "custom",
  rules: [
    { rule_id: "rec", category: "receiving", stat: "receptions", points: 0.5, conditions: {}, applies_to_positions: ["WR", "RB", "TE"] },
    { rule_id: "yd", category: "receiving", stat: "receiving_yards", points: 0.1, conditions: {}, applies_to_positions: ["WR", "RB", "TE"] },
    { rule_id: "pass", category: "passing", stat: "passing_yards", points: 0.04, conditions: {}, applies_to_positions: ["QB"] },
    { rule_id: "interception", category: "passing", stat: "interceptions", points: -2, conditions: {}, applies_to_positions: ["QB"] }
  ]
};

test("scores raw receiving stats using configured league rules and actual position", () => {
  assert.equal(scoreRawStats(scoring, ["WR"], { receptions: 7, receiving_yards: 85, passing_yards: 300 }), 12);
});

test("normalizes NFLverse stat names to league rule names instead of skipping TDs and fumbles", () => {
  const rules: ScoringSettings = { scoring_type: "custom", rules: [
    { rule_id: "td", category: "passing", stat: "passing_touchdowns", points: 4, conditions: {}, applies_to_positions: ["QB"] },
    { rule_id: "int", category: "passing", stat: "interceptions", points: -2, conditions: {}, applies_to_positions: ["QB"] },
    { rule_id: "f", category: "misc", stat: "fumbles", points: -2, conditions: {}, applies_to_positions: ["QB"] }
  ] };
  assert.equal(scoreRawStats(rules, ["QB"], { passing_tds: 2, passing_interceptions: 1, fumbles_total: 1 }), 4);
  assert.deepEqual(aggregateTeamScenarios(rules, [{ players: [
    { playerId: "qb", positions: ["QB"], stats: { passing_tds: 2, passing_interceptions: 1, fumbles_total: 1 } }
  ] }]).scenarioTotals, [4]);
});

test("rejects missing scoring stats instead of silently treating missing inputs as zero", () => {
  assert.throws(() => scoreRawStats(scoring, ["WR"], { receptions: 1 }), /missing.*receiving_yards/i);
});

test("refuses conditional scoring rules the existing league scorer does not implement", () => {
  const conditional: ScoringSettings = {
    scoring_type: "custom",
    rules: [{ rule_id: "bonus", category: "passing", stat: "passing_yards", points: 1,
      conditions: { minimum: 300 }, applies_to_positions: ["QB"] }]
  };
  assert.throws(() => scoreRawStats(conditional, ["QB"], { passing_yards: 299 }), /unsupported.*condition/i);
});

test("maps each raw QB sample to league-specific fantasy points before averaging", () => {
  const result = scorePlayerSamples(scoring, ["QB"], [
    { passing_yards: 101, interceptions: 1 },
    { passing_yards: 200, interceptions: 0 }
  ]);
  assert.deepEqual(result.pointSamples, [2.04, 8]);
  assert.equal(result.meanPoints, 5.02);
});

test("rejects absent, nonfinite or positionless raw-stat input rather than manufacturing points", () => {
  assert.throws(() => scoreRawStats(scoring, ["WR"], {}), /stat/i);
  assert.throws(() => scoreRawStats(scoring, ["WR"], { receptions: Number.NaN }), /finite/i);
  assert.throws(() => scoreRawStats(scoring, [], { receptions: 2 }), /position/i);
});

test("settles discrete prop samples with an exact-line push and American-odds EV per unit stake", () => {
  const result = evaluatePlayerProp(
    [{ receptions: 5 }, { receptions: 6 }, { receptions: 6 }, { receptions: 8 }],
    "receptions", 6, { over: 150, under: -120 }
  );
  assert.equal(result.sampleCount, 4);
  assert.equal(result.overProbability, 0.25);
  assert.equal(result.underProbability, 0.25);
  assert.equal(result.pushProbability, 0.5);
  assert.equal(result.overExpectedValue, 0.125);
  assert.ok(Math.abs(result.underExpectedValue - (0.25 * (100 / 120) - 0.25)) < 1e-12);
});

test("prop evaluation refuses missing draws, missing observed stat, or malformed odds", () => {
  assert.throws(() => evaluatePlayerProp([], "receptions", 5.5, { over: 110, under: -110 }), /samples/i);
  assert.throws(() => evaluatePlayerProp([{}], "receptions", 5.5, { over: 110, under: -110 }), /finite receptions/i);
  assert.throws(() => evaluatePlayerProp([{ receptions: 6 }], "receptions", 5.5, { over: 0, under: -110 }), /odds/i);
});

test("aggregates same-index joint QB/receiver scenarios without independently resampling players", () => {
  const result = aggregateTeamScenarios(scoring, [
    { players: [
      { playerId: "qb", positions: ["QB"], stats: { passing_yards: 100, interceptions: 0 } },
      { playerId: "wr", positions: ["WR"], stats: { receiving_yards: 100, receptions: 2 } }
    ] },
    { players: [
      { playerId: "wr", positions: ["WR"], stats: { receiving_yards: 0, receptions: 0 } },
      { playerId: "qb", positions: ["QB"], stats: { passing_yards: 0, interceptions: 0 } }
    ] }
  ]);
  assert.deepEqual(result.scenarioTotals, [15, 0]);
  assert.equal(result.meanTotal, 7.5);
  assert.equal(result.sampleCount, 2);
});

test("rounds once per team total, matching the league roster scorer", () => {
  const result = aggregateTeamScenarios(scoring, [{ players: [
    { playerId: "qb", positions: ["QB"], stats: { passing_yards: 0.125, interceptions: 0 } },
    { playerId: "wr", positions: ["WR"], stats: { receiving_yards: 0.05, receptions: 0 } }
  ] }]);
  assert.deepEqual(result.scenarioTotals, [0.01]);
});

test("refuses joint scenarios that silently change a player's scoring position", () => {
  assert.throws(() => aggregateTeamScenarios(scoring, [
    { players: [{ playerId: "p", positions: ["WR"], stats: { receptions: 1, receiving_yards: 0 } }] },
    { players: [{ playerId: "p", positions: ["QB"], stats: { passing_yards: 10, interceptions: 0 } }] }
  ]), /position/i);
});

test("rejects absent scenarios, duplicate players, and inconsistent joint rosters", () => {
  const wr = { playerId: "wr", positions: ["WR"] as const, stats: { receptions: 0, receiving_yards: 0 } };
  assert.throws(() => aggregateTeamScenarios(scoring, []), /scenarios/i);
  assert.throws(() => aggregateTeamScenarios(scoring, [{ players: [wr, wr] }]), /distinct players/i);
  assert.throws(() => aggregateTeamScenarios(scoring, [
    { players: [wr] }, { players: [{ playerId: "qb", positions: ["QB"], stats: { passing_yards: 0, interceptions: 0 } }] }
  ]), /same distinct players/i);
});
