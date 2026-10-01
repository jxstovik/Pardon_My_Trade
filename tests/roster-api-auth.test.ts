import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../src/api/server.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";
import { InMemoryV1Store } from "../src/history/v1-store.js";
import { loadFixtureSnapshotSource } from "../src/knowledge/ingestion.js";

test("password auth protects roster APIs and requires CSRF for mutations", async () => {
  const originalPassword = process.env.PMT_WEB_PASSWORD;
  const originalSecret = process.env.PMT_WEB_SESSION_SECRET;
  const originalCookieSecure = process.env.PMT_COOKIE_SECURE;
  process.env.PMT_WEB_PASSWORD = "test-passphrase";
  process.env.PMT_WEB_SESSION_SECRET = "test-session-secret-long-enough";
  delete process.env.PMT_COOKIE_SECURE;
  const snapshot = await loadFixtureSnapshotSource("tests/fixtures/sample-football-league.json");
  const server = createApiServer({
    repository: new InMemoryKnowledgeRepository(),
    v1Store: new InMemoryV1Store(),
    initialSnapshot: snapshot,
    refresh: async () => ({
      refreshed_at: new Date().toISOString(), league_id: snapshot.league.league_id, team_id: "team-001",
      snapshot_id: snapshot.snapshot_id, news_ingested: 0, injury_alerts: 0, projection_updates: 0,
      notifications_sent: 0, weekly_report_id: "test-report"
    })
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const secureHeaders = { "x-forwarded-proto": "https" };
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/league`)).status, 401);
    assert.equal((await fetch(`${base}/api/modeling/artifact/manifest.json`)).status, 401);
    const asset = await fetch(`${base}/roster.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") || "", /javascript/);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { ...secureHeaders, "content-type": "application/json" },
      body: JSON.stringify({ password: "test-passphrase" })
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json() as { csrfToken: string };
    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie?.includes("HttpOnly"));
    assert.ok(cookie?.includes("Secure"));
    assert.ok(cookie?.includes("SameSite=Strict"));
    const sessionCookie = cookie!.split(";")[0]!;
    const csrfRejected = await fetch(`${base}/api/refresh`, { method: "POST", headers: { cookie: sessionCookie } });
    assert.equal(csrfRejected.status, 403);
    const refresh = await fetch(`${base}/api/refresh`, {
      method: "POST", headers: { cookie: sessionCookie, "x-csrf-token": loginBody.csrfToken }
    });
    assert.equal(refresh.status, 200);
    const league = await fetch(`${base}/api/league`, { headers: { cookie: sessionCookie } });
    assert.equal(league.status, 200);
    const scenario = await fetch(`${base}/api/free-agent-scenarios`, { method: "POST", headers: { cookie: sessionCookie } });
    assert.equal(scenario.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalPassword === undefined) delete process.env.PMT_WEB_PASSWORD; else process.env.PMT_WEB_PASSWORD = originalPassword;
    if (originalSecret === undefined) delete process.env.PMT_WEB_SESSION_SECRET; else process.env.PMT_WEB_SESSION_SECRET = originalSecret;
    if (originalCookieSecure === undefined) delete process.env.PMT_COOKIE_SECURE; else process.env.PMT_COOKIE_SECURE = originalCookieSecure;
  }
});
