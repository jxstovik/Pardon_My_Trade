import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFTodayProjectionSource, buildFFTDayUrl, posIdToPosition } from "../src/projections/fftoday-projection-source.js";
import { RecommendationCache } from "../src/projections/recommendation-cache.js";

function fakeFetch(body: string): typeof fetch {
  return (async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
}

async function isolatedCache(): Promise<{ cache: RecommendationCache; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "pmt-fft-cache-"));
  return { cache: new RecommendationCache({ directory: join(dir, "cache") }), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("buildFFTDayUrl builds season and weekly urls with posid", () => {
  assert.equal(buildFFTDayUrl({ position: "rb" }), "https://www.fftoday.com/playerproj.php?PosID=20");
  assert.equal(buildFFTDayUrl({ position: "qb", kind: "weekly", season: "2026", week: 3 }), "https://www.fftoday.com/playerwkproj.php?Season=2026&GameWeek=3&PosID=10");
  assert.equal(buildFFTDayUrl({ position: "dst" }), "https://www.fftoday.com/playerproj.php?PosID=99");
});

test("posIdToPosition maps posids", () => {
  assert.equal(posIdToPosition("10"), "QB");
  assert.equal(posIdToPosition("99"), "DST");
  assert.equal(posIdToPosition("80"), "K");
});

test("FFTodayProjectionSource parses rb projection html", async () => {
  const html = await readFile("tests/fixtures/fftoday-rb-proj.html", "utf8");
  const { cache, cleanup } = await isolatedCache();
  try {
    const source = new FFTodayProjectionSource({ position: "rb", fetchImpl: fakeFetch(html), cache });
    assert.equal(source.name, "fftoday-rb");

    const candidates = await source.fetchProjections("football", "2026", "2026-ROS");
    assert.equal(candidates.length, 2);
    const henry = candidates.find((c) => c.name === "Derrick Henry");
    assert.ok(henry);
    assert.equal(henry.team, "BAL");
    assert.deepEqual(henry.positions, ["RB"]);
    assert.equal(henry.projected_stats.rushing_yards, 1350);
    assert.equal(henry.projected_stats.receiving_yards, 150);
    assert.equal(henry.projected_points, 255.3);
  } finally {
    await cleanup();
  }
});

test("FFTodayProjectionSource throws when no table is present", async () => {
  const { cache, cleanup } = await isolatedCache();
  try {
    const source = new FFTodayProjectionSource({ position: "rb", fetchImpl: fakeFetch("<html><body>no table</body></html>"), cache });
    await assert.rejects(() => source.fetchProjections("football", "2026", "2026-ROS"), /parseable/i);
  } finally {
    await cleanup();
  }
});
