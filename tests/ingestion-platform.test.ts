import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshotFromPlatform } from "../src/knowledge/ingestion.js";
import type { LeagueSnapshot } from "../src/models/types.js";
import type { PlatformReader } from "../src/adapters/platform-reader.js";

function fakeReader(overrides: Partial<PlatformReader> = {}): PlatformReader {
  const league = {
    schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "sleeper",
    league_id: "league-001", external_id: "sl-123", platform: "sleeper", sport: "football",
    season: "2026", name: "My Sleeper League",
    teams: [{
      team_id: "team-001", external_id: "1", league_id: "league-001", manager_id: "m1", name: "Me",
      roster: {
        team_id: "team-001",
        starters: [{ slot_id: "s1", slot_type: "QB", allowed_positions: ["QB"], locked: false, player_id: "p-qb" }],
        bench: [], injured_reserve: [], taxi: [], last_updated_at: ""
      },
      standings: { wins: 1, losses: 0, ties: 0, points_for: 100, points_against: 90, rank: 1 },
      transaction_history: []
    }],
    roster_settings: { slots: [], bench_count: 0, injured_reserve_count: 0, taxi_count: 0 },
    scoring_settings: { scoring_type: "ppr", rules: [] },
    waiver_settings: { type: "faab" },
    trade_settings: { enabled: true, review_type: "league_vote" },
    schedule: [],
    import_metadata: { imported_at: "", source: "sleeper", adapter_version: "0.1.0" }
  } as unknown as LeagueSnapshot["league"];

  const players = [
    { schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "sleeper", source_record_id: "p-qb", player_id: "p-qb", external_id: "p-qb", sport: "football", full_name: "QB One", team: "CHI", positions: ["QB"], status: "active", injury_status: "active", eligibility: { eligible_slots: ["QB"], injured_reserve_eligible: false, taxi_eligible: false }, external_ids: {} },
    { schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "sleeper", source_record_id: "p-rb", player_id: "p-rb", external_id: "p-rb", sport: "football", full_name: "RB Two", team: "DET", positions: ["RB"], status: "active", injury_status: "active", eligibility: { eligible_slots: ["RB"], injured_reserve_eligible: false, taxi_eligible: false }, external_ids: {} }
  ];

  return {
    getLeague: async () => league,
    getTeams: async () => league.teams,
    getRoster: async () => league.teams[0].roster,
    getScoringSettings: async () => league.scoring_settings,
    getRosterSettings: async () => league.roster_settings,
    getStandings: async () => league.teams.map((t) => t.standings),
    getSchedule: async () => [],
    getPlayers: async () => players,
    getFreeAgents: async () => [players[1]],
    getWaiverState: async () => ({ schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "sleeper", source_record_id: "w", league_id: "league-001", waiver_order: ["team-001"], faab_budgets: {} }),
    getTransactions: async () => [],
    ...overrides
  } as unknown as PlatformReader;
}

test("buildSnapshotFromPlatform assembles a canonical snapshot from a reader", async () => {
  const snapshot = await buildSnapshotFromPlatform(fakeReader(), "sl-123", "2026", {
    clock: () => new Date("2026-09-10T00:00:00Z")
  });

  assert.equal(snapshot.league.league_id, "league-001");
  assert.equal(snapshot.managers.length, 1);
  assert.equal(snapshot.managers[0].display_name, "Me");
  // Roster player p-qb kept; free agent p-rb also included via freeIds.
  assert.ok(snapshot.players.some((p) => p.player_id === "p-qb"));
  assert.ok(snapshot.players.some((p) => p.player_id === "p-rb"));
  assert.equal(snapshot.free_agents.length, 1);
  assert.equal(snapshot.projections.length, 0);
  assert.equal(snapshot.news.length, 0);
  assert.ok(snapshot.snapshot_id.startsWith("sleeper-sl-123-"));
});

test("buildSnapshotFromPlatform accepts supplied projections and news", async () => {
  const projection = { schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "f", source_record_id: "x", projection_id: "px", player_id: "p-qb", source: "f", scoring_period: "W1", projected_stats: {}, projected_points: 18, floor: 10, ceiling: 25, confidence: 0.7 };
  const news = { schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "f", source_record_id: "n", news_id: "n", player_id: "p-qb", source: "f", headline: "h", summary: "s", impact: "medium", published_at: "2026-09-10T00:00:00Z", ingested_at: "" };

  const snapshot = await buildSnapshotFromPlatform(fakeReader(), "sl-123", "2026", {
    projections: [projection as never],
    news: [news as never],
    snapshotId: "fixed-id"
  });

  assert.equal(snapshot.snapshot_id, "fixed-id");
  assert.equal(snapshot.projections.length, 1);
  assert.equal(snapshot.news.length, 1);
});
