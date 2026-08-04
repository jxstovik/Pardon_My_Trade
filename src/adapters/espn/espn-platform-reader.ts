import { PmtError } from "../../errors.js";
import type {
  League,
  Matchup,
  Player,
  PlayerPosition,
  PlayerStatus,
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
import { EspnPlatformClient } from "./espn-platform-client.js";
import {
  loadEspnCredentials,
  mapEspnSlotToPosition,
  mapPositionToEspnSlot,
  type EspnCredentials,
  type EspnSlotAssignment
} from "./espn-auth.js";

export interface EspnPlatformReaderOptions {
  readonly credentials?: EspnCredentials;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

interface EspnLeagueResponse {
  id?: number;
  name?: string;
  seasonId?: number;
  status?: { type?: number; shortName?: string };
  settings?: {
    rosterPositions?: string[];
    rosterSize?: number;
    waiverSettings?: Record<string, unknown>;
    tradeReview?: { type?: number };
  };
  members?: Array<{ id: string; displayName: string; firstName?: string; lastName?: string }>;
  teams?: EspnTeam[];
  players?: EspnPlayer[];
  schedule?: EspnMatchup[];
  scoringSettings?: Record<string, number>;
}

interface EspnTeam {
  id: number;
  location?: string;
  nickname?: string;
  abbrev?: string;
  values?: Record<string, number>;
  record?: {
    overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number };
  };
  roster?: {
    entries?: Array<{ playerId: number; lineuSlotId: number; status?: string; injuryStatus?: string }>;
    lineupSlotCounts?: Record<string, number>;
  };
  waiverRank?: number;
}

interface EspnPlayer {
  id: number;
  firstName?: string;
  lastName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  injured?: boolean;
  injuryStatus?: string;
  onTeamId?: number;
  percentOwned?: number;
}

interface EspnMatchup {
  id: number;
  homeTeamId?: number;
  awayTeamId?: number;
  homePoints?: number;
  awayPoints?: number;
  matchupPeriodId?: number;
}

const ESPN_POSITION_ID: Record<number, PlayerPosition> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  6: "DST"
};

const DEFAULT_LEAGUE_VIEWS = ["mTeam", "mRoster", "mMatchup", "mStandings", "mSettings", "mPlayer"];

export class EspnPlatformReader implements PlatformReader {
  readonly client: EspnPlatformClient;
  private leagueCache: EspnLeagueResponse | null = null;

  constructor(options: EspnPlatformReaderOptions = {}) {
    const credentials = options.credentials ?? loadEspnCredentials();
    this.client = new EspnPlatformClient({
      credentials,
      fetchImpl: options.fetchImpl,
      baseUrl: options.baseUrl
    });
  }

  private async getLeagueRaw(): Promise<EspnLeagueResponse> {
    if (this.leagueCache) return this.leagueCache;
    const data = await this.client.getJson<EspnLeagueResponse>("", DEFAULT_LEAGUE_VIEWS);
    this.leagueCache = data;
    return data;
  }

  async getLeague(_leagueExternalId: string, season: string): Promise<League> {
    const data = await this.getLeagueRaw();
    const now = new Date().toISOString();
    const teams = await this.getTeams(_leagueExternalId);
    return {
      schema_version: "1.0.0",
      created_at: now,
      updated_at: now,
      source_system: "espn",
      source_record_id: String(data.id ?? this.client.credentials.leagueId),
      league_id: String(data.id ?? this.client.credentials.leagueId),
      external_id: String(data.id ?? this.client.credentials.leagueId),
      platform: "espn",
      sport: "football",
      season: data.seasonId?.toString() ?? season,
      name: data.name ?? "ESPN League",
      teams,
      roster_settings: await this.getRosterSettings(_leagueExternalId),
      scoring_settings: await this.getScoringSettings(_leagueExternalId),
      waiver_settings: this.mapWaiverSettings(data),
      trade_settings: this.mapTradeSettings(data),
      schedule: await this.getSchedule(_leagueExternalId),
      import_metadata: {
        imported_at: now,
        source: "espn",
        adapter_version: "0.1.0"
      }
    };
  }

