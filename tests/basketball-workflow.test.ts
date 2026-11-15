import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BasketballCapture, CaptureSchema, ConfigSchema } from "../src/basketball/contracts.js";
import { aggregateCategories, compareCategories } from "../src/basketball/categories.js";
import { validatePeriods, resolveCalendar } from "../src/basketball/calendar.js";
import { importCapture, currentCapture, contentHash, selectPolicy, readPolicy } from "../src/basketball/store.js";
import { createReadinessReport, saveReport, renderReadinessMarkdown } from "../src/basketball/report.js";
import { FantraxReadError, readFantrax } from "../src/basketball/fantrax-reader.js";

const config = ConfigSchema.parse(JSON.parse(await readFile("config/basketball/banging-3s.json", "utf8")));
const capture = CaptureSchema.parse(JSON.parse(await readFile("config/basketball/banging-3s.capture.json", "utf8")));
const at = new Date("2026-10-25T18:25:00Z");
const one = {PTS:25, REB:8, AST:4, ST:2, BLK:1, "3PTM":3, FGM:9, FGA:20, FTM:4, FTA:5};
const two = {PTS:10, REB:5, AST:2, ST:0, BLK:3, "3PTM":0, FGM:5, FGA:5, FTM:0, FTA:0};
const opponent = {PTS:32, REB:10, AST:8, ST:2, BLK:2, "3PTM":4, FGM:12, FGA:24, FTM:4, FTA:6};
const exact = {kind: "synthetic-exact" as const, minimumFGA: 0, minimumFTA: 0};

async function temporary(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "pmt-basketball-"));
  try {await work(root);} finally {await rm(root, {recursive: true, force: true});}
}

test("category aggregation uses attempt weights and all six counts, not mean player percentages", () => {
  const a = aggregateCategories([one, two]);
  assert.deepEqual(a, {PTS:35, REB:13, AST:6, ST:2, BLK:4, "3PTM":3, FGM:14, FGA:25, FTM:4, FTA:5, "FG%":0.56, "FT%":0.8});
  assert.notEqual(a["FG%"], (0.45 + 1) / 2);
  assert.deepEqual(compareCategories(a, aggregateCategories([opponent]), exact), {PTS:"win", REB:"win", AST:"loss", ST:"tie", BLK:"win", "3PTM":"loss", "FG%":"win", "FT%":"win"});
});

test("real comparisons stay unsupported; zero attempts and configured minima stay explicit", () => {
  const a = aggregateCategories([one]), b = aggregateCategories([opponent]), empty = aggregateCategories([]);
  assert.equal(empty["FG%"], null); assert.equal(empty["FT%"], null);
  assert.ok(Object.values(compareCategories(a, b, null)).every(v => v === "unsupported"));
  assert.equal(compareCategories(empty, b, exact)["FG%"], "unsupported");
  assert.equal(compareCategories(a, b, {...exact, minimumFGA: 25})["FG%"], "unsupported");
  assert.equal(compareCategories(a, a, exact)["FG%"], "tie");
  assert.throws(() => compareCategories(a, b, {...exact, minimumFTA: -1}), /policy/);
});

test("missing stats and impossible/coherency data fail before category calculation", () => {
  const {AST, ...missing} = one;
  assert.throws(() => aggregateCategories([missing]));
  assert.throws(() => aggregateCategories([{...one, FGM: 30}]));
  assert.throws(() => aggregateCategories([{...one, FTA: 1}]));
  assert.throws(() => aggregateCategories([{...one, PTS: 999}]));
  assert.throws(() => aggregateCategories([{...one, ST: Number.NaN}]));
});

