import { parseEspnWaiverSettings } from "./espn-waiver-settings.js";
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
import { parseEspnTransactions } from "./espn-transaction-parser.js";
import { ESPN_SCORING_STATS, type EspnScoringItem } from "./espn-scoring.js";
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
  scoringPeriodId?: number;
  status?: { type?: number; shortName?: string };
  settings?: {
    name?: string;
    rosterPositions?: string[];
    rosterSize?: number;
    rosterSettings?: { lineupSlotCounts?: Record<string, number> };
    scoringSettings?: { scoringItems?: EspnScoringItem[] };
    waiverSettings?: Record<string, unknown>;
    acquisitionSettings?: Record<string, unknown>;
    tradeReview?: { type?: number };
  };
  members?: Array<{ id: string; displayName: string; firstName?: string; lastName?: string }>;
  teams?: EspnTeam[];
  players?: EspnPlayer[];
  schedule?: EspnMatchup[];
  scoringSettings?: { scoringItems?: EspnScoringItem[] } & Record<string, unknown>;
}

interface EspnTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev?: string;
  values?: Record<string, number>;
  record?: {
    overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number };
  };
  roster?: {
    entries?: Array<{
      playerId: number;
      /** Live API spelling. */
      lineupSlotId?: number;
      /** Historical payload spelling (ESPN's own typo). */
      lineuSlotId?: number;
      locked?: boolean;
      isLocked?: boolean;
      lockedForScoringPeriod?: boolean;
      status?: string;
      injuryStatus?: string;
      playerPoolEntry?: { rosterLocked?: boolean; player?: EspnPlayer };
    }>;
    lineupSlotCounts?: Record<string, number>;
  };
  waiverRank?: number;
  acquisitionBudget?: number;
  waiverBudget?: number;
}

interface EspnPlayer {
  id: number;
  fullName?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  injured?: boolean;
  injuryStatus?: string;
  onTeamId?: number;
  percentOwned?: number;
  eligibleSlots?: number[];
  locked?: boolean;
  lockedInLineup?: boolean;
  lockedForScoringPeriod?: boolean;
  gameStatus?: string;
  stats?: Array<{
    seasonId?: number;
    scoringPeriodId?: number;
    statSourceId?: number;
    statSplitTypeId?: number;
    appliedTotal?: number;
    appliedStats?: Record<string, number>;
    stats?: Record<string, number>;
  }>;
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
  16: "DST"
};

const DEFAULT_LEAGUE_VIEWS = ["mTeam", "mRoster", "mMatchup", "mStandings", "mSettings", "mPlayer"];

/** The request builders are shared by the read-adapter compatibility methods and the writer port. */
export function buildEspnRosterPayload(
  teamId: string,
  assignments: EspnSlotAssignment[]
): { body: Record<string, unknown>; filter: Record<string, unknown> } {
  const roster = assignments.map((a) => ({
    id: Number(a.playerId),
    lineupSlotId: mapPositionToEspnSlot(a.slot)
  }));
  const lineupSlotCounts: Record<string, number> = {};
  for (const a of assignments) {
    const slot = String(mapPositionToEspnSlot(a.slot));
    lineupSlotCounts[slot] = (lineupSlotCounts[slot] ?? 0) + 1;
  }
  return {
    body: {
      teamId: Number(teamId),
      roster,
      lineupSlotCounts,
      type: "ROSTER"
    },
    filter: { teams: { filterTeamIds: { value: [Number(teamId)] }, filterSlotIds: { value: [] } } }
  };
}

export function buildEspnAddDropPayload(
  teamId: string,
  adds: string[],
  drops: string[],
  kind: "waivers" | "freeagent" = "freeagent",
  faabBid?: number
): Record<string, unknown> {
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
  const body: Record<string, unknown> = {
    type: kind === "waivers" ? "WAIVER" : "ADD",
    memberId: Number(teamId),
    transactItems
  };
  if (kind === "waivers" && faabBid !== undefined) body.bidAmount = faabBid;
  return body;
}

