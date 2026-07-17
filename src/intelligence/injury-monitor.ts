import type { LeagueSnapshot, Player, Recommendation } from "../models/types.js";

const ALERT_STATUSES: Player["status"][] = ["out", "injured_reserve", "doubtful"];

export function detectInjuryChanges(
  before: Player[],
  after: Player[],
  clock: () => Date = () => new Date()
): Recommendation[] {
  const beforeById = new Map(before.map((player) => [player.player_id, player]));
  const alerts: Recommendation[] = [];
  const now = clock().toISOString();

  for (const current of after) {
    const previous = beforeById.get(current.player_id);
    if (!previous) continue;
    if (ALERT_STATUSES.includes(current.status) && current.status !== previous.status) {
      alerts.push(buildInjuryAlert(current, previous, now));
    }
  }

  return alerts;
}

function buildInjuryAlert(current: Player, previous: Player, now: string): Recommendation {
  return {
    schema_version: "1.0.0",
    created_at: now,
    updated_at: now,
    source_system: "injury-monitor",
    recommendation_id: `alert-injury-${current.player_id}-${now}`,
    league_id: "",
    team_id: "",
    type: "alert",
    title: `Injury status change: ${current.full_name}`,
    recommendation: `${current.full_name} changed from ${previous.status} to ${current.status}. Review lineup and waiver options.`,
    reasoning: [
      `Previous status: ${previous.status}.`,
      `Current status: ${current.status}.`,
      `Player team: ${current.team}.`
    ],
    evidence: [{
      evidence_id: `ev-injury-${current.player_id}`,
      source: "knowledge-base",
      source_type: "player-status",
      observed_at: now,
      claim: `status changed to ${current.status}`,
      value: current.status,
      confidence: 0.9
    }],
    confidence: 0.9,
    risk: { level: "high", factors: [`${current.full_name} availability uncertain.`] },
    expected_benefit: { metric: "roster_health", value: 0, range: [0, 0] },
    assumptions: ["Status change reflects the latest ingested snapshot."],
    alternatives: ["Check official injury report before locking lineup."],
    generated_at: now,
    expiration: new Date(Date.now() + 86_400_000).toISOString(),
    status: "ready"
  };
}

export function currentInjuryWatch(snapshot: LeagueSnapshot): Player[] {
  return [...snapshot.players, ...snapshot.free_agents].filter((player) =>
    ALERT_STATUSES.includes(player.status) || player.injury_status === "questionable"
  );
}
