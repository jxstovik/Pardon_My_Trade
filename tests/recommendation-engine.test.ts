import assert from "node:assert/strict";
import test from "node:test";
import { DefaultRecommendationEngine } from "../src/recommendations/recommendation-engine.js";
import { ScoringRuleEngine } from "../src/rules/rule-engine.js";
import { assertRecommendation } from "../src/models/validation.js";
import type { Recommendation } from "../src/models/types.js";
import type { DropCandidate, LineupCandidate, TradeCandidate, WaiverCandidate, WeeklyReportInputs } from "../src/decisions/types.js";

const fixedClock = () => new Date("2026-09-08T12:00:00Z");

function baseInputs(overrides: Partial<WeeklyReportInputs> = {}): WeeklyReportInputs {
  return {
    leagueId: "league-001",
    teamId: "team-001",
    currentProjectedPoints: 100,
    lineupCandidates: [] as LineupCandidate[],
    waiverCandidates: [] as WaiverCandidate[],
    dropCandidates: [] as DropCandidate[],
    tradeCandidates: [] as TradeCandidate[],
    notes: [],
    ...overrides
  };
}

test("generateWeeklyReport produces a contract-valid recommendation", () => {
  const engine = new DefaultRecommendationEngine(new ScoringRuleEngine(), { clock: fixedClock });
  const report = engine.generateWeeklyReport(baseInputs());

  assert.equal(report.type, "weekly_report");
  assert.equal(report.status, "ready");
  assert.ok(report.reasoning.length > 0);
  assert.doesNotThrow(() => assertRecommendation(report));
  assert.ok(report.expiration > report.generated_at);
});

test("generateWeeklyReport surfaces candidate upsides in reasoning", () => {
  const engine = new DefaultRecommendationEngine(new ScoringRuleEngine(), { clock: fixedClock });
  const inputs = baseInputs({
    lineupCandidates: [{
      candidateId: "c1", teamId: "team-001", proposedStarters: [], projectedPoints: 112,
      swaps: [], confidence: 0.6, rationale: "Start fa-rb-001 over player-rb-004 for +6 points."
    }]
  });
  const report = engine.generateWeeklyReport(inputs);
  assert.ok(report.reasoning.some((line) => line.includes("fa-rb-001")));
  assert.ok(report.expected_benefit.value >= 100);
});

test("validateRecommendation fails on malformed recommendation", () => {
  const engine = new DefaultRecommendationEngine(new ScoringRuleEngine(), { clock: fixedClock });
  const bad = { confidence: 2 } as unknown as Recommendation;
  const evaluation = engine.validateRecommendation(bad);
  assert.equal(evaluation.valid, false);
});

test("rankCandidates orders by confidence descending", () => {
  const engine = new DefaultRecommendationEngine(new ScoringRuleEngine(), { clock: fixedClock });
  const ranked = engine.rankCandidates([
    { confidence: 0.2 },
    { confidence: 0.9 },
    { confidence: 0.5 }
  ]);
  assert.deepEqual(ranked.map((c) => c.confidence), [0.9, 0.5, 0.2]);
});
