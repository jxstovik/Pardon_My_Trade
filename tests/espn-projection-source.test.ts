import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EspnProjectionSource } from "../src/projections/espn-projection-source.js";

function fakeFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

const credentials = { leagueId: "999", season: "2025" };

test("espn source maps athletes to projection candidates with canonical stats", async () => {
  const fixture = JSON.parse(await readFile("tests/fixtures/espn-projections.json", "utf8"));
  const source = new EspnProjectionSource({ fetchImpl: fakeFetch(fixture), credentials });

  const candidates = await source.fetchProjections("football", "2025", "2025-W01");

  assert.equal(candidates.length, 2, "only matching projected scoring-period records are returned");
  const cmc = candidates.find((c) => c.name === "Christian McCaffrey");
  assert.ok(cmc);
  assert.deepEqual(cmc?.positions, ["RB"]);
  assert.equal(cmc?.projected_stats.rushing_yards, 95);
  assert.equal(cmc?.projected_stats.rushing_touchdowns, 0.7);
  assert.equal(cmc?.projected_stats.receptions, 3.2);
  assert.equal(cmc?.projected_points, 21.4);
  assert.equal(cmc?.player_id, "4037");
  assert.equal(cmc?.scoring_period, "2025-W01");
  assert.equal(cmc?.projected_stats.rushing_yards, 95);

  const lamb = candidates.find((c) => c.name === "CeeDee Lamb");
  assert.equal(lamb?.projected_stats.receiving_touchdowns, 0.5);
});

test("espn K/DST raw event stats rescore once using the imported league rules", async () => {
  const { EspnPlatformReader } = await import("../src/adapters/espn/espn-platform-reader.js");
  const { scoreProjectionPoints } = await import("../src/rules/rule-engine.js");
  const rules = JSON.parse(await readFile("tests/fixtures/espn-scoring-98806880-2026.json", "utf8"));
  const scoring = await new EspnPlatformReader({ credentials, fetchImpl: fakeFetch(rules) }).getScoringSettings("999");
  const playerStats = (stats: Record<string, number>, appliedStats: Record<string, number>, appliedTotal: number) => [
    { seasonId: 2025, scoringPeriodId: 1, statSourceId: 1, statSplitTypeId: 1, stats, appliedStats, appliedTotal }
  ];
  const source = new EspnProjectionSource({ credentials, fetchImpl: fakeFetch({players: [
    {player: {id: 1, fullName: "Test K", defaultPositionId: 5, stats: playerStats(
      {"77": 1, "80": 1, "85": 1, "86": 2, "88": 1, "198": 1, "201": 1},
      {"77": 4, "80": 3, "85": -1, "86": 2, "88": -1, "198": 5, "201": 5}, 17)}},
    {player: {id: 2, fullName: "Test DST", defaultPositionId: 16, stats: playerStats(
      {"89": 0.25, "99": 3, "95": 1, "123": 0.75, "136": 0.5},
      {"89": 1.25, "99": 3, "95": 2, "123": -0.75, "136": -3.5}, 2)}},
    {player: {id: 3, fullName: "Applied only", defaultPositionId: 5,
      stats: [{seasonId: 2025, scoringPeriodId: 1, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 9, appliedStats: {"77": 4, "198": 5}}]}}
  ]}) });
  const candidates = await source.fetchProjections("football", "2025", "2025-W01");
  assert.equal(candidates[0]?.projected_stats.field_goals_40_49, 1, "raw counts, not already-weighted points");
  assert.equal(candidates[1]?.projected_stats.points_allowed_0, 0.25, "retain fractional tier probabilities");
  for (const candidate of candidates) {
    const projection: import("../src/models/types.js").Projection = {...candidate, player_id: candidate.player_id!, scoring_period: "2025-W01",
      source: "espn", projection_id: "test", source_system: "espn", schema_version: "1.0.0", created_at: "2025-09-01", updated_at: "2025-09-01"};
    assert.equal(scoreProjectionPoints(scoring, projection, candidate.positions), candidate.projected_points);
  }
  assert.deepEqual(candidates[2]?.projected_stats, {}, "appliedStats are points contributions, never raw events");
});

test("espn source handles points as a bare number", async () => {
  const fixture = JSON.parse(await readFile("tests/fixtures/espn-projections.json", "utf8"));
  const source = new EspnProjectionSource({ fetchImpl: fakeFetch(fixture), credentials });
  const candidates = await source.fetchProjections("football", "2025", "2025-W01");
  const lamb = candidates.find((c) => c.name === "CeeDee Lamb");
  assert.equal(lamb?.projected_points, 18.1);
});

test("espn source calls fantasy player stats endpoint for the requested scoring period", async () => {
  let requestUrl = "";
  const source = new EspnProjectionSource({
    credentials,
    fetchImpl: (async (input: string | URL | Request) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ players: [] }), { status: 200 });
    }) as typeof fetch
  });
  await source.fetchProjections("football", "2025", "2025-W04");
  assert.match(requestUrl, /lm-api-reads\.fantasy\.espn\.com/);
  assert.match(requestUrl, /leagues\/999/);
  assert.match(requestUrl, /scoringPeriodId=4/);
  assert.doesNotMatch(requestUrl, /site\.web\.api\.espn\.com/);
});

test("espn projections require projected scoring-period stats and preserve negative points", async () => {
  const source = new EspnProjectionSource({
    credentials,
    fetchImpl: fakeFetch({ players: [{ player: {
      id: 900, fullName: "Negative DST", defaultPositionId: 16,
      stats: [
        { seasonId: 2025, scoringPeriodId: 1, statSourceId: 0, statSplitTypeId: 1, appliedTotal: -2, appliedStats: {} },
        { seasonId: 2025, scoringPeriodId: 1, statSourceId: 1, statSplitTypeId: 2, appliedTotal: -3, appliedStats: {} },
        { seasonId: 2025, scoringPeriodId: 1, statSourceId: 1, statSplitTypeId: 1, appliedTotal: -4, appliedStats: {} }
      ]
    } }] })
  });
  const [candidate] = await source.fetchProjections("football", "2025", "2025-W01");
  assert.equal(candidate?.projected_points, -4);
  assert.ok(candidate!.floor < candidate!.ceiling);
  assert.ok(candidate!.ceiling < 0, "negative points stay negative across the display interval");
});
