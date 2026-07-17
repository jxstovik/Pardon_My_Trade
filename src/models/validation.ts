import { validationError } from "../errors.js";
import type { League, LeagueSnapshot, Player, Recommendation, Team } from "./types.js";

export function assertLeagueSnapshot(value: unknown): asserts value is LeagueSnapshot {
  const snapshot = asRecord(value, "snapshot");
  requireString(snapshot.snapshot_id, "snapshot.snapshot_id");
  assertLeague(snapshot.league);
  requireArray(snapshot.managers, "snapshot.managers");
  requireArray(snapshot.players, "snapshot.players").forEach(assertPlayer);
  requireArray(snapshot.free_agents, "snapshot.free_agents").forEach(assertPlayer);
  asRecord(snapshot.waiver_state, "snapshot.waiver_state");
  requireArray(snapshot.projections, "snapshot.projections");
  requireArray(snapshot.news, "snapshot.news");
}

export function assertLeague(value: unknown): asserts value is League {
  const league = asRecord(value, "league");
  requireString(league.league_id, "league.league_id");
  requireString(league.external_id, "league.external_id");
  requireString(league.platform, "league.platform");
  requireString(league.sport, "league.sport");
  requireString(league.season, "league.season");
  requireString(league.name, "league.name");
  requireArray(league.teams, "league.teams").forEach(assertTeam);
  asRecord(league.roster_settings, "league.roster_settings");
  const scoring = asRecord(league.scoring_settings, "league.scoring_settings");
  requireArray(scoring.rules, "league.scoring_settings.rules");
  asRecord(league.waiver_settings, "league.waiver_settings");
  asRecord(league.trade_settings, "league.trade_settings");
  requireArray(league.schedule, "league.schedule");
  asRecord(league.import_metadata, "league.import_metadata");
}

export function assertTeam(value: unknown): asserts value is Team {
  const team = asRecord(value, "team");
  requireString(team.team_id, "team.team_id");
  requireString(team.external_id, "team.external_id");
  requireString(team.league_id, "team.league_id");
  requireString(team.manager_id, "team.manager_id");
  requireString(team.name, "team.name");
  asRecord(team.roster, "team.roster");
  asRecord(team.standings, "team.standings");
  requireArray(team.transaction_history, "team.transaction_history");
}

export function assertPlayer(value: unknown): asserts value is Player {
  const player = asRecord(value, "player");
  requireString(player.player_id, "player.player_id");
  requireString(player.external_id, "player.external_id");
  requireString(player.sport, "player.sport");
  requireString(player.full_name, "player.full_name");
  requireString(player.team, "player.team");
  requireArray(player.positions, "player.positions");
  requireString(player.status, "player.status");
  requireString(player.injury_status, "player.injury_status");
  asRecord(player.eligibility, "player.eligibility");
  asRecord(player.external_ids, "player.external_ids");
}

export function assertRecommendation(value: unknown): asserts value is Recommendation {
  const recommendation = asRecord(value, "recommendation");
  requireString(recommendation.recommendation_id, "recommendation.recommendation_id");
  requireString(recommendation.league_id, "recommendation.league_id");
  requireString(recommendation.team_id, "recommendation.team_id");
  requireString(recommendation.type, "recommendation.type");
  requireString(recommendation.title, "recommendation.title");
  requireString(recommendation.recommendation, "recommendation.recommendation");
  requireArray(recommendation.reasoning, "recommendation.reasoning");
  requireArray(recommendation.evidence, "recommendation.evidence");
  requireNumber(recommendation.confidence, "recommendation.confidence");
  asRecord(recommendation.risk, "recommendation.risk");
  asRecord(recommendation.expected_benefit, "recommendation.expected_benefit");
  requireArray(recommendation.assumptions, "recommendation.assumptions");
  requireArray(recommendation.alternatives, "recommendation.alternatives");
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationError(`${path} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw validationError(`${path} must be a valid number.`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw validationError(`${path} must be an array.`);
  }
  return value;
}
