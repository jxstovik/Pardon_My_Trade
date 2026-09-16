import assert from "node:assert/strict";
import test from "node:test";
import {
  ESPN_SLOT_TO_POSITION,
  mapEspnSlotToPosition,
  mapPositionToEspnSlot
} from "../src/adapters/espn/espn-auth.js";

test("ESPN slot 17 is KICKER (not BN), 14 is DB, 16 is D/ST", () => {
  assert.equal(ESPN_SLOT_TO_POSITION[17], "K");
  assert.equal(ESPN_SLOT_TO_POSITION[16], "DST");
  assert.equal(ESPN_SLOT_TO_POSITION[23], "FLEX");
  assert.equal(ESPN_SLOT_TO_POSITION[20], "BN");
  assert.equal(mapEspnSlotToPosition(17), "K");
  assert.notEqual(mapEspnSlotToPosition(14), "K", "slot 14 is DB, never kicker");
});

test("position -> slot round-trips for the starting lineup positions", () => {
  for (const position of ["QB", "RB", "WR", "TE", "K", "DST", "FLEX"] as const) {
    assert.equal(mapEspnSlotToPosition(mapPositionToEspnSlot(position)), position);
  }
});
