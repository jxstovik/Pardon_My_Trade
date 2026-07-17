import { PmtError } from "../../errors.js";
import type {
  League,
  Matchup,
  Player,
  PlayerPosition,
  Roster,
  RosterSettings,
  RosterSlot,
  ScoringSettings,
  Standings,
  Team,
  Transaction,
  WaiverState
} from "../../models/types.js";
import type { PlatformReader } from "../platform-reader.js";

export interface SleeperPlatformReaderOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

interface SleeperLeagueResponse {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  status: string;
  total_rosters: number;
  roster_positions: string[];
  settings: Record<string, unknown>;
  scoring_settings: Record<string, number>;
}

interface SleeperRosterResponse {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: { wins: number; losses: number; ties: number; fpts: number; fpts_against: number };
}

interface SleeperUserResponse {
  user_id: string;
  display_name: string;
  team_name?: string;
  metadata?: Record<string, unknown>;
}

interface SleeperMatchupResponse {
  roster_id: number;
  matchup_id: number;
  points: number;
  opponents: number[];
}

interface SleeperTransactionResponse {
  transaction_id: string;
  type: string;
  roster_ids: number[];
  adds?: Record<string, number>;
  drops?: Record<string, number>;
  created: string;
}

const POSITION_MAP: Record<string, PlayerPosition> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DST",
  FLEX: "FLEX",
  SUPER_FLEX: "SUPER_FLEX",
  BN: "BN",
  IR: "IR",
  TAXI: "BN"
};

export class SleeperPlatformReader implements PlatformReader {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private cache = new Map<string, unknown>();

  constructor(options: SleeperPlatformReaderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? "https://api.sleeper.app/v1";
  }

  async getLeague(leagueExternalId: string, season: string): Promise<League> {
    const data = await this.getJson<SleeperLeagueResponse>(`${this.baseUrl}/league/${leagueExternalId}`);
    if (data.season !== season) {
      throw new PmtError({
        code: "SLEEPER_LEAGUE_NOT_FOUND",
        message: `Sleeper league ${leagueExternalId} for season ${season} was not found.`,
        source: "sleeper_adapter",
        retryable: false
      });
    }

    const now = new Date().toISOString();
    const teams = await this.getTeams(leagueExternalId);
    const rosterSettings = this.mapRosterSettings(data);

    return {
      schema_version: "1.0.0",
      created_at: now,
      updated_at: now,
      source_system: "sleeper",
      source_record_id: data.league_id,
      league_id: data.league_id,
      external_id: data.league_id,
      platform: "sleeper",
      sport: "football",
      season: data.season,
      name: data.name,
      teams,
      roster_settings: rosterSettings,
      scoring_settings: this.mapScoringSettings(data),
      waiver_settings: { type: "rolling" },
      trade_settings: { enabled: true, review_type: "league_vote" },
      schedule: [],
      import_metadata: {
        imported_at: now,
        source: "sleeper",
        adapter_version: "0.1.0"
      }
    };
  }

  async getTeams(leagueExternalId: string): Promise<Team[]> {
    const rosters = await this.getJson<SleeperRosterResponse[]>(`${this.baseUrl}/league/${leagueExternalId}/rosters`);
    const users = await this.getJson<SleeperUserResponse[]>(`${this.baseUrl}/league/${leagueExternalId}/users`);
    const now = new Date().toISOString();

    return rosters.map((roster) => {
      const user = users.find((u) => u.user_id === roster.owner_id);
      const managerId = roster.owner_id;
      return {
        schema_version: "1.0.0",
        created_at: now,
        updated_at: now,
        source_system: "sleeper",
        source_record_id: String(roster.roster_id),
        team_id: `team-${roster.roster_id}`,
        external_id: String(roster.roster_id),
        league_id: leagueExternalId,
        manager_id: managerId,
        name: user?.team_name ?? user?.display_name ?? `Team ${roster.roster_id}`,
        roster: this.mapRoster(leagueExternalId, roster, `${roster.roster_id}`),
        standings: this.mapStandings(roster),
        transaction_history: []
      };
    });
  }

  async getRoster(leagueExternalId: string, teamExternalId: string): Promise<Roster> {
    const rosters = await this.getJson<SleeperRosterResponse[]>(`${this.baseUrl}/league/${leagueExternalId}/rosters`);
    const roster = rosters.find((r) => String(r.roster_id) === teamExternalId);
    if (!roster) {
      throw new PmtError({
        code: "SLEEPER_TEAM_NOT_FOUND",
        message: `Sleeper roster ${teamExternalId} was not found.`,
        source: "sleeper_adapter",
        retryable: false
      });
    }
    return this.mapRoster(leagueExternalId, roster, teamExternalId);
  }

  async getScoringSettings(leagueExternalId: string): Promise<ScoringSettings> {
    const data = await this.getJson<SleeperLeagueResponse>(`${this.baseUrl}/league/${leagueExternalId}`);
    return this.mapScoringSettings(data);
  }

  async getRosterSettings(leagueExternalId: string): Promise<RosterSettings> {
    const data = await this.getJson<SleeperLeagueResponse>(`${this.baseUrl}/league/${leagueExternalId}`);
    return this.mapRosterSettings(data);
  }