  async getTeams(_leagueExternalId: string): Promise<Team[]> {
    const data = await this.getLeagueRaw();
    const now = new Date().toISOString();
    const members = new Map((data.members ?? []).map((m) => [m.id, m.displayName]));
    const players = data.players ?? [];

    return (data.teams ?? []).map((team) => {
      const managerName = members.get(String(team.id)) ?? team.nickname ?? `Team ${team.id}`;
      return {
        schema_version: "1.0.0",
        created_at: now,
        updated_at: now,
        source_system: "espn",
        source_record_id: String(team.id),
        team_id: String(team.id),
        external_id: String(team.id),
        league_id: String(data.id ?? this.client.credentials.leagueId),
        manager_id: String(team.id),
        name: team.nickname ?? managerName,
        roster: this.mapRoster(String(team.id), team, players),
        standings: this.mapStandings(team),
        transaction_history: []
      };
    });
  }

  async getRoster(leagueExternalId: string, teamExternalId: string): Promise<Roster> {
    const data = await this.getLeagueRaw();
    const team = (data.teams ?? []).find((t) => String(t.id) === teamExternalId);
    if (!team) {
      throw new PmtError({
        code: "ESPN_TEAM_NOT_FOUND",
        message: `ESPN team ${teamExternalId} was not found.`,
        source: "platform_adapter",
        retryable: false
      });
    }
    return this.mapRoster(teamExternalId, team, data.players ?? []);
  }

  async getScoringSettings(_leagueExternalId: string): Promise<ScoringSettings> {
    const data = await this.getLeagueRaw();
    const raw = data.scoringSettings ?? {};
    const rules: ScoringSettings["rules"] = [];
    const mapping: Array<[string, string, PlayerPosition[], number]> = [
      ["passYd", "passing_yards", ["QB"], 0.04],
      ["passTd", "passing_touchdowns", ["QB"], 4],
      ["passInt", "interceptions", ["QB"], -2],
      ["rushYd", "rushing_yards", ["QB", "RB", "WR", "TE"], 0.1],
      ["rushTd", "rushing_touchdowns", ["QB", "RB", "WR", "TE"], 6],
      ["rec", "receptions", ["RB", "WR", "TE"], 1],
      ["recYd", "receiving_yards", ["RB", "WR", "TE"], 0.1],
      ["recTd", "receiving_touchdowns", ["RB", "WR", "TE"], 6],
      ["fum", "fumbles", ["QB", "RB", "WR", "TE"], -2]
    ];
    for (const [key, stat, positions, fallback] of mapping) {
      const points = raw[key];
      if (typeof points === "number") {
        rules.push({
          rule_id: `espn-${key}`,
          category: stat.split("_")[0],
          stat,
          points,
          conditions: {},
          applies_to_positions: positions
        });
      } else {
        rules.push({
          rule_id: `espn-${key}-default`,
          category: stat.split("_")[0],
          stat,
          points: fallback,
          conditions: {},
          applies_to_positions: positions
        });
      }
    }
    return { scoring_type: "custom", rules };
  }

  async getRosterSettings(_leagueExternalId: string): Promise<RosterSettings> {
    const data = await this.getLeagueRaw();
    const positions = data.settings?.rosterPositions ?? ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BE", "BE"];
    const counts = new Map<string, number>();
    for (const position of positions) {
      counts.set(position, (counts.get(position) ?? 0) + 1);
    }
    const slots = [...counts.entries()].map(([slot, count]) => ({
      slot: (ESPN_SLOT_ALIAS[slot] ?? slot) as PlayerPosition,
      count,
      positions: [ESPN_SLOT_ALIAS[slot] ?? slot].filter((p): p is PlayerPosition => p in POSITION_SET) as PlayerPosition[]
    }));
    return {
      slots,
      bench_count: counts.get("BE") ?? 0,
      injured_reserve_count: counts.get("IR") ?? 0,
      taxi_count: 0
    };
  }

  async getStandings(_leagueExternalId: string): Promise<Standings[]> {
    const data = await this.getLeagueRaw();
    return (data.teams ?? []).map((team) => this.mapStandings(team));
  }

  async getSchedule(_leagueExternalId: string): Promise<Matchup[]> {
    const data = await this.getLeagueRaw();
    const now = new Date().toISOString();
    return (data.schedule ?? []).map((matchup) => ({
      schema_version: "1.0.0",
      created_at: now,
      updated_at: now,
      source_system: "espn",
      source_record_id: String(matchup.id),
      matchup_id: String(matchup.id),
      league_id: String(data.id ?? this.client.credentials.leagueId),
      scoring_period: `${data.id ?? this.client.credentials.leagueId}-W${matchup.matchupPeriodId ?? 0}`,
      team_id: matchup.homeTeamId !== undefined ? String(matchup.homeTeamId) : "unknown",
      opponent_team_id: matchup.awayTeamId !== undefined ? String(matchup.awayTeamId) : "unknown",
      actual_points_for: matchup.homePoints,
      actual_points_against: matchup.awayPoints
    }));
  }

