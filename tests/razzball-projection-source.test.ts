import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RazzballProjectionSource, buildRazzballUrl } from "../src/projections/razzball-projection-source.js";
import { RecommendationCache } from "../src/projections/recommendation-cache.js";

function fakeFetch(body: string): typeof fetch {
  return (async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
}

async function isolatedCache(): Promise<{ cache: RecommendationCache; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "pmt-rz-cache-"));
  return { cache: new RecommendationCache({ directory: join(dir, "cache") }), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("buildRazzballUrl builds ros, weekly, and pigskinonator urls", () => {
  assert.equal(buildRazzballUrl({ position: "rb", kind: "ros" }), "https://football.razzball.com/projections-rb-restofseason/");
  assert.equal(buildRazzballUrl({ position: "qb", kind: "weekly" }), "https://football.razzball.com/weekly-rankings-qb/");
  assert.equal(buildRazzballUrl({ position: "wr", kind: "weekly", ppr: true }), "https://football.razzball.com/weekly-rankings-wr-ppr/");
  assert.equal(buildRazzballUrl({ position: "dst", kind: "ros" }), "https://football.razzball.com/projections-teamdefense-restofseason/");
  assert.equal(buildRazzballUrl({ position: "rb", kind: "pigskinonator", week: 1 }), "https://football.razzball.com/pigskinonator-rb/?week=1");
});

test("RazzballProjectionSource parses ros rb html into candidates", async () => {
  const html = await readFile("tests/fixtures/razzball-rb-ros.html", "utf8");
  const { cache, cleanup } = await isolatedCache();
  try {
    const source = new RazzballProjectionSource({ position: "rb", fetchImpl: fakeFetch(html), cache });
    assert.equal(source.name, "razzball-rb");

    const candidates = await source.fetchProjections("football", "2026", "2026-ROS");
    assert.equal(candidates.length, 2);
    const cmc = candidates.find((c) => c.name === "Christian McCaffrey");
    assert.ok(cmc);
    assert.equal(cmc.projected_points, 280.5);
    assert.equal(cmc.floor, 240);
    assert.equal(cmc.ceiling, 320);
  } finally {
    await cleanup();
  }
});

test("RazzballProjectionSource premium without cookie throws a clear error", async () => {
  const html = await readFile("tests/fixtures/razzball-rb-ros.html", "utf8");
  const source = new RazzballProjectionSource({ position: "rb", kind: "pigskinonator", fetchImpl: fakeFetch(html) });
  await assert.rejects(() => source.fetchProjections("football", "2026", "2026-W01"), /premium/i);
});

test("optional premium source falls back to no candidates when the session is missing", async () => {
  const html = await readFile("tests/fixtures/razzball-rb-ros.html", "utf8");
  const source = new RazzballProjectionSource({
    position: "rb",
    kind: "pigskinonator",
    fetchImpl: fakeFetch(html),
    optional: true
  });
  assert.deepEqual(await source.fetchProjections("football", "2026", "2026-W01"), []);
  assert.match(source.lastSkipReason ?? "", /premium/i);
});

test("Razzball reports an invalid projection schema", async () => {
  const { cache, cleanup } = await isolatedCache();
  try {
    const source = new RazzballProjectionSource({ position: "rb", fetchImpl: fakeFetch("<html>login page</html>"), cache });
    await assert.rejects(() => source.fetchProjections("football", "2026", "2026-ROS"), /schema is invalid/i);
  } finally {
    await cleanup();
  }
});
