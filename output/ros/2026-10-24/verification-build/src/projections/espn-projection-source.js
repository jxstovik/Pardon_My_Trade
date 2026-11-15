import { PmtError } from "../errors.js";
import { EspnPlatformClient } from "../adapters/espn/espn-platform-client.js";
const PLAYER_POSITIONS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };
const ESPN_STAT_MAP = {
    "3": "passing_yards", "4": "passing_touchdowns", "20": "interceptions",
    "24": "rushing_yards", "25": "rushing_touchdowns", "53": "receptions",
    "42": "receiving_yards", "43": "receiving_touchdowns", "72": "fumbles_lost"
};
/**
 * ESPN's fantasy API reports league-scored projected points in player stats.
 * This intentionally uses the fantasy read endpoint rather than ESPN's
 * unrelated site sports projections URL.
 */
export class EspnProjectionSource {
    name = "espn";
    explicitCredentials;
    fetchImpl;
    baseUrl;
    client;
    constructor(options = {}) {
        this.explicitCredentials = options.credentials;
        this.fetchImpl = options.fetchImpl;
        this.baseUrl = options.baseUrl;
    }
    async fetchProjections(sport, season, scoringPeriod) {
        if (sport !== "football")
            return [];
        const period = parsePeriod(scoringPeriod, season);
        const credentials = this.resolveCredentials(season);
        if (credentials.season !== season) {
            throw new PmtError({ code: "ESPN_SEASON_MISMATCH", message: `ESPN source is configured for season ${credentials.season}, but projections requested ${season}.`, source: "projection_source" });
        }
        const pageSize = 1500;
        const allPlayers = new Map();
        let receivedSchema = false;
        for (let offset = 0; offset < 30 * pageSize; offset += pageSize) {
            const data = await this.getClient(credentials).getJson("", {
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
            for (const player of collectPlayers(data))
                if (player.id !== undefined)
                    allPlayers.set(player.id, player);
            const count = data.players?.length ?? 0;
            if (count < pageSize)
                break;
        }
        if (!receivedSchema)
            return [];
        const players = [...allPlayers.values()];
        const observedAt = new Date().toISOString();
        return players.flatMap((player) => {
            const stats = player.stats?.find((candidate) => candidate.statSourceId === 1
                && candidate.scoringPeriodId === period
                && candidate.statSplitTypeId === 1
                && (candidate.seasonId === undefined || candidate.seasonId === Number(season)));
            const name = player.fullName ?? [player.firstName, player.lastName].filter(Boolean).join(" ").trim();
            if (!stats || !name || typeof stats.appliedTotal !== "number" || !Number.isFinite(stats.appliedTotal))
                return [];
            const projectedStats = {};
            for (const [statId, value] of Object.entries(stats.appliedStats ?? stats.stats ?? {})) {
                const mapped = ESPN_STAT_MAP[statId];
                if (mapped && Number.isFinite(value))
                    projectedStats[mapped] = value;
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
                        ? [PLAYER_POSITIONS[player.defaultPositionId]] : [],
                    projected_stats: projectedStats,
                    projected_points: points,
                    floor: round(points - spread),
                    ceiling: round(points + spread),
                    confidence: 0.7
                }];
        });
    }
    resolveCredentials(season) {
        if (this.explicitCredentials)
            return this.explicitCredentials;
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
    getClient(credentials) {
        if (!this.client)
            this.client = new EspnPlatformClient({
                credentials, fetchImpl: this.fetchImpl, baseUrl: this.baseUrl, readBaseUrl: this.baseUrl
            });
        return this.client;
    }
}
function collectPlayers(data) {
    const players = new Map();
    for (const entry of data.players ?? [])
        if (entry.player?.id !== undefined)
            players.set(entry.player.id, entry.player);
    for (const team of data.teams ?? []) {
        for (const entry of team.roster?.entries ?? []) {
            const player = entry.playerPoolEntry?.player;
            if (player?.id !== undefined)
                players.set(player.id, player);
        }
    }
    return [...players.values()];
}
function parsePeriod(scoringPeriod, season) {
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
function round(value) { return Math.round(value * 100) / 100; }
