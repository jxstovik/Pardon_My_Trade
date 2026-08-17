import type { Player, Projection } from "../models/types.js";
import type { ProjectionCandidate } from "./projection-source.js";

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function buildLookup(players: Player[]): Map<string, Player[]> {
  const byName = new Map<string, Player[]>();
  for (const player of players) {
    const key = normalizeName(player.full_name);
    const list = byName.get(key) ?? [];
    list.push(player);
    byName.set(key, list);
  }
  return byName;
}

function teamMatches(candidate: ProjectionCandidate, player: Player): boolean {
  if (!candidate.team) return true;
  return player.team.toUpperCase() === candidate.team.toUpperCase();
}

export function matchProjectionsToRoster(
  candidates: ProjectionCandidate[],
  players: Player[],
  scoringPeriod: string,
  source: string
): Projection[] {
  const lookup = buildLookup(players);
  const matched: Projection[] = [];

  for (const candidate of candidates) {
    const candidates2 = lookup.get(normalizeName(candidate.name));
    if (!candidates2 || candidates2.length === 0) continue;

    const teamMatchesFound = candidates2.filter((p) => teamMatches(candidate, p));
    if (teamMatchesFound.length !== 1) continue;
    const player = teamMatchesFound[0];
    matched.push({
      schema_version: "1.0.0",
      created_at: "",
      updated_at: "",
      source_system: source,
      source_record_id: `${source}-${player.player_id}`,
      projection_id: `${source}-${player.player_id}-${scoringPeriod}`,
      player_id: player.player_id,
      source,
      scoring_period: scoringPeriod,
      projected_stats: candidate.projected_stats,
      projected_points: candidate.projected_points,
      floor: candidate.floor,
      ceiling: candidate.ceiling,
      confidence: candidate.confidence
    });
  }

  return matched;
}
