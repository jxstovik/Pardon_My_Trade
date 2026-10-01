import { PmtError } from "../../errors.js";
import { EspnPlatformReader, type EspnPlatformReaderOptions } from "./espn-platform-reader.js";
import type { EspnCredentials } from "./espn-auth.js";
import { EspnProjectionSource } from "../../projections/espn-projection-source.js";

export type EspnDoctorStatus = "pass" | "warn" | "fail";

export interface EspnDoctorCheck {
  readonly name: string;
  readonly status: EspnDoctorStatus;
  readonly detail: string;
}

export interface EspnDoctorReport {
  readonly platform: "espn";
  /** Diagnostics exercise reads but do not assert external/live correctness. */
  readonly validation: "read-only-runtime-checks";
  readonly checked_at: string;
  readonly league_id?: string;
  readonly season?: string;
  readonly scoring_period_id?: number;
  readonly checks: EspnDoctorCheck[];
  readonly summary: { pass: number; warn: number; fail: number };
}

export interface EspnDoctorOptions extends Pick<EspnPlatformReaderOptions, "fetchImpl" | "baseUrl"> {
  readonly credentials?: EspnCredentials;
}

/** Read-only, redacted ESPN connectivity/schema/projection diagnostic. */
export async function runEspnDoctor(options: EspnDoctorOptions): Promise<EspnDoctorReport> {
  const credentials = options.credentials;
  const checks: EspnDoctorCheck[] = [];
  const add = (name: string, status: EspnDoctorStatus, detail: string) => checks.push({ name, status, detail });
  if (!credentials?.leagueId) {
    add("configuration", "fail", "ESPN league ID is missing.");
    return report(credentials, checks);
  }
  if (!credentials.season || !/^\d{4}$/.test(credentials.season)) {
    add("configuration", "fail", "ESPN season is missing or invalid.");
    return report(credentials, checks);
  }
  add("configuration", "pass", "League ID and season are configured.");
  if (!!credentials.espnS2 !== !!credentials.swid) {
    add("credentials", "warn", "Only one private-league cookie is configured; private reads may fail. Values are redacted.");
  } else if (credentials.espnS2 && credentials.swid) {
    add("credentials", "pass", "Both private-league cookie fields are present; values are redacted.");
  } else {
    add("credentials", "warn", "No private-league cookies are configured; public league reads may still work.");
  }

  const reader = new EspnPlatformReader({ credentials, fetchImpl: options.fetchImpl, baseUrl: options.baseUrl });
  let raw: Awaited<ReturnType<EspnPlatformReader["getLeagueFresh"]>>;
  try {
    raw = await reader.getLeagueFresh();
  } catch (error) {
    add("league_read", "fail", diagnosticMessage(error));
    return report(credentials, checks);
  }
  const returnedLeagueId = raw.id === undefined ? undefined : String(raw.id);
  if (returnedLeagueId !== credentials.leagueId) {
    add("league_identity", "fail", `Requested league ${credentials.leagueId}; ESPN returned ${returnedLeagueId ?? "no league ID"}.`);
  } else if (raw.seasonId !== undefined && String(raw.seasonId) !== credentials.season) {
    add("league_identity", "fail", `Requested season ${credentials.season}; ESPN returned ${raw.seasonId}.`);
  } else {
    add("league_identity", "pass", `ESPN returned the configured league${raw.seasonId === undefined ? "" : ` and season ${raw.seasonId}`}.`);
  }

  const teams = raw.teams ?? [];
  const rosterEntries = teams.flatMap((team) => team.roster?.entries ?? []);
  const validPlayerEntries = rosterEntries.filter((entry) => Number.isSafeInteger(entry.playerId));
  if (teams.length === 0 || validPlayerEntries.length === 0) {
    add("roster_schema", "fail", "League response did not contain teams with roster player IDs.");
  } else {
    add("roster_schema", "pass", `Read ${teams.length} teams and ${validPlayerEntries.length} roster entries.`);
  }
  const period = raw.scoringPeriodId;
  if (typeof period !== "number" || !Number.isSafeInteger(period) || period < 1) {
    add("scoring_period", "warn", "ESPN did not return a valid scoringPeriodId.");
  } else {
    add("scoring_period", "pass", `Current scoringPeriodId is ${period}.`);
  }
  const scoringItems = raw.settings?.scoringSettings?.scoringItems ?? raw.scoringSettings?.scoringItems ?? [];
  if (scoringItems.length === 0) add("scoring_settings", "warn", "No ESPN scoringItems were found in the league response.");
  else {
    const supported = new Set([3, 4, 20, 24, 25, 53, 42, 43, 72]);
    const unsupported = scoringItems.filter((item) => !supported.has(item.statId ?? -1)).length;
    add("scoring_settings", unsupported ? "warn" : "pass", `Read ${scoringItems.length} league scoring rules; ${unsupported} use stat IDs not normalized by PMT.`);
  }

  try {
    const freeAgents = await reader.getFreeAgents(credentials.leagueId);
    add("player_pool", "pass", `Read ${freeAgents.length} unowned player records.`);
  } catch (error) {
    add("player_pool", "fail", diagnosticMessage(error));
  }

  if (typeof period === "number" && period > 0) {
    try {
      const source = new EspnProjectionSource({
        credentials,
        fetchImpl: options.fetchImpl,
        baseUrl: options.baseUrl
      });
      const projections = await source.fetchProjections("football", credentials.season, `${credentials.season}-W${String(period).padStart(2, "0")}`);
      const rosterIds = new Set(rosterEntries.map((entry) => String(entry.playerId)));
      const covered = projections.filter((candidate) => candidate.player_id && rosterIds.has(candidate.player_id)).length;
      const denominator = rosterIds.size;
      const rate = denominator === 0 ? 0 : Math.round(covered / denominator * 100);
      add("projection_coverage", covered === 0 ? "warn" : "pass",
        `Found ${covered}/${denominator} roster projections (${rate}%) for scoring period ${period}.`);
    } catch (error) {
      add("projection_read", "fail", diagnosticMessage(error));
    }
  }
  return report(credentials, checks, period);
}

function report(credentials: EspnCredentials | undefined, checks: EspnDoctorCheck[], period?: number): EspnDoctorReport {
  return {
    platform: "espn",
    validation: "read-only-runtime-checks",
    checked_at: new Date().toISOString(),
    ...(credentials?.leagueId ? { league_id: credentials.leagueId } : {}),
    ...(credentials?.season ? { season: credentials.season } : {}),
    ...(period === undefined ? {} : { scoring_period_id: period }),
    checks,
    summary: {
      pass: checks.filter((check) => check.status === "pass").length,
      warn: checks.filter((check) => check.status === "warn").length,
      fail: checks.filter((check) => check.status === "fail").length
    }
  };
}

function diagnosticMessage(error: unknown): string {
  if (error instanceof PmtError) {
    if (error.code === "ESPN_REQUEST_FAILED") return error.message;
    if (error.code === "ESPN_NON_JSON_RESPONSE") return "ESPN returned HTML instead of JSON (possible expired credentials, rate limit, or endpoint change).";
    if (error.code === "ESPN_UNEXPECTED_RESPONSE") return "ESPN response could not be parsed as expected JSON.";
    return `${error.code}: ${error.message}`;
  }
  return "ESPN read failed; detailed request data and credentials were redacted.";
}
