import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EspnProjectionSource } from "../src/projections/espn-projection-source.js";
function fakeFetch(body) {
    return (async () => new Response(JSON.stringify(body), { status: 200 }));
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
        fetchImpl: (async (input) => {
            requestUrl = String(input);
            return new Response(JSON.stringify({ players: [] }), { status: 200 });
        })
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
    assert.ok(candidate.floor < candidate.ceiling);
    assert.ok(candidate.ceiling < 0, "negative points stay negative across the display interval");
});
