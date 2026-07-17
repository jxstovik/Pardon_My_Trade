import type {
  League,
  Matchup,
  Player,
  Roster,
  RosterSettings,
  ScoringSettings,
  Standings,
  Team,
  Transaction,
  WaiverState
} from "../models/types.js";

export interface PlatformReader {
  getLeague(leagueExternalId: string, season: string): Promise<League>;
  getTeams(leagueExternalId: string): Promise<Team[]>;
  getRoster(leagueExternalId: string, teamExternalId: string): Promise<Roster>;
  getScoringSettings(leagueExternalId: string): Promise<ScoringSettings>;
  getRosterSettings(leagueExternalId: string): Promise<RosterSettings>;
  getStandings(leagueExternalId: string): Promise<Standings[]>;
  getSchedule(leagueExternalId: string): Promise<Matchup[]>;
  getPlayers(sport: string, season: string): Promise<Player[]>;
  getFreeAgents(leagueExternalId: string): Promise<Player[]>;
  getWaiverState(leagueExternalId: string): Promise<WaiverState>;
  getTransactions(leagueExternalId: string, since?: string): Promise<Transaction[]>;
}
