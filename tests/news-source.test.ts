import assert from "node:assert/strict";
import test from "node:test";
import { FixtureNewsSource } from "../src/news/news-source.js";

test("fixture news source loads items and preserves shape", async () => {
  const source = new FixtureNewsSource("tests/fixtures/sample-news.json");
  const news = await source.fetchNews("league-001");
  assert.equal(news.length, 2);
  assert.equal(news[0].news_id, "news-001");
  assert.equal(news[0].source_system, "news-fixture");
});

test("fixture news source filters by since", async () => {
  const source = new FixtureNewsSource("tests/fixtures/sample-news.json");
  const news = await source.fetchNews("league-001", "2026-09-10T00:00:00Z");
  assert.equal(news.length, 1);
  assert.equal(news[0].news_id, "news-002");
});