  async getStandings(leagueExternalId: string): Promise<Standings[]> {
    const rosters = await this.getJson<SleeperRosterResponse[]>(`${this.baseUrl}/league/${leagueExternalId}/rosters`);
    return rosters.map((roster) => this.mapStandings(roster));
  }

  async getSchedule(leagueExternalId: string): Promise<Matchup[]> {
    const league = await this.getJson<SleeperLeagueResponse>(`${this.baseUrl}/league/${leagueExternalId}`);
    const week = typeof league.settings.leg === "number" ? league.settings.leg : 1;
    const matchups = await this.getJson<SleeperMatchupResponse[]>(`${this.baseUrl}/league/${leagueExternalId}/matchups/${week}`);
    const now = new Date().toISOString();

    return matchups.map((matchup) => ({
      schema_version: "1.0.0",
      created_at: now,
      updated_at: now,
      source_system: "sleeper",
      source_record_id: String(matchup.matchup_id),
      matchup_id: String(matchup.matchup_id),
      league_id: leagueExternalId,
      scoring_period: `${leagueExternalId}-W${week}`,
      team_id: `team-${matchup.roster_id}`,
      opponent_team_id: matchup.opponents.length > 0 ? `team-${matchup.opponents[0]}` : "unknown",
      actual_points_for: matchup.points
    }));
  }

  async getPlayers(sport: string, season: string): Promise<Player[]> {
    if (sport !== "football") return [];
    const data = await this.getJson<Record<string, SleeperPlayerResponse>>(`${this.baseUrl}/players/nfl`);
    const now = new Date().toISOString();
    const players: Player[] = [];

    for (const [playerId, player] of Object.entries(data)) {
      if (player.status === "离开了" || player.status === "cut" || !player.position) continue;
      players.push({
        schema_version: "1.0.0",
        created_at: now,
        updated_at: now,
        source_system: "sleeper",
        source_record_id: playerId,
        player_id: playerId,
        external_id: playerId,
        sport: "football",
        full_name: player.full_name,
        team: player.team ?? "FA",
        positions: [this.mapPosition(player.position)],
        status: this.mapStatus(player.status),
        injury_status: this.mapStatus(player.injury_status),
        eligibility: {
          eligible_slots: (player.fantasy_positions ?? [player.position]).map((p) => this.mapPosition(p)),
          injured_reserve_eligible: false,
          taxi_eligible: false
        },
        external_ids: { sleeper: playerId }
      });
    }
    return players;
  }

  async getFreeAgents(leagueExternalId: string): Promise<Player[]> {
    const rosters = await this.getJson<SleeperRosterResponse[]>(`${this.baseUrl}/league/${leagueExternalId}/rosters`);
    const owned = new Set(rosters.flatMap((r) => r.players ?? []));
    const allPlayers = await this.getPlayers("football", "");
    return allPlayers.filter((player) => !owned.has(player.player_id));
  }

  async getWaiverState(leagueExternalId: string): Promise<WaiverState> {
    const rosters = await this.getJson<SleeperRosterResponse[]>(`${this.baseUrl}/league/${leagueExternalId}/rosters`);
    const now = new Date().toISOString();
    return {
      schema_version: "1.0.0",
      created_at: now,
      updated_at: now,
      source_system: "sleeper",
      source_record_id: `${leagueExternalId}-waiver`,
      league_id: leagueExternalId,
      waiver_order: rosters.map((r) => `team-${r.roster_id}`),
      faab_budgets: {}
    };
  }

  async getTransactions(leagueExternalId: string, since?: string): Promise<Transaction[]> {
    const league = await this.getJson<SleeperLeagueResponse>(`${this.baseUrl}/league/${leagueExternalId}`);
    const week = typeof league.settings.leg === "number" ? league.settings.leg : 1;
    const transactions = await this.getJson<SleeperTransactionResponse[]>(`${this.baseUrl}/league/${leagueExternalId}/transactions/${week}`);

    const mapped = transactions.map((transaction) => ({
      schema_version: "1.0.0",
      created_at: transaction.created,
      updated_at: transaction.created,
      source_system: "sleeper",
      source_record_id: transaction.transaction_id,
      transaction_id: transaction.transaction_id,
      league_id: leagueExternalId,
      type: this.mapTransactionType(transaction.type),
      team_ids: transaction.roster_ids.map((id) => `team-${id}`),
      player_ids: [...Object.keys(transaction.adds ?? {}), ...Object.keys(transaction.drops ?? {})],
      occurred_at: transaction.created
    }));

    if (!since) return mapped;
    return mapped.filter((transaction) => transaction.occurred_at >= since);
  }

