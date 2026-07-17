import { PmtError } from "../errors.js";
import { assertRecommendation } from "../models/validation.js";
import type { Evidence, Recommendation, RiskLevel } from "../models/types.js";
import type { RuleEngine, RuleEvaluation } from "../rules/rule-engine.js";
import type { WeeklyReportInputs } from "../decisions/types.js";

export interface RecommendationEngineOptions {
  readonly clock?: () => Date;
  readonly expirationDays?: number;
}

export interface RecommendationEngine {
  rankCandidates<T extends { confidence: number }>(candidates: T[]): T[];
  attachEvidence(recommendation: Recommendation, evidence: Evidence[]): Recommendation;
  validateRecommendation(recommendation: Recommendation): RuleEvaluation;
  generateWeeklyReport(inputs: WeeklyReportInputs): Recommendation;
}

const engineVersion = "0.1.0";

export class DefaultRecommendationEngine implements RecommendationEngine {
  private readonly clock: () => Date;
  private readonly expirationDays: number;

  constructor(private readonly ruleEngine: RuleEngine, options: RecommendationEngineOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.expirationDays = options.expirationDays ?? 7;
  }

  rankCandidates<T extends { confidence: number }>(candidates: T[]): T[] {
    return [...candidates].sort((a, b) => b.confidence - a.confidence);
  }

  attachEvidence(recommendation: Recommendation, evidence: Evidence[]): Recommendation {
    return {
      ...recommendation,
      evidence: [...recommendation.evidence, ...evidence]
    };
  }

  validateRecommendation(recommendation: Recommendation): RuleEvaluation {
    try {
      assertRecommendation(recommendation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        violations: [{ ruleId: "recommendation-contract", message }],
        warnings: [],
        appliedRules: ["recommendation-contract"],
        calculatedValues: {},
        explanation: "Recommendation failed structural contract validation."
      };
    }
    return this.ruleEngine.validateRecommendationCompleteness(recommendation);
  }

  generateWeeklyReport(inputs: WeeklyReportInputs): Recommendation {
    const now = this.clock();
    const generatedAt = now.toISOString();
    const expiration = new Date(now.getTime() + this.expirationDays * 86_400_000).toISOString();

    const reasoning: string[] = [];
    reasoning.push(`Current projected lineup scores ${inputs.currentProjectedPoints} points.`);

    const bestLineup = inputs.lineupCandidates[0];
    if (bestLineup) {
      reasoning.push(`Best lineup upgrade: ${bestLineup.rationale}`);
    }
    const bestWaiver = inputs.waiverCandidates[0];
    if (bestWaiver) {
      reasoning.push(`Top waiver target: ${bestWaiver.rationale}`);
    }
    const bestTrade = inputs.tradeCandidates[0];
    if (bestTrade) {
      reasoning.push(`Notable trade idea: ${bestTrade.rationale}`);
    }
    for (const note of inputs.notes) {
      reasoning.push(note);
    }
    if (reasoning.length === 0) {
      reasoning.push("No actionable upgrades detected for this scoring period.");
    }

    const evidence: Evidence[] = [
      {
        evidence_id: `ev-${inputs.teamId}-projections`,
        source: "knowledge-base",
        source_type: "projection",
        observed_at: generatedAt,
        claim: "Projected starter points",
        value: inputs.currentProjectedPoints,
        confidence: 0.6
      }
    ];

    const confidence = this.aggregateConfidence(inputs);
    const risk = this.deriveRisk(inputs);
    const upside = this.estimateUpside(inputs);

    const recommendation: Recommendation = {
      schema_version: "1.0.0",
      created_at: generatedAt,
      updated_at: generatedAt,
      source_system: "decision-engine",
      recommendation_id: `weekly-${inputs.leagueId}-${inputs.teamId}-${now.getTime()}`,
      league_id: inputs.leagueId,
      team_id: inputs.teamId,
      type: "weekly_report",
      title: "Weekly fantasy football assistant report",
      recommendation: "Review the lineup, waiver, and trade suggestions below before locking your lineup.",
      reasoning,
      evidence,
      confidence,
      risk,
      expected_benefit: {
        metric: "projected_points",
        value: Math.round((inputs.currentProjectedPoints + upside) * 100) / 100,
        range: [inputs.currentProjectedPoints, Math.round((inputs.currentProjectedPoints + upside * 1.5) * 100) / 100]
      },
      assumptions: ["Projections reflect the latest ingested snapshot.", "No injuries occurred after snapshot ingestion."],
      alternatives: ["Re-run after news ingestion for updated injury context."],
      generated_at: generatedAt,
      expiration,
      status: "ready"
    };

    const evaluation = this.validateRecommendation(recommendation);
    if (!evaluation.valid) {
      throw new PmtError({
        code: "RECOMMENDATION_GENERATION_FAILED",
        message: `Weekly report failed validation: ${evaluation.violations.map((v) => v.message).join("; ")}`,
        source: "recommendation_engine",
        retryable: false
      });
    }

    return recommendation;
  }

  private aggregateConfidence(inputs: WeeklyReportInputs): number {
    const confidences = [
      ...inputs.lineupCandidates.map((c) => c.confidence),
      ...inputs.waiverCandidates.map((c) => c.confidence),
      ...inputs.tradeCandidates.map((c) => c.confidence)
    ];
    if (confidences.length === 0) return 0.5;
    const min = Math.min(...confidences);
    return Math.round(min * 100) / 100;
  }

  private deriveRisk(inputs: WeeklyReportInputs): { level: RiskLevel; factors: string[] } {
    const factors: string[] = [];
    if (inputs.dropCandidates.some((c) => c.reason.includes("injury"))) {
      factors.push("Injury-related roster risk.");
    }
    if (inputs.tradeCandidates.length === 0 && inputs.lineupCandidates.length === 0) {
      factors.push("Limited actionable upside this period.");
    }
    const level: RiskLevel = factors.length > 0 ? "medium" : "low";
    return { level, factors };
  }

  private estimateUpside(inputs: WeeklyReportInputs): number {
    const deltas = [
      ...inputs.lineupCandidates.map((c) => c.projectedPoints - inputs.currentProjectedPoints),
      ...inputs.waiverCandidates.map((c) => c.projectedDelta),
      ...inputs.tradeCandidates.map((c) => c.projectedDelta)
    ];
    const best = deltas.length > 0 ? Math.max(...deltas) : 0;
    return Math.max(0, Math.round(best * 100) / 100);
  }
}

void engineVersion;
