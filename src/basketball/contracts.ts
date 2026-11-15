import { z } from "zod";

export const CATEGORIES = ["PTS", "REB", "AST", "ST", "BLK", "3PTM", "FG%", "FT%"] as const;
export const PROFILE_NAMES = ["balanced", "bigs", "guards"] as const;
export const OVERLAYS = ["none", "schedule-pressure", "must-win", "playoff-runway"] as const;
export type Category = typeof CATEGORIES[number];
export type ProfileName = typeof PROFILE_NAMES[number];

const identifier = z.string().regex(/^[a-zA-Z0-9_-]+$/);
export const instant = z.string().refine(
  value => /T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value)),
  "Expected an instant with an explicit UTC offset"
);
const source = z.object({
  url: z.url(), observedAt: instant,
  kind: z.enum(["browser-transcription", "raw-api", "synthetic"]),
  completeness: z.enum(["field-subset", "complete-response", "synthetic"])
});
const period = z.object({number: z.number().int().positive(), startDate: instant, endDate: instant});
const team = z.object({id: identifier, name: z.string().min(1)});
const info = z.object({
  leagueName: z.string().min(1), seasonYear: z.number().int(),
  startDate: z.iso.date(), endDate: z.iso.date(),
  scoringSystem: z.object({type: z.string(), scoringCategories: z.object({PLAYER: z.record(z.string(), z.record(z.string(), z.string()))})}),
  rosterInfo: z.object({maxTotalPlayers: z.number().int().nonnegative(), maxTotalActivePlayers: z.number().int().nonnegative(), maxTotalReservePlayers: z.number().int().nonnegative(), positionConstraints: z.record(z.string(), z.object({maxActive: z.number().int().nonnegative()}))}),
  teamInfo: z.record(z.string(), team), scoringPeriods: z.array(period).min(1), rosterPeriods: z.array(period).min(1),
  playoffs: z.object({used: z.boolean(), lastRegularSeasonPeriod: z.number().int(), firstPlayoffPeriod: z.number().int(), numPlayoffTeams: z.number().int(), mergePlayoffPeriods: z.boolean()})
});
const rules = z.object({
  source, seasonLabel: z.string(), lineupCadence: z.literal("weekly-monday"), lockOffsetMinutes: z.literal(0),
  lockScope: z.string().nullable(), leagueTimezone: z.string().nullable(), activationRule: z.string().nullable(),
  minimumTotal: z.literal(0), minimumActive: z.literal(0), injuryReserve: z.literal(false), minorLeague: z.literal(false),
  preventIllegalTransactions: z.literal("always"),
  weeklyClaims: z.literal("unlimited"), seasonClaims: z.literal("unlimited"),
  freeAgents: z.literal("first-come-first-served"), waiverMethod: z.literal("rotating-priority"),
  waiverDays: z.literal(2), minimumWaiverHours: z.literal(23), antiChurning: z.literal(true),
  undraftedToWaivers: z.literal(true), claimsBeforeDraft: z.literal(false), dropsDuringDraft: z.literal(false),
  currentWaiverPriority: z.number().int().positive().nullable(), waiverProcessing: z.string().nullable(),
  tradeReviewDays: z.literal(2), tradeObjections: z.literal(4), tradeDeadline: z.literal("none"),
  playoffReseed: z.literal(false), playoffTie: z.literal("higher-seed"),
  standingsTies: z.tuple([z.literal("head-to-head-among-tied"), z.literal("season-wins"), z.literal("random")]),
  statFreezeHours: z.literal(168), gameCaps: z.string().nullable(), shotMinimums: z.string().nullable(),
  categoryComparison: z.string().nullable()
});
const authenticatedState = z.discriminatedUnion("draftState", [
  z.object({source, competitionCode: z.literal("NCAAB"), draftState: z.literal("not-held-date-unset"), ownRosterCount: z.literal(0)}).strict(),
  z.object({source, competitionCode: z.literal("NCAAB"), draftState: z.literal("not-held-scheduled"), ownRosterCount: z.literal(0), draftStart: instant}).strict()
]);