export function buildEspnTradePayload(
  fromTeamId: string,
  toTeamId: string,
  givePlayerIds: string[],
  receivePlayerIds: string[]
): Record<string, unknown> {
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
  return {
    teamId: Number(fromTeamId),
    proposingTeamId: Number(fromTeamId),
    receivingTeamId: Number(toTeamId),
    assets
  };
}

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

  private async getLeagueRaw(forceRefresh = false): Promise<EspnLeagueResponse> {
    if (this.leagueCache && !forceRefresh) return this.leagueCache;
    // League reads come from ESPN's JSON read API, not the web/write host.
    const data = await this.client.getJson<EspnLeagueResponse>("", {
      view: DEFAULT_LEAGUE_VIEWS,
      scope: { segment: 0, readHost: true }
    });
    // The read API embeds roster players instead of returning the legacy
    // top-level `players` array used by the original league response shape.
    if (!data.players) {
      const players = new Map<number, EspnPlayer>();
      for (const team of data.teams ?? []) {
        for (const entry of team.roster?.entries ?? []) {
          const player = entry.playerPoolEntry?.player;
          if (player) players.set(player.id, player);
        }
      }
      data.players = [...players.values()];
    }
    this.leagueCache = data;
    return data;
  }

  /** Fetch a fresh league state for diagnostics and pre-action revalidation. */
  async getLeagueFresh(): Promise<EspnLeagueResponse> {
    return this.getLeagueRaw(true);
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
      name: data.name ?? data.settings?.name ?? "ESPN League",
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
        name: team.name ?? team.nickname ?? managerName,
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
    const raw = data.settings?.scoringSettings ?? data.scoringSettings ?? {};
    const rules: ScoringSettings["rules"] = [];
    for (const item of raw.scoringItems ?? []) {
      const definition = ESPN_SCORING_STATS[item.statId ?? -1];
      if (!definition) continue;
      // Overrides replace the base weight; zero is an explicit override too.
      // ESPN keys these by player position (K=5, D/ST=16), not lineup slot.
      const byPoints = new Map<number, PlayerPosition[]>();
      for (const position of definition.positions) {
        const positionId = Object.entries(ESPN_POSITION_ID).find(([, value]) => value === position)?.[0];
        const points = (positionId ? item.pointsOverrides?.[positionId] : undefined) ?? item.points;
        if (typeof points !== "number" || !Number.isFinite(points)) continue;
        byPoints.set(points, [...(byPoints.get(points) ?? []), position]);
      }
      for (const [points, positions] of byPoints) {
        rules.push({
          rule_id: `espn-stat-${item.statId}${byPoints.size > 1 ? `-${positions.join("-")}` : ""}`,
          category: definition.stat.split("_")[0],
          stat: definition.stat,
          points,
          conditions: {},
          applies_to_positions: positions
        });
      }
    }
    return { scoring_type: "custom", rules };
  }

  async getRosterSettings(_leagueExternalId: string): Promise<RosterSettings> {
    const data = await this.getLeagueRaw();
    const lineupSlotCounts = data.settings?.rosterSettings?.lineupSlotCounts;
    const positions = data.settings?.rosterPositions ?? (lineupSlotCounts
      ? Object.entries(lineupSlotCounts).flatMap(([slotId, count]) =>
          Array.from({ length: count }, () => mapEspnSlotToPosition(Number(slotId)))
        )
      : ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST", "BE", "BE"]);
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
      scoring_period: `${data.seasonId ?? this.client.credentials.season}-W${matchup.matchupPeriodId ?? 0}`,
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
    // The league views no longer embed a top-level `players` pool. ESPN's
    // `kona_player_info` uses ESPN's filter header and scoringPeriodId; paginate
    // defensively because the read endpoint may cap individual pages.
    const league = await this.getLeagueRaw();
    const owned = new Set<number>();
    for (const team of league.teams ?? []) {
      for (const entry of team.roster?.entries ?? []) {
        owned.add(entry.playerId);
      }
    }
    const scoringPeriodId = league.scoringPeriodId ?? 1;
    const pageSize = 1500;
    const allEntries: Array<{ player?: EspnPlayer }> = [];
    for (let offset = 0; offset < 30 * pageSize; offset += pageSize) {
      const data = await this.client.getJson<{ players?: Array<{ player?: EspnPlayer }>; scoringPeriodId?: number }>("", {
      view: ["kona_player_info"],
      scope: { segment: 0, readHost: true },
      query: { scoringPeriodId },
      filter: {
        players: {
          filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
          filterSlotIds: { value: [] },
          limit: pageSize,
          offset,
          sortPercOwned: { sortPriority: 1, sortAsc: false },
          sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" }
        }
      }
      });
      const entries = data.players ?? [];
      allEntries.push(...entries);
      if (entries.length < pageSize) break;
    }
    return allEntries
      .map((entry) => entry.player)
      .filter((player): player is EspnPlayer => !!player && this.mapPosition(player.defaultPositionId) !== undefined)
      .filter((player) => !owned.has(player.id))
      .map((player) => this.mapPlayer(player));
  }

  /** Distinguish an immediate free agent from a waiver claim before preparing a write. */
  async getAcquisitionStatus(leagueExternalId: string, playerId: string): Promise<string | undefined> {
    if (leagueExternalId !== this.client.credentials.leagueId) throw new Error("Acquisition status league mismatch.");
    const league = await this.getLeagueRaw();
    for (let offset = 0; offset < 45000; offset += 1500) {
      const data = await this.client.getJson<{ players?: Array<{ player?: { id: number }; status?: string }> }>("", {
        view: ["kona_player_info"], scope: { segment: 0, readHost: true }, query: { scoringPeriodId: league.scoringPeriodId ?? 1 },
        filter: { players: { filterStatus: { value: ["FREEAGENT", "WAIVERS"] }, filterSlotIds: { value: [] }, limit: 1500, offset, sortPercOwned: { sortPriority: 1, sortAsc: false }, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" } } }
      });
      const match = data.players?.find((entry) => String(entry.player?.id) === playerId);
      if (match) return match.status;
      if ((data.players?.length ?? 0) < 1500) return undefined;
    }
    return undefined;
  }

  async getWaiverPlayerIds(leagueId: string): Promise<string[]> {
    if (leagueId !== this.client.credentials.leagueId) throw new Error("Waiver pool scope mismatch.");
    const league = await this.getLeagueRaw();
    const ids: string[] = [];
    for (let offset=0; offset<45000; offset+=1500) {
      const data = await this.client.getJson<{players?: Array<{player?: {id: number}; status?: string}>}>("", {
        view:["kona_player_info"],scope:{segment:0,readHost:true},query:{scoringPeriodId:league.scoringPeriodId ?? 1},
        filter:{players:{filterStatus:{value:["WAIVERS"]},filterSlotIds:{value:[]},limit:1500,offset,sortPercOwned:{sortPriority:1,sortAsc:false}}}
      });
      if (!Array.isArray(data.players)) throw new Error("Waiver pool unavailable.");
      for (const entry of data.players) if (entry.status === "WAIVERS" && entry.player?.id !== undefined) ids.push(String(entry.player.id));
      if (data.players.length<1500) return ids;
    }
    throw new Error("Waiver pool pagination truncated.");
  }

  /** Authenticated pending claims only; missing view data is not proof of an empty queue. */
  async getPendingWaiverClaims(leagueId: string, teamId: string): Promise<Array<{id: string; priority: number; items: Array<{playerId: number; type: string}>}>> {
    if (leagueId !== this.client.credentials.leagueId) throw new Error("Pending waiver scope mismatch.");
    const league = await this.getLeagueFresh();
    if (String(league.id) !== leagueId || String(league.seasonId) !== this.client.credentials.season || !Number.isInteger(league.scoringPeriodId) || league.scoringPeriodId! < 1) throw new Error("Pending waiver scoring period unavailable or mismatched.");
    const data = await this.client.getJson<{id?: number; seasonId?: number; transactions?: Array<{id: string; teamId: number; type: string; status: string; priority: number; items: Array<{playerId: number; type: string}>}>}>("", {
      view: ["mTransactions2"], scope: {segment: 0, readHost: true},
      query: { scoringPeriodId: league.scoringPeriodId! },
      requireAuthenticatedRole: true,
      filter: {transactions: {filterStatus: {value: ["PENDING"]}, filterType: {value: ["WAIVER"]}, filterTeamId: {value: [Number(teamId)]}}}
    });
    if (String(data.id) !== leagueId || String(data.seasonId) !== this.client.credentials.season || !Array.isArray(data.transactions)) throw new Error("Pending waiver view unavailable or mismatched.");
    return data.transactions.filter(t=>String(t.teamId)===teamId && t.type === "WAIVER" && t.status === "PENDING").map(t=>({id:t.id,priority:t.priority,items:t.items}));
  }

  async getWaiverState(_leagueExternalId: string): Promise<WaiverState> {
    const data = await this.getLeagueRaw();
    const now = new Date().toISOString();
    const order = (data.teams ?? [])
      .slice()
      .sort((a, b) => (a.waiverRank ?? Infinity) - (b.waiverRank ?? Infinity))
      .map((team) => String(team.id));
    const faabBudgets: Record<string, number> = {};
    for (const team of data.teams ?? []) {
      const budget = team.acquisitionBudget ?? team.waiverBudget;
      if (budget !== undefined) faabBudgets[String(team.id)] = budget;
    }
    return {
      schema_version: "1.0.0",
      created_at: now,
      updated_at: now,
      source_system: "espn",
      source_record_id: `${this.client.credentials.leagueId}-waiver`,
      league_id: String(data.id ?? this.client.credentials.leagueId),
      waiver_order: order,
      faab_budgets: faabBudgets
    };
  }

  async getTransactions(leagueExternalId: string, since?: string): Promise<Transaction[]> {
    // mTransactions is a separate, undocumented ESPN view. Do not infer
    // history from the current roster when the view is absent or changes shape.
    const data = await this.client.getJson<unknown>("", {
      view: ["mTransactions"],
      scope: { segment: 0, readHost: true }
    });
    return parseEspnTransactions(data, leagueExternalId, since);
  }

  // --- Write actions (plan §2: espn-api read/write) ---

  async setRoster(teamId: string, assignments: EspnSlotAssignment[]): Promise<unknown> {
    const payload = buildEspnRosterPayload(teamId, assignments);
    return this.client.postJson("", payload.body, payload.filter);
  }

  async addDrop(
    teamId: string,
    adds: string[],
    drops: string[],
    kind: "waivers" | "freeagent" = "freeagent"
  ): Promise<unknown> {
    const body = buildEspnAddDropPayload(teamId, adds, drops, kind);
    return this.client.postJson("/transactions/", body);
  }

  async proposeTrade(
    fromTeamId: string,
    toTeamId: string,
    givePlayerIds: string[],
    receivePlayerIds: string[]
  ): Promise<unknown> {
    const body = buildEspnTradePayload(fromTeamId, toTeamId, givePlayerIds, receivePlayerIds);
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
      // ESPN payloads spell the field inconsistently across endpoints:
      // `lineupSlotId` (live API) vs `lineuSlotId` (some historical payloads).
      const slotId = entry.lineupSlotId ?? entry.lineuSlotId ?? 20;
      const position = mapEspnSlotToPosition(slotId);
      const playerId = String(entry.playerId);
      const embeddedPlayer = entry.playerPoolEntry?.player ?? players.find((candidate) => candidate.id === entry.playerId);
      const locked = entry.locked === true || entry.isLocked === true || entry.lockedForScoringPeriod === true || entry.playerPoolEntry?.rosterLocked === true
        || embeddedPlayer?.locked === true || embeddedPlayer?.lockedInLineup === true
        || embeddedPlayer?.lockedForScoringPeriod === true
        || ["IN_PROGRESS", "FINAL", "COMPLETED"].includes(embeddedPlayer?.gameStatus?.toUpperCase() ?? "");
      const eligible = this.mapEligibleSlots(embeddedPlayer, position);
      const slotBase = {
        slot_id: `${teamId}-${position}-${playerId}`,
        allowed_positions: eligible,
        locked,
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
    const fullName = player.fullName?.trim() || player.displayName?.trim() || [player.firstName, player.lastName].filter(Boolean).join(" ").trim() || `Player ${player.id}`;
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
        eligible_slots: this.mapEligibleSlots(player, position),
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

  private mapEligibleSlots(player: EspnPlayer | undefined, position?: PlayerPosition): PlayerPosition[] {
    const mapped = (player?.eligibleSlots ?? [])
      .map(mapEspnSlotToPosition)
      .filter((slot) => slot !== "BN" && slot !== "IR");
    const natural = position ? [position] : [];
    const flex = position && ["RB", "WR", "TE"].includes(position) ? ["FLEX"] : [];
    const base = mapped.length ? mapped : [...natural, ...flex];
    return [...new Set([...base, "BN"].filter((p): p is PlayerPosition => POSITION_SET.has(p as PlayerPosition)))];
  }

  private mapStatus(status?: string, injured?: boolean): PlayerStatus {
    if (!status) return injured ? "questionable" : "active";
    const normalized = status.toUpperCase();
    if (normalized.includes("OUT")) return "out";
    if (normalized.includes("DOUBTFUL")) return "doubtful";
    if (normalized.includes("QUESTIONABLE")) return "questionable";
    if (normalized === "IR" || normalized.includes("INJURY_RESERVE") || normalized.includes("INJURED")) return "injured_reserve";
    if (normalized.includes("SUSPENDED")) return "suspended";
    if (normalized.includes("BYE")) return "bye";
    return "active";
  }

  private mapWaiverSettings(data: EspnLeagueResponse): League["waiver_settings"] {
    return parseEspnWaiverSettings(data.settings?.acquisitionSettings, data.settings?.waiverSettings);
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
