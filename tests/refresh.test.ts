import assert from "node:assert/strict";
import test from "node:test";
import { runRefresh } from "../src/pipeline/refresh.js";
import { ScoringRuleEngine } from "../src/rules/rule-engine.js";
import { DefaultDecisionEngine } from "../src/decisions/decision-engine.js";
import { DefaultRecommendationEngine } from "../src/recommendations/recommendation-engine.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";
import { InMemoryV1Store } from "../src/history/v1-store.js";
import { FixtureNewsSource } from "../src/news/news-source.js";
import { ConsoleNotificationProvider } from "../src/notifications/notification-provider.js";

test("runRefresh ingests news, builds report, sends notifications, and records history", async () => {
  const clock = () => new Date("2026-09-10T12:00:00Z");
  const repository = new InMemoryKnowledgeRepository();
  const v1Store = new InMemoryV1Store();
  const ruleEngine = new ScoringRuleEngine();
  const decisionEngine = new DefaultDecisionEngine(ruleEngine);
  const recommendationEngine = new DefaultRecommendationEngine(ruleEngine, { clock });

  const summary = await runRefresh({
    fixturePath: "tests/fixtures/sample-football-league.json",
    newsPath: "tests/fixtures/sample-news.json",
    leagueExternalId: "pmt-demo-football",
    teamExternalId: "team-001",
    repository,
    v1Store,
    ruleEngine,
    decisionEngine,
    recommendationEngine,
    newsSource: new FixtureNewsSource("tests/fixtures/sample-news.json"),
    notificationProviders: [new ConsoleNotificationProvider()],
    clock
  });

  assert.equal(summary.news_ingested, 2);
  assert.equal(summary.league_id, "league-001");
  assert.ok(summary.weekly_report_id.length > 0);

  const stored = await repository.getRecommendation(summary.weekly_report_id);
  assert.ok(stored, "weekly report persisted");

  const history = await v1Store.getHistory("league-001");
  assert.equal(history.length, 1);

  const news = await v1Store.getNews("league-001");
  assert.equal(news.length, 2);

  const notifications = await v1Store.getNotifications("league-001");
  assert.ok(notifications.length >= 1);
  assert.equal(summary.notifications_sent, notifications.length);
});

test("runRefresh rejects unknown team", async () => {
  await assert.rejects(
    () => runRefresh({
      fixturePath: "tests/fixtures/sample-football-league.json",
      leagueExternalId: "pmt-demo-football",
      teamExternalId: "team-999",
      repository: new InMemoryKnowledgeRepository(),
      v1Store: new InMemoryV1Store(),
      ruleEngine: new ScoringRuleEngine(),
      decisionEngine: new DefaultDecisionEngine(new ScoringRuleEngine()),
      recommendationEngine: new DefaultRecommendationEngine(new ScoringRuleEngine())
    }),
    /Team team-999 was not found/
  );
});
