import assert from "node:assert/strict";
import test from "node:test";
import { EspnPlatformClient } from "../src/adapters/espn/espn-platform-client.js";
function creds(overrides = {}) {
    return { leagueId: "lg1", season: "2026", ...overrides };
}
function stubFetch(handler) {
    return ((url, init) => Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(handler(url, init)))
    }));
}
test("getJson defaults to league-scoped path and GET (no filter header)", async () => {
    let captured;
    const client = new EspnPlatformClient({
        credentials: creds(),
        fetchImpl: stubFetch((url, init) => { captured = { url, headers: init.headers }; return {}; })
    });
    await client.getJson("foo", ["bar"]);
    assert.equal(captured.url, "https://fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/1/leagues/lg1foo?view=bar");
    assert.equal(captured.headers["X-Fantasy-Filter"], undefined);
});
test("getJson honours leaguedefaults scope, read host, view and GET filter", async () => {
    let captured;
    const client = new EspnPlatformClient({
        credentials: creds(),
        fetchImpl: stubFetch((url, init) => { captured = { url, headers: init.headers }; return {}; })
    });
    await client.getJson("/draft/d1", {
        view: ["draftDetail"],
        filter: { players: { limit: 50, offset: 0 } },
        scope: { segment: 0, leagueDefaults: 3, readHost: true }
    });
    assert.equal(captured.url, "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3/draft/d1?view=draftDetail");
    assert.ok(captured.headers["X-Fantasy-Filter"]?.includes("\"limit\":50"), "GET must send X-Fantasy-Filter");
});
test("getJson supports league reads on ESPN's JSON read host", async () => {
    let capturedUrl;
    const client = new EspnPlatformClient({
        credentials: creds({ leagueId: "98806880", season: "2025" }),
        fetchImpl: stubFetch((url) => { capturedUrl = url; return {}; })
    });
    await client.getJson("", { view: ["mTeam"], scope: { segment: 0, readHost: true } });
    assert.equal(capturedUrl, "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/98806880?view=mTeam");
});
test("postJson still sends X-Fantasy-Filter on POST", async () => {
    let captured;
    const client = new EspnPlatformClient({
        credentials: creds(),
        fetchImpl: stubFetch((url, init) => { captured = { url, headers: init.headers }; return {}; })
    });
    await client.postJson("/transactions/", { x: 1 }, { teams: { limit: 5 } });
    assert.equal(captured.headers["content-type"], "application/json");
    assert.ok(captured.headers["X-Fantasy-Filter"]?.includes("\"limit\":5"));
});
test("GET retries transient rate limits and redacts cookies from request records", async () => {
    let calls = 0;
    const secret = "private-cookie-value";
    const client = new EspnPlatformClient({
        credentials: creds({ espnS2: secret, swid: "{private-swid}" }),
        readRetries: 1,
        fetchImpl: (async (_url, init) => {
            calls += 1;
            assert.match(String((init?.headers).cookie), /private-cookie-value/);
            return new Response(JSON.stringify({ ok: true }), { status: calls === 1 ? 429 : 200 });
        })
    });
    assert.deepEqual(await client.getJson(""), { ok: true });
    assert.equal(calls, 2);
    assert.equal(client.recordedRequests[0]?.headers.cookie, "[REDACTED]");
    assert.doesNotMatch(JSON.stringify(client.recordedRequests), /private-cookie-value|private-swid/);
});
test("GET failures classify status without exposing response bodies", async () => {
    const client = new EspnPlatformClient({
        credentials: creds(),
        readRetries: 0,
        fetchImpl: (async () => new Response("secret html", { status: 403 }))
    });
    await assert.rejects(client.getJson(""), (error) => {
        assert.match(error.message, /authentication or private-league access denied/);
        assert.doesNotMatch(error.message, /secret html/);
        return true;
    });
});
test("POST timeout is surfaced as unknown and is never retried", async () => {
    let calls = 0;
    const client = new EspnPlatformClient({
        credentials: creds(),
        timeoutMs: 5,
        readRetries: 3,
        fetchImpl: (async (_url, init) => {
            calls += 1;
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    const error = new Error("aborted");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
            });
        })
    });
    await assert.rejects(client.postJson("/transactions/", { type: "ADD" }), (error) => {
        assert.equal(error.code, "ESPN_WRITE_OUTCOME_UNKNOWN");
        return true;
    });
    assert.equal(calls, 1);
});
test("GET timeouts use bounded safe retries", async () => {
    let calls = 0;
    const client = new EspnPlatformClient({
        credentials: creds(),
        timeoutMs: 5,
        readRetries: 1,
        fetchImpl: (async (_url, init) => {
            calls += 1;
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    const error = new Error("aborted");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
            });
        })
    });
    await assert.rejects(client.getJson(""), /timed out after bounded retries/);
    assert.equal(calls, 2);
});
