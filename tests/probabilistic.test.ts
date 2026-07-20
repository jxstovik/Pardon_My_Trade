import assert from "node:assert/strict";
import test from "node:test";
import {
  createModel,
  updateModel,
  probabilityAbove,
  probabilityTable,
  expectedPoints,
  type ModelPrior,
  type Observation
} from "../src/probabilistic/bayesian-model.js";
import {
  buildModels,
  applyObservations,
  rankByValue,
  evaluateTrade,
  probabilityBeats,
  DEFAULT_SCARCITY
} from "../src/probabilistic/model-engine.js";
import { normalCdf, erf } from "../src/probabilistic/normal.js";
import { InMemoryModelStore, JsonModelStore } from "../src/probabilistic/model-store.js";

const prior = (over: Partial<ModelPrior> = {}): ModelPrior => ({
  playerId: "p1",
  playerName: "Test Player",
  position: "RB",
  historyMean: 12,
  historyVar: 16,
  ...over
});

test("erf is odd and bounded", () => {
  assert.ok(Math.abs(erf(0)) < 1e-9);
  assert.ok(Math.abs(erf(-1) + erf(1)) < 1e-9);
  assert.ok(Math.abs(erf(3) - 0.9999779) < 1e-4);
});

test("normalCdf matches known values", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-3);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
});

test("createModel seeds mu/sigma from history prior", () => {
  const model = createModel(prior());
  assert.equal(model.mu, 12);
  assert.equal(model.sigma, 4);
  assert.equal(model.weeksObserved, 0);
  assert.equal(model.lastObserved, null);
});

test("updateModel blends history mean with previous level", () => {
  let model = createModel(prior({ alpha: 0.3, historyMean: 10, historyVar: 9 }));
  // Before any observation the level is the history mean.
  model = updateModel(model, { playerId: "p1", week: 1, points: 20 });
  // mu = 0.3*10 + 0.7*10 = 10 (level was history mean)
  assert.ok(Math.abs(model.mu - 10) < 1e-9);
  assert.equal(model.weeksObserved, 1);
  // Next week the level is the previous realized points (20).
  const second = updateModel(model, { playerId: "p1", week: 2, points: 14 });
  // mu = 0.3*10 + 0.7*20 = 17
  assert.ok(Math.abs(second.mu - 17) < 1e-9);
  assert.equal(second.lastObserved, 14);
});

test("probabilityAbove increases as threshold decreases", () => {
  const model = createModel(prior({ historyMean: 12, historyVar: 16 }));
  assert.ok(probabilityAbove(model, 8) > probabilityAbove(model, 18));
  assert.ok(probabilityAbove(model, 100) < 0.001);
});

test("probabilityTable returns all thresholds", () => {
  const table = probabilityTable(createModel(prior()));
  assert.deepEqual(Object.keys(table).map(Number).sort((a, b) => a - b), [8, 12, 18]);
});

test("applyObservations updates only observed players immutably", () => {
  const models = buildModels([
    prior({ playerId: "a" }),
    prior({ playerId: "b" })
  ]);
  const observations: Observation[] = [
    { playerId: "a", week: 1, points: 25 },
    { playerId: "a", week: 2, points: 5 }
  ];
  const updated = applyObservations(models, observations);
  assert.equal(models.get("a")!.weeksObserved, 0, "original map untouched");
  assert.equal(updated.get("a")!.weeksObserved, 2);
  assert.equal(updated.get("b")!.weeksObserved, 0);
});

test("rankByValue orders by position-adjusted value", () => {
  const models = buildModels([
    prior({ playerId: "star", historyMean: 20, historyVar: 4, position: "RB" }),
    prior({ playerId: "ok", historyMean: 10, historyVar: 4, position: "WR" }),
    prior({ playerId: "kick", historyMean: 9, historyVar: 1, position: "K" })
  ]);
  const ranked = rankByValue(models.values());
  assert.equal(ranked[0].model.playerId, "star");
  assert.equal(ranked[ranked.length - 1].model.playerId, "kick");
});

test("probabilityBeats reflects mean gap", () => {
  const good = createModel(prior({ playerId: "g", historyMean: 18, historyVar: 4 }));
  const bad = createModel(prior({ playerId: "b", historyMean: 8, historyVar: 4 }));
  assert.ok(probabilityBeats(good, bad) > 0.95);
  assert.ok(Math.abs(probabilityBeats(bad, good) + probabilityBeats(good, bad) - 1) < 1e-9);
});

test("evaluateTrade computes net value and win probability", () => {
  const give = [createModel(prior({ playerId: "low", historyMean: 6, historyVar: 4 }))];
  const receive = [createModel(prior({ playerId: "high", historyMean: 15, historyVar: 4 }))];
  const evalResult = evaluateTrade(give, receive);
  assert.ok(evalResult.netValue > 0);
  assert.ok(evalResult.winProbability > 0.95);
});

test("JsonModelStore persists and reloads", async () => {
  const path = `./data/test-models-${Date.now()}.json`;
  const store = new JsonModelStore(path);
  await store.save(createModel(prior({ playerId: "x" })));
  await store.save(createModel(prior({ playerId: "y", historyMean: 5 })));
  const reloaded = new JsonModelStore(path);
  const list = await reloaded.list();
  assert.equal(list.length, 2);
  assert.ok(await reloaded.get("x"));
});
