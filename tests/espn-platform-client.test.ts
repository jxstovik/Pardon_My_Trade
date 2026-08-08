import assert from "node:assert/strict";
import test from "node:test";
import { EspnPlatformClient } from "../src/adapters/espn/espn-platform-client.js";
import type { EspnCredentials } from "../src/adapters/espn/espn-auth.js";

function creds(overrides: Partial<EspnCredentials> = {}): EspnCredentials {
  return { leagueId: "lg1", season: "2026", ...overrides };
}

function stubFetch(handler: (url: string, init: { method: string; headers: Record<string, string> }) => unknown) {
  return ((url: string, init: { method: string; headers: Record<string, string> }) =>
    Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(handler(url, init)))
    } as Response)) as unknown as typeof fetch;
}

test("getJson defaults to league-scoped path and GET (no filter header)", async () => {
  let captured: { url: string; headers: Record<string, string> } | undefined;
  const client = new EspnPlatformClient({
    credentials: creds(),
    fetchImpl: stubFetch((url, init) => { captured = { url, headers: init.headers }; return {}; })
  });
  await client.getJson("foo", ["bar"]);
  assert.equal(captured!.url, "https://fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/1/leagues/lg1foo?view=bar");
  assert.equal(captured!.headers["X-Fantasy-Filter"], undefined);
});

test("getJson honours leaguedefaults scope, read host, view and GET filter", async () => {
  let captured: { url: string; headers: Record<string, string> } | undefined;
  const client = new EspnPlatformClient({
    credentials: creds(),
    fetchImpl: stubFetch((url, init) => { captured = { url, headers: init.headers }; return {}; })
  });
  await client.getJson("/draft/d1", {
    view: ["draftDetail"],
    filter: { players: { limit: 50, offset: 0 } },
    scope: { segment: 0, leagueDefaults: 3, readHost: true }
  });
  assert.equal(
    captured!.url,
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3/draft/d1?view=draftDetail"
  );
  assert.ok(captured!.headers["X-Fantasy-Filter"]?.includes("\"limit\":50"), "GET must send X-Fantasy-Filter");
});

test("postJson still sends X-Fantasy-Filter on POST", async () => {
  let captured: { url: string; headers: Record<string, string>; body?: string } | undefined;
  const client = new EspnPlatformClient({
    credentials: creds(),
    fetchImpl: stubFetch((url, init) => { captured = { url, headers: init.headers }; return {}; })
  });
  await client.postJson("/transactions/", { x: 1 }, { teams: { limit: 5 } });
  assert.equal(captured!.headers["content-type"], "application/json");
  assert.ok(captured!.headers["X-Fantasy-Filter"]?.includes("\"limit\":5"));
});
