import { PmtError } from "../errors.js";
import type { PlayerPosition } from "../models/types.js";
import type { EspnCredentials } from "../adapters/espn/espn-auth.js";
import { EspnPlatformClient } from "../adapters/espn/espn-platform-client.js";
import { ESPN_SCORING_STATS } from "../adapters/espn/espn-scoring.js";
import type { ProjectionCandidate, ProjectionSource } from "./projection-source.js";

export interface EspnProjectionSourceOptions {
  readonly fetchImpl?: typeof fetch;
  /** Fantasy API root override, useful for a controlled endpoint or fixture. */
  readonly baseUrl?: string;
  readonly credentials?: EspnCredentials;
}

interface EspnPlayerStats {
  seasonId?: number;
  scoringPeriodId?: number;
  statSourceId?: number;
  statSplitTypeId?: number;
  appliedTotal?: number;
  appliedStats?: Record<string, number>;
  stats?: Record<string, number>;
}

interface EspnFantasyPlayer {
  id?: number;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
  proTeam?: { abbreviation?: string };
  stats?: EspnPlayerStats[];
}

interface EspnFantasyResponse {
  players?: Array<{ player?: EspnFantasyPlayer }>;
  teams?: Array<{ roster?: { entries?: Array<{ playerPoolEntry?: { player?: EspnFantasyPlayer } }> } }>;
}

const PLAYER_POSITIONS: Record<number, PlayerPosition> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };

/**
 * ESPN's fantasy API reports league-scored projected points in player stats.
 * This intentionally uses the fantasy read endpoint rather than ESPN's
 * unrelated site sports projections URL.
 */
export class EspnProjectionSource implements ProjectionSource {
  readonly name = "espn";
  private readonly explicitCredentials?: EspnCredentials;
  private readonly fetchImpl?: typeof fetch;
  private readonly baseUrl?: string;
  private client?: EspnPlatformClient;

  constructor(options: EspnProjectionSourceOptions = {}) {
    this.explicitCredentials = options.credentials;
    this.fetchImpl = options.fetchImpl;
    this.baseUrl = options.baseUrl;
  }

  async fetchProjections(sport: string, season: string, scoringPeriod: string): Promise<ProjectionCandidate[]> {
    if (sport !== "football") return [];
    const period = parsePeriod(scoringPeriod, season);
    const credentials = this.resolveCredentials(season);
    if (credentials.season !== season) {
      throw new PmtError({ code: "ESPN_SEASON_MISMATCH", message: `ESPN source is configured for season ${credentials.season}, but projections requested ${season}.`, source: "projection_source" });
    }
    const pageSize = 1500;
    const allPlayers = new Map<number, EspnFantasyPlayer>();
    let receivedSchema = false;
    for (let offset = 0; offset < 30 * pageSize; offset += pageSize) {
      const data = await this.getClient(credentials).getJson<EspnFantasyResponse>("", {
        view: ["kona_player_info"],
        scope: { season, segment: 0, readHost: true },
        query: { scoringPeriodId: period },
        filter: { players: {
          filterStatus: { value: ["FREEAGENT", "WAIVERS", "ONTEAM"] },
          filterSlotIds: { value: [] },
          limit: pageSize,
          offset,
          sortPercOwned: { sortPriority: 1, sortAsc: false }
        } }
      });
      if (!Array.isArray(data.players) && !Array.isArray(data.teams)) {
        throw new PmtError({ code: "ESPN_UNEXPECTED_RESPONSE", message: "ESPN fantasy player response did not include a players or teams array.", source: "projection_source" });
      }
      receivedSchema = true;
      for (const player of collectPlayers(data)) if (player.id !== undefined) allPlayers.set(player.id, player);
      const count = data.players?.length ?? 0;
      if (count < pageSize) break;
    }
    if (!receivedSchema) return [];
    const players = [...allPlayers.values()];
    const observedAt = new Date().toISOString();
    return players.flatMap((player) => {
      const stats = player.stats?.find((candidate) => candidate.statSourceId === 1
      && candidate.scoringPeriodId === period
        && candidate.statSplitTypeId === 1
        && (candidate.seasonId === undefined || candidate.seasonId === Number(season)));
      const name = player.fullName ?? [player.firstName, player.lastName].filter(Boolean).join(" ").trim();
      if (!stats || !name || typeof stats.appliedTotal !== "number" || !Number.isFinite(stats.appliedTotal)) return [];
      const projectedStats: Record<string, number> = {};
      // appliedStats already contains weighted points contributions. Only raw
      // stats can be multiplied by league weights; without them retain the
      // authoritative appliedTotal via the scorer's empty-stat fallback.
      for (const [statId, value] of Object.entries(stats.stats ?? {})) {
        const mapped = ESPN_SCORING_STATS[Number(statId)]?.stat;
        if (mapped && Number.isFinite(value)) projectedStats[mapped] = value;
      }
      const points = round(stats.appliedTotal);
      // ESPN supplies its league-scored mean; this broad ±30% band is only a
      // display fallback until the calibrated PMT distribution is available.
      const spread = Math.abs(points) * 0.3;
      return [{
        player_id: player.id === undefined ? undefined : String(player.id),
        scoring_period: scoringPeriod,
        observed_at: observedAt,
        name,
        team: player.proTeam?.abbreviation ?? (player.proTeamId === undefined ? "" : String(player.proTeamId)),
        positions: player.defaultPositionId && PLAYER_POSITIONS[player.defaultPositionId]
          ? [PLAYER_POSITIONS[player.defaultPositionId]!] : [],
        projected_stats: projectedStats,
        projected_points: points,
        floor: round(points - spread),
        ceiling: round(points + spread),
        confidence: 0.7
      }];
    });
  }

