import assert from "node:assert/strict";
import test from "node:test";
import { ActionExecutor, InMemoryActionExecutionStore, JsonActionExecutionStore, rosterFingerprint } from "../src/agents/action-executor.js";
import { actionPayloadHash, ActionQueue, InMemoryActionQueueStore } from "../src/agents/action-queue.js";
import { EspnPlatformWriter } from "../src/adapters/espn/espn-platform-writer.js";
import type { PlatformReader } from "../src/adapters/platform-reader.js";
import type { PlatformWriter } from "../src/adapters/platform-writer.js";
import type { AgentAction } from "../src/agents/types.js";
import type { Player, Roster, WaiverState } from "../src/models/types.js";
import { rm } from "node:fs/promises";

function makeRoster(teamId: string, playerId: string, locked = false): Roster {
  return {
    team_id: teamId,
    starters: [{
      slot_id: `${teamId}-starter`,
      slot_type: "QB",
      allowed_positions: ["QB"],
      locked,
      player_id: playerId
    }],
    bench: [],
    injured_reserve: [],
    taxi: [],
    last_updated_at: "2026-09-10T00:00:00Z"
  };
}

function player(playerId: string): Player {
  return { player_id: playerId } as Player;
}

function makeReader(rosters: Map<string, Roster>, freeAgentIds: string[] = ["fa-1"]): PlatformReader {
  const waiverState: WaiverState = {
    schema_version: "1.0.0",
    created_at: "",
    updated_at: "",
    source_system: "fake",
    source_record_id: "waiver",
    league_id: "lg1",
    waiver_order: ["1"],
    faab_budgets: { "1": 100 }
  };
  return {
    getLeague: async () => { throw new Error("unused"); },
    getTeams: async () => [],
    getRoster: async (_leagueId, teamId) => {
      const roster = rosters.get(teamId);
      if (!roster) throw new Error(`missing roster ${teamId}`);
      return roster;
    },
    getScoringSettings: async () => { throw new Error("unused"); },
    getRosterSettings: async () => { throw new Error("unused"); },
    getStandings: async () => [],
    getSchedule: async () => [],
    getPlayers: async () => [],
    getFreeAgents: async () => freeAgentIds.map(player),
    getWaiverState: async () => waiverState,
    getTransactions: async () => []
  };
}

function makeWriter(overrides: Partial<PlatformWriter> = {}): PlatformWriter & { calls: string[] } {
  const calls: string[] = [];
  return {
    platform: "fixture",
    calls,
    setRoster: async () => { calls.push("set_roster"); return { ok: true }; },
    addDrop: async () => { calls.push("add_drop"); return { ok: true }; },
    submitWaiverClaim: async () => { calls.push("waiver_claim"); return { ok: true }; },
    proposeTrade: async () => { calls.push("propose_trade"); return { ok: true }; },
    ...overrides
  };
}

test("ESPN writer submits the explicit FAAB waiver contract", async () => {
  const writer = new EspnPlatformWriter({
    credentials: { leagueId: "999", season: "2026", swid: "{fixture-member}", espnS2: "fixture-cookie" },
    fetchImpl: (async (_input, init) => new Response(JSON.stringify(init?.method === "GET"
      ? { id: 999, seasonId: 2026, scoringPeriodId: 5, teams: [{ id: 1, owners: ["fixture-member"] }] }
      : { ok: true }), { status: 200 })) as typeof fetch
  });
  await writer.submitWaiverClaim("999", { type: "waiver_claim", teamId: "1", addPlayerId: "301", dropPlayerId: "103", faabBid: 17 });
  const request = writer.client.recordedRequests.find((request) => request.method === "POST");
  assert.ok(request?.url.includes("/segments/0/leagues/999/transactions/"));
  assert.deepEqual(request?.body, {
    isLeagueManager: false, teamId: 1, type: "WAIVER", memberId: "{fixture-member}", scoringPeriodId: 5, executionType: "EXECUTE", bidAmount: 17,
    items: [{ type: "ADD", playerId: 301, toTeamId: 1 }, { type: "DROP", playerId: 103, fromTeamId: 1 }]
  });
});

test("executor revalidates, records audit/receipt, and is idempotent", async () => {
  const roster = makeRoster("1", "p-1");
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const action: AgentAction = {
    type: "set_roster",
    teamId: "1",
    starters: [{ playerId: "p-1", slot: "QB" }]
  };
  const queued = await queue.enqueue(action, "low", "test", {
    preconditions: { leagueExternalId: "lg1", expectedRosterHashes: { "1": rosterFingerprint(roster) } }
  });
  await queue.approve(queued.actionId);
  assert.equal(queued.payloadHash, actionPayloadHash(action));
  assert.match(queued.idempotencyKey ?? "", new RegExp(queued.payloadHash ?? "never"));
  const writer = makeWriter();
  const store = new InMemoryActionExecutionStore();
  const executor = new ActionExecutor({
    queue,
    reader: makeReader(new Map([["1", roster]])),
    writer,
    store
  });

  const first = await executor.execute(queued.actionId);
  const second = await executor.execute(queued.actionId);
  assert.equal(first.status, "executed");
  assert.equal(second.status, "already_executed");
  assert.deepEqual(writer.calls, ["set_roster"]);
  assert.equal((await store.listReceipts()).length, 1);
  assert.ok((await store.listAudit()).some((record) => record.event === "executed"));
  assert.equal((await queue.get(queued.actionId))?.status, "executed");
});

