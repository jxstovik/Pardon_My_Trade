import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const directory = "artifacts/wr-2024-replay";

test("real WR replay records a causal cutoff and real source provenance", async () => {
  const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8")) as {
    data_status: string;
    preseason_cutoff: string;
    training_window: string;
    row_counts: { training: number; validation: number };
    matching: { rank: { matched: number; source_rows: number } };
  };
  assert.match(manifest.data_status, /real nflverse/);
  assert.equal(manifest.preseason_cutoff, "2024-09-04T08:00:00-04:00");
  assert.equal(manifest.training_window, "2018-2023");
  assert.ok(manifest.row_counts.training > 1000);
  assert.ok(manifest.row_counts.validation > 100);
  assert.ok(manifest.matching.rank.source_rows > 0);
  assert.ok(manifest.matching.rank.matched > 0);
});

test("real WR replay publishes model and rank benchmark artifacts", async () => {
  const metrics = JSON.parse(await readFile(`${directory}/metrics.json`, "utf8")) as Array<{
    model: string;
    samples: number;
    rank_samples: number;
    rmse?: number;
    spearman?: number;
  }>;
  const hardStats = metrics.find((row) => row.model === "hard_stats");
  const razzball = metrics.find((row) => row.model === "razzball_rank");
  assert.ok(hardStats && hardStats.samples > 100 && Number.isFinite(hardStats.rmse));
  assert.ok(razzball && razzball.rank_samples > 0 && Number.isFinite(razzball.spearman));
  assert.match(await readFile(`${directory}/report.md`, "utf8"), /archive-first Razzball/);
});

test("walk-forward replay publishes immutable checkpoints and a promotion decision", async () => {
  const manifest = JSON.parse(await readFile(`${directory}/walkforward-manifest.json`, "utf8")) as {
    replay_id: string;
    checkpoints: number;
    bootstrap: { unit: string; seed: number };
  };
  const promotion = JSON.parse(await readFile(`${directory}/promotion-decision.json`, "utf8")) as {
    approved: boolean;
    delta_ci?: { clusters?: number; status?: string };
  };
  assert.equal(manifest.replay_id, "chatpft-wr-2024");
  assert.equal(manifest.checkpoints, 19);
  assert.equal(manifest.bootstrap.unit, "target_period");
  assert.ok(manifest.bootstrap.seed > 0);
  assert.equal(promotion.approved, true);
  assert.equal(promotion.delta_ci?.status, "ok");
  assert.ok((promotion.delta_ci?.clusters ?? 0) >= 8);
});