  private mapRoster(leagueExternalId: string, roster: SleeperRosterResponse, teamExternalId: string): Roster {
    const now = new Date().toISOString();
    const starters = (roster.starters ?? []).map((playerId, index) => ({
      slot_id: `${teamExternalId}-ST-${index}`,
      slot_type: "FLEX" as PlayerPosition,
      allowed_positions: ["QB", "RB", "WR", "TE", "K", "DST", "FLEX"] as PlayerPosition[],
      locked: false,
      player_id: playerId
    }));
    const starterSet = new Set(roster.starters ?? []);
    const benchPlayers = (roster.players ?? []).filter((playerId) => !starterSet.has(playerId));
    const bench: RosterSlot[] = benchPlayers.map((playerId, index) => ({
      slot_id: `${teamExternalId}-BN-${index}`,
      slot_type: "BN",
      allowed_positions: ["QB", "RB", "WR", "TE", "K", "DST"],
      locked: false,
      player_id: playerId
    }));
    const injuredReserve: RosterSlot[] = (roster.reserve ?? []).map((playerId, index) => ({
      slot_id: `${teamExternalId}-IR-${index}`,
      slot_type: "IR",
      allowed_positions: ["QB", "RB", "WR", "TE"],
      locked: false,
      player_id: playerId
    }));

    return {
      team_id: `team-${roster.roster_id}`,
      starters,
      bench,
      injured_reserve: injuredReserve,
      taxi: [],
      last_updated_at: now
    };
  }

  private mapStandings(roster: SleeperRosterResponse): Standings {
    return {
      wins: roster.settings.wins ?? 0,
      losses: roster.settings.losses ?? 0,
      ties: roster.settings.ties ?? 0,
      points_for: roster.settings.fpts ?? 0,
      points_against: roster.settings.fpts_against ?? 0,
      rank: 0
    };
  }

  private mapRosterSettings(league: SleeperLeagueResponse): RosterSettings {
    const slots = (league.roster_positions ?? []).filter((position) => position !== "TAXI" && position !== "IR");
    const counts = new Map<string, number>();
    for (const position of league.roster_positions ?? []) {
      counts.set(position, (counts.get(position) ?? 0) + 1);
    }
    return {
      slots: slots.map((position) => ({
        slot: this.mapPosition(position),
        count: counts.get(position) ?? 1,
        positions: [this.mapPosition(position)]
      })),
      bench_count: counts.get("BN") ?? 0,
      injured_reserve_count: counts.get("IR") ?? 0,
      taxi_count: counts.get("TAXI") ?? 0
    };
  }

  private mapScoringSettings(league: SleeperLeagueResponse): ScoringSettings {
    const rules: ScoringSettings["rules"] = [];
    const mapping: Array<[string, string, PlayerPosition[]]> = [
      ["pass_yd", "passing_yards", ["QB"]],
      ["pass_td", "passing_touchdowns", ["QB"]],
      ["pass_int", "interceptions", ["QB"]],
      ["rush_yd", "rushing_yards", ["QB", "RB", "WR", "TE"]],
      ["rush_td", "rushing_touchdowns", ["QB", "RB", "WR", "TE"]],
      ["rec", "receptions", ["RB", "WR", "TE"]],
      ["rec_yd", "receiving_yards", ["RB", "WR", "TE"]],
      ["rec_td", "receiving_touchdowns", ["RB", "WR", "TE"]]
    ];
    for (const [sleeperKey, stat, positions] of mapping) {
      const points = league.scoring_settings[sleeperKey];
      if (points === undefined) continue;
      rules.push({
        rule_id: `sleeper-${sleeperKey}`,
        category: stat.split("_")[0],
        stat,
        points,
        conditions: {},
        applies_to_positions: positions
      });
    }
    return {
      scoring_type: "custom",
      rules
    };
  }

  private mapPosition(position: string): PlayerPosition {
    return POSITION_MAP[position] ?? ("BN" as PlayerPosition);
  }

  private mapStatus(status: string | undefined): Player["status"] {
    if (!status) return "unknown";
    const normalized = status.toLowerCase();
    if (normalized.includes("out")) return "out";
    if (normalized.includes("questionable")) return "questionable";
    if (normalized.includes("doubtful")) return "doubtful";
    if (normalized.includes("ir") || normalized.includes("injured_reserve")) return "injured_reserve";
    if (normalized.includes("bye")) return "bye";
    if (normalized.includes("suspended")) return "suspended";
    if (normalized === "active") return "active";
    return "unknown";
  }

  private mapTransactionType(type: string): Transaction["type"] {
    switch (type) {
      case "waiver":
        return "waiver";
      case "trade":
        return "trade";
      case "free_agent":
        return "add";
      case "commissioner":
        return "commissioner";
      default:
        return "add";
    }
  }

  private async getJson<T>(url: string): Promise<T> {
    const cached = this.cache.get(url);
    if (cached) return cached as T;

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new PmtError({
        code: "SLEEPER_REQUEST_FAILED",
        message: `Sleeper request to ${url} failed with status ${response.status}.`,
        source: "sleeper_adapter",
        retryable: response.status >= 500
      });
    }
    const parsed = (await response.json()) as T;
    this.cache.set(url, parsed);
    return parsed;
  }
}

interface SleeperPlayerResponse {
  player_id: string;
  full_name: string;
  position: string;
  team?: string;
  status?: string;
  injury_status?: string;
  fantasy_positions?: string[];
}
