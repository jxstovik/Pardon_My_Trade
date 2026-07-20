import type { LeagueSnapshot, PlayerPosition, Projection, Roster } from "../models/types.js";
import type { ProjectionCandidate } from "../projections/projection-source.js";
import type { ModelPosition, ModelPrior, PlayerModel } from "../probabilistic/bayesian-model.js";
import type {
  FreeAgentInput,
  OpponentInput,
  OrchestratorInput,
  RosterSlotInput
} from "./types.js";

export const MODEL_POSITIONS = new Set<ModelPosition>([
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DST",
  "FLEX"
]);

export const POSITION_BASELINE: Record<ModelPosition, number> = {
  QB: 16,
  RB: 11,
  WR: 10,
  TE: 7,
  K: 8,
  DST: 7,
  FLEX: 10
};

export const POSITION_VAR: Record<ModelPosition, number> = {
  QB: 25,
  RB: 16,
  WR: 16,
  TE: 9,
  K: 4,
  DST: 9,
  FLEX: 16
};

export function primaryModelPosition(positions: ReadonlyArray<PlayerPosition>): ModelPosition | undefined {
  for (const position of positions) {
    if (MODEL_POSITIONS.has(position as ModelPosition)) return position as ModelPosition;
  }
  return undefined;
}

/**
 * Build per-player priors from a snapshot. When the snapshot carries
 * projections, the projected points become the history mean (a reasonable
 * pre-season prior); otherwise a position baseline is used so the orchestrator
 * can still run offline.
 */
export function buildPriorsFromSnapshot(
  snapshot: LeagueSnapshot,
  options: { useProjections?: boolean } = {}
): ModelPrior[] {
  const useProjections = options.useProjections ?? true;
  const projectionByPlayer = new Map<string, number>();
  if (useProjections) {
    for (const projection of snapshot.projections) {
      projectionByPlayer.set(projection.player_id, projection.projected_points);
    }
  }

  const priors: ModelPrior[] = [];
  const seen = new Set<string>();
  for (const player of [...snapshot.players, ...snapshot.free_agents]) {
    if (seen.has(player.player_id)) continue;
    const position = primaryModelPosition(player.positions);
    if (!position) continue;
    seen.add(player.player_id);
    const historyMean = projectionByPlayer.get(player.player_id) ?? POSITION_BASELINE[position];
    priors.push({
      playerId: player.player_id,
      playerName: player.full_name,
      position,
      historyMean,
      historyVar: POSITION_VAR[position]
    });
  }
  return priors;
}

/**
 * Derive a runnable `OrchestratorInput` from a canonical snapshot for a given
 * team. Free-agent projected points come from the built models when available.
 */
export function buildOrchestratorInputFromSnapshot(
  snapshot: LeagueSnapshot,
  teamId: string,
  models: Map<string, PlayerModel>
): OrchestratorInput {
  const league = snapshot.league;
  const team = league.teams.find((t) => t.team_id === teamId) ?? league.teams[0];

  const rosterSlots: RosterSlotInput[] = [];
  for (const slot of [...team.roster.starters, ...team.roster.bench, ...team.roster.injured_reserve]) {
    if (!slot.player_id) continue;
    const position = primaryModelPosition([slot.slot_type]) ?? "BN";
    rosterSlots.push({ playerId: slot.player_id, slot: position });
  }

  const starterCounts = (league.roster_settings?.slots ?? []).map((slot) => ({
    slot: slot.slot,
    count: slot.count
  }));

  const freeAgents: FreeAgentInput[] = [];
  for (const player of snapshot.free_agents) {
    const position = primaryModelPosition(player.positions);
    if (!position) continue;
    const projectedPoints = models.get(player.player_id)?.mu ?? POSITION_BASELINE[position];
    freeAgents.push({ playerId: player.player_id, position, projectedPoints });
  }

  const opponents: OpponentInput[] = league.teams
    .filter((t) => t.team_id !== team.team_id)
    .map((t) => ({
      teamId: t.team_id,
      players: rosterPlayerPositions(t.roster)
    }));

  return {
    teamId: team.team_id,
    rosterSlots,
    starterCounts,
    freeAgents,
    opponents
  };
}

function rosterPlayerPositions(roster: Roster): Array<{ playerId: string; position: PlayerPosition }> {
  const result: Array<{ playerId: string; position: PlayerPosition }> = [];
  for (const slot of [...roster.starters, ...roster.bench, ...roster.injured_reserve]) {
    if (!slot.player_id) continue;
    const position = primaryModelPosition([slot.slot_type]);
    if (position) result.push({ playerId: slot.player_id, position });
  }
  return result;
}

/**
 * Best-effort merge of projection candidates (e.g. from `EspnProjectionSource`)
 * into a snapshot by matching player full name. Returns a new snapshot; the
 * original is not mutated. Used so imported ESPN leagues can seed model priors
 * with real projected points instead of position baselines.
 */
export function mergeProjectionCandidates(
  snapshot: LeagueSnapshot,
  candidates: ReadonlyArray<ProjectionCandidate>
): LeagueSnapshot {
  if (candidates.length === 0) return snapshot;

  const nameToId = new Map<string, string>();
  for (const player of [...snapshot.players, ...snapshot.free_agents]) {
    nameToId.set(normalizeName(player.full_name), player.player_id);
  }

  const existing = new Set(snapshot.projections.map((p) => p.player_id));
  const additions: Projection[] = [];
  for (const candidate of candidates) {
    const playerId = nameToId.get(normalizeName(candidate.name));
    if (!playerId || existing.has(playerId)) continue;
    existing.add(playerId);
    additions.push({
      schema_version: "1.0.0",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_system: "espn",
      source_record_id: `proj-${playerId}`,
      projection_id: `proj-${playerId}`,
      player_id: playerId,
      source: "espn",
      scoring_period: snapshot.league.season,
      projected_stats: candidate.projected_stats,
      projected_points: candidate.projected_points,
      floor: candidate.floor,
      ceiling: candidate.ceiling,
      confidence: candidate.confidence
    });
  }

  if (additions.length === 0) return snapshot;
  return {
    ...snapshot,
    projections: [...snapshot.projections, ...additions]
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