test("calendar preserves exact offsets, inclusive endpoints and the accumulation cutoff discrepancy", () => {
  assert.equal(resolveCalendar(capture, at).next!.number, 1);
  assert.equal(resolveCalendar(capture, new Date("2026-11-01T14:30:00Z")).current!.number, 1);
  assert.equal(resolveCalendar(capture, new Date("2026-11-09T15:59:59Z")).current!.number, 1);
  assert.equal(resolveCalendar(capture, new Date("2026-11-09T16:00:00Z")).current!.number, 2);
  const final = resolveCalendar(capture, new Date("2027-03-15T15:59:59Z"));
  assert.equal(final.current!.number, 19); assert.equal(final.accumulationEnd, "2027-03-14");
  assert.equal(final.accumulationAndPeriodDatesDiffer, true); assert.equal(final.lockInstant, null);
  assert.equal(resolveCalendar(capture, new Date("2027-03-15T16:00:00Z")).state, "after-last-period");
  assert.throws(() => validatePeriods([capture.leagueInfo.scoringPeriods[0]!, capture.leagueInfo.scoringPeriods[0]!]));
});

test("capture rejects unsupported version, unzoned source times and wrong league/partial roster scopes", async () => temporary(async root => {
  assert.throws(() => CaptureSchema.parse({...capture, schemaVersion: 2}));
  assert.throws(() => CaptureSchema.parse({...capture, leagueSource: {...capture.leagueSource, observedAt:"2026-10-25T12:00:00"}}));
  await assert.rejects(importCapture(root, config, {...capture, leagueId:"other-league"}, at), /scope/);
  const missing = structuredClone(capture); delete missing.rosters.rosters[config.teamId];
  await assert.rejects(importCapture(root, config, missing, at), /incomplete/);
  await assert.rejects(importCapture(root, config, {...capture, rosterSource: {...capture.rosterSource, kind: "synthetic", completeness:"synthetic"}}, at), /Synthetic/);
}));

test("rules, home and draft evidence must match the exact league and resource", async () => temporary(async root => {
  for (const badConfig of [
    {...config, rules: {...config.rules, source: {...config.rules.source, url:"https://www.fantrax.com/fantasy/league/another/rules"}}},
    {...config, authenticatedState: {...config.authenticatedState!, source: {...config.authenticatedState!.source, url:"https://www.fantrax.com/fantasy/league/another/home"}}}
  ]) await assert.rejects(importCapture(root, badConfig, capture, at), /Evidence/);
  const badDraft = {...capture, draftObservation: {...capture.draftObservation!, source: {...capture.draftObservation!.source, url:"https://www.fantrax.com/fxea/general/getDraftResults?leagueId=another"}}};
  await assert.rejects(importCapture(root, config, badDraft, at), /league/);
}));

test("reimport is idempotent and failed import leaves the current immutable capture intact", async () => temporary(async root => {
  const first = await importCapture(root, config, capture, at);
  const repeat = await importCapture(root, config, capture, new Date("2026-10-26T13:45:00Z"));
  assert.equal(first.snapshotId, repeat.snapshotId); assert.equal(first.ingestedAt, repeat.ingestedAt);
  await assert.rejects(importCapture(root, config, {...capture, leagueId:"wrong"}, at));
  assert.equal((await currentCapture(root, config)).snapshotId, first.snapshotId);
  const path = join(root, config.leagueId, "snapshots", `${first.snapshotId}.json`);
  const damaged = {...first, capture: {...first.capture, leagueInfo: {...first.capture.leagueInfo, leagueName:"changed"}}};
  await writeFile(path, JSON.stringify(damaged));
  await assert.rejects(importCapture(root, config, capture, at), /Immutable/);
  await assert.rejects(currentCapture(root, config), /scope|hash/);
}));

test("strategy persistence audits pivots, preserves Balanced start, and expires one-period overlay", async () => temporary(async root => {
  assert.equal(await readPolicy(root, config), null);
  const initial = await selectPolicy(root, config, {profile:"balanced", overlay:"none", effectivePeriod:null}, at);
  const pivot = await selectPolicy(root, config, {profile:"guards", overlay:"must-win", effectivePeriod:1}, at);
  assert.equal(pivot.previousRevision, initial.revision); assert.equal((await readPolicy(root, config))!.profile, "guards");
  const stored = await importCapture(root, config, capture, at);
  assert.equal(createReadinessReport(config, stored, pivot, new Date("2026-11-02T12:00:00Z")).strategy.activeOverlay, "must-win");
  assert.equal(createReadinessReport(config, stored, pivot, new Date("2026-11-10T12:00:00Z")).strategy.activeOverlay, "none");
  await assert.rejects(selectPolicy(root, config, {profile:"guards", overlay:"must-win", effectivePeriod:null}, at));
}));

