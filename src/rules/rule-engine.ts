import type {
  League,
  Player,
  PlayerPosition,
  Projection,
  Recommendation,
  Roster,
  RosterSettings,
  ScoringSettings
} from "../models/types.js";

export interface RuleViolation {
  readonly ruleId: string;
  readonly message: string;
}

export interface RuleWarning {
  readonly ruleId: string;
  readonly message: string;
}

export interface RuleEvaluation {
  readonly valid: boolean;
  readonly violations: RuleViolation[];
  readonly warnings: RuleWarning[];
  readonly appliedRules: string[];
  readonly calculatedValues: Record<string, number>;
  readonly explanation: string;
}

export interface RuleEngine {
  validateLineup(league: League, roster: Roster): RuleEvaluation;
  calculateProjectedScore(
    scoring: ScoringSettings,
    projections: Projection[],
    roster: Roster,
    playerPositions?: Map<string, PlayerPosition[]>
  ): number;
  getEligibleSlots(player: Player, settings: RosterSettings): PlayerPosition[];
  validateWaiverRecommendation(league: League, roster: Roster, addPlayer: Player, dropPlayer?: Player): RuleEvaluation;
  validateTradeRecommendation(league: League, teamRoster: Roster, incoming: Player[], outgoing: Player[]): RuleEvaluation;
  validateRecommendationCompleteness(recommendation: Recommendation): RuleEvaluation;
}

const ERROR = (ruleId: string, message: string): RuleViolation => ({ ruleId, message });

export class ScoringRuleEngine implements RuleEngine {
  validateLineup(league: League, roster: Roster): RuleEvaluation {
    const violations: RuleViolation[] = [];
    const warnings: RuleWarning[] = [];
    const appliedRules = ["roster-slot-legality", "position-eligibility", "slot-limits"];

    const assignedByType = new Map<PlayerPosition, number>();
    const seenPlayers = new Set<string>();

    for (const slot of roster.starters) {
      if (!slot.player_id) {
        warnings.push({ ruleId: "roster-slot-legality", message: `Starter slot ${slot.slot_id} is empty.` });
        continue;
      }
      if (seenPlayers.has(slot.player_id)) {
        violations.push(ERROR("roster-slot-legality", `Player ${slot.player_id} is assigned to multiple slots.`));
      }
      seenPlayers.add(slot.player_id);

      if (slot.slot_type !== "FLEX" && slot.slot_type !== "SUPER_FLEX") {
        if (!slot.allowed_positions.includes(slot.slot_type)) {
          violations.push(ERROR("position-eligibility", `Slot ${slot.slot_id} type ${slot.slot_type} is not in allowed positions.`));
        }
      }
      assignedByType.set(slot.slot_type, (assignedByType.get(slot.slot_type) ?? 0) + 1);
    }

    for (const required of league.roster_settings.slots) {
      const actual = assignedByType.get(required.slot) ?? 0;
      if (actual > required.count) {
        violations.push(ERROR("slot-limits", `Too many ${required.slot} starters: ${actual} > ${required.count}.`));
      }
    }

    if (roster.bench.length > league.roster_settings.bench_count) {
      violations.push(ERROR("slot-limits", `Bench exceeds limit: ${roster.bench.length} > ${league.roster_settings.bench_count}.`));
    }
    if (roster.injured_reserve.length > league.roster_settings.injured_reserve_count) {
      violations.push(ERROR("slot-limits", `IR exceeds limit: ${roster.injured_reserve.length} > ${league.roster_settings.injured_reserve_count}.`));
    }

    const valid = violations.length === 0;
    return {
      valid,
      violations,
      warnings,
      appliedRules,
      calculatedValues: { starterCount: roster.starters.length, benchCount: roster.bench.length },
      explanation: valid
        ? "Lineup satisfies roster slot, eligibility, and limit rules."
        : `Lineup has ${violations.length} violation(s).`
    };
  }

  calculateProjectedScore(
    scoring: ScoringSettings,
    projections: Projection[],
    roster: Roster,
    playerPositions: Map<string, PlayerPosition[]> = new Map()
  ): number {
    const byPlayer = new Map(projections.map((projection) => [projection.player_id, projection]));
    let total = 0;
    for (const slot of roster.starters) {
      if (!slot.player_id) continue;
      const projection = byPlayer.get(slot.player_id);
      if (!projection) continue;

      const positions = playerPositions.get(slot.player_id) ?? slot.allowed_positions;
      if (projection.projected_stats && Object.keys(projection.projected_stats).length > 0) {
        total += this.scoreStats(scoring, projection.projected_stats, positions);
      } else {
        total += projection.projected_points;
      }
    }
    return Math.round(total * 100) / 100;
  }

  getEligibleSlots(player: Player, settings: RosterSettings): PlayerPosition[] {
    const candidatePositions = player.eligibility.eligible_slots.length > 0
      ? player.eligibility.eligible_slots
      : player.positions;
    return settings.slots
      .filter((slotDef) => slotDef.positions.some((position) => candidatePositions.includes(position)))
      .map((slotDef) => slotDef.slot);
  }

