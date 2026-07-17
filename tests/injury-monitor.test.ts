import assert from "node:assert/strict";
import test from "node:test";
import { detectInjuryChanges, currentInjuryWatch } from "../src/intelligence/injury-monitor.js";
import type { Player } from "../src/models/types.js";

function player(playerId: string, status: Player["status"]): Player {
  return {
    schema_version: "1.0.0", created_at: "", updated_at: "", source_system: "f", source_record_id: playerId,
    player_id: playerId, external_id: playerId, sport: "football", full_name: playerId, team: "TM",
    positions: ["RB"], status, injury_status: status,
    eligibility: { eligible_slots: ["RB"], injured_reserve_eligible: false, taxi_eligible: false },
    external_ids: {}
  };
}

test("detectInjuryChanges emits an alert when status worsens", () => {
  const before = [player("rb-1", "active")];
  const after = [player("rb-1", "out")];
  const alerts = detectInjuryChanges(before, after);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "alert");
  assert.ok(alerts[0].title.includes("rb-1"));
});

test("detectInjuryChanges is quiet when status is unchanged", () => {
  const before = [player("rb-1", "questionable")];
  const after = [player("rb-1", "questionable")];
  assert.equal(detectInjuryChanges(before, after).length, 0);
});

test("currentInjuryWatch flags injured and questionable players", () => {
  const players = [player("rb-1", "out"), player("rb-2", "questionable"), player("rb-3", "active")];
  const watch = currentInjuryWatch({ players, free_agents: [] } as never);
  assert.equal(watch.length, 2);
});
