import test from "node:test";
import assert from "node:assert/strict";
import { pendingActionPage } from "../src/mcp/action-context.js";
const now = new Date("2026-10-15T10:00:00Z");
const row = (id, teamId = "7", league = "98806880") => ({ actionId: id, action: { type: "set_roster", teamId, starters: [] }, risk: "low", rationale: "x".repeat(10000), status: "pending", createdAt: now.toISOString(), expiresAt: "2026-10-16T00:00:00Z", preconditions: { leagueExternalId: league, scoringPeriod: "2026-W6" } });
test("pending page filters scope and expired proposals, returns compact recoverable pages", () => {
    const expired = { ...row("expired"), expiresAt: "2026-10-14T00:00:00Z" };
    const rows = [row("b"), row("a"), row("other-team", "8"), row("other-league", "7", "1"), expired];
    const options = { leagueId: "98806880", teamId: "7", scoringPeriod: "2026-W6", limit: 1 };
    const first = pendingActionPage(rows, options, now);
    assert.equal(first.total_count, 2);
    assert.equal(first.returned_count, 1);
    assert.equal(first.has_more, true);
    assert.equal(first.actions[0].actionId, "a");
    assert.ok(JSON.stringify(first).length < 3000);
    const second = pendingActionPage(rows, { ...options, offset: first.next_offset }, now);
    assert.equal(second.actions[0].actionId, "b");
    assert.equal(second.has_more, false);
});
test("type filter excludes transactions without deleting them", () => {
    const tx = { ...row("tx"), action: { type: "add_drop", teamId: "7", addPlayerIds: ["1"], dropPlayerIds: ["2"] } };
    const result = pendingActionPage([row("lineup"), tx], { actionType: "set_roster" }, now);
    assert.deepEqual(result.actions.map(a => a.actionId), ["lineup"]);
    assert.equal(tx.status, "pending");
});
