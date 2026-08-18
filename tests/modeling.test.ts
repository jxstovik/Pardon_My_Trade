import assert from "node:assert/strict";
import test from "node:test";
import { calibrationMetrics } from "../src/projections/calibration.js";
import { runHistoricalBacktest } from "../src/projections/backtest.js";
import { aggregateProbabilisticModels, createHistoricalBaseline, type HistoricalPlayerStat } from "../src/projections/modeling.js";

const history: HistoricalPlayerStat[] = [
  { playerId: "qb", position: "QB", scoringPeriod: "W1", points: 20 },
  { playerId: "wr", position: "WR", scoringPeriod: "W1", points: 10 },
  { playerId: "qb", position: "QB", scoringPeriod: "W2", points: 22 },
  { playerId: "wr", position: "WR", scoringPeriod: "W2", points: 12 },
  { playerId: "qb", position: "QB", scoringPeriod: "W3", points: 18 },
  { playerId: "wr", position: "WR", scoringPeriod: "W3", points: 8 }
];

test("historical baseline and ensemble return probabilistic predictions", () => {
  const baseline = createHistoricalBaseline(history);
  const prediction = aggregateProbabilisticModels({ playerId: "qb", position: "QB", scoringPeriod: "W4", history: [20, 22, 18] }, [baseline]);
  assert.equal(prediction.quantiles.p50, prediction.mean);
  assert.ok(prediction.standardDeviation > 0);
  assert.ok(prediction.provenance.some((item) => item.kind === "metamodel"));
});

test("rolling backtest compares only future periods", () => {
  const result = runHistoricalBacktest(history, (training) => createHistoricalBaseline(training));
  assert.equal(result.predictions.length, 4);
  assert.equal(result.metrics[0].source, "historical-baseline");
});

test("rolling backtest orders double-digit weeks numerically", () => {
  const history: HistoricalPlayerStat[] = [
    { playerId: "wr", position: "WR", scoringPeriod: "2024-W1", points: 10 },
    { playerId: "wr", position: "WR", scoringPeriod: "2024-W10", points: 12 },
    { playerId: "wr", position: "WR", scoringPeriod: "2024-W2", points: 11 }
  ];
  const result = runHistoricalBacktest(history, (training) => createHistoricalBaseline(training));
  assert.deepEqual(result.predictions.map((prediction) => prediction.scoringPeriod), ["2024-W2", "2024-W10"]);
});

test("calibration reports interval coverage and spread", () => {
  const prediction = createHistoricalBaseline(history).predict({ playerId: "qb", position: "QB", scoringPeriod: "W4", history: [20, 22] });
  const metrics = calibrationMetrics([{ prediction, actual: 21 }]);
  assert.equal(metrics.samples, 1);
  assert.ok(metrics.averageSpread > 0);
});
