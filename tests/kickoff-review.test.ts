import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadFixtureSnapshotSource } from "../src/knowledge/ingestion.js";
import { assembleKickoffReview, rosterIdentities, renderKickoffReport, runKickoffReview, finalizeKickoffReport, kickoffPrompt, prepareKickoffLineup } from "../src/mcp/kickoff-review.js";
import { easternIso, groupKickoffs, parseKickoffSchedule, parsePlayerKickoffNews, parseGameInjuries, type KickoffSource, type NflGame, type AvailabilityEvidence } from "../src/adapters/espn/kickoff-source.js";
import { createModel } from "../src/probabilistic/bayesian-model.js";
import { ActionQueue, InMemoryActionQueueStore, actionPayloadHash } from "../src/agents/action-queue.js";
import { InMemoryActionExecutionStore } from "../src/agents/action-executor.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";
import { InMemoryV1Store } from "../src/history/v1-store.js";
import { FixturePlatformReader } from "../src/adapters/fixture/fixture-platform-reader.js";
import type { PmtMcpDependencies } from "../src/mcp/server.js";
import type { LeagueSnapshot, PlayerStatus } from "../src/models/types.js";
import { EspnPlatformReader } from "../src/adapters/espn/espn-platform-reader.js";

const at = new Date("2026-10-18T16:00:00Z");
const input = { season: "2026", nflWeek: 6, kickoff: "2026-10-18T17:00:00.000Z" };
const game: NflGame = { id: "401873002", name: "Steelers at Buccaneers", kickoff: input.kickoff, season: "2026", week: 6, teams: [{ id: "23", abbreviation: "PIT" }, { id: "27", abbreviation: "TB" }], state: "pre" };
const models = new Map([ ["1", createModel({ playerId: "1", playerName: "First Player", position: "RB", historyMean: 7, historyVar: 4 })], ["2", createModel({ playerId: "2", playerName: "Second Player", position: "RB", historyMean: 15, historyVar: 4 })] ]);
test("Hermes schedule bridge scenario regressions", () => {
  const result = spawnSync("python3", ["-B", "tests/hermes-kickoff-jobs.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
async function fixture(): Promise<LeagueSnapshot> {
  const base = await loadFixtureSnapshotSource("tests/fixtures/sample-football-league.json");
  const players = ["1", "2"].map((id, i) => ({ ...base.players[0]!, player_id: id, external_id: id, external_ids: { espn: id }, full_name: i ? "Second Player" : "First Player", team: "23", positions: ["RB" as const], status: "active" as const, injury_status: "active" as const, eligibility: { eligible_slots: ["RB" as const, "FLEX" as const, "BN" as const], injured_reserve_eligible: false, taxi_eligible: false } }));
  const slot = (id: string, type: "RB" | "BN") => ({ slot_id: id, slot_type: type, allowed_positions: ["RB" as const], locked: false, player_id: id });
  return { ...base, snapshot_id: "fresh-kickoff", scoring_period: "2026-W7", players, free_agents: [], projections: players.map(p => ({ ...base.projections[0]!, player_id: p.player_id, scoring_period: "2026-W7", projected_points: models.get(p.player_id)!.mu })), league: { ...base.league, external_id: "98806880", season: "2026", roster_settings: { ...base.league.roster_settings, slots: [{ slot: "RB", count: 1, positions: ["RB"] }], bench_count: 1 }, teams: [{ ...base.league.teams[0]!, team_id: "7", external_id: "7", roster: { team_id: "7", starters: [slot("1", "RB")], bench: [slot("2", "BN")], injured_reserve: [], taxi: [], last_updated_at: at.toISOString() } }] } };
}
const build = (s: LeagueSnapshot, evidence: AvailabilityEvidence[] = []) => assembleKickoffReview(s, "7", input, [game], models, evidence, at);
function news(text: string, date = at.toISOString()): AvailabilityEvidence {
  return { playerId: "1", status: "unverified", text, publishedAt: date, retrievedAt: at.toISOString(), sourceUrl: "https://www.espn.com/nfl/player/news/_/id/1", kind: "news" };
}

test("named deterministic full-lineup changes preserve NFL week vs platform fantasy period", async () => {
  const s = await fixture(); const r = build(s);
  assert.deepEqual(build(s), r);
  assert.equal(r.scoringPeriod, "2026-W7"); assert.equal(r.nflWeek, 6);
  assert.equal(r.executionEligible, true); assert.equal(r.expectedGain, 8);
  assert.deepEqual(r.lineup, [{ playerId: "2", slot: "RB" }]);
  assert.deepEqual(r.changes.map(c => [c.name, c.from, c.to]), [["First Player", "RB", "BN"], ["Second Player", "BN", "RB"]]);
  const report = renderKickoffReport(r);
  for (const text of ["First Player (1): RB → BN", "Second Player (2): BN → RB", "Injuries and availability", "Coverage and limitations", "Action and verification", "2026-W7"]) assert.ok(report.includes(text));
});

test("questionable, doubtful, stale/future/undated reports and optimistic wording cannot grant clearance", async () => {
  const base = await fixture();
  for (const status of ["questionable", "doubtful", "unknown"] as PlayerStatus[]) {
    const s = { ...base, players: [{ ...base.players[0]!, injury_status: status }, base.players[1]!] };
    for (const item of [news("Player is expected to be active for Sunday."), news("Player is active for Sunday if warmups go well."), news("Player is active for Sunday.", "2026-10-10T16:00:00Z"), news("Player is active for Sunday.", "2026-10-18T18:00:00Z"), news("Player is active for Sunday.", "invalid")]) {
      const r = build(s, [item]); assert.equal(r.executionEligible, false); assert.equal(r.status, "incomplete");
      assert.match(renderKickoffReport(r), /^\[CRON_FAILURE\]/);
    }
    const confirmed = build(s, [news("Player is active for Sunday's game.")]);
    assert.equal(confirmed.players[0]!.availability, "confirmed_active");
  }
});

test("routine stale evidence is cleared from active reports without changing decisions or losing exclusion counts", async () => {
  const s = await fixture();
  const stale = news("Player is inactive for Sunday's game.", "2026-10-10T16:00:00Z");
  const r = build(s, [stale]);
  assert.deepEqual(r.players[0]!.evidence, []);
  assert.equal(r.players[0]!.availability, "no_designation_observed");
  assert.deepEqual(r.lineup, build(s).lineup);
  assert.deepEqual(Reflect.get(r.players[0]!, "excludedEvidence"), { stale: 1, future: 0, undated: 0 });
  assert.ok(!r.warnings.some(w => /stale.*evidence/.test(w)));
  assert.ok(!renderKickoffReport(r).includes("stale/future/undated"));
});

test("future and undated evidence remain flagged while the exact 24-hour boundary is retained", async () => {
  const s = await fixture();
  const evidence = [
    news("Player is active for Sunday.", "2026-10-18T18:00:00Z"),
    news("Player is active for Sunday.", "invalid"),
    news("Player is active for Sunday.", "2026-10-17T16:00:00Z")
  ];
  const r = build(s, evidence);
  assert.deepEqual(r.players[0]!.excludedEvidence, { stale: 0, future: 1, undated: 1 });
  assert.deepEqual(r.players[0]!.evidence, [evidence[2]]);
  assert.match(renderKickoffReport(r), /1 future-dated and 1 undated\/invalid evidence item/);
  assert.equal(r.players[0]!.availability, "confirmed_active");
});

test("current OUT/IR survive without recent news; inactive is excluded from the candidate lineup", async () => {
  const base = await fixture();
  const s = { ...base, players: [{ ...base.players[0]!, injury_status: "out" as const, updated_at: "2020-01-01T00:00:00Z" }, base.players[1]!] };
  const r = build(s); assert.equal(r.players[0]!.availability, "out"); assert.deepEqual(r.lineup, [{ playerId: "2", slot: "RB" }]);
  const inactive = build(base, [news("Player is inactive for Sunday's game.")]); assert.equal(inactive.players[0]!.availability, "inactive");
  const ruledOut = build(base, [news("Player (calf) has been ruled out for Sunday's game.")]); assert.equal(ruledOut.players[0]!.availability, "out");
  const benchOut = build(base, [{ ...news("Player (calf) will not play Sunday."), playerId: "2" }]); assert.ok(!benchOut.lineup.some(p => p.playerId === "2"));
  const newer = build(base, [news("Player has been ruled out for Sunday.", "2026-10-18T12:00Z"), news("Player is active for Sunday's game.")]); assert.equal(newer.players[0]!.availability, "confirmed_active");
  const suffixed = { ...base, players: [{ ...base.players[0]!, full_name: "First Player Jr.", injury_status: "questionable" as const }, base.players[1]!] };
  assert.equal(build(suffixed, [news("Player Jr. (calf) is active for Sunday's game.")]).players[0]!.availability, "confirmed_active");
  assert.notEqual(build(base, [news("Player has not been ruled out for Sunday.")]).players[0]!.availability, "out");
});

test("locks, missing projections, stale roster, empty slots and ambiguous player IDs block unsafe proposals", async () => {
  const s = await fixture();
  const locked = { ...s, league: { ...s.league, teams: [{ ...s.league.teams[0]!, roster: { ...s.league.teams[0]!.roster, starters: [{ ...s.league.teams[0]!.roster.starters[0]!, locked: true }] } }] } };
  assert.deepEqual(build(locked).changes, []);
  const missing = assembleKickoffReview(s, "7", input, [game], new Map(), [], at); assert.equal(missing.executionEligible, false); assert.match(missing.blockers.join(), /projection/);
  const stale = { ...s, league: { ...s.league, teams: [{ ...s.league.teams[0]!, roster: { ...s.league.teams[0]!.roster, last_updated_at: "2020-01-01T00:00:00Z" } }] } };
  assert.match(build(stale).blockers.join(), /stale/);
  const collided = { ...s, players: [...s.players, { ...s.players[1]!, player_id: "collision", external_id: "1" }] };
  assert.match(build(collided).blockers.join(), /Unresolved roster identity/);
  const nameless = { ...s, players: [{ ...s.players[0]!, full_name: "Player 1" }, s.players[1]!] };
  assert.match(build(nameless).blockers.join(), /Missing full name/);
  assert.throws(() => rosterIdentities(s, "not-this-team"));
  assert.equal(assembleKickoffReview(s, "7", input, [game], models, [], new Date(input.kickoff)).executionEligible, false);
});

test("no owned game group produces a complete no-op without projection comparisons", async () => {
  const s = await fixture(); const other = { ...game, teams: [{ id: "1", abbreviation: "ATL" }, { id: "2", abbreviation: "BUF" }] };
  const r = assembleKickoffReview(s, "7", input, [other], new Map(), [], at);
  assert.equal(r.status, "complete"); assert.equal(r.executionEligible, false); assert.deepEqual(r.changes, []);
});

test("schedule groups equal timestamps once and uses correct Eastern DST offset; TBD is excluded", () => {
  assert.equal(easternIso(new Date("2026-10-18T16:00Z")), "2026-10-18T12:00:00-04:00");
  assert.equal(easternIso(new Date("2026-11-08T17:00Z")), "2026-11-08T12:00:00-05:00");
  assert.equal(groupKickoffs([game, { ...game, id: "other" }], at).length, 1);
  const event = { id: game.id, name: game.name, date: game.kickoff, season: { year: 2026, type: 2 }, week: { number: 6 }, competitions: [{ date: game.kickoff, competitors: game.teams.map(team => ({ team })), status: { type: { state: "pre" } } }] };
  assert.equal(parseKickoffSchedule({ events: [event] }, "2026", 6).length, 1);
  assert.throws(() => parseKickoffSchedule({ events: [{ ...event, competitions: [{ ...event.competitions[0], timeValid: false }] }] }, "2026", 6), /No verified/);
  assert.throws(() => parseKickoffSchedule({ events: [event] }, "2025", 6));
  const prompt = kickoffPrompt(input); assert.ok(!prompt.includes("scoped-news-workflow.md")); assert.match(prompt, /pmt_finalize_kickoff_report/); assert.match(prompt, /verbatim/);
});

test("source parsers retain timestamps and provenance and reject malformed/mismatched coverage", () => {
  const rows = parsePlayerKickoffNews({ news: [], rotowire: { headline: "Player is questionable", story: "Current report", published: "Sun Oct 18 05:09:31 PDT 2026" } }, "1", at);
  assert.equal(rows[0]!.publishedAt, "2026-10-18T12:09:31.000Z"); assert.match(rows[0]!.sourceUrl, /\/1$/);
  assert.throws(() => parsePlayerKickoffNews({}, "1", at)); assert.throws(() => parseGameInjuries({ header: { id: "wrong" }, injuries: [] }, game, at));
});

async function environment(s: LeagueSnapshot) {
  const dataDir = await mkdtemp(join(tmpdir(), "pmt-kickoff-"));
  const queue = new ActionQueue(new InMemoryActionQueueStore()); const executionStore = new InMemoryActionExecutionStore();
  const deps: PmtMcpDependencies = { dataDir, reader: new FixturePlatformReader("tests/fixtures/sample-football-league.json"), repository: new InMemoryKnowledgeRepository({ snapshots: [s] }), v1Store: new InMemoryV1Store(), actionQueue: queue, executionStore, loadSnapshot: async () => s, syncSnapshot: async () => ({}), leagueExternalId: "98806880", teamId: "7", clock: () => at };
  let scheduleCalls = 0, injuryCalls = 0, newsCalls = 0;
  const source: KickoffSource = { schedule: async () => { scheduleCalls++; return [game]; }, injuries: async () => { injuryCalls++; return []; }, playerNews: async () => { newsCalls++; return []; } };
  return { dataDir, deps, source, counts: () => ({ scheduleCalls, injuryCalls, newsCalls }) };
}

test("one tool runs bounded scoped reads, persists exact report, finalizes with no queue mutation or writes", async () => {
  const env = await environment(await fixture());
  try {
    const result = await runKickoffReview(env.deps, input, env.source);
    assert.deepEqual(env.counts(), { scheduleCalls: 1, injuryCalls: 1, newsCalls: 2 });
    assert.equal(result.review.status, "complete"); assert.equal((await env.deps.actionQueue.pending()).length, 0);
    const final = await finalizeKickoffReport(env.deps, result.review.reportId);
    assert.equal(final.action.status, "not_executed"); assert.equal(final.platform_writes_by_this_tool, 0);
    const path = join(env.dataDir, "kickoff-reviews", `${result.review.reportId}.json`);
    const stored = JSON.parse(await readFile(path, "utf8")); stored.players[0].name = "Tampered"; await writeFile(path, JSON.stringify(stored));
    await assert.rejects(finalizeKickoffReport(env.deps, result.review.reportId), /integrity/);
    await assert.rejects(finalizeKickoffReport(env.deps, "../escape"), /identifier/);
  } finally { await rm(env.dataDir, { recursive: true, force: true }); }
});

test("failed sync, failed news and unavailable schedule still render explicit incomplete reports", async () => {
  const env = await environment(await fixture());
  try {
    const r = await runKickoffReview({ ...env.deps, syncSnapshot: async () => { throw new Error("offline"); } }, input, { ...env.source, playerNews: async () => { throw new Error("news unavailable"); } });
    assert.equal(r.review.status, "incomplete"); assert.equal(r.review.executionEligible, false); assert.match(r.report, /Fresh roster\/projection sync failed/); assert.match(r.report, /news unavailable/);
    const missing = await runKickoffReview(env.deps, input, { ...env.source, schedule: async () => { throw new Error("offline"); } });
    assert.match(missing.report, /Game scope unverified/); assert.match(missing.report, /^\[CRON_FAILURE\]/);
  } finally { await rm(env.dataDir, { recursive: true, force: true }); }
});

test("finalizer does not confuse approval with execution, rejects unrelated moves, verifies unknown/receipt/audit/readback", async () => {
  const s = await fixture(); const env = await environment(s);
  try {
    const { review } = await runKickoffReview(env.deps, input, env.source);
    const queued = await env.deps.actionQueue.enqueue({ type: "set_roster", teamId: "7", starters: review.lineup }, "low", "exact kickoff", { preconditions: { leagueExternalId: "98806880", scoringPeriod: "2026-W7" } });
    await env.deps.actionQueue.approve(queued.actionId, "fixture-user");
    const approved = await finalizeKickoffReport(env.deps, review.reportId, queued.actionId);
    assert.equal(approved.action.verified, false); assert.equal(approved.action.status, "approved"); assert.equal(approved.status, "incomplete");
    const unrelated = await env.deps.actionQueue.enqueue({ type: "add_drop", teamId: "7", addPlayerIds: ["3"], dropPlayerIds: ["1"] }, "high", "unrelated");
    await assert.rejects(finalizeKickoffReport(env.deps, review.reportId, unrelated.actionId), /scope/);
    const payloadHash = actionPayloadHash(queued.action); const receipt = { receiptId: "r", actionId: queued.actionId, idempotencyKey: "key", payloadHash, status: "unknown" as const, recordedAt: at.toISOString() };
    await env.deps.executionStore!.saveReceipt(receipt);
    assert.equal((await finalizeKickoffReport(env.deps, review.reportId, queued.actionId)).action.status, "unknown");
    await env.deps.executionStore!.saveReceipt({ ...receipt, status: "executed" });
    await env.deps.executionStore!.appendAudit({ auditId: "audit", actionId: queued.actionId, idempotencyKey: "key", payloadHash, event: "executed", recordedAt: at.toISOString() });
    const roster = { ...s.league.teams[0]!.roster, starters: [{ ...s.league.teams[0]!.roster.starters[0]!, player_id: "2" }] };
    const reader = { ...env.deps.reader, getLeagueFresh: async () => ({}), getRoster: async () => roster } as unknown as PmtMcpDependencies["reader"];
    const verified = await finalizeKickoffReport({ ...env.deps, reader }, review.reportId, queued.actionId);
    assert.equal(verified.action.verified, true); assert.equal(verified.action.status, "executed_and_verified");
    const mismatchReader = { ...reader, getRoster: async () => s.league.teams[0]!.roster } as PmtMcpDependencies["reader"];
    assert.equal((await finalizeKickoffReport({ ...env.deps, reader: mismatchReader }, review.reportId, queued.actionId)).action.status, "executed_readback_mismatch");
  } finally { await rm(env.dataDir, { recursive: true, force: true }); }
});

test("kickoff preparation requires the saved exact fresh eligible report and constructs a deduplicated lineup without model-supplied IDs", async () => {
  const s = await fixture(); const env = await environment(s);
  try {
    const { review } = await runKickoffReview(env.deps, input, env.source);
    const entry = (id: number, slot: number) => ({ lineupSlotId: slot, playerPoolEntry: { player: { id, eligibleSlots: [2, 23] } } });
    const fresh = { id: 98806880, seasonId: 2026, scoringPeriodId: 7, settings: { rosterSettings: { lineupSlotCounts: { "2": 1, "20": 1 } } }, teams: [{ id: 7, roster: { entries: [entry(1, 2), entry(2, 20)] } }] };
    const reader = { getLeagueFresh: async () => fresh, getRoster: async () => s.league.teams[0]!.roster } as unknown as PmtMcpDependencies["reader"];
    const deps = { ...env.deps, reader };
    const first = await prepareKickoffLineup(deps, review.reportId);
    const second = await prepareKickoffLineup(deps, review.reportId);
    assert.equal(first.action.actionId, second.action.actionId); assert.equal(first.action.status, "pending");
    assert.deepEqual(first.action.action, { type: "set_roster", teamId: "7", starters: review.lineup });
    assert.equal(first.execution_allowed, false);
    await assert.rejects(prepareKickoffLineup({ ...deps, clock: () => new Date("2026-10-18T16:30Z") }, review.reportId), /expired/);
    const changed = { ...reader, getRoster: async () => ({ ...s.league.teams[0]!.roster, bench: [] }) } as PmtMcpDependencies["reader"];
    await assert.rejects(prepareKickoffLineup({ ...deps, reader: changed }, review.reportId), /Roster changed/);
    const wrongPeriod = { ...reader, getLeagueFresh: async () => ({ ...fresh, scoringPeriodId: 8 }) } as unknown as PmtMcpDependencies["reader"];
    await assert.rejects(prepareKickoffLineup({ ...deps, reader: wrongPeriod }, review.reportId), /scope\/period/);
  } finally { await rm(env.dataDir, { recursive: true, force: true }); }
});

test("ESPN player names use the live API fullName spelling", async () => {
  const reader = new EspnPlatformReader({ credentials: { leagueId: "98806880", season: "2026" }, fetchImpl: async () => new Response(JSON.stringify({ id: 98806880, seasonId: 2026, teams: [], players: [{ id: 4569587, fullName: "Named Player", defaultPositionId: 2 }] })) });
  const players = await reader.getPlayers("football", "2026"); assert.equal(players.find(p => p.player_id === "4569587")?.full_name, "Named Player");
});
