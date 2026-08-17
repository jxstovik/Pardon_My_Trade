import type { LeagueSnapshot, Transaction } from "../models/types.js";
import type { ManagerProfileRecord } from "../models/v1.js";

export function updateManagerProfiles(snapshot: LeagueSnapshot, clock: () => Date = () => new Date()): ManagerProfileRecord[] {
  const now = clock().toISOString();
  const profiles: ManagerProfileRecord[] = [];

  for (const manager of snapshot.managers) {
    const team = snapshot.league.teams.find((candidate) => candidate.manager_id === manager.manager_id);
    const transactions: Transaction[] = team?.transaction_history ?? [];

    const adds = transactions.filter((transaction) => transaction.type === "add" || transaction.type === "waiver").length;
    const drops = transactions.filter((transaction) => transaction.type === "drop").length;
    const trades = transactions.filter((transaction) => transaction.type === "trade").length;

    const aggression = trades + adds + drops;
    const tradeActivity: "low" | "moderate" | "high" =
      trades >= 3 ? "high" : trades >= 1 ? "moderate" : "low";

    profiles.push({
      league_id: snapshot.league.league_id,
      manager_id: manager.manager_id,
      display_name: manager.display_name,
      observed_behavior_profile: {
        ...manager.observed_behavior_profile,
        adds,
        drops,
        trades,
        aggression,
        trade_activity: tradeActivity
      },
      updated_at: now
    });
  }

  return profiles;
}
