import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPmtMcpServer } from "../src/mcp/server.js";
import { FixturePlatformReader } from "../src/adapters/fixture/fixture-platform-reader.js";
import { ActionQueue, InMemoryActionQueueStore } from "../src/agents/action-queue.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";
import { InMemoryV1Store } from "../src/history/v1-store.js";
import { EspnNewsSource } from "../src/news/espn-news-source.js";
import { RazzballNewsSource } from "../src/news/razzball-news-source.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadFixtureSnapshotSource } from "../src/knowledge/ingestion.js";
import type { LeagueSnapshot, NewsItem } from "../src/models/types.js";

const now = new Date("2026-10-15T12:00:00.000Z");
async function fixture(): Promise<LeagueSnapshot> {
  const s = await loadFixtureSnapshotSource("tests/fixtures/sample-football-league.json");
  const p = s.players[0]!;
  return { ...s, players: [{ ...p, player_id: "canonical-a", external_id: "101", external_ids: { espn: "101", sleeper: "9001" } }, { ...p, player_id: "canonical-b", external_id: "102", external_ids: { espn: "102" } }], free_agents: [{ ...p, player_id: "candidate", external_id: "103", external_ids: { espn: "103" } }], league: { ...s.league, league_id: "league", external_id: "external-league", teams: [{ ...s.league.teams[0]!, team_id: "team", external_id: "7", roster: { ...s.league.teams[0]!.roster, starters: [{ slot_id: "one", slot_type: "QB", allowed_positions: ["QB"], locked: false, player_id: "101" }], bench: [], injured_reserve: [], taxi: [] } }] } };
}
async function api() {
  // Dynamic lookup keeps the first RED a behavioral assertion, not a TS import error.
  const path = "../src/mcp/news-context.js";
  const module = await import(path).catch(() => ({}));
  assert.equal(typeof module.buildNewsContext, "function", "scoped news context API must exist");
  return module;
}
function news(id: string, player = "101", extra: Partial<NewsItem> = {}): NewsItem {
  return { schema_version: "1", created_at: now.toISOString(), updated_at: now.toISOString(), source_system: "espn", news_id: id, player_id: player, source: "espn", headline: "Injury update", summary: "Untrusted source text", impact: "high", published_at: "2026-10-15T10:00:00.000Z", ingested_at: now.toISOString(), ...extra };
}

test("team scope resolves canonical/external roster IDs and unions only explicit candidates", async () => {
  const { buildNewsContext } = await api();
  const result = buildNewsContext(await fixture(), [news("a"), news("b", "102"), news("c", "103")], { leagueId: "external-league", teamId: "7", candidatePlayerIds: ["103"] }, now);
  assert.deepEqual(result.news.map((n: NewsItem) => n.player_id).sort(), ["candidate", "canonical-a"]);
  assert.equal(result.coverage.scoped_player_count, 2);
  assert.equal(result.omissions.out_of_scope_count, 1);
  assert.throws(() => buildNewsContext({ ...result, league: { league_id: "league", external_id: "external-league" } }, [], { leagueId: "wrong" }, now));
});

test("recent window, deterministic impact-first cursor pages recover every urgent item within a JSON character budget", async () => {
  const { buildNewsContext } = await api();
  const s = await fixture();
  const rows = Array.from({ length: 30 }, (_, i) => news(String(i).padStart(2, "0"), "101", { headline: "x".repeat(1000), summary: "y".repeat(5000), impact: i === 0 ? "low" : "high" }));
  rows.push(news("old", "101", { published_at: "2025-01-01T00:00:00Z" }), news("future", "101", { published_at: "2027-01-01T00:00:00Z" }), news("invalid", "101", { published_at: "bad" }));
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const r = buildNewsContext(s, [...rows].reverse(), { teamId: "7", limit: 5, maxChars: 3500, cursor }, now);
    assert.ok(JSON.stringify(r).length <= 3500);
    assert.equal(r.total_count, 30);
    assert.equal(r.omissions.outside_window_count, 2);
    assert.equal(r.omissions.invalid_timestamp_count, 1);
    assert.equal(r.coverage.no_news_is_not_clearance, true);
    assert.equal(r.omissions.remaining_high_impact_count, 29 - [...seen, ...r.news.map((n: NewsItem) => n.news_id)].filter(id => id !== "00").length);
    seen.push(...r.news.map((n: NewsItem) => n.news_id));
    cursor = r.next_cursor ?? undefined;
    assert.ok(r.news.length > 0);
  } while (cursor);
  assert.equal(seen.length, 30);
  assert.equal(new Set(seen).size, 30);
  assert.equal(seen.at(-1), "00");
});