  validateWaiverRecommendation(league: League, roster: Roster, addPlayer: Player, dropPlayer?: Player): RuleEvaluation {
    const violations: RuleViolation[] = [];
    const warnings: RuleWarning[] = [];
    const appliedRules = ["waiver-add-eligibility", "waiver-drop-required"];

    const eligibleSlots = this.getEligibleSlots(addPlayer, league.roster_settings);
    if (eligibleSlots.length === 0) {
      violations.push(ERROR("waiver-add-eligibility", `Add target ${addPlayer.player_id} is not eligible for any roster slot.`));
    }

    const rosterSize = roster.starters.length + roster.bench.length + roster.injured_reserve.length;
    const capacity = this.totalSlotCapacity(league.roster_settings);
    const isFull = rosterSize >= capacity;

    if (isFull && !dropPlayer) {
      violations.push(ERROR("waiver-drop-required", "Roster is full; a drop player is required for this waiver claim."));
    }

    if (dropPlayer) {
      const onRoster = [...roster.starters, ...roster.bench, ...roster.injured_reserve]
        .some((slot) => slot.player_id === dropPlayer.player_id);
      if (!onRoster) {
        violations.push(ERROR("waiver-drop-required", `Drop player ${dropPlayer.player_id} is not on the roster.`));
      }
    }

    const valid = violations.length === 0;
    return {
      valid,
      violations,
      warnings,
      appliedRules,
      calculatedValues: { rosterSize, capacity },
      explanation: valid
        ? "Waiver recommendation satisfies add eligibility and drop pairing rules."
        : `Waiver recommendation has ${violations.length} violation(s).`
    };
  }

  validateTradeRecommendation(league: League, teamRoster: Roster, incoming: Player[], outgoing: Player[]): RuleEvaluation {
    const violations: RuleViolation[] = [];
    const warnings: RuleWarning[] = [];
    const appliedRules = ["trade-disabled", "trade-roster-constraint"];

    if (league.trade_settings.enabled === false) {
      violations.push(ERROR("trade-disabled", "Trades are disabled for this league."));
    }
    if (incoming.length === 0 || outgoing.length === 0) {
      violations.push(ERROR("trade-constraint", "A trade must include at least one incoming and one outgoing player."));
    }

    const onRosterIds = new Set(
      [...teamRoster.starters, ...teamRoster.bench, ...teamRoster.injured_reserve].map((slot) => slot.player_id)
    );
    for (const player of outgoing) {
      if (!onRosterIds.has(player.player_id)) {
        violations.push(ERROR("trade-roster-constraint", `Outgoing player ${player.player_id} is not on the roster.`));
      }
    }

    const before = teamRoster.starters.length + teamRoster.bench.length + teamRoster.injured_reserve.length;
    const after = before - outgoing.length + incoming.length;
    const capacity = this.totalSlotCapacity(league.roster_settings);
    if (after > capacity) {
      violations.push(ERROR("trade-roster-constraint", `Post-trade roster size ${after} exceeds capacity ${capacity}.`));
    }

    const valid = violations.length === 0;
    return {
      valid,
      violations,
      warnings,
      appliedRules,
      calculatedValues: { rosterBefore: before, rosterAfter: after, capacity },
      explanation: valid
        ? "Trade recommendation satisfies league trade constraints."
        : `Trade recommendation has ${violations.length} violation(s).`
    };
  }

  validateRecommendationCompleteness(recommendation: Recommendation): RuleEvaluation {
    const violations: RuleViolation[] = [];
    const warnings: RuleWarning[] = [];
    const appliedRules = ["recommendation-completeness"];

    const reasoning = recommendation.reasoning ?? [];
    const assumptions = recommendation.assumptions ?? [];
    const confidence = recommendation.confidence;

    if (reasoning.length === 0) {
      violations.push(ERROR("recommendation-completeness", "Recommendation must include reasoning."));
    }
    if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
      violations.push(ERROR("recommendation-completeness", "Confidence must be a number between 0 and 1."));
    }
    if (assumptions.length === 0) {
      warnings.push({ ruleId: "recommendation-completeness", message: "Recommendation has no stated assumptions." });
    }
    if (new Date(recommendation.expiration) <= new Date(recommendation.generated_at)) {
      violations.push(ERROR("recommendation-completeness", "Recommendation expiration must be after generation time."));
    }

    const valid = violations.length === 0;
    return {
      valid,
      violations,
      warnings,
      appliedRules,
      calculatedValues: { confidence: recommendation.confidence },
      explanation: valid
        ? "Recommendation satisfies the explainability contract."
        : `Recommendation is incomplete with ${violations.length} violation(s).`
    };
  }

  private scoreStats(scoring: ScoringSettings, stats: Record<string, number>, positions: PlayerPosition[]): number {
    let total = 0;
    for (const rule of scoring.rules) {
      const value = stats[rule.stat];
      if (value === undefined) continue;
      if (!rule.applies_to_positions.some((position) => positions.includes(position))) continue;
      total += value * rule.points;
    }
    return total;
  }

  private totalSlotCapacity(settings: RosterSettings): number {
    const starters = settings.slots.reduce((sum, slot) => sum + slot.count, 0);
    return starters + settings.bench_count + settings.injured_reserve_count + settings.taxi_count;
  }
}

export function scoreProjectionPoints(
  scoring: ScoringSettings,
  projection: Projection,
  positions: PlayerPosition[]
): number {
  if (projection.projected_stats && Object.keys(projection.projected_stats).length > 0) {
    let total = 0;
    for (const rule of scoring.rules) {
      const value = projection.projected_stats[rule.stat];
      if (value === undefined) continue;
      if (!rule.applies_to_positions.some((position) => positions.includes(position))) continue;
      total += value * rule.points;
    }
    return Math.round(total * 100) / 100;
  }
  return projection.projected_points;
}