/** League-specific first-slice contract. Null is unresolved, never unlimited or zero. */
export const ConfigSchema = z.object({
  schemaVersion: z.literal(1), leagueId: identifier, leagueName: z.string(), seasonYear: z.number().int(),
  teamId: identifier, teamConfirmed: z.literal(true), initialProfile: z.enum(PROFILE_NAMES),
  operatorTimezone: z.string().refine(value => {try {new Intl.DateTimeFormat("en", {timeZone: value}); return true;} catch {return false;}}, "Invalid IANA timezone"),
  competition: z.string().nullable(),
  authenticatedState: authenticatedState.nullable(),
  rules
}).strict();
export type BasketballConfig = z.infer<typeof ConfigSchema>;

export const CaptureSchema = z.object({
  schemaVersion: z.literal(1), leagueId: identifier, leagueSource: source, rosterSource: source,
  leagueInfo: info,
  rosters: z.object({period: z.number().int().positive(), rosters: z.record(z.string(), z.object({teamName: z.string(), rosterItems: z.array(z.record(z.string(), z.unknown()))}))}),
  draftObservation: z.object({source, state: z.string(), pickEntries: z.number().int().nonnegative(), selectedPlayers: z.number().int().nonnegative()}).nullable()
}).strict();
export type BasketballCapture = z.infer<typeof CaptureSchema>;

export const PolicySchema = z.object({
  schemaVersion: z.literal(1), leagueId: identifier, teamId: identifier, profile: z.enum(PROFILE_NAMES),
  overlay: z.enum(OVERLAYS), effectivePeriod: z.number().int().positive().nullable(),
  selectedAt: instant, previousRevision: z.string().nullable(), revision: z.string()
}).strict().refine(p => p.overlay === "none" || p.effectivePeriod !== null, "A tactical overlay requires one explicit period");
export type StrategyPolicy = z.infer<typeof PolicySchema>;

function validateEvidenceUrl(observation: z.infer<typeof source>, leagueId: string, expectedPath: string): void {
  const url = new URL(observation.url);
  if (observation.kind === "synthetic") {
    if (!leagueId.startsWith("synthetic-")) throw new Error("Synthetic evidence cannot replace a real league capture");
    return;
  }
  if (url.protocol !== "https:" || url.hostname !== "www.fantrax.com" || url.username || url.password || url.pathname !== expectedPath) throw new Error("Evidence source URL does not match its Fantrax resource");
  if (expectedPath.startsWith("/fxea/")) {
    if (url.searchParams.get("leagueId") !== leagueId || [...url.searchParams.keys()].some(key => !["leagueId", "period", "excludePlayerInfo"].includes(key))) throw new Error("Evidence source query does not match the league");
  } else if (url.search) throw new Error("Unexpected query on rules/home evidence URL");
}

export function validateScope(config: BasketballConfig, capture: BasketballCapture): void {
  if (config.leagueId !== capture.leagueId || config.leagueName !== capture.leagueInfo.leagueName || config.seasonYear !== capture.leagueInfo.seasonYear) throw new Error("Basketball league/name/season scope mismatch");
  if (capture.leagueInfo.teamInfo[config.teamId]?.id !== config.teamId) throw new Error("Confirmed basketball team is absent from league directory");
  const ids = Object.keys(capture.leagueInfo.teamInfo);
  if (ids.some(id => capture.leagueInfo.teamInfo[id]!.id !== id)) throw new Error("Conflicting team IDs in league directory");
  if (ids.length !== Object.keys(capture.rosters.rosters).length || ids.some(id => !capture.rosters.rosters[id])) throw new Error("Roster collection is incomplete; do not substitute an empty roster");
  if (!capture.leagueInfo.rosterPeriods.some(p => p.number === capture.rosters.period)) throw new Error("Roster response period is outside the imported calendar");
  validateEvidenceUrl(capture.leagueSource, config.leagueId, "/fxea/general/getLeagueInfo");
  validateEvidenceUrl(capture.rosterSource, config.leagueId, "/fxea/general/getTeamRosters");
  validateEvidenceUrl(config.rules.source, config.leagueId, `/fantasy/league/${config.leagueId}/rules`);
  if (config.authenticatedState) validateEvidenceUrl(config.authenticatedState.source, config.leagueId, `/fantasy/league/${config.leagueId}/home`);
  if (capture.draftObservation) validateEvidenceUrl(capture.draftObservation.source, config.leagueId, "/fxea/general/getDraftResults");
  const rosterUrl = new URL(capture.rosterSource.url);
  if (capture.rosterSource.kind !== "synthetic" && rosterUrl.searchParams.get("period") !== String(capture.rosters.period)) throw new Error("Roster source period does not match the response");
}