test("executor never writes an unapproved or expired action", async () => {
  const action: AgentAction = { type: "add_drop", teamId: "1", addPlayerIds: ["fa-1"], dropPlayerIds: ["p-1"] };
  const reader = makeReader(new Map([["1", makeRoster("1", "p-1")]]));
  const writer = makeWriter();
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const pending = await queue.enqueue(action, "high", "test");
  const executor = new ActionExecutor({ queue, reader, writer, leagueExternalId: "lg1" });
  assert.equal((await executor.execute(pending.actionId)).status, "blocked");

  const expired = await queue.enqueue(action, "high", "test", -1);
  assert.equal((await executor.execute(expired.actionId)).status, "blocked");
  assert.deepEqual(writer.calls, []);
  assert.equal((await queue.get(expired.actionId))?.status, "expired");
});

test("stale preconditions block without a POST", async () => {
  const original = makeRoster("1", "p-1");
  const current = makeRoster("1", "p-2");
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const queued = await queue.enqueue(
    { type: "set_roster", teamId: "1", starters: [{ playerId: "p-2", slot: "QB" }] },
    "low",
    "stale proposal",
    { preconditions: { leagueExternalId: "lg1", expectedRosterHashes: { "1": rosterFingerprint(original) } } }
  );
  await queue.approve(queued.actionId);
  const writer = makeWriter();
  const executor = new ActionExecutor({
    queue,
    reader: makeReader(new Map([["1", current]])),
    writer
  });

  const result = await executor.execute(queued.actionId);
  assert.equal(result.status, "blocked");
  assert.match(result.reason ?? "", /roster_precondition_mismatch/);
  assert.deepEqual(writer.calls, []);
});

test("ambiguous writer failures become unknown and are never retried", async () => {
  const roster = makeRoster("1", "p-1");
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const queued = await queue.enqueue(
    { type: "set_roster", teamId: "1", starters: [{ playerId: "p-1", slot: "QB" }] },
    "low",
    "network test"
  );
  await queue.approve(queued.actionId);
  let writes = 0;
  const writer = makeWriter({
    setRoster: async () => {
      writes += 1;
      throw new Error("socket closed after request");
    }
  });
  const executor = new ActionExecutor({
    queue,
    reader: makeReader(new Map([["1", roster]])),
    writer,
    leagueExternalId: "lg1"
  });

  const first = await executor.execute(queued.actionId);
  const second = await executor.execute(queued.actionId);
  assert.equal(first.status, "unknown");
  assert.equal(second.status, "unknown");
  assert.equal(writes, 1);
  assert.equal((await queue.get(queued.actionId))?.status, "unknown");
});

test("JSON execution store preserves receipts and audit across instances", async () => {
  const path = `./data/test-action-execution-${Date.now()}.json`;
  try {
    const first = new JsonActionExecutionStore(path);
    await first.saveReceipt({
      receiptId: "receipt-1",
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payloadHash: "hash-1",
      status: "unknown",
      recordedAt: "2026-09-10T00:00:00Z",
      error: "connection reset"
    });
    await first.appendAudit({
      auditId: "audit-1",
      actionId: "action-1",
      idempotencyKey: "idem-1",
      payloadHash: "hash-1",
      event: "unknown",
      recordedAt: "2026-09-10T00:00:01Z"
    });

    const second = new JsonActionExecutionStore(path);
    assert.equal((await second.getReceipt("action-1"))?.status, "unknown");
    assert.equal((await second.listAudit()).length, 1);
  } finally {
    await rm(path, { force: true });
  }
});

test("waiver execution blocks a player who cleared waivers after approval", async () => {
  const queue = new ActionQueue(new InMemoryActionQueueStore());
  const reader = Object.assign(makeReader(new Map([["1", makeRoster("1", "p-1")]]), ["fa-1"]), { getAcquisitionStatus: async () => "FREEAGENT" });
  const writer = makeWriter();
  const pending = await queue.enqueue({type:"waiver_claim",teamId:"1",addPlayerId:"fa-1",dropPlayerId:"p-1",priority:1},"high","test",{preconditions:{leagueExternalId:"lg1"}});
  await queue.approve(pending.actionId, "human");
  const executor = new ActionExecutor({queue,reader,writer,store:new InMemoryActionExecutionStore(),leagueExternalId:"lg1"});
  const result = await executor.execute(pending.actionId);
  assert.equal(result.status,"blocked"); assert.equal(result.reason,"acquisition_status_changed");
  assert.deepEqual(writer.calls,[]);
});