test("cursor binds scope and frozen window, rejects changed data and malformed tokens", async () => {
  const { buildNewsContext } = await api();
  const s = await fixture();
  const rows = [news("a"), news("b")];
  const first = buildNewsContext(s, rows, { teamId: "7", limit: 1 }, now);
  const second = buildNewsContext(s, rows.reverse(), { teamId: "7", limit: 1, cursor: first.next_cursor }, new Date("2026-10-20T00:00:00Z"));
  assert.equal(second.news[0].news_id, "b");
  assert.deepEqual(second.filters, first.filters);
  assert.throws(() => buildNewsContext(s, [...rows, news("c")], { teamId: "7", cursor: first.next_cursor }, now), /restart without cursor/);
  assert.throws(() => buildNewsContext(s, rows, { cursor: first.next_cursor }, now), /restart without cursor/);
  assert.throws(() => buildNewsContext(s, rows, { cursor: "garbage" }, now), /Invalid.*cursor/);
  assert.throws(() => buildNewsContext(s, rows, { since: "2027-01-01T00:00:00Z" }, now), /window/);
});

test("ambiguous IDs, unresolved roster members, unknown players and empty results never imply clearance", async () => {
  const { buildNewsContext } = await api();
  const s = await fixture();
  const ambiguous = { ...s, players: [...s.players, { ...s.players[1]!, player_id: "collision", external_id: "101" }] };
  const r = buildNewsContext(ambiguous, [news("unknown", "no-match"), news("ambiguous")], { teamId: "7", candidatePlayerIds: ["missing"] }, now);
  assert.equal(r.coverage.unresolved_player_count, 2);
  assert.equal(r.omissions.unmapped_item_count, 2);
  assert.equal(r.coverage.source_completeness, "unknown");
  assert.equal(r.coverage.no_news_is_not_clearance, true);
  assert.equal(r.total_count, 0);
  assert.throws(() => buildNewsContext(s, [], { teamId: "missing" }, now), /team scope/);
  const empty = buildNewsContext(s, [], { playerIds: [] }, now);
  assert.equal(empty.coverage.scoped_player_count, 0);
});

test("injury scope uses both status fields, retains stale urgent statuses, paginates compact records and marks unknowns", async () => {
  const { buildInjuryContext } = await api();
  assert.equal(typeof buildInjuryContext, "function");
  const s = await fixture();
  const injured = { ...s, players: [{ ...s.players[0]!, status: "active", injury_status: "out", updated_at: "2020-01-01T00:00:00Z" }, { ...s.players[1]!, status: "out" }], free_agents: [{ ...s.free_agents[0]!, status: "unknown", injury_status: "unknown" }] };
  const r = buildInjuryContext(injured, { teamId: "7", candidatePlayerIds: ["103"], maxChars: 2048 }, now);
  assert.deepEqual(r.players.map((p: { player_id: string }) => p.player_id), ["canonical-a"]);
  assert.equal(r.coverage.unknown_status_count, 1);
  assert.equal(r.coverage.no_news_is_not_clearance, true);
  assert.equal(r.players[0].injury_status, "out");
  assert.equal(r.players[0].stale, true);
  assert.equal(r.players[0].external_ids, undefined);
  assert.ok(JSON.stringify(r).length <= 2048);
});

async function connected(snapshot: LeagueSnapshot, store: InMemoryV1Store) {
  const server = createPmtMcpServer({ deps: { dataDir: "data", reader: new FixturePlatformReader("tests/fixtures/sample-football-league.json"), repository: new InMemoryKnowledgeRepository({ snapshots: [snapshot] }), v1Store: store, actionQueue: new ActionQueue(new InMemoryActionQueueStore()), loadSnapshot: async () => snapshot, leagueExternalId: "external-league", teamId: "7", clock: () => now } });
  const client = new Client({ name: "news-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, close: async () => { await client.close(); await server.close(); }, call: async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const contents = result.content as { type: string; text: string }[];
    return JSON.parse(contents.find(c => c.type === "text")!.text);
  } };
}

