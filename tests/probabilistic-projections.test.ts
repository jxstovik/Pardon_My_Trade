import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePredictions } from "../src/projections/performance.js";
import { resolveProjectionFallback } from "../src/projections/fallback.js";
import { projectionFromPoint } from "../src/projections/probabilistic.js";

test("probabilistic projection exposes mean, spread, and ordered quantiles", () => {
  const projection = projectionFromPoint("p1", "W1", 20, 5, [{ source: "history", kind: "historical" }]);
  assert.equal(projection.mean, 20);
  assert.equal(projection.quantiles.p50, 20);
  assert.ok(projection.quantiles.p10 <= projection.quantiles.p90);
});

test("Razzball is a widened-uncertainty per-player fallback", () => {
  const result = resolveProjectionFallback(undefined, [], {
    playerId: "p1", source: "razzball", projectedPoints: 15, scoringPeriod: "W1"
  });
  assert.ok(result);
  assert.equal(result.reason, "razzball");
  assert.equal(result.projection.fallback, "razzball");
  assert.equal(result.projection.modelVersion, "razzball-fallback-v1");
});

test("performance metrics compare source errors and rank by RMSE", () => {
  const metrics = evaluatePredictions([
    { playerId: "p1", scoringPeriod: "W1", source: "razzball", predicted: 10, actual: 12 },
    { playerId: "p2", scoringPeriod: "W1", source: "razzball", predicted: 20, actual: 18 },
    { playerId: "p1", scoringPeriod: "W1", source: "metamodel", predicted: 12, actual: 12 },
    { playerId: "p2", scoringPeriod: "W1", source: "metamodel", predicted: 18, actual: 18 }
  ]);
  assert.equal(metrics[0].source, "metamodel");
  assert.equal(metrics[0].mae, 0);
  assert.equal(metrics[1].bias, 0);
});
