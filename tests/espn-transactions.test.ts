import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EspnPlatformReader } from "../src/adapters/espn/espn-platform-reader.js";
import { parseEspnTransactions } from "../src/adapters/espn/espn-transaction-parser.js";

function fakeFetch(body: string): typeof fetch {
  return ((url: string) => {
    if (url.includes("view=mTransactions")) {
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  }) as unknown as typeof fetch;
}

test("ESPN getTransactions uses mTransactions and maps typed records", async () => {
  const body = await readFile("tests/fixtures/espn-transactions.json", "utf8");
  const reader = new EspnPlatformReader({
    credentials: { leagueId: "999", season: "2026" },
    fetchImpl: fakeFetch(body)
  });

  const transactions = await reader.getTransactions("999", "2026-09-10T00:00:00Z");
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0]?.transaction_id, "txn-001");
  assert.equal(transactions[0]?.type, "add");
  assert.deepEqual(transactions[0]?.team_ids, ["1"]);
  assert.deepEqual(transactions[0]?.player_ids, ["301"]);
  assert.ok(reader.client.recordedRequests[0]?.url.includes("view=mTransactions"));
});

test("unsupported ESPN transaction payloads produce no fabricated records", () => {
  assert.deepEqual(parseEspnTransactions({ transactions: [{ id: "missing-fields" }] }, "999"), []);
  assert.deepEqual(parseEspnTransactions({ unexpected: [] }, "999"), []);
});