  async getPlayers(_sport: string, _season: string): Promise<Player[]> {
    const data = await this.getLeagueRaw();
    return (data.players ?? []).map((player) => this.mapPlayer(player));
  }

  async getFreeAgents(_leagueExternalId: string): Promise<Player[]> {
    const data = await this.getLeagueRaw();
    const owned = new Set<number>();
    for (const team of data.teams ?? []) {
      for (const entry of team.roster?.entries ?? []) {
        owned.add(entry.playerId);
      }
    }
    return (data.players ?? [])
      .filter((player) => !owned.has(player.id) && this.mapPosition(player.defaultPositionId) !== undefined)
      .map((player) => this.mapPlayer(player));
  }

  async getWaiverState(_leagueExternalId: string): Promise<WaiverState> {
    const data = await this.getLeagueRaw();
    const now = new Date().toISOString();
    const order = (data.teams ?? [])
      .slice()
      .sort((a, b) => (a.waiverRank ?? 0) - (b.waiverRank ?? 0))
      .map((team) => String(team.id));
    return {
      schema_version: "1.0.0",
      created_at: now,
      updated_at: now,
      source_system: "espn",
      source_record_id: `${this.client.credentials.leagueId}-waiver`,
      league_id: String(data.id ?? this.client.credentials.leagueId),
      waiver_order: order,
      faab_budgets: {}
    };
  }

  async getTransactions(_leagueExternalId: string, since?: string): Promise<Transaction[]> {
    const data = await this.getLeagueRaw();
    const now = new Date().toISOString();
    const transactions: Transaction[] = [];
    for (const team of data.teams ?? []) {
      const moved = new Set<number>();
      for (const entry of team.roster?.entries ?? []) moved.add(entry.playerId);
    }
    // ESPN surfaces transaction history via a separate view; without it we
    // return an empty list rather than fabricating data.
    void now;
    void since;
    return transactions;
  }

  // --- Write actions (plan §2: espn-api read/write) ---

  async setRoster(teamId: string, assignments: EspnSlotAssignment[]): Promise<unknown> {
    const roster = assignments.map((a) => ({
      id: Number(a.playerId),
      lineupSlotId: mapPositionToEspnSlot(a.slot)
    }));
    const lineupSlotCounts: Record<string, number> = {};
    for (const a of assignments) {
      const slot = String(mapPositionToEspnSlot(a.slot));
      lineupSlotCounts[slot] = (lineupSlotCounts[slot] ?? 0) + 1;
    }
    const body = {
      teamId: Number(teamId),
      roster,
      lineupSlotCounts,
      type: "ROSTER"
    };
    const filter = { teams: { filterTeamIds: { value: [Number(teamId)] }, filterSlotIds: { value: [] } } };
    return this.client.postJson("", body, filter);
  }

  async addDrop(
    teamId: string,
    adds: string[],
    drops: string[],
    kind: "waivers" | "freeagent" = "freeagent"
  ): Promise<unknown> {
    const transactItems: Array<Record<string, unknown>> = [];
    for (const playerId of adds) {
      transactItems.push({
        type: "ADD",
        playerId: Number(playerId),
        fromTeamId: 0,
        toTeamId: Number(teamId)
      });
    }
    for (const playerId of drops) {
      transactItems.push({
        type: "DROP",
        playerId: Number(playerId),
        fromTeamId: Number(teamId),
        toTeamId: 0
      });
    }
    const body = {
      type: kind === "waivers" ? "WAIVER" : "ADD",
      memberId: Number(teamId),
      transactItems
    };
    return this.client.postJson("/transactions/", body);
  }

  async proposeTrade(
    fromTeamId: string,
    toTeamId: string,
    givePlayerIds: string[],
    receivePlayerIds: string[]
  ): Promise<unknown> {
    const assets: Array<Record<string, unknown>> = [
      ...givePlayerIds.map((playerId) => ({
        type: "PLAYER",
        teamId: Number(fromTeamId),
        playerId: Number(playerId)
      })),
      ...receivePlayerIds.map((playerId) => ({
        type: "PLAYER",
        teamId: Number(toTeamId),
        playerId: Number(playerId)
      }))
    ];
    const body = {
      teamId: Number(fromTeamId),
      proposingTeamId: Number(fromTeamId),
      receivingTeamId: Number(toTeamId),
      assets
    };
    return this.client.postJson("/trades/", body);
  }

  // --- Mapping helpers ---

