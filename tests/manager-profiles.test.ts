import assert from "node:assert/strict";
import test from "node:test";
import { updateManagerProfiles } from "../src/intelligence/manager-profiles.js";
import type { LeagueSnapshot, Transaction } from "../src/models/types.js";

function snapshotWithTransactions(transactionsByTeam: Record<string, Transaction[]>): LeagueSnapshot {
  return {
    snapshot_id: "s",
    league: {
      league_id: "league-001",
      teams: Object.entries(transactionsByTeam).map(([teamId, transactions]) => ({
        team_id: teamId,
        manager_id: `mgr-${teamId}`,
        transaction_history: transactions
      }))
    } as never,
    managers: Object.keys(transactionsByTeam).map((teamId) => ({
      manager_id: `mgr-${teamId}`,
      league_id: "league-001",
      display_name: `Manager ${teamId}`,
      observed_behavior_profile: {}
    }))
  } as unknown as LeagueSnapshot;
}

test("updateManagerProfiles derives trade activity from transactions", () => {
  const snapshot = snapshotWithTransactions({
    "team-001": [
      { schema_version: "1.0.0", created_at: "x", updated_at: "x", source_system: "f", transaction_id: "t1", league_id: "l", type: "trade", team_ids: ["team-001"], player_ids: ["p1"], occurred_at: "x" },
      { schema_version: "1.0.0", created_at: "x", updated_at: "x", source_system: "f", transaction_id: "t2", league_id: "l", type: "add", team_ids: ["team-001"], player_ids: ["p2"], occurred_at: "x" }
    ],
    "team-002": []
  });

  const profiles = updateManagerProfiles(snapshot);
  const team1 = profiles.find((p) => p.manager_id === "mgr-team-001");
  assert.ok(team1);
  assert.equal(team1?.observed_behavior_profile.trades, 1);
  assert.equal(team1?.observed_behavior_profile.adds, 1);
  assert.equal(team1?.observed_behavior_profile.trade_activity, "moderate");
});
