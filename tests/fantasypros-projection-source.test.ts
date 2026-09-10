import assert from "node:assert/strict";
import test from "node:test";
import { parseFantasyProsRows, FantasyProsProjectionSource } from "../src/projections/fantasypros-projection-source.js";

const SAMPLE = `
<table>
<tr class="mpb-player-0"><td>
  <a class="fp-player-name" href="/nfl/players/jahmyr-gibbs">Jahmyr Gibbs</a>
  <span class="player-team">DET</span>
</td><td>254</td><td>18</td><td>17.2</td></tr>
<tr class="mpb-player-1"><td>
  <a class="fp-player-name" href="/nfl/players/bijan">Bijan Robinson</a>
  <span class="player-team">ATL</span>
</td><td>268</td><td>6</td><td>18.1</td></tr>
<tr><td><a class="fp-player-name">No Points Guy</a></td><td></td></tr>
</table>`;

test("parseFantasyProsRows extracts name, team, and final numeric cell", () => {
  const rows = parseFantasyProsRows(SAMPLE);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Jahmyr Gibbs");
  assert.equal(rows[0].team, "DET");
  assert.equal(rows[0].points, 17.2);
  assert.equal(rows[1].name, "Bijan Robinson");
  assert.equal(rows[1].points, 18.1);
});

test("FantasyProsProjectionSource builds candidates with PPR scoring url", async () => {
  let requestedUrl = "";
  const source = new FantasyProsProjectionSource({
    position: "rb",
    scoring: "PPR",
    optional: false,
    fetchImpl: (async (url: string | URL) => {
      requestedUrl = String(url);
      return new Response(SAMPLE, { status: 200 });
    }) as typeof fetch
  });
  const candidates = await source.fetchProjections("football", "2026", "2026-W1");
  assert.ok(requestedUrl.includes("scoring=PPR"), `url should request PPR: ${requestedUrl}`);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].projected_points, 17.2);
  assert.equal(candidates[0].positions[0], "RB");
});

test("optional source tolerates failures with lastSkipReason", async () => {
  const source = new FantasyProsProjectionSource({
    position: "k",
    optional: true,
    fetchImpl: (async () => new Response("nope", { status: 404 })) as typeof fetch
  });
  const candidates = await source.fetchProjections("football", "2026", "2026-W1");
  assert.deepEqual(candidates, []);
  assert.ok(source.lastSkipReason?.includes("404"));
});
