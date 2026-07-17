import assert from "node:assert/strict";
import test from "node:test";
import { runWeeklyReport } from "../src/pipeline/weekly-report.js";
import { assertRecommendation } from "../src/models/validation.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";

test("weekly report pipeline runs end-to-end on the fixture snapshot", async () => {
  const repository = new InMemoryKnowledgeRepository();
  const result = await runWeeklyReport(
    "tests/fixtures/sample-football-league.json",
    "pmt-demo-football",
    "team-001",
    { repository, clock: () => new Date("2026-09-08T12:00:00Z") }
  );

  assert.equal(result.team.name, "The Waiver Wires");
  assert.equal(result.lineupEvaluationValid, true);
  assert.ok(result.inputs.currentProjectedPoints >= 0);

  const saved = await repository.getRecommendation(result.report.recommendation_id);
  assert.ok(saved, "recommendation should be persisted to the knowledge repository");

  assert.doesNotThrow(() => assertRecommendation(result.report));
  assert.equal(result.report.type, "weekly_report");
});

test("weekly report pipeline rejects unknown team", async () => {
  await assert.rejects(
    () => runWeeklyReport("tests/fixtures/sample-football-league.json", "pmt-demo-football", "team-999"),
    /Team team-999 was not found/
  );
});
