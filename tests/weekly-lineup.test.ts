import assert from "node:assert/strict";
import test from "node:test";
import { planWeeklyLineup } from "../src/agents/weekly-lineup.js";
import type { RosterSlotInput } from "../src/agents/types.js";

test("maximizes total score across competing eligible positions and keeps the full roster", () => {
  const roster: RosterSlotInput[] = [
    { playerId: "flexible", slot: "RB", currentSlot: "RB", eligiblePositions: ["RB", "WR", "FLEX"] },
    { playerId: "rb", slot: "RB", currentSlot: "BN", eligiblePositions: ["RB", "FLEX"] },
    { playerId: "wr", slot: "WR", currentSlot: "WR", eligiblePositions: ["WR", "FLEX"] }
  ];
  const result = planWeeklyLineup(roster, [{slot:"RB",count:1},{slot:"WR",count:1}], new Map([["flexible",20],["rb",19],["wr",2]]));
  assert.equal(result.expectedPoints,39);
  assert.equal(result.starters.find(p=>p.playerId==="rb")?.slot,"RB");
  assert.equal(result.starters.find(p=>p.playerId==="flexible")?.slot,"WR");
});

test("freezes locked starters and excludes a locked bench upgrade", () => {
  const roster: RosterSlotInput[] = [
    {playerId:"locked",slot:"RB",currentSlot:"RB",eligiblePositions:["RB","FLEX"],locked:true},
    {playerId:"bench",slot:"RB",currentSlot:"BN",eligiblePositions:["RB","FLEX"],locked:true},
    {playerId:"available",slot:"WR",currentSlot:"FLEX",eligiblePositions:["WR","FLEX"]}
  ];
  const r=planWeeklyLineup(roster,[{slot:"RB",count:1},{slot:"FLEX",count:1}],new Map([["locked",1],["bench",100],["available",5]]));
  assert.deepEqual(r.starters.map(p=>p.playerId).sort(),["available","locked"]);
  assert.deepEqual(r.changes,[]);
});

test("fails closed for incomplete eligibility, unsupported models, impossible locks and vacant positions", () => {
  const p: RosterSlotInput={playerId:"p",slot:"RB",currentSlot:"RB",eligiblePositions:["RB"]};
  const points=new Map([["p",5],["q",10]]);
  assert.throws(()=>planWeeklyLineup([p],[{slot:"QB",count:1}],points),/cannot fill/);
  assert.throws(()=>planWeeklyLineup([{...p,eligiblePositions:[]}],[{slot:"RB",count:1}],points),/eligibility/);
  assert.throws(()=>planWeeklyLineup([p],[{slot:"RB",count:1}],new Map()),/coverage/);
  assert.throws(()=>planWeeklyLineup([{...p,locked:true},{...p,playerId:"q",locked:true}],[{slot:"RB",count:1}],points),/Locked/);
  assert.throws(()=>planWeeklyLineup([p,p],[{slot:"RB",count:1}],points),/Duplicate/);
});

test("preserves an already optimal lineup on tied projections", () => {
  const roster: RosterSlotInput[]=[{playerId:"a",slot:"RB",currentSlot:"RB",eligiblePositions:["RB","FLEX"]},{playerId:"b",slot:"RB",currentSlot:"FLEX",eligiblePositions:["RB","FLEX"]}];
  assert.deepEqual(planWeeklyLineup(roster,[{slot:"RB",count:1},{slot:"FLEX",count:1}],new Map([["a",10],["b",10]])).changes,[]);
});