  private mapRoster(teamId: string, team: EspnTeam, players: EspnPlayer[]): Roster {
    const now = new Date().toISOString();
    const playerName = new Map(players.map((p) => [p.id, this.mapPlayer(p)]));
    const entries = team.roster?.entries ?? [];
    const starters: RosterSlot[] = [];
    const bench: RosterSlot[] = [];
    const injuredReserve: RosterSlot[] = [];
    let starterIndex = 0;
    let benchIndex = 0;
    let irIndex = 0;

    for (const entry of entries) {
      const position = mapEspnSlotToPosition(entry.lineuSlotId);
      const playerId = String(entry.playerId);
      const slotBase = {
        slot_id: `${teamId}-${position}-${playerId}`,
        allowed_positions: [position] as PlayerPosition[],
        locked: false,
        player_id: playerId
      };
      if (position === "IR") {
        injuredReserve.push({ ...slotBase, slot_type: "IR", slot_id: `${teamId}-IR-${irIndex++}` });
      } else if (position === "BN") {
        bench.push({ ...slotBase, slot_type: "BN", slot_id: `${teamId}-BN-${benchIndex++}` });
      } else {
        starters.push({ ...slotBase, slot_type: position, slot_id: `${teamId}-ST-${starterIndex++}` });
      }
    }

    return {
      team_id: teamId,
      starters,
      bench,
      injured_reserve: injuredReserve,
      taxi: [],
      last_updated_at: now
    };
  }

  private mapStandings(team: EspnTeam): Standings {
    const record = team.record?.overall ?? {};
    return {
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0,
      points_for: record.pointsFor ?? 0,
      points_against: record.pointsAgainst ?? 0,
      rank: 0
    };
  }

  private mapPlayer(player: EspnPlayer): Player {
    const now = new Date().toISOString();
    const position = this.mapPosition(player.defaultPositionId);
    const fullName = [player.firstName, player.lastName].filter(Boolean).join(" ").trim() || `Player ${player.id}`;
    return {
      schema_version: "1.0.0",
      created_at: now,
      updated_at: now,
      source_system: "espn",
      source_record_id: String(player.id),
      player_id: String(player.id),
      external_id: String(player.id),
      sport: "football",
      full_name: fullName,
      team: String(player.proTeamId ?? "FA"),
      positions: position ? [position] : [],
      status: this.mapStatus(player.injuryStatus, player.injured),
      injury_status: this.mapStatus(player.injuryStatus, player.injured),
      eligibility: {
        eligible_slots: position ? [position, "FLEX", "BN"].filter((p): p is PlayerPosition => p in POSITION_SET) : ["BN"],
        injured_reserve_eligible: player.injuryStatus === "IR",
        taxi_eligible: false
      },
      external_ids: { espn: String(player.id) }
    };
  }

  private mapPosition(defaultPositionId?: number): PlayerPosition | undefined {
    if (defaultPositionId === undefined) return undefined;
    return ESPN_POSITION_ID[defaultPositionId];
  }

  private mapStatus(status?: string, injured?: boolean): PlayerStatus {
    if (!status) return injured ? "questionable" : "active";
    const normalized = status.toUpperCase();
    if (normalized.includes("OUT")) return "out";
    if (normalized.includes("DOUBTFUL")) return "doubtful";
    if (normalized.includes("QUESTIONABLE")) return "questionable";
    if (normalized.includes("IR") || normalized.includes("INJURED")) return "injured_reserve";
    if (normalized.includes("SUSPENDED")) return "suspended";
    if (normalized.includes("BYE")) return "bye";
    return "active";
  }

  private mapWaiverSettings(data: EspnLeagueResponse): League["waiver_settings"] {
    const raw = data.settings?.waiverSettings;
    const type = raw && typeof raw === "object" && "type" in raw ? String((raw as Record<string, unknown>).type) : "rolling";
    return { type: type === "FA" ? "none" : "rolling" };
  }

  private mapTradeSettings(data: EspnLeagueResponse): League["trade_settings"] {
    const review = data.settings?.tradeReview?.type;
    return {
      enabled: true,
      review_type: review === 0 ? "none" : review === 1 ? "commissioner" : "league_vote"
    };
  }
}

const ESPN_SLOT_ALIAS: Record<string, PlayerPosition> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DST: "DST",
  DEF: "DST",
  FLEX: "FLEX",
  SUPERFLEX: "SUPER_FLEX",
  BE: "BN",
  IR: "IR"
};

const POSITION_SET = new Set<PlayerPosition>([
  "QB", "RB", "WR", "TE", "K", "DST", "FLEX", "SUPER_FLEX", "BN", "IR"
]);
