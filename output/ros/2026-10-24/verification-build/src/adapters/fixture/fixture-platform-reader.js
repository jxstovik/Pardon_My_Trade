import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PmtError } from "../../errors.js";
import { assertLeagueSnapshot } from "../../models/validation.js";
export class FixturePlatformReader {
    fixturePath;
    snapshot;
    constructor(fixturePath) {
        this.fixturePath = fixturePath;
    }
    async getLeague(leagueExternalId, season) {
        const snapshot = await this.loadSnapshot();
        if (snapshot.league.external_id !== leagueExternalId || snapshot.league.season !== season) {
            throw new PmtError({
                code: "FIXTURE_LEAGUE_NOT_FOUND",
                message: `Fixture league ${leagueExternalId} for season ${season} was not found.`,
                source: "fixture_adapter",
                retryable: false
            });
        }
        return snapshot.league;
    }
    async getTeams(leagueExternalId) {
        return (await this.getLeagueByExternalId(leagueExternalId)).teams;
    }
    async getRoster(leagueExternalId, teamExternalId) {
        const team = (await this.getLeagueByExternalId(leagueExternalId)).teams.find((item) => item.external_id === teamExternalId);
        if (!team) {
            throw new PmtError({
                code: "FIXTURE_TEAM_NOT_FOUND",
                message: `Fixture team ${teamExternalId} was not found.`,
                source: "fixture_adapter",
                retryable: false
            });
        }
        return team.roster;
    }
    async getScoringSettings(leagueExternalId) {
        return (await this.getLeagueByExternalId(leagueExternalId)).scoring_settings;
    }
    async getRosterSettings(leagueExternalId) {
        return (await this.getLeagueByExternalId(leagueExternalId)).roster_settings;
    }
    async getStandings(leagueExternalId) {
        return (await this.getLeagueByExternalId(leagueExternalId)).teams.map((team) => team.standings);
    }
    async getSchedule(leagueExternalId) {
        return (await this.getLeagueByExternalId(leagueExternalId)).schedule;
    }
    async getPlayers(sport, season) {
        const snapshot = await this.loadSnapshot();
        if (snapshot.league.sport !== sport || snapshot.league.season !== season) {
            return [];
        }
        const playersById = new Map();
        for (const player of [...snapshot.players, ...snapshot.free_agents]) {
            playersById.set(player.player_id, player);
        }
        return Array.from(playersById.values());
    }
    async getFreeAgents(leagueExternalId) {
        await this.getLeagueByExternalId(leagueExternalId);
        return (await this.loadSnapshot()).free_agents;
    }
    async getWaiverState(leagueExternalId) {
        await this.getLeagueByExternalId(leagueExternalId);
        return (await this.loadSnapshot()).waiver_state;
    }
    async getTransactions(leagueExternalId, since) {
        const league = await this.getLeagueByExternalId(leagueExternalId);
        const transactions = league.teams.flatMap((team) => team.transaction_history);
        if (!since) {
            return transactions;
        }
        return transactions.filter((transaction) => transaction.occurred_at >= since);
    }
    async getLeagueByExternalId(leagueExternalId) {
        const snapshot = await this.loadSnapshot();
        if (snapshot.league.external_id !== leagueExternalId) {
            throw new PmtError({
                code: "FIXTURE_LEAGUE_NOT_FOUND",
                message: `Fixture league ${leagueExternalId} was not found.`,
                source: "fixture_adapter",
                retryable: false
            });
        }
        return snapshot.league;
    }
    async loadSnapshot() {
        if (this.snapshot) {
            return this.snapshot;
        }
        const absolutePath = resolve(this.fixturePath);
        const raw = await readFile(absolutePath, "utf8");
        const parsed = JSON.parse(raw);
        assertLeagueSnapshot(parsed);
        this.snapshot = parsed;
        return this.snapshot;
    }
}
