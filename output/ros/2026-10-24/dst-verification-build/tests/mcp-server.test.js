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
const operatorTools = new Set(["pmt_prepare_kickoff_lineup", "pmt_prepare_lineup", "pmt_prepare_add_drop", "pmt_action_approve", "pmt_action_reject", "pmt_action_execute"]);
test("PMT MCP defaults to the versioned adviser contract without operator tools", async () => {
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
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...PMT_MCP_TOOL_NAMES].filter((name) => !operatorTools.has(name)).sort());
    const result = await client.callTool({
        name: "pmt_get_current_scoring_period",
        arguments: { season: "2026", at: "2026-09-10T12:00:00.000Z" }
    });
    const content = result.content;
    const text = content.find((item) => item.type === "text");
    if (!text || typeof text.text !== "string")
        throw new Error("MCP result did not contain text content.");
    const envelope = JSON.parse(text.text);
    assert.equal(envelope.contract_version, PMT_MCP_CONTRACT_VERSION);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.scoring_period, "2026-W1");
    await client.close();
    await server.close();
});
test("adviser cannot approve, reject, or execute a proposal by guessing a tool name", async () => {
    const snapshot = await loadFixtureSnapshotSource(fixturePath);
    const queue = new ActionQueue(new InMemoryActionQueueStore());
    const pending = await queue.enqueue({ type: "set_roster", teamId: "team-001", starters: [] }, "low", "role boundary");
    const server = createPmtMcpServer({
        deps: {
            dataDir: "data",
            reader: new FixturePlatformReader(fixturePath),
            repository: new InMemoryKnowledgeRepository({ snapshots: [snapshot] }),
            v1Store: new InMemoryV1Store(),
            actionQueue: queue,
            loadSnapshot: async () => snapshot
        }
    });
    const client = new Client({ name: "pmt-role-denial-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
        for (const name of operatorTools) {
            let denied = false;
            try {
                const result = await client.callTool({ name, arguments: { actionId: pending.actionId } });
                denied = result.isError === true;
            }
            catch {
                denied = true;
            }
            assert.equal(denied, true, `${name} must be denied by the server`);
            assert.equal((await queue.get(pending.actionId))?.status, "pending");
        }
    }
    finally {
        await client.close();
        await server.close();
    }
});
test("explicit operator role can approve without implicitly executing a platform action", async () => {
    const snapshot = await loadFixtureSnapshotSource(fixturePath);
    const queue = new ActionQueue(new InMemoryActionQueueStore());
    const pending = await queue.enqueue({ type: "set_roster", teamId: "team-001", starters: [] }, "low", "operator preview");
    const server = createPmtMcpServer({
        role: "operator",
        deps: {
            dataDir: "data",
            reader: new FixturePlatformReader(fixturePath),
            repository: new InMemoryKnowledgeRepository({ snapshots: [snapshot] }),
            v1Store: new InMemoryV1Store(),
            actionQueue: queue,
            loadSnapshot: async () => snapshot
        }
    });
    const client = new Client({ name: "pmt-operator-role-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
        const listed = await client.listTools();
        for (const name of operatorTools)
            assert.ok(listed.tools.some((tool) => tool.name === name));
        const result = await client.callTool({ name: "pmt_action_approve", arguments: { actionId: pending.actionId, actor: "human-owner" } });
        const content = result.content;
        const envelope = JSON.parse(content.find((item) => item.type === "text").text);
        assert.equal(envelope.ok, true);
        assert.equal(envelope.data.execution_allowed, false);
        assert.equal((await queue.get(pending.actionId))?.status, "approved");
        assert.equal((await queue.get(pending.actionId))?.approvedBy, "human-owner");
    }
    finally {
        await client.close();
        await server.close();
    }
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
    const leagueContent = leagueResult.content;
    const leagueText = leagueContent.find((item) => item.type === "text");
    if (!leagueText || typeof leagueText.text !== "string")
        throw new Error("MCP league result did not contain text content.");
    const leagueEnvelope = JSON.parse(leagueText.text);
    assert.equal(leagueEnvelope.ok, true);
    assert.equal(leagueEnvelope.data.league.league_id, snapshot.league.league_id);
    const transactionResult = await client.callTool({
        name: "pmt_espn_read_transactions",
        arguments: { leagueId: snapshot.league.external_id, since: "2999-01-01T00:00:00.000Z" }
    });
    const transactionContent = transactionResult.content;
    const transactionText = transactionContent.find((item) => item.type === "text");
    if (!transactionText || typeof transactionText.text !== "string")
        throw new Error("MCP transaction result did not contain text content.");
    const transactionEnvelope = JSON.parse(transactionText.text);
    assert.deepEqual(transactionEnvelope.data.transactions, []);
    await client.close();
    await server.close();
});
test("operator prepares one scoped add/drop pending review, rejects invalid drops and waiver players", async () => {
    const snapshot = await loadFixtureSnapshotSource(fixturePath);
    const queue = new ActionQueue(new InMemoryActionQueueStore());
    const base = new FixturePlatformReader(fixturePath);
    const roster = await base.getRoster(snapshot.league.external_id, snapshot.league.teams[0].external_id);
    let acquisitionStatus = "FREEAGENT";
    const reader = Object.assign(base, {
        getLeagueFresh: async () => ({ seasonId: 2026, scoringPeriodId: 5 }),
        getAcquisitionStatus: async () => acquisitionStatus,
        getRoster: async () => ({ ...roster, bench: [{ ...roster.bench[0], player_id: "103", locked: false }] }),
        getFreeAgents: async () => [{ ...snapshot.league.teams[0], player_id: "301", full_name: "Free Player" }]
    });
    const server = createPmtMcpServer({ role: "operator", deps: { dataDir: "data", reader, teamId: "7", leagueExternalId: "999", repository: new InMemoryKnowledgeRepository({ snapshots: [snapshot] }), v1Store: new InMemoryV1Store(), actionQueue: queue, loadSnapshot: async () => snapshot } });
    const client = new Client({ name: "prepare-acquisition-test", version: "1.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const call = async (args) => { const r = await client.callTool({ name: "pmt_prepare_add_drop", arguments: args }); return JSON.parse(r.content.find(c => c.type === 'text').text); };
    const args = { leagueId: "999", teamId: "7", addPlayerId: "301", dropPlayerId: "103" };
    try {
        const first = await call(args);
        assert.equal(first.ok, true);
        assert.equal(first.data.action.status, "pending");
        assert.equal(first.data.execution_allowed, false);
        assert.equal((await call(args)).data.action.actionId, first.data.action.actionId);
        assert.equal((await queue.pending()).length, 1);
        assert.equal((await call({ ...args, teamId: "8" })).ok, false);
        assert.equal((await call({ ...args, dropPlayerId: "9999" })).ok, false);
        acquisitionStatus = "WAIVERS";
        assert.equal((await call(args)).ok, false);
    }
    finally {
        await client.close();
        await server.close();
    }
});
test("roster tool refreshes ESPN cache before reporting a post-action roster", async () => {
    const snapshot = await loadFixtureSnapshotSource(fixturePath);
    class CachedReader extends FixturePlatformReader {
        liveVersion = 1;
        cachedVersion = 0;
        refreshes = 0;
        async getLeagueFresh() { this.cachedVersion = this.liveVersion; this.refreshes++; return {}; }
        async getRoster(leagueId, teamId) { const roster = await super.getRoster(leagueId, teamId); return { ...roster, starters: roster.starters.map((slot, i) => i === 0 ? { ...slot, player_id: `version-${this.cachedVersion}` } : slot) }; }
    }
    const reader = new CachedReader(fixturePath);
    const server = createPmtMcpServer({ deps: { dataDir: "data", reader, repository: new InMemoryKnowledgeRepository({ snapshots: [snapshot] }), v1Store: new InMemoryV1Store(), actionQueue: new ActionQueue(new InMemoryActionQueueStore()), loadSnapshot: async () => snapshot } });
    const client = new Client({ name: "fresh-roster-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
        const teamId = snapshot.league.teams[0].external_id ?? snapshot.league.teams[0].team_id;
        const read = async () => { const result = await client.callTool({ name: "pmt_espn_read_rosters", arguments: { leagueId: snapshot.league.external_id ?? snapshot.league.league_id, teamId } }); const block = result.content[0]; const data = JSON.parse(block.text); assert.equal(data.ok, true); return data.data.rosters[0].roster.starters[0].player_id; };
        assert.equal(await read(), "version-1");
        reader.liveVersion = 2;
        assert.equal(await read(), "version-2");
        assert.equal(reader.refreshes, 2);
    }
    finally {
        await client.close();
        await server.close();
    }
});
test("news tool filters to requested players, prioritizes high-impact items, and reports truncation", async () => {
    const snapshot = await loadFixtureSnapshotSource(fixturePath);
    const reader = new FixturePlatformReader(fixturePath);
    const leagueId = snapshot.league.external_id ?? snapshot.league.league_id;
    const teamId = snapshot.league.teams[0].external_id ?? snapshot.league.teams[0].team_id;
    const roster = await reader.getRoster(leagueId, teamId);
    const playerId = roster.starters.find((slot) => slot.player_id)?.player_id;
    assert.ok(playerId);
    const observedAt = "2026-10-15T10:00:00.000Z";
    const newsItem = (newsId, linkedPlayerId, impact, publishedAt) => ({
        schema_version: "1.0.0", created_at: observedAt, updated_at: observedAt,
        source_system: "test-news", source_record_id: newsId, news_id: newsId,
        player_id: linkedPlayerId, source: "test", headline: newsId, summary: "test summary",
        impact, published_at: publishedAt, ingested_at: observedAt
    });
    const store = new InMemoryV1Store();
    await store.saveNews(leagueId, [
        newsItem("relevant-high", playerId, "high", "2026-10-14T10:00:00.000Z"),
        newsItem("relevant-low", playerId, "low", "2026-10-15T09:00:00.000Z"),
        newsItem("unrelated-high", "not-rostered", "high", "2026-10-15T09:30:00.000Z")
    ]);
    const server = createPmtMcpServer({ deps: {
            dataDir: "data", reader, repository: new InMemoryKnowledgeRepository({ snapshots: [snapshot] }),
            v1Store: store, actionQueue: new ActionQueue(new InMemoryActionQueueStore()), loadSnapshot: async () => snapshot,
            clock: () => new Date(observedAt)
        } });
    const client = new Client({ name: "filtered-news-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
        const result = await client.callTool({ name: "pmt_list_news", arguments: { leagueId, playerIds: [playerId], limit: 1 } });
        const content = result.content;
        const envelope = JSON.parse(content.find((item) => item.type === "text").text);
        assert.equal(envelope.ok, true);
        assert.equal(envelope.data.total_count, 2);
        assert.equal(envelope.data.returned_count, 1);
        assert.equal(envelope.data.truncated, true);
        assert.deepEqual(envelope.data.news.map((item) => item.news_id), ["relevant-high"]);
    }
    finally {
        await client.close();
        await server.close();
    }
});
