import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CATEGORIES, validateScope, type BasketballConfig, type StrategyPolicy } from "./contracts.js";
import { resolveCalendar } from "./calendar.js";
import { contentHash, immutableText, leagueDirectory, PROFILES, type StoredCapture } from "./store.js";

export function createReadinessReport(config: BasketballConfig, stored: StoredCapture, policy: StrategyPolicy | null, asOf: Date) {
  const capture = stored.capture, info = capture.leagueInfo;
  validateScope(config, capture);
  const sources = {league: capture.leagueSource, roster: capture.rosterSource, rules: config.rules.source,
    ...(capture.draftObservation ? {draft: capture.draftObservation.source} : {}),
    ...(config.authenticatedState ? {authenticated: config.authenticatedState.source} : {})};
  const sourceHealth = Object.fromEntries(Object.entries(sources).map(([key, s]) => {
    const ageHours = (asOf.getTime() - Date.parse(s.observedAt)) / 3_600_000;
    const maximumAgeHours = key === "roster" || key === "draft" || key === "authenticated" ? 1 : 24;
    return [key, {...s, ageHours, maximumAgeHours, status: ageHours < 0 ? "future-observation" : ageHours > maximumAgeHours ? "stale" : "within-report-age-policy"}];
  }));
  const categories = Object.keys(info.scoringSystem.scoringCategories.PLAYER);
  const supportedScoring = info.scoringSystem.type === "HEAD_TO_HEAD_ROTI_MULTI_WIN" && categories.length === CATEGORIES.length && CATEGORIES.every(c => categories.includes(c) && Object.keys(info.scoringSystem.scoringCategories.PLAYER[c]!).length === 1 && Number(info.scoringSystem.scoringCategories.PLAYER[c]!.Default) === 1);
  const rosterCount = capture.rosters.rosters[config.teamId]!.rosterItems.length;
  const blockers: string[] = [];
  if (!supportedScoring) blockers.push("Scoring format/categories/weights are outside this eight-category implementation.");
  if (Object.values(sourceHealth).some(s => s.status !== "within-report-age-policy")) blockers.push("One or more source observations are stale or in the future; reimport does not refresh them.");
  if (!config.competition) blockers.push("Competition identity and historical-source coverage are unverified.");
  const auth = config.authenticatedState;
  const draftTiming = auth?.draftState === "not-held-scheduled" ? `scheduled ${auth.draftStart}` : "date unset";
  if (rosterCount === 0) blockers.push(auth ? `Roster is observed empty. Authenticated home observed ${auth.source.observedAt} reported draft not held, ${draftTiming}; prepare a draft board before roster advice.` : "Roster is observed empty; draft readiness requires independent evidence before roster advice.");
  else blockers.push("Player identities, box/schedule coverage and basketball projections have not been imported.");
  for (const [name, value] of Object.entries({lockScope: config.rules.lockScope, leagueTimezone: config.rules.leagueTimezone, activationRule: config.rules.activationRule, gameCaps: config.rules.gameCaps, shotMinimums: config.rules.shotMinimums, categoryComparison: config.rules.categoryComparison})) if (value === null) blockers.push(`Unverified operational rule: ${name}.`);
  blockers.push("The separate weekly-forecast command provides conditional lineup research; verified lock/counting semantics and a validated probabilistic basketball model remain unavailable.");
  const calendar = resolveCalendar(capture, asOf);
  const activeOverlay = policy && calendar.current && policy.overlay !== "none" && policy.effectivePeriod === calendar.current.number ? policy.overlay : "none";
  return {
    schemaVersion: 1, generatedAt: asOf.toISOString(), leagueId: config.leagueId, leagueName: info.leagueName,
    team: {id: config.teamId, name: info.teamInfo[config.teamId]!.name, confirmed: config.teamConfirmed},
    season: config.rules.seasonLabel, competition: config.competition, operatorTimezone: config.operatorTimezone,
    status: "partial" as const, readyForPersonalAdvice: false, readyForExecution: false, liveActionsExecuted: 0,
    categories, objective: "Expected category wins; retain losses/ties separately. No turnover penalty or fantasy-points sum.",
    roster: {period: capture.rosters.period, observedPlayers: rosterCount, ...info.rosterInfo},
    draft: {publicApi: capture.draftObservation, authenticated: config.authenticatedState},
    strategy: {profile: policy?.profile ?? config.initialProfile, revision: policy?.revision ?? null, saved: policy !== null,
      requestedOverlay: policy?.overlay ?? "none", activeOverlay, effectivePeriod: policy?.effectivePeriod ?? null,
      alternatives: PROFILES, forecastsAvailable: false, probabilities: null},
    knownRules: config.rules, playoffs: info.playoffs, calendar, sourceHealth, blockers,
    capabilities: {browserAssistedRead: Object.values(sources).some(s => s.kind === "browser-transcription") ? "evidence provided" : "not established", unattendedHttp: "not established; a capture is not a live transport check", localReport: "implemented",
      categoryArithmetic: "implemented; W/L/T uses explicit synthetic policy only", draftPreparation: "experimental baseline via separate draft-forecast output; not evaluated by this readiness report", customModel: "not-trained", optimizer: "conditional linear weekly-forecast command; separate input coverage and legality gates", scheduler: "external-interim-only", platformWriter: "absent"},
    manifest: {snapshotId: stored.snapshotId, captureHash: stored.captureHash, configHash: contentHash(config),
      policyHash: policy ? contentHash(policy) : null, configuration: config, policy, originalPayloadHash: null,
      hashMeaning: "Hash of validated imported/transcribed fields; not proof of original API bytes.",
      ingestedAt: stored.ingestedAt, analysisVersion: "basketball-readiness-v1", mode: "read-only"}
  };
}
export type ReadinessReport = ReturnType<typeof createReadinessReport>;

