import type { LeagueSnapshot, Player, Projection, Team } from "../src/models/types.js";

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makePlayer(opts: Partial<Player> & { full_name: string; player_id?: string }): Player {
  return {
    schema_version: "1.0.0",
    created_at: "",
    updated_at: "",
    source_system: "test",
    source_record_id: opts.player_id ?? uid("p"),
    player_id: opts.player_id ?? uid("p"),
    external_id: opts.external_id ?? "ext",
    sport: "football",
    full_name: opts.full_name,
    team: opts.team ?? "FA",
    positions: opts.positions ?? ["RB"],
    status: opts.status ?? "active",
    injury_status: opts.injury_status ?? "active",
    eligibility: opts.eligibility ?? { eligible_slots: ["RB"], injured_reserve_eligible: false, taxi_eligible: false },
    external_ids: opts.external_ids ?? {}
  };
}

export function makeSnapshot(players: Player[], opts: { season?: string; snapshotId?: string } = {}): LeagueSnapshot {
  const team: Team = {
    schema_version: "1.0.0",
    created_at: "",
    updated_at: "",
    source_system: "test",
    source_record_id: "team-001",
    team_id: "team-001",
    external_id: "team-001",
    league_id: "lg-1",
    manager_id: "mgr-1",
    name: "Test Team",
    roster: {
      team_id: "team-001",
      starters: players.map((p, i) => ({
        slot_id: `s${i}`,
        slot_type: p.positions[0],
        allowed_positions: p.positions,
        locked: false,
        player_id: p.player_id
      })),
      bench: [],
      injured_reserve: [],
      taxi: [],
      last_updated_at: ""
    },
    standings: { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0, rank: 1 },
    transaction_history: []
  };

  return {
    snapshot_id: opts.snapshotId ?? uid("snap"),
    league: {
      schema_version: "1.0.0",
      created_at: "",
      updated_at: "",
      source_system: "test",
      source_record_id: "lg-1",
      league_id: "lg-1",
      external_id: "lg-1",
      platform: "fixture",
      sport: "football",
      season: opts.season ?? "2026",
      name: "Test League",
      teams: [team],
      roster_settings: { slots: [{ slot: "RB", count: 1, positions: ["RB"] }], bench_count: 5, injured_reserve_count: 1, taxi_count: 0 },
      scoring_settings: { scoring_type: "ppr", rules: [] },
      waiver_settings: { type: "faab", budget: 100 },
      trade_settings: { enabled: true, review_type: "league_vote" },
      schedule: [],
      import_metadata: { imported_at: "", source: "fixture", adapter_version: "0.0.1" }
    },
    managers: [],
    players,
    free_agents: [],
    waiver_state: {
      schema_version: "1.0.0",
      created_at: "",
      updated_at: "",
      source_system: "test",
      source_record_id: "lg-1",
      league_id: "lg-1",
      waiver_order: [],
      faab_budgets: {}
    },
    projections: [],
    news: []
  };
}

export function makeProjection(opts: Partial<Projection> & { player_id: string; source: string; scoring_period: string }): Projection {
  return {
    schema_version: "1.0.0",
    created_at: "",
    updated_at: "",
    source_system: opts.source,
    source_record_id: `${opts.source}-${opts.player_id}`,
    projection_id: `${opts.source}-${opts.player_id}-${opts.scoring_period}`,
    player_id: opts.player_id,
    source: opts.source,
    scoring_period: opts.scoring_period,
    projected_stats: opts.projected_stats ?? {},
    projected_points: opts.projected_points ?? 100,
    floor: opts.floor ?? 70,
    ceiling: opts.ceiling ?? 130,
    confidence: opts.confidence ?? 0.7
  };
}
