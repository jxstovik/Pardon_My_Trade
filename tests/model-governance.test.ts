import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";
import { createModel, type ModelPrior } from "../src/probabilistic/bayesian-model.js";
import {
  PostWeekOutcomeUpdateService,
  type PostWeekOutcomeUpdateRequest
} from "../src/probabilistic/model-governance.js";
import { InMemoryModelStore, JsonModelStore } from "../src/probabilistic/model-store.js";

const prior = (playerId: string): ModelPrior => ({
  playerId,
  playerName: playerId,
  position: "WR",
  historyMean: 10,
  historyVar: 4
});

const request = (overrides: Partial<PostWeekOutcomeUpdateRequest> = {}): PostWeekOutcomeUpdateRequest => ({
  season: "2026",
  week: 1,
  causalCutoff: "2026-09-15T12:00:00Z",
  observations: [{
    playerId: "p1",
    week: 1,
    scoringPeriod: "2026-W01",
    points: 18,
    observedAt: "2026-09-15T10:00:00Z",
    predictions: [{ source: "espn", predicted: 16 }]
  }],
  ...overrides
});

test("rejects an outcome after the causal cutoff without mutating models", async () => {
  const store = new InMemoryModelStore();
  await store.save(createModel(prior("p1")));
  const service = new PostWeekOutcomeUpdateService(store);

  await assert.rejects(
    service.update(request({
      observations: [{
        playerId: "p1",
        week: 1,
        scoringPeriod: "2026-W01",
        points: 18,
        observedAt: "2026-09-15T12:00:01Z"
      }]
    })),
    /Future observation rejected/
  );
  assert.equal((await store.get("p1"))!.weeksObserved, 0);
});

test("updates existing models through the recurrence and keeps weekly period state", async () => {
  const store = new InMemoryModelStore();
  await store.save(createModel(prior("p1")));
  await store.save(createModel(prior("p2")));
  const service = new PostWeekOutcomeUpdateService(store);

  const result = await service.update(request({
    observations: [
      { playerId: "p2", week: 1, scoringPeriod: "2026-W1", points: 6, observedAt: "2026-09-15T10:00:00Z" },
      { playerId: "p1", week: 1, scoringPeriod: "2026-W01", points: 18, observedAt: "2026-09-15T10:00:00Z" }
    ]
  }));

  assert.deepEqual(result.manifest.observed_player_ids, ["p1", "p2"]);
  assert.equal(result.manifest.weekly_scoring_period, "2026-W01");
  assert.equal(result.updatedModels.find((model) => model.playerId === "p1")!.mu, 10);
  assert.equal(result.updatedModels.find((model) => model.playerId === "p1")!.lastUpdatedScoringPeriod, "2026-W01");
  assert.equal((await store.get("p1"))!.weeksObserved, 1);
});

test("scores model and source forecasts and writes versioned rollback artifacts", async () => {
  const directory = `./data/test-model-governance-${Date.now()}`;
  try {
    const store = new JsonModelStore(`${directory}/models.json`);
    await store.save(createModel(prior("p1")));
    const service = new PostWeekOutcomeUpdateService(store, { artifactDir: directory });
    const result = await service.update(request({
      modelVersion: "bayesian-ewma-v2",
      observations: [{
        playerId: "p1",
        week: 1,
        scoringPeriod: "2026-W01",
        points: 18,
        observedAt: "2026-09-15T10:00:00Z",
        predictions: [
          { source: "espn", predicted: 16 },
          { source: "bayesian-ewma", predicted: 20 }
        ]
      }]
    }));

    assert.deepEqual(result.performance.map((metric) => metric.source).sort(), ["bayesian-ewma", "espn"]);
    assert.equal(result.performance.find((metric) => metric.source === "espn")!.mae, 2);
    assert.equal(result.decision.decision_version, "promotion-decision-v1");
    assert.equal(result.manifest.manifest_version, "model-governance-v1");
    assert.equal(result.manifest.rollback.snapshot_ref, "rollback-models.json");
    assert.equal(result.manifest.rollback.previous_model_count, 1);
    assert.equal(JSON.parse(await readFile(`${directory}/promotion-decision.json`, "utf8")).approved, true);
    assert.equal(JSON.parse(await readFile(`${directory}/rollback-models.json`, "utf8")).models[0].weeksObserved, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects season and rest-of-season scoring periods", async () => {
  const store = new InMemoryModelStore();
  await store.save(createModel(prior("p1")));
  const service = new PostWeekOutcomeUpdateService(store);

  await assert.rejects(
    service.update(request({
      observations: [{
        playerId: "p1",
        week: 1,
        scoringPeriod: "2026-ROS",
        points: 18,
        observedAt: "2026-09-15T10:00:00Z"
      }]
    })),
    /weekly period/
  );
});
