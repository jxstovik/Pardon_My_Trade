import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EspnNewsSource, parseEspnNews } from "../src/news/espn-news-source.js";

function fakeFetch(body: string, status = 200): typeof fetch {
  return (() => Promise.resolve(new Response(body, { status, headers: { "content-type": "application/json" } }))) as unknown as typeof fetch;
}

test("ESPN news source parses player-linked articles and filters by publication time", async () => {
  const body = await readFile("tests/fixtures/espn-news.json", "utf8");
  const source = new EspnNewsSource({ fetchImpl: fakeFetch(body), baseUrl: "https://example.test/espn-news" });
  const news = await source.fetchNews("league-001", "2026-09-10T00:00:00Z");

  assert.equal(news.length, 1);
  assert.equal(news[0]?.news_id, "7001");
  assert.equal(news[0]?.player_id, "10101");
  assert.equal(news[0]?.source_system, "espn-news");
  assert.equal(news[0]?.impact, "medium");
  assert.equal(news[0]?.parser_version, "espn-news-v1");
  assert.match(news[0]?.content_hash ?? "", /^[a-f0-9]{64}$/);
});

test("ESPN news parser skips articles without a stable athlete id", () => {
  assert.deepEqual(parseEspnNews({ articles: [{ id: 1, headline: "No player", published: "2026-09-10T00:00:00Z" }] }), []);
});

test("ESPN news source degrades on transport and JSON failures", async () => {
  const failed = new EspnNewsSource({ fetchImpl: fakeFetch("unavailable", 503) });
  assert.deepEqual(await failed.fetchNews("league-001"), []);

  const malformed = new EspnNewsSource({ fetchImpl: fakeFetch("not-json") });
  assert.deepEqual(await malformed.fetchNews("league-001"), []);
});