test("MCP news/injury registrations apply configured roster defaults and read both league storage aliases", async () => {
  const s = await fixture();
  const store = new InMemoryV1Store();
  await store.saveNews("league", [news("canonical-store")]);
  await store.saveNews("external-league", [news("external-store"), news("other-player", "102")]);
  const c = await connected(s, store);
  try {
    const r = await c.call("pmt_list_news", { leagueId: "external-league", limit: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.data.total_count, 2);
    assert.ok(r.data.next_cursor);
    const next = await c.call("pmt_list_news", { leagueId: "external-league", limit: 1, cursor: r.data.next_cursor });
    assert.equal(next.data.returned_count, 1);
    assert.notEqual(next.data.news[0].news_id, r.data.news[0].news_id);
    const injuries = await c.call("pmt_list_injury_alerts", {});
    assert.equal(injuries.data.coverage.scoped_player_count, 1);
    assert.equal(r.data.scope.team_id, "team");
    assert.equal(r.data.scope.league_id, "league");
    assert.equal((await c.call("pmt_list_news", { leagueId: "external-league", teamId: "missing" })).ok, false);
  } finally { await c.close(); }
});

test("refresh persists every fetched row before returning a bounded roster page and explicit source degradation", async (t) => {
  const s = await fixture();
  const store = new InMemoryV1Store();
  const rows = Array.from({ length: 80 }, (_, i) => news(`refresh-${i}`, i % 2 ? "101" : "102", { summary: "x".repeat(5000) }));
  t.mock.method(EspnNewsSource.prototype, "fetchNews", async () => rows);
  t.mock.method(RazzballNewsSource.prototype, "fetchNews", async () => { throw new Error("offline"); });
  const c = await connected(s, store);
  try {
    const r = await c.call("pmt_run_news_injury_refresh", { maxChars: 3500, limit: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.data.ingested, 80);
    assert.equal((await store.getNews("league")).length, 80);
    assert.equal((await store.getNews("league"))[0]!.summary.length, 5000);
    assert.equal(r.data.total_count, 40);
    assert.equal(r.data.counts.espn, 80);
    assert.ok(r.data.degraded.razzball);
    assert.ok(JSON.stringify(r.data).length <= 3500);
    const next = await c.call("pmt_list_news", { leagueId: "external-league", maxChars: 3500, cursor: r.data.next_cursor });
    assert.equal(next.ok, true);
    assert.ok(next.data.news.length > 0);
    const bad = await c.call("pmt_run_news_injury_refresh", { sources: "typo" });
    assert.equal(bad.ok, false);
  } finally { await c.close(); }
});

test("urgent unresolvable/invalid-date news is explicitly counted and missing injury status is unknown", async () => {
  const { buildNewsContext, buildInjuryContext } = await api();
  const s = await fixture();
  const r = buildNewsContext(s, [news("unknown", "absent"), news("bad-date", "101", { published_at: "bad" })], { teamId: "7" }, now);
  assert.equal(r.omissions.unmapped_high_impact_count, 1);
  assert.equal(r.omissions.invalid_timestamp_high_impact_count, 1);
  const missing = { ...s, players: [{ ...s.players[0]!, injury_status: undefined }] };
  assert.equal(buildInjuryContext(missing, { teamId: "7" }, now).coverage.unknown_status_count, 1);
});

test("news window is inclusive and budgets reject oversize identities rather than dropping records", async () => {
  const { buildNewsContext } = await api();
  const s = await fixture();
  const since = "2026-10-14T12:00:00.000Z", until = now.toISOString();
  const r = buildNewsContext(s, [news("since", "101", { published_at: since }), news("until", "101", { published_at: until })], { since, until, playerIds: ["9001"] }, now);
  assert.equal(r.total_count, 2);
  assert.throws(() => buildNewsContext(s, [news("x".repeat(5000))], { maxChars: 2048 }, now), /increase maxChars/);
  assert.throws(() => buildNewsContext(s, [], { limit: 0 }, now), /limit/);
});
