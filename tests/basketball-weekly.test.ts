import test from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES } from "../src/basketball/contracts.js";
import { contentHash } from "../src/basketball/store.js";
import { buildWeeklyReport, optimizeWeeklyLineup, type WeeklyInput } from "../src/basketball/weekly.js";
import type { DraftBoard } from "../src/basketball/forecast.js";

// Synthetic identities and coherent synthetic lines only. No platform calls.
const now=new Date("2026-10-29T02:00:00Z");
function fixture() {
  const stats={PTS:10,REB:4,AST:2,ST:1,BLK:1,"3PTM":1,FGM:4,FGA:8,FTM:1,FTA:2};
  const rows=Array.from({length:16},(_,i)=>{
    const rate=1+i/20;
    const scale=(factor:number)=>Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,v*factor]));
    return {fantraxId:`p${i}`,name:`Synthetic ${i}`,school:"SYN",eligibleGroups:i<6?["G"]:i<12?["F/C"]:["G","F/C"],
      stats:scale(rate),sensitivity:{low:scale(rate*.8),high:scale(rate*1.2)},flags:[],minutes:30};
  });
  const payload={leagueId:"league",teamId:"team",season:"2026-27",generatedAt:"2026-10-28T20:00:00Z",statusObservations:[],rows,
    reference:{refFG:.5,refFT:.5,moments:Object.fromEntries(CATEGORIES.map(c=>[c,{mean:0,sd:1}]))}};
  const board={revision:contentHash(payload),...payload} as unknown as DraftBoard;
  const input:WeeklyInput={schemaVersion:1,leagueId:"league",teamId:"team",season:"2026-27",boardRevision:board.revision,
    observedAt:"2026-10-29T01:00:00Z",sourceKind:"synthetic",sourceUrls:["https://example.com/synthetic"],
    period:{number:1,firstDate:"2026-11-01",lastDate:"2026-11-08",opponentTeamId:null},unresolvedRules:["lock scope unknown"],
    candidateScope:"Two synthetic candidates only",protectedIds:[],currentActiveIds:Array.from({length:10},(_,i)=>`p${i}`),
    players:rows.map((p,i)=>({id:p.fantraxId,name:p.name,school:p.school,ownership:i<14?"own":"waiver",availability:"unknown",
      waiverLabel:i<14?null:"W (Fri)",scheduleComplete:true,games:[{id:`g${i}`,date:"2026-11-02",label:"Synthetic Monday",state:"scheduled",startAt:null}]}))};
  return {board,input};
}
test("weekly game volume can outrank a better per-game player; percentages remain weighted",()=>{
  const {board,input}=fixture();
  input.players[0]!.games!.push({id:"extra",date:"2026-11-06",label:"Synthetic Friday",state:"scheduled",startAt:null});
  const report=buildWeeklyReport(board,input,now),p=report.ranked.find(p=>p.id==="p0")!;
  assert.equal(p.games,2);assert.equal(p.totals.PTS,20);assert.equal(p.totals.FGA,16);
  assert.equal(report.ranked.filter(p=>p.ownership==="own")[0]!.id,"p0");
  assert.ok(report.lineup);assert.equal(report.lineup.active.length,10);assert.equal(new Set(report.lineup.active.map(p=>p.id)).size,10);
  assert.ok(Math.abs(report.lineup.totals["FG%"]!-report.lineup.totals.FGM/report.lineup.totals.FGA)<1e-12);
  assert.equal(report.liveActionsExecuted,0);assert.match(report.status,/advisory/);
});
test("slot DP agrees with exhaustive ten-player subset objective including dual eligibility",()=>{
  const {board,input}=fixture(),report=buildWeeklyReport(board,input,now),players=report.ranked.filter(p=>p.ownership==="own");
  let best=-Infinity;
  for(let mask=0;mask<1<<players.length;mask++) {
    const chosen=players.filter((_,i)=>mask&(1<<i));if(chosen.length!==10)continue;
    if(chosen.filter(p=>p.eligibleGroups.includes("G")).length<4||chosen.filter(p=>p.eligibleGroups.includes("F/C")).length<4)continue;
    best=Math.max(best,chosen.reduce((s,p)=>s+p.score,0));
  }
  assert.ok(Math.abs(optimizeWeeklyLineup(players)!.score-best)<1e-9);
});
test("missing schedule is never zero and suppresses lineup; explicit zero stays modeled",()=>{
  const {board,input}=fixture();input.players[0]!.games=null;
  let r=buildWeeklyReport(board,input,now);assert.equal(r.lineup,null);assert.match(r.excluded[0]!.reason,/not zero/);
  input.players[0]!.games=[];r=buildWeeklyReport(board,input,now);
  assert.equal(r.ranked.find(p=>p.id==="p0")!.games,0);assert.ok(r.lineup);
});
test("duplicates, mismatched identities, period boundaries and invalid active IDs fail closed",()=>{
  const f=fixture();f.input.players[0]!.games!.push({...f.input.players[0]!.games![0]!});
  assert.throws(()=>buildWeeklyReport(f.board,f.input,now),/Duplicate player-game/);
  const g=fixture();g.input.players[0]!.name="Wrong athlete";assert.throws(()=>buildWeeklyReport(g.board,g.input,now),/crosswalk/);
  const h=fixture();h.input.players[0]!.games![0]!.date="2026-11-09";assert.throws(()=>buildWeeklyReport(h.board,h.input,now),/outside/);
  const j=fixture();j.input.currentActiveIds.push("not-owned");assert.throws(()=>buildWeeklyReport(j.board,j.input,now));
});
test("replayed observations retain source age; stale inputs gate real advice",()=>{
  const {board,input}=fixture();const r=buildWeeklyReport(board,input,new Date("2026-11-01T00:00:00Z"));
  assert.equal(r.observedAt,input.observedAt);assert.equal(r.forecastGeneratedAt,board.generatedAt);
  assert.ok(r.blockers.some(b=>b.includes("older than 24")));
  input.observedAt="2026-11-02T00:00:00Z";assert.throws(()=>buildWeeklyReport(board,input,now),/Future/);
});
test("cancelled games and known out players are not treated as usable appearances",()=>{
  const {board,input}=fixture();input.players[0]!.games![0]!.state="cancelled";
  input.players[1]!.availability="out";
  const r=buildWeeklyReport(board,input,now);assert.equal(r.ranked.find(p=>p.id==="p0")!.games,0);
  assert.ok(r.excluded.some(p=>p.id==="p1"&&p.reason==="known status block"));assert.ok(r.lineup);
});
test("hash/scope mutation and started game observations cannot support pre-lock planning",()=>{
  const {board,input}=fixture();input.teamId="wrong";assert.throws(()=>buildWeeklyReport(board,input,now),/scope/);
  input.teamId="team";board.rows[0]!.stats.PTS=999;assert.throws(()=>buildWeeklyReport(board,input,now),/hash/);
  const g=fixture();g.input.players[0]!.games![0]!.startAt="2026-10-28T00:00:00Z";
  assert.throws(()=>buildWeeklyReport(g.board,g.input,now),/started/);
});
test("protected assets cannot appear as drops; waiver candidates are never execution eligible",()=>{
  const {board,input}=fixture();input.protectedIds=input.players.filter(p=>p.ownership==="own").map(p=>p.id);
  const r=buildWeeklyReport(board,input,now);
  assert.ok(r.waiverResearch.every(p=>p.conditionalBestReplacement===null&&!p.executionEligible));
});
