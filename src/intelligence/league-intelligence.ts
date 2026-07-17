import type { LeagueSnapshot, Projection } from "../models/types.js";

export interface LeagueInsight {
  readonly leagueId: string;
  readonly scoringPeriod: string;
  readonly standings: Array<{ teamId: string; name: string; rank: number; pointsFor: number; wins: number; losses: number }>;
  readonly projectedLeaders: Array<{ teamId: string; name: string; projectedPoints: number }>;
  readonly waiverTargets: string[];
  readonly notes: string[];
}

export function analyzeLeague(snapshot: LeagueSnapshot, projections: Projection[]): LeagueInsight {
  const projectionByPlayer = new Map(projections.map((projection) => [projection.player_id, projection]));

  const standings = snapshot.league.teams
    .map((team) => ({
      teamId: team.team_id,
      name: team.name,
      rank: team.standings.rank,
      pointsFor: team.standings.points_for,
      wins: team.standings.wins,
      losses: team.standings.losses
    }))
    .sort((a, b) => b.pointsFor - a.pointsFor);

  const projectedLeaders = snapshot.league.teams
    .map((team) => {
      const points = team.roster.starters
        .map((slot) => (slot.player_id ? projectionByPlayer.get(slot.player_id)?.projected_points ?? 0 : 0))
        .reduce((sum, value) => sum + value, 0);
      return { teamId: team.team_id, name: team.name, projectedPoints: Math.round(points * 100) / 100 };
    })
    .sort((a, b) => b.projectedPoints - a.projectedPoints);

  const waiverTargets = snapshot.free_agents
    .map((player) => ({ player, points: projectionByPlayer.get(player.player_id)?.projected_points ?? 0 }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((entry) => entry.player.player_id);

  const notes: string[] = [];
  if (snapshot.news.length > 0) {
    notes.push(`${snapshot.news.length} active news item(s) may affect decisions.`);
  }
  if (standings.length > 0 && standings[0].pointsFor === 0) {
    notes.push("League has not yet scored; insights are preseason projections.");
  }

  return {
    leagueId: snapshot.league.league_id,
    scoringPeriod: snapshot.league.season,
    standings,
    projectedLeaders,
    waiverTargets,
    notes
  };
}
