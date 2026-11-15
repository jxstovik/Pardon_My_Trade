import assert from "node:assert/strict";
import test from "node:test";
import { FixturePlatformReader } from "../src/adapters/fixture/fixture-platform-reader.js";
import { ActionQueue, InMemoryActionQueueStore } from "../src/agents/action-queue.js";
import { prepareWaiverClaim, readWaiverContext } from "../src/mcp/waiver-context.js";
import { parseEspnWaiverSettings } from "../src/adapters/espn/espn-waiver-settings.js";
import { buildEspnAcquisitionPayload } from "../src/adapters/espn/espn-platform-writer.js";

const settings = { acquisitionType: "WAIVERS_TRADITIONAL", isUsingAcquisitionBudget: false, acquisitionBudget: 100, waiverOrderReset: true, waiverHours: 24, waiverProcessDays: ["WEDNESDAY"], waiverProcessHour: 11 };
async function setup() {
  const base = new FixturePlatformReader("tests/fixtures/sample-football-league.json");
  const league = await base.getLeague("pmt-demo-football", "2026");
  const roster = await base.getRoster(league.external_id, league.teams[0].external_id);
  const reader = Object.assign(base, {
    getLeagueFresh: async () => ({ id: 98806880, seasonId: 2026, scoringPeriodId: 8, settings: { acquisitionSettings: settings }, teams: [{ id: 7, name: "Bored Man Gets Paid", waiverRank: 4 }] }),
    getWaiverState: async () => ({ schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "fixture", source_record_id: "waivers", league_id: "98806880", waiver_order: ["5", "1", "10", "7"], faab_budgets: {} }),
    getAcquisitionStatus: async () => "WAIVERS",
    getRoster: async () => ({ ...roster, bench: [{ ...roster.bench[0], player_id: "103", locked: false }] })
  });
  return { reader, queue: new ActionQueue(new InMemoryActionQueueStore()) };
}
const claim = { type: "waiver_claim" as const, teamId: "7", addPlayerId: "301", dropPlayerId: "103", priority: 1 };
test("actual traditional settings retain reset, hold and schedule without inventing FAAB", () => {
  const parsed = parseEspnWaiverSettings(settings);
  assert.equal(parsed.type, "rolling"); assert.equal(parsed.budget, undefined);
  assert.equal(parsed.priority_reset, "weekly_inverse_standings"); assert.equal(parsed.waiver_hours, 24);
  assert.equal(parsed.process_hour, 11); assert.deepEqual(parsed.process_days, ["WEDNESDAY"]);
  assert.equal(parseEspnWaiverSettings({ ...settings, waiverOrderReset: false }).priority_reset, "never");
  assert.equal(parseEspnWaiverSettings({ ...settings, isUsingAcquisitionBudget: true }).type, "faab");
  assert.throws(() => parseEspnWaiverSettings({ acquisitionType: "UNKNOWN" }));
});
test("claim preference is independent of league rank, idempotent and approval gated", async () => {
  const {reader, queue} = await setup();
  const result = await prepareWaiverClaim(reader, queue, "98806880", claim);
  assert.equal(result.context.teamWaiverRank, 4); assert.equal(result.action.action.type, "waiver_claim");
  assert.equal(result.action.status, "pending"); assert.equal(result.action.risk, "high");
  assert.equal(result.execution_allowed, false);
  assert.equal((await prepareWaiverClaim(reader, queue, "98806880", claim)).action.actionId, result.action.actionId);
  await assert.rejects(prepareWaiverClaim(reader, queue, "98806880", {...claim, addPlayerId: "302"}), /priority or player/);
  const second = await prepareWaiverClaim(reader, queue, "98806880", {...claim, addPlayerId: "302", priority: 2});
  assert.equal(second.action.status, "pending"); // Same conditional drop supports fallback claims.
  assert.equal((await queue.pending()).length, 2);
});
test("preparation blocks wrong scope, FAAB on traditional, invalid preference, locked/unowned drops and free agents", async () => {
  const {reader, queue} = await setup();
  await assert.rejects(readWaiverContext(reader, "other", "7"), /scope/);
  await assert.rejects(readWaiverContext(reader, "98806880", "8"), /team missing/);
  await assert.rejects(prepareWaiverClaim(reader, queue, "98806880", {...claim, faabBid: 1}), /FAAB/);
  await assert.rejects(prepareWaiverClaim(reader, queue, "98806880", {...claim, priority: 0}), /priority/);
  await assert.rejects(prepareWaiverClaim(reader, queue, "98806880", {...claim, dropPlayerId: "999"}), /Drop/);
  reader.getAcquisitionStatus = async () => "FREEAGENT";
  await assert.rejects(prepareWaiverClaim(reader, queue, "98806880", claim), /currently on waivers/);
  assert.equal((await queue.pending()).length, 0);
});
test("wire carries exact claim preference, rejects fractional bids and invalid priorities", () => {
  assert.equal(buildEspnAcquisitionPayload("7", "member", 8, ["301"], ["103"], "WAIVER", undefined, 2).priority, 2);
  for (const priority of [0, -1, 1.5, NaN]) assert.throws(() => buildEspnAcquisitionPayload("7", "member", 8, ["301"], [], "WAIVER", undefined, priority));
  assert.throws(() => buildEspnAcquisitionPayload("7", "member", 8, ["301"], [], "WAIVER", 1.5));
});
