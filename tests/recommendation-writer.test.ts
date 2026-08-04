import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRecommendationMarkdown, saveRecommendation } from "../src/projections/recommendation-writer.js";

const rows = [
  { rank: 1, player: "Christian McCaffrey", team: "SF", position: "RB", value: 280.5, floor: 240, ceiling: 320 },
  { rank: 2, player: "Bijan Robinson", team: "ATL", position: "RB", value: 265.1, floor: 220, ceiling: 300 }
];

test("renderRecommendationMarkdown includes front matter and table", () => {
  const md = renderRecommendationMarkdown({ source: "razzball", query: "rb ros", url: "https://x", rows });
  assert.match(md, /^---\n/);
  assert.match(md, /source: razzball/);
  assert.match(md, /url: https:\/\/x/);
  assert.match(md, /Christian McCaffrey/);
  assert.match(md, /\| Rank \| Player \| Team \| Pos \| Proj \| Floor \| Ceiling \|/);
  assert.match(md, /280\.5/);
});

test("renderRecommendationMarkdown omits floor/ceiling when absent", () => {
  const md = renderRecommendationMarkdown({
    source: "razzball",
    query: "rb ros",
    url: "https://x",
    rows: [{ rank: 1, player: "A", team: "B", position: "RB", value: 100 }]
  });
  assert.doesNotMatch(md, /Floor/);
  assert.doesNotMatch(md, /Ceiling/);
});

test("saveRecommendation writes a dated file under the directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-rec-"));
  try {
    const clock = () => new Date("2026-08-03T15:42:00Z");
    const { path, markdown } = await saveRecommendation(
      { source: "razzball", query: "rb rest of season", url: "https://x", rows, clock },
      { directory: dir, clock }
    );
    assert.equal(path, join(dir, "2026-08-03-razzball-rb-rest-of-season.md"));
    const onDisk = await readFile(path, "utf8");
    assert.equal(onDisk, markdown);
    assert.match(onDisk, /fetched_at: 2026-08-03T15:42:00.000Z/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveRecommendation honours a no-op writer (no file on disk)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pmt-rec-"));
  try {
    const { path } = await saveRecommendation(
      { source: "razzball", query: "rb ros", url: "https://x", rows },
      { directory: dir, writeFileImpl: async () => {} }
    );
    // The custom writer was used instead of the filesystem, so nothing is on disk.
    await assert.rejects(() => readFile(path, "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
