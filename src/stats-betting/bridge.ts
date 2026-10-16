import type { PlayerPosition, Projection, Roster, ScoringSettings } from "../models/types.js";
import { ScoringRuleEngine, scoreProjectionPoints } from "../rules/rule-engine.js";

/** Explicit nflverse -> league rule aliases. Fumbles and lost fumbles are distinct. */
const NFLVERSE_ALIASES: Readonly<Record<string, string>> = {
  passing_tds: "passing_touchdowns", passing_interceptions: "interceptions",
  rushing_tds: "rushing_touchdowns", receiving_tds: "receiving_touchdowns",
  fumbles_total: "fumbles", fumbles_lost_total: "fumbles_lost"
};

function normalizedStats(scoring: ScoringSettings, positions: readonly PlayerPosition[],
                         stats: Record<string, number>): Record<string, number> {
  if (scoring.rules.some((rule) => Object.keys(rule.conditions).length > 0)) {
    throw new Error("Unsupported conditional scoring rule: league scorer ignores conditions");
  }
  if (!positions.length) throw new Error("Raw-stat scoring requires player positions");
  if (!Object.keys(stats).length) throw new Error("Raw-stat scoring requires explicit stats (use zero for observed zeros)");
  if (Object.values(stats).some((value) => !Number.isFinite(value))) {
    throw new Error("Raw-stat values must be finite");
  }
  const normalized = { ...stats };
  for (const [raw, canonical] of Object.entries(NFLVERSE_ALIASES)) {
    if (stats[raw] === undefined) continue;
    if (normalized[canonical] !== undefined && normalized[canonical] !== stats[raw]) {
      throw new Error(`Conflicting raw stat mapping for ${canonical}`);
    }
    normalized[canonical] = stats[raw];
  }
  for (const rule of scoring.rules) {
    if (rule.applies_to_positions.some((position) => positions.includes(position)) && normalized[rule.stat] === undefined) {
      throw new Error(`Missing raw stat required by league scoring: ${rule.stat}`);
    }
  }
  return normalized;
}

/** Score a raw stat line against the same position-aware rule path used by league projections. */
export function scoreRawStats(
  scoring: ScoringSettings,
  positions: readonly PlayerPosition[],
  stats: Record<string, number>
): number {
  const projectedStats = normalizedStats(scoring, positions, stats);
  const projection: Projection = {
    schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "raw-stats",
    projection_id: "raw-stat-line", player_id: "raw-stat-line", source: "raw-stats", scoring_period: "",
    projected_stats: projectedStats, projected_points: 0, floor: 0, ceiling: 0, confidence: 0
  };
  return scoreProjectionPoints(scoring, projection, [...positions]);
}

export interface PlayerSampleAggregate {
  readonly pointSamples: readonly number[];
  readonly meanPoints: number;
}

/** Uses the supplied raw-stat draws, not an assumed fantasy-point distribution. */
export function scorePlayerSamples(
  scoring: ScoringSettings,
  positions: readonly PlayerPosition[],
  samples: readonly Record<string, number>[]
): PlayerSampleAggregate {
  if (!samples.length) throw new Error("Player scoring requires predictive samples");
  const pointSamples = samples.map((stats) => scoreRawStats(scoring, positions, stats));
  return { pointSamples, meanPoints: pointSamples.reduce((sum, value) => sum + value, 0) / pointSamples.length };
}

export interface AmericanPropOdds {
  readonly over: number;
  readonly under: number;
}

export interface PropEvaluation {
  readonly sampleCount: number;
  readonly overProbability: number;
  readonly underProbability: number;
  readonly pushProbability: number;
  /** Net expected profit per unit staked, with pushes returning the stake. */
  readonly overExpectedValue: number;
  readonly underExpectedValue: number;
}

