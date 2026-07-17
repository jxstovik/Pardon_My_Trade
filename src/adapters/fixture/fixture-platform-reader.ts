import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PmtError } from "../../errors.js";
import { assertLeagueSnapshot } from "../../models/validation.js";
import type {
  League,
  LeagueSnapshot,
  Matchup,
  Player,
  Roster,
  RosterSettings,
  ScoringSettings,
  Standings,
  Team,
  Transaction,
  WaiverState
} from "../../models/types.js";
import type { PlatformReader } from "../platform-reader.js";

export class FixturePlatformReader implements PlatformReader {
  private snapshot?: LeagueSnapshot;

  constructor(private readonly fixturePath: string) {}

  async getLeague(leagueExternalId: string, season: string): Promise<League> {
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

  async getTeams(leagueExternalId: string): Promise<Team[]> {
    return (await this.getLeagueByExternalId(leagueExternalId)).teams;
  }

  async getRoster(leagueExternalId: string, teamExternalId: string): Promise<Roster> {
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

  async getScoringSettings(leagueExternalId: string): Promise<ScoringSettings> {
    return (await this.getLeagueByExternalId(leagueExternalId)).scoring_settings;
  }

  async getRosterSettings(leagueExternalId: string): Promise<RosterSettings> {
    return (await this.getLeagueByExternalId(leagueExternalId)).roster_settings;
  }

  async getStandings(leagueExternalId: string): Promise<Standings[]> {
    return (await this.getLeagueByExternalId(leagueExternalId)).teams.map((team) => team.standings);
  }

  async getSchedule(leagueExternalId: string): Promise<Matchup[]> {
    return (await this.getLeagueByExternalId(leagueExternalId)).schedule;
  }

  async getPlayers(sport: string, season: string): Promise<Player[]> {
    const snapshot = await this.loadSnapshot();
    if (snapshot.league.sport !== sport || snapshot.league.season !== season) {
      return [];
    }
    const playersById = new Map<string, Player>();
    for (const player of [...snapshot.players, ...snapshot.free_agents]) {
      playersById.set(player.player_id, player);
    }
    return Array.from(playersById.values());
  }

  async getFreeAgents(leagueExternalId: string): Promise<Player[]> {
    await this.getLeagueByExternalId(leagueExternalId);
    return (await this.loadSnapshot()).free_agents;
  }

  async getWaiverState(leagueExternalId: string): Promise<WaiverState> {
    await this.getLeagueByExternalId(leagueExternalId);
    return (await this.loadSnapshot()).waiver_state;
  }

  async getTransactions(leagueExternalId: string, since?: string): Promise<Transaction[]> {
    const league = await this.getLeagueByExternalId(leagueExternalId);
    const transactions = league.teams.flatMap((team) => team.transaction_history);
    if (!since) {
      return transactions;
    }
    return transactions.filter((transaction) => transaction.occurred_at >= since);
  }

  private async getLeagueByExternalId(leagueExternalId: string): Promise<League> {
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

  private async loadSnapshot(): Promise<LeagueSnapshot> {
    if (this.snapshot) {
      return this.snapshot;
    }

    const absolutePath = resolve(this.fixturePath);
    const raw = await readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    assertLeagueSnapshot(parsed);
    this.snapshot = parsed;
    return this.snapshot;
  }
}
