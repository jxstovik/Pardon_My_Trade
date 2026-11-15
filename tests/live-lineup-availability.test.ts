import assert from "node:assert/strict";
import test from "node:test";
import { EspnPlatformReader } from "../src/adapters/espn/espn-platform-reader.js";

test("ESPN INJURY_RESERVE and player-pool locks survive normalization",async()=>{
 const reader=new EspnPlatformReader({credentials:{leagueId:"999",season:"2026"},fetchImpl:async()=>new Response(JSON.stringify({id:999,seasonId:2026,teams:[{id:7,roster:{entries:[{playerId:123,lineupSlotId:20,playerPoolEntry:{rosterLocked:true,player:{id:123,fullName:"Unavailable RB",defaultPositionId:2,eligibleSlots:[2,23,20],injuryStatus:"INJURY_RESERVE",injured:true}}}]}}]}))});
 const players=await reader.getPlayers("football","2026");
 assert.equal(players[0]?.status,"injured_reserve");
 const roster=await reader.getRoster("999","7");
 assert.equal(roster.bench[0]?.locked,true);
});
