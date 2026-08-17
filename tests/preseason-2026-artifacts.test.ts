import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const position of ["qb", "rb", "wr", "te"]) {
  test(`${position.toUpperCase()} 2026 preseason artifact is dashboard-compatible`, async () => {
    const directory = `artifacts/${position}-2026-preseason`;
    const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8")) as {
      position: string;
      season: number;
      prediction_horizon: string;
      row_counts: { predictions: number };
      matching: { rank: { matched: number } };
    };
    const prediction = JSON.parse((await readFile(`${directory}/weekly-predictions.jsonl`, "utf8")).split("\n")[0]) as {
      scoring_period: string;
      target_period: string;
      actual_points: number | null;
      model_points: number;
    };
    assert.equal(manifest.position, position.toUpperCase());
    assert.equal(manifest.season, 2026);
    assert.equal(manifest.prediction_horizon, "2026-ROS");
    assert.ok(manifest.row_counts.predictions > 20);
    assert.ok(manifest.matching.rank.matched > 0);
    assert.equal(prediction.scoring_period, "2026-ROS");
    assert.equal(prediction.target_period, "2026-ROS");
    assert.equal(prediction.actual_points, null);
    assert.ok(Number.isFinite(prediction.model_points));
    assert.match(await readFile(`${directory}/report.md`, "utf8"), /Razzball Comparison/);
  });
}