export function renderReadinessMarkdown(report: ReadinessReport): string {
  return [`# ${report.leagueName}: basketball readiness`, "", `Generated ${report.generatedAt}. Team **${report.team.name}**; ${report.season}; strategy **${report.strategy.profile}**.`, "",
    "Status: **partial**. Local evidence/report foundation works; personalized weekly lineup advice and platform execution are unavailable. Experimental draft forecasts are separate draft-forecast artifacts and are not evaluated by this report.", "",
    `Categories: ${report.categories.join(", ")}. ${report.objective}`, "",
    `Roster: ${report.roster.observedPlayers} observed players. Weekly Monday lineups; 0-minute pregame lock offset, exact scope unresolved.`,
    ...(report.draft.authenticated?.draftState === "not-held-scheduled" ? [`Draft scheduled: **${report.draft.authenticated.draftStart}** (authenticated home observation; recheck for changes).`] : []),
    "Claims: unlimited; rotating priority, two-day waivers (23-hour minimum), anti-churning. Undrafted players go to waivers. No pre-draft claims/drops.",
    "Playoffs: four teams, no reseeding, higher seed wins ties. Fantasy correction window: 168 hours.", "",
    `Calendar: ${report.calendar.state}; current period ${report.calendar.current?.number ?? "none"}; next period ${report.calendar.next?.number ?? "none"} ${report.calendar.next?.startDate ?? ""}.`,
    `Accumulation: ${report.calendar.accumulationStart} through ${report.calendar.accumulationEnd}. Last imported period ends ${report.calendar.finalPeriodEnd}; this is not permission to count March 15 games.`, "",
    "## Strategy choices", "", ...Object.entries(report.strategy.alternatives).map(([name, description]) => `- **${name}**: ${description}`), "",
    "No numerical pivot benefit is available until real data/model inputs exist. Strategy changes save preferences; they do not create forecasts or submit actions.", "",
    "## Sources", "", ...Object.entries(report.sourceHealth).map(([name, source]) => `- ${name}: [${source.kind}](${source.url}), observed ${source.observedAt}; age ${source.ageHours.toFixed(2)} hours; ${source.status}.`), "",
    "Source kinds and completeness are recorded above; original raw payload hashes are unavailable in this field-level capture contract.", "",
    "## Remaining work", "", ...report.blockers.map(b => `- ${b}`), "",
    `Manifest snapshot: ${report.manifest.snapshotId}. Config hash: ${report.manifest.configHash}.`, "",
    "No live actions executed. No basketball model trained or promoted. A local report is not an unattended Fantrax manager.", ""].join("\n");
}

/** Immutable reports. The timestamp is analysis time, never a new source observation. */
export async function saveReport(root: string, config: BasketballConfig, report: ReadinessReport): Promise<{directory: string; reportId: string}> {
  const reportId = contentHash(report), directory = join(leagueDirectory(root, config), "reports", reportId);
  await mkdir(directory, {recursive: true});
  const path = join(directory, "report.json"), json = JSON.stringify(report, null, 2) + "\n";
  await immutableText(path, json);
  await immutableText(join(directory, "report.md"), renderReadinessMarkdown(report));
  await immutableText(join(directory, "manifest.json"), JSON.stringify({...report.manifest, reportId}, null, 2) + "\n");
  return {directory, reportId};
}
