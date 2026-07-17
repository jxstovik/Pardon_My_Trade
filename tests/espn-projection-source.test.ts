import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { EspnProjectionSource } from "../src/projections/espn-projection-source.js";

function fakeFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

test("espn source maps athletes to projection candidates with canonical stats", async () => {
  const fixture = JSON.parse(await readFile("tests/fixtures/espn-projections.json", "utf8"));
  const source = new EspnProjectionSource({ fetchImpl: fakeFetch(fixture) });

  const candidates = await source.fetchProjections("football", "2025", "2025-W01");

  assert.equal(candidates.length, 3);
  const cmc = candidates.find((c) => c.name === "Christian McCaffrey");
  assert.ok(cmc);
  assert.deepEqual(cmc?.positions, ["RB"]);
  assert.equal(cmc?.projected_stats.rushing_yards, 95);
  assert.equal(cmc?.projected_stats.rushing_touchdowns, 0.7);
  assert.equal(cmc?.projected_stats.receptions, 3.2);
  assert.equal(cmc?.projected_points, 21.4);

  const lamb = candidates.find((c) => c.name === "CeeDee Lamb");
  assert.equal(lamb?.projected_stats.receiving_touchdowns, 0.5);
});

test("espn source handles points as a bare number", async () => {
  const fixture = JSON.parse(await readFile("tests/fixtures/espn-projections.json", "utf8"));
  const source = new EspnProjectionSource({ fetchImpl: fakeFetch(fixture) });
  const candidates = await source.fetchProjections("football", "2025", "2025-W01");
  const lamb = candidates.find((c) => c.name === "CeeDee Lamb");
  assert.equal(lamb?.projected_points, 18.1);
});