test("real partial readiness report saves without policy and never invents players/probabilities or source freshness", async () => temporary(async root => {
  const stored = await importCapture(root, config, capture, at);
  const report = createReadinessReport(config, stored, null, at);
  assert.equal(report.strategy.activeOverlay, "none");
  assert.equal(report.readyForPersonalAdvice, false); assert.equal(report.readyForExecution, false);
  assert.equal(report.roster.observedPlayers, 0); assert.equal(report.strategy.probabilities, null);
  assert.equal(report.manifest.originalPayloadHash, null); assert.equal(report.liveActionsExecuted, 0);
  const output = await saveReport(root, config, report);
  assert.equal(JSON.parse(await readFile(join(output.directory, "report.json"), "utf8")).manifest.captureHash, stored.captureHash);
  assert.match(renderReadinessMarkdown(report), /weekly|Weekly/);
  assert.match(renderReadinessMarkdown(report), /March 15/);
  const later = createReadinessReport(config, stored, null, new Date("2026-10-27T13:45:00Z"));
  assert.equal(later.sourceHealth.roster!.status, "stale");
  assert.equal(later.sourceHealth.roster!.observedAt, capture.rosterSource.observedAt);
  const noAuth = createReadinessReport({...config, authenticatedState:null}, stored, null, at);
  assert.ok(noAuth.blockers.every(b => !b.includes("Authenticated home observed")));
  const scheduled = ConfigSchema.parse({...config, authenticatedState: {...config.authenticatedState!, draftState:"not-held-scheduled", draftStart:"2026-10-28T21:00:00-04:00"}});
  const scheduledReport = createReadinessReport(scheduled, stored, null, at);
  assert.match(renderReadinessMarkdown(scheduledReport), /Draft scheduled:.*2026-10-28T21:00:00-04:00/);
  assert.ok(scheduledReport.blockers.some(b => b.includes("scheduled 2026-10-28")));
  assert.ok(scheduledReport.blockers.every(b => !b.includes("date unset")));
  assert.throws(() => ConfigSchema.parse({...scheduled, authenticatedState:{...scheduled.authenticatedState!, draftStart:undefined}}));
  assert.throws(() => ConfigSchema.parse({...scheduled, authenticatedState:{...scheduled.authenticatedState!, draftStart:"2026-10-28T21:00:00"}}));
  const brokenWeights = structuredClone(stored);
  brokenWeights.capture.leagueInfo.scoringSystem.scoringCategories.PLAYER.PTS = {};
  assert.ok(createReadinessReport(config, brokenWeights, null, at).blockers.some(b => b.includes("Scoring format")));
}));

test("HTTP probe uses explicit allowlisted GET; 403 does not return fixture data", async () => {
  let calls = 0;
  const fetcher = (async (url: URL, init: RequestInit) => {
    calls++; assert.equal(init.method, "GET"); assert.equal(url.hostname, "www.fantrax.com");
    assert.equal(url.searchParams.get("period"), "1");
    return new Response("Forbidden", {status:403});
  }) as unknown as typeof fetch;
  await assert.rejects(readFantrax("getTeamRosters", config.leagueId, {period:1, fetcher}), error => error instanceof FantraxReadError && error.code === "HTTP_403" && !error.retryable);
  assert.equal(calls, 1);
  await assert.rejects(readFantrax("deletePlayer" as never, config.leagueId, {fetcher}), /Unsupported/);
  await assert.rejects(readFantrax("getTeamRosters", config.leagueId, {fetcher}), /explicit positive period/);
  assert.equal(calls, 1);
});

test("hashes are key-order stable and invalid JSON values fail", () => {
  assert.equal(contentHash({b:2,a:1}), contentHash({a:1,b:2}));
  assert.throws(() => contentHash({unsupported:undefined}));
});
