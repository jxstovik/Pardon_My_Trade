import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { RazzballNewsSource, parseRazzballNews } from "../src/news/razzball-news-source.js";

function fakeFetch(body: string, status = 200): typeof fetch {
  return (() => Promise.resolve(new Response(body, { status, headers: { "content-type": "application/rss+xml" } }))) as unknown as typeof fetch;
}

test("Razzball news source parses RSS player categories through an explicit id map", async () => {
  const body = await readFile("tests/fixtures/razzball-news.xml", "utf8");
  const source = new RazzballNewsSource({
    fetchImpl: fakeFetch(body),
    feedUrl: "https://example.test/razzball-feed",
    playerIdsByName: { "nico west": "10101", "miles hart": "20202" }
  });
  const news = await source.fetchNews("league-001", "2026-09-10T00:00:00Z");

  assert.equal(news.length, 1);
  assert.equal(news[0]?.news_id, "81001");
  assert.equal(news[0]?.player_id, "10101");
  assert.equal(news[0]?.source_system, "razzball-news");
  assert.equal(news[0]?.impact, "medium");
  assert.equal(news[0]?.parser_version, "razzball-news-v1");
  assert.match(news[0]?.content_hash ?? "", /^[a-f0-9]{64}$/);
});

test("Razzball parser skips articles with no resolvable player id", () => {
  const news = parseRazzballNews(
    "<rss><channel><item><title>General advice</title><pubDate>Thu, 10 Sep 2026 19:00:00 +0000</pubDate><guid>81003</guid></item></channel></rss>"
  );
  assert.deepEqual(news, []);
});

test("Razzball news source degrades on feed failures", async () => {
  const source = new RazzballNewsSource({ fetchImpl: fakeFetch("unavailable", 503) });
  assert.deepEqual(await source.fetchNews("league-001"), []);
});