/** Empirical frequencies supplied by a predictive sampler; never derives a distribution from point estimates. */
export function evaluatePlayerProp(
  samples: readonly Readonly<Record<string, number>>[],
  stat: string,
  line: number,
  odds: AmericanPropOdds
): PropEvaluation {
  if (samples.length === 0) throw new Error("Prop evaluation requires predictive samples");
  if (!Number.isFinite(line)) throw new Error("Prop line must be finite");
  const profitPerUnit = (price: number): number => {
    if (!Number.isFinite(price) || Math.abs(price) < 100) throw new Error("American odds must be finite and at least +100 or at most -100");
    return price > 0 ? price / 100 : 100 / -price;
  };
  const overProfit = profitPerUnit(odds.over);
  const underProfit = profitPerUnit(odds.under);
  let over = 0;
  let under = 0;
  let push = 0;
  for (const sample of samples) {
    const value = sample[stat];
    if (!Number.isFinite(value)) throw new Error(`Every prop sample must supply finite ${stat}`);
    if (value > line) over++;
    else if (value < line) under++;
    else push++;
  }
  const overProbability = over / samples.length;
  const underProbability = under / samples.length;
  return {
    sampleCount: samples.length, overProbability, underProbability, pushProbability: push / samples.length,
    overExpectedValue: overProbability * overProfit - underProbability,
    underExpectedValue: underProbability * underProfit - overProbability
  };
}

export interface TeamPlayerStatLine {
  readonly playerId: string;
  readonly positions: readonly PlayerPosition[];
  readonly stats: Record<string, number>;
}

/** Each scenario is a joint draw; player samples at the same index retain supplied correlation. */
export interface TeamScenario {
  readonly players: readonly TeamPlayerStatLine[];
}

export interface TeamAggregate {
  readonly scenarioTotals: readonly number[];
  readonly meanTotal: number;
  readonly sampleCount: number;
}

export function aggregateTeamScenarios(scoring: ScoringSettings, scenarios: readonly TeamScenario[]): TeamAggregate {
  if (!scenarios.length) throw new Error("Team aggregation requires joint scenarios");
  const playerIds = scenarios[0].players.map((player) => player.playerId);
  if (!playerIds.length || new Set(playerIds).size !== playerIds.length) {
    throw new Error("Team scenario needs distinct players");
  }
  const positionsByPlayer = new Map(scenarios[0].players.map((player) => [player.playerId, [...player.positions].sort().join(",")]));
  const scenarioTotals = scenarios.map((scenario) => {
    const ids = scenario.players.map((player) => player.playerId);
    if (ids.length !== playerIds.length || new Set(ids).size !== ids.length || ids.some((id) => !playerIds.includes(id))) {
      throw new Error("All joint scenarios must contain the same distinct players");
    }
    if (scenario.players.some((player) => [...player.positions].sort().join(",") !== positionsByPlayer.get(player.playerId))) {
      throw new Error("Player positions must remain fixed across joint scenarios");
    }
    // Validate every stat line, then use the league's roster scorer so rounding happens once per team.
    const normalized = scenario.players.map((player) => normalizedStats(scoring, player.positions, player.stats));
    const roster: Roster = {
      team_id: "raw-stat-team", last_updated_at: "",
      starters: scenario.players.map((player) => ({
        slot_id: player.playerId, slot_type: player.positions[0], allowed_positions: [...player.positions],
        locked: false, player_id: player.playerId
      })),
      bench: [], injured_reserve: [], taxi: []
    };
    const projections: Projection[] = scenario.players.map((player, index) => ({
      schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "raw-stats",
      projection_id: player.playerId, player_id: player.playerId, source: "raw-stats", scoring_period: "",
      projected_stats: normalized[index], projected_points: 0, floor: 0, ceiling: 0, confidence: 0
    }));
    const positions = new Map<string, PlayerPosition[]>(scenario.players.map((player) => [player.playerId, [...player.positions]]));
    return new ScoringRuleEngine().calculateProjectedScore(scoring, projections, roster, positions);
  });
  return {
    scenarioTotals,
    meanTotal: scenarioTotals.reduce((sum, value) => sum + value, 0) / scenarioTotals.length,
    sampleCount: scenarioTotals.length
  };
}
