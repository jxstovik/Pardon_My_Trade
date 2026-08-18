import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ActionQueue, InMemoryActionQueueStore } from "../src/agents/action-queue.js";
import { FixturePlatformReader } from "../src/adapters/fixture/fixture-platform-reader.js";
import { InMemoryKnowledgeRepository } from "../src/knowledge/in-memory-knowledge-repository.js";
import { loadFixtureSnapshotSource } from "../src/knowledge/ingestion.js";
import { InMemoryV1Store } from "../src/history/v1-store.js";
import { PMT_MCP_CONTRACT_VERSION, PMT_MCP_TOOL_NAMES } from "../src/mcp/contracts.js";
import { createPmtMcpServer } from "../src/mcp/server.js";

const fixturePath = "tests/fixtures/sample-football-league.json";

test("PMT MCP exposes the versioned read-only contract", async () => {
  const snapshot = await loadFixtureSnapshotSource(fixturePath);
  const repository = new InMemoryKnowledgeRepository({ snapshots: [snapshot] });
  const server = createPmtMcpServer({
    deps: {
      dataDir: "data",
      reader: new FixturePlatformReader(fixturePath),
      repository,
      v1Store: new InMemoryV1Store(),
      actionQueue: new ActionQueue(new InMemoryActionQueueStore()),
      loadSnapshot: async () => snapshot,
      clock: () => new Date("2026-08-18T12:00:00.000Z")
    }
  });
  const client = new Client({ name: "pmt-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [...PMT_MCP_TOOL_NAMES].sort()
  );

  const result = await client.callTool({
    name: "pmt_get_current_scoring_period",
    arguments: { season: "2026", at: "2026-09-10T12:00:00.000Z" }
  });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === "text");
  if (!text || typeof text.text !== "string") throw new Error("MCP result did not contain text content.");
  const envelope = JSON.parse(text.text) as { contract_version: string; ok: boolean; data: { scoring_period: string } };
  assert.equal(envelope.contract_version, PMT_MCP_CONTRACT_VERSION);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.scoring_period, "2026-W1");

  await client.close();
  await server.close();
});

test("PMT MCP reads fixture league state and filters transactions", async () => {
  const snapshot = await loadFixtureSnapshotSource(fixturePath);
  const server = createPmtMcpServer({
    deps: {
      dataDir: "data",
      reader: new FixturePlatformReader(fixturePath),
      repository: new InMemoryKnowledgeRepository({ snapshots: [snapshot] }),
      v1Store: new InMemoryV1Store(),
      actionQueue: new ActionQueue(new InMemoryActionQueueStore()),
      loadSnapshot: async () => snapshot
    }
  });
  const client = new Client({ name: "pmt-fixture-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const leagueResult = await client.callTool({
    name: "pmt_espn_read_league",
    arguments: { leagueId: snapshot.league.external_id, season: snapshot.league.season }
  });
  const leagueContent = leagueResult.content as Array<{ type: string; text?: string }>;
  const leagueText = leagueContent.find((item) => item.type === "text");
  if (!leagueText || typeof leagueText.text !== "string") throw new Error("MCP league result did not contain text content.");
  const leagueEnvelope = JSON.parse(leagueText.text) as { ok: boolean; data: { league: { league_id: string } } };
  assert.equal(leagueEnvelope.ok, true);
  assert.equal(leagueEnvelope.data.league.league_id, snapshot.league.league_id);

  const transactionResult = await client.callTool({
    name: "pmt_espn_read_transactions",
    arguments: { leagueId: snapshot.league.external_id, since: "2999-01-01T00:00:00.000Z" }
  });
  const transactionContent = transactionResult.content as Array<{ type: string; text?: string }>;
  const transactionText = transactionContent.find((item) => item.type === "text");
  if (!transactionText || typeof transactionText.text !== "string") throw new Error("MCP transaction result did not contain text content.");
  const transactionEnvelope = JSON.parse(transactionText.text) as { data: { transactions: unknown[] } };
  assert.deepEqual(transactionEnvelope.data.transactions, []);

  await client.close();
  await server.close();
});