  private resolveCredentials(season: string): EspnCredentials {
    if (this.explicitCredentials) return this.explicitCredentials;
    const leagueId = process.env.ESPN_LEAGUE_ID ?? process.env.PMT_LEAGUE_ID;
    if (!leagueId) {
      throw new PmtError({ code: "ESPN_LEAGUE_ID_MISSING", message: "ESPN projection reads require ESPN_LEAGUE_ID or PMT_LEAGUE_ID.", source: "projection_source" });
    }
    return {
      leagueId,
      season: process.env.ESPN_SEASON ?? process.env.PMT_SEASON ?? season,
      espnS2: process.env.ESPN_S2,
      swid: process.env.SWID
    };
  }

  private getClient(credentials: EspnCredentials): EspnPlatformClient {
    if (!this.client) this.client = new EspnPlatformClient({
      credentials, fetchImpl: this.fetchImpl, baseUrl: this.baseUrl, readBaseUrl: this.baseUrl
    });
    return this.client;
  }
}

function collectPlayers(data: EspnFantasyResponse): EspnFantasyPlayer[] {
  const players = new Map<number, EspnFantasyPlayer>();
  for (const entry of data.players ?? []) if (entry.player?.id !== undefined) players.set(entry.player.id, entry.player);
  for (const team of data.teams ?? []) {
    for (const entry of team.roster?.entries ?? []) {
      const player = entry.playerPoolEntry?.player;
      if (player?.id !== undefined) players.set(player.id, player);
    }
  }
  return [...players.values()];
}

function parsePeriod(scoringPeriod: string, season: string): number {
  const match = /^(?:(\d{4})-)?W?(\d+)$/i.exec(scoringPeriod);
  if (!match) {
    throw new PmtError({
      code: "ESPN_INVALID_SCORING_PERIOD",
      message: `Invalid ESPN scoring period '${scoringPeriod}'. Expected YYYY-WNN or a scoring period number.`,
      source: "projection_source"
    });
  }
  const period = Number(match[2]);
  if ((match[1] !== undefined && match[1] !== season)
    || !Number.isSafeInteger(period) || period < 1 || period > 30 || !/^\d{4}$/.test(season)) {
    throw new PmtError({ code: "ESPN_INVALID_SCORING_PERIOD", message: "Invalid ESPN season or scoring period.", source: "projection_source" });
  }
  return period;
}

function round(value: number): number { return Math.round(value * 100) / 100; }
