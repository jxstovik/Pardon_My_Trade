import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../src/api/server.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";
import { InMemoryV1Store } from "../src/history/v1-store.js";
import { loadFixtureSnapshotSource } from "../src/knowledge/ingestion.js";
import type { ApiServer } from "../src/api/server.js";
import type { RefreshSummary } from "../src/models/v1.js";

test("api server serves health, league, refresh, and recommendations", async () => {
  const initial = await loadFixtureSnapshotSource("tests/fixtures/sample-football-league.json");
  const repository = new InMemoryKnowledgeRepository();
  const v1Store = new InMemoryV1Store();
  const refresh: () => Promise<RefreshSummary> = async () => ({
    refreshed_at: new Date().toISOString(),
    league_id: initial.league.league_id,
    team_id: "team-001",
    snapshot_id: "snap-1",
    news_ingested: 0,
    injury_alerts: 0,
    projection_updates: 0,
    notifications_sent: 0,
    weekly_report_id: "rec-1"
  });

  const server: ApiServer = createApiServer({ repository, v1Store, refresh, initialSnapshot: initial });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.status, "ok");

    const league = await (await fetch(`${base}/api/league`)).json();
    assert.equal(league.league.league_id, "league-001");

    const refreshRes = await (await fetch(`${base}/api/refresh`, { method: "POST" })).json();
    assert.equal(refreshRes.weekly_report_id, "rec-1");

    const traversal = await fetch(`${base}/%2e%2e/package.json`);
    assert.equal(traversal.status, 404);

    const recommendations = await (await fetch(`${base}/api/recommendations`)).json();
    assert.ok(Array.isArray(recommendations));

    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes("Pardon My Trade"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
