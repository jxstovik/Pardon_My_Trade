import assert from "node:assert/strict";
import test from "node:test";
import { runEspnDoctor } from "../src/adapters/espn/espn-doctor.js";

const league = {
  id: 999,
  seasonId: 2025,
  scoringPeriodId: 4,
  settings: { scoringSettings: { scoringItems: [{ statId: 3, points: 0.04 }] } },
  teams: [{ id: 1, roster: { entries: [{ playerId: 4037, lineupSlotId: 2 }] } }]
};
const pool = { players: [{ player: {
  id: 4037, firstName: "Chris", lastName: "McCaffrey", defaultPositionId: 2,
  stats: [{ seasonId: 2025, scoringPeriodId: 4, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 20, appliedStats: { "24": 100 } }]
} }] };

test("doctor reports read-only checks and projection coverage without leaking credentials", async () => {
  const report = await runEspnDoctor({
    credentials: { leagueId: "999", season: "2025", espnS2: "secret-s2", swid: "secret-swid" },
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes("kona_player_info") ? pool : league), { status: 200 });
    }) as typeof fetch
  });
  assert.equal(report.validation, "read-only-runtime-checks");
  assert.equal(report.summary.fail, 0);
  assert.ok(report.checks.some((check) => check.name === "projection_coverage" && check.detail.includes("1/1")));
  assert.doesNotMatch(JSON.stringify(report), /secret-s2|secret-swid/);
});

test("doctor returns a configuration failure without making network requests", async () => {
  let calls = 0;
  const report = await runEspnDoctor({
    credentials: undefined,
    fetchImpl: (async () => { calls += 1; return new Response("{}", { status: 200 }); }) as typeof fetch
  });
  assert.equal(calls, 0);
  assert.equal(report.summary.fail, 1);
  assert.match(report.checks[0]!.detail, /league ID is missing/);
});
