import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = join(process.cwd(), "scripts", "stats-betting-readout.mjs");

test("readout scores an explicit custom league from raw draws without inventing a quote", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmt-stats-readout-"));
  const bundle = join(dir, "bundle.json");
  writeFileSync(bundle, JSON.stringify({
    player_id: "gsis-1", position: "TE", season: 2025, week: 1,
    status: "conditional_on_recorded_game", source: "unit-test",
    scoring: { scoring_type: "custom", rules: [
      { rule_id: "rec", category: "receiving", stat: "receptions", points: 1,
        conditions: {}, applies_to_positions: ["TE"] }
    ] },
    samples: [{ receptions: 3 }, { receptions: 5 }]
  }));
  const output = JSON.parse(execFileSync("node", [script, "--bundle", bundle], { encoding: "utf8" }));
  assert.equal(output.player_id, "gsis-1");
  assert.equal(output.fantasy.mean_points, 4);
  assert.equal(output.betting.status, "no_timestamped_quote");
});
