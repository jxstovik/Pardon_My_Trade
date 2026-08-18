import assert from "node:assert/strict";
import test from "node:test";
import {
  averageRanks,
  evaluateBenchmark,
  intervalMetrics,
  intervalScore,
  pinballLoss,
  quantileMetrics,
  rankMetrics,
  type BenchmarkObservation
} from "../src/projections/benchmark.js";
import {
  clusterBootstrapCI,
  pairedDeltaConfidenceInterval,
  type PairedNumericObservation
} from "../src/projections/bootstrap.js";

const rows: BenchmarkObservation[] = [
  { playerId: "a", scoringPeriod: "W1", actual: 10, predicted: 8, quantiles: { p10: 4, p50: 8, p90: 14 }, interval: { lower: 4, upper: 14 } },
  { playerId: "b", scoringPeriod: "W1", actual: 5, predicted: 7, quantiles: { p10: 2, p50: 7, p90: 12 }, interval: { lower: 2, upper: 12 } },
  { playerId: "c", scoringPeriod: "W2", actual: 20, predicted: 16, quantiles: { p10: 8, p50: 16, p90: 24 }, interval: { lower: 8, upper: 24 } }
];

test("point and pinball metrics use signed forecast errors", () => {
  const result = evaluateBenchmark(rows);
  assert.equal(result.point.samples, 3);
  assert.equal(result.point.mae, 8 / 3);
  assert.equal(result.point.bias, (-4) / 3);
  assert.equal(pinballLoss(10, 8, 0.5), 1);
  assert.equal(pinballLoss(5, 7, 0.1), 1.8);
});

test("quantile and interval metrics report calibration quantities", () => {
  const quantiles = quantileMetrics(rows, [0.1, 0.5, 0.9]);
  assert.equal(quantiles.byQuantile.length, 3);
  assert.equal(quantiles.byQuantile[1].pinballLoss, (1 + 1 + 2) / 3);
  assert.equal(intervalScore(1, 2, 4, 0.2), 12);
  const intervals = intervalMetrics(rows.map(({ actual, interval }) => ({ actual, ...interval! })));
  assert.equal(intervals.coverage, 1);
  assert.equal(intervals.width, 12);
  assert.equal(intervals.intervalScore, 12);
});

test("average ranks and rank metrics are tie-safe", () => {
  assert.deepEqual(averageRanks([10, 10, 5]), [1.5, 1.5, 3]);
  const result = rankMetrics([
    { scoringPeriod: "W1", actual: 10, predicted: 8 },
    { scoringPeriod: "W1", actual: 10, predicted: 8 },
    { scoringPeriod: "W1", actual: 5, predicted: 2 }
  ], { topK: [2] });
  assert.equal(result.samples, 3);
  assert.equal(result.mae, 0);
  assert.equal(result.spearman, 1);
  assert.equal(result.topKHitRate["2"], 1);
});

test("cluster bootstrap and paired delta intervals are deterministic", () => {
  const statistic = (sample: readonly BenchmarkObservation[]) => sample.reduce((sum, row) => sum + row.predicted - row.actual, 0) / sample.length;
  const first = clusterBootstrapCI(rows, statistic, { iterations: 200, seed: 42 });
  const second = clusterBootstrapCI(rows, statistic, { iterations: 200, seed: 42 });
  assert.deepEqual(first, second);
  assert.equal(first.clusters, 2);
  assert.equal(first.replicates, 200);

  const paired: PairedNumericObservation[] = rows.map((row) => ({
    scoringPeriod: row.scoringPeriod,
    baseline: row.actual,
    candidate: row.predicted
  }));
  const delta = pairedDeltaConfidenceInterval(paired, { iterations: 100, seed: 7 });
  assert.equal(delta.estimate, -4 / 3);
  assert.equal(delta.clusters, 2);
});
