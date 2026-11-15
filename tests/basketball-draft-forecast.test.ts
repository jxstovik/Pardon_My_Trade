import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ConfigSchema } from "../src/basketball/contracts.js";
import { normalizeHistory, type readHistory } from "../src/basketball/history.js";
import { buildDraftBoard, boardCsv, boardMarkdown } from "../src/basketball/forecast.js";
import { canCompleteRoster, recommendDraft, snakeTeam } from "../src/basketball/draft.js";
import { StatLineSchema } from "../src/basketball/categories.js";

const config=ConfigSchema.parse(JSON.parse(await readFile("config/basketball/banging-3s.json","utf8")));
const at=new Date("2026-10-28T20:00:00Z");
// All fixture athletes/statistics below are synthetic and are never saved to real league data.
function fixture(){
  const source={schemaVersion:1,leagueId:config.leagueId,leagueName:config.leagueName,leagueSeason:"2026-27",sourceUrl:`https://www.fantrax.com/fantasy/league/${config.leagueId}/players`,observedAt:"2026-10-28T19:00:00Z",kind:"official-csv-export",statsSeason:"2025-26",statsLabel:"2025-26 Reg Season - YTD",statsBasis:"per-game",filter:"all-available-players",completeness:"all-matching-export-rows",scopeVerification:"browser-league-header-and-selected-filters",statView:"standard",displayCountDecimals:1};
  const header=["ID","Player","Team","Position","RkOv","Status","Score","%D","ADP","GP","MIN","FGM","FGA","FG%","FTM","FTA","FT%","3PTM","REB","AST","ST","BLK","TO","PTS"];
  const rows=Array.from({length:24},(_,i)=>{
    const j=i%12,FGA=10+j*.2,FGM=4+j*.1,FTA=4+j*.1,FTM=3+j*.1,three=1+j*.1;
    return [`p${i}`,`Synthetic ${i}`,"SYN",i<12?"G":"F/C",i+1,"FA",100,50,20+i,30,30+j*.1,FGM.toFixed(1),FGA.toFixed(1),(FGM/FGA).toFixed(3),FTM.toFixed(1),FTA.toFixed(1),(FTM/FTA).toFixed(3),three.toFixed(1),(i<12?3:7)+j*.1,2+j*.1,(1+j*.1).toFixed(1),(.2+j*.1).toFixed(1),2,(2*FGM+three+FTM).toFixed(1)];
  });
  rows.push(["cold","Synthetic Cold","SYN","G",25,"FA",0,0,70,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  rows.push(["unknown","Synthetic Uncovered","SYN","G",26,"FA",0,0,90,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  const csv=[header.join(","),...rows.map(r=>r.join(","))].join("\n");
  const history={schemaVersion:1,analysisVersion:"historical-display-v1",leagueId:config.leagueId,rawSha256:"b".repeat(64),revision:"a".repeat(64),directory:"synthetic-only",...normalizeHistory(config,source,csv)} as Awaited<ReturnType<typeof readHistory>>;
  const supplement={schemaVersion:1,season:"2026-27",source:{provider:"RotoWire",url:"https://www.rotowire.com/cbasketball/article/2026-27-college-basketball-player-rankings-fantasy-141463",observedAt:"2026-10-28T19:00:00Z",publishedLabel:"Synthetic test source label",scope:"Synthetic tests only"},players:[
    {fantraxId:"p0",name:"Synthetic 0",schoolLabel:"SYN",providerRank:1,minutes:32,PTS:18,REB:4,AST:6,notes:"Synthetic projected role",matchMethod:"Exact test name/school"},
    {fantraxId:"cold",name:"Synthetic Cold",schoolLabel:"SYN",providerRank:2,minutes:28,PTS:15,REB:4,AST:3,notes:"Synthetic freshman",matchMethod:"Exact test name/school"}]};
  return {history,supplement};
}
function board(){const f=fixture();return buildDraftBoard(config,f.history,f.supplement,at);}
function session(b:ReturnType<typeof board>){return {schemaVersion:1,leagueId:b.leagueId,teamId:b.teamId,boardRevision:b.revision,sourceKind:"manual-local",observedAt:at.toISOString(),draftStart:"2026-10-28T21:00:00-04:00",phase:"pre-draft",teamOrder:["t0","t1","t2","t3","t4",b.teamId,"t6","t7"],rounds:14,unavailablePlayerIds:[],picks:[] as {overall:number;teamId:string;playerId:string}[]};}

test("per-game forecast preserves provider fields, coherent eight-category shooting and explicit cold-start modeling",()=>{
  const b=board(),p=b.rows.find(p=>p.fantraxId==="p0")!,cold=b.rows.find(p=>p.fantraxId==="cold")!;
  assert.equal(p.minutes,32);assert.ok(Math.abs(p.stats.PTS-18)<1e-8);assert.equal(p.stats.REB,4);assert.equal(p.stats.AST,6);
  assert.equal(cold.basis,"provider-plus-cold-start-prior");assert.ok(cold.stats.PTS>0&&cold.stats.ST>0);
  assert.ok(cold.flags.includes("cold-start-shooting-steals-blocks-imputed"));
  assert.ok(b.excluded.some(p=>p.fantraxId==="unknown"&&p.name==="Synthetic Uncovered"));
  for(const r of b.rows){StatLineSchema.parse(r.stats);StatLineSchema.parse(r.sensitivity.low);StatLineSchema.parse(r.sensitivity.high);assert.ok(r.flags.includes("current-availability-unverified"));}
  assert.match(boardMarkdown(b),/not a cleared autopick order/);assert.match(boardCsv(b),/Review flags/);
});

test("provider-supported short history stays distinct from zero history and retains a review flag",()=>{
  const f=fixture();f.history.players.find(p=>p.fantraxId==="p0")!.gamesPlayed=6;
  const b=buildDraftBoard(config,f.history,f.supplement,at),p=b.rows.find(p=>p.fantraxId==="p0")!;
  assert.equal(p.basis,"provider-plus-model");assert.equal(p.historicalGP,6);assert.equal(p.stats.AST,6);
  assert.ok(p.flags.includes("short-history-shooting-steals-blocks-review"));
  assert.ok(!p.flags.includes("cold-start-shooting-steals-blocks-imputed"));
});

test("provider wrong-ID name/school joins, duplicate ranks, wrong season and future data fail closed",()=>{
  const f=fixture();
  const wrong=structuredClone(f.supplement);wrong.players[0]!.fantraxId="p1";
  assert.throws(()=>buildDraftBoard(config,f.history,wrong,at),/crosswalk/);
  const school=structuredClone(f.supplement);school.players[0]!.schoolLabel="Different";
  assert.throws(()=>buildDraftBoard(config,f.history,school,at),/crosswalk/);
  const dup=structuredClone(f.supplement);dup.players[1]!.providerRank=1;
  assert.throws(()=>buildDraftBoard(config,f.history,dup,at),/Duplicate/);
  assert.throws(()=>buildDraftBoard(config,f.history,{...f.supplement,season:"2025-26"},at),/mismatch/);
  assert.throws(()=>buildDraftBoard(config,f.history,f.supplement,new Date("2026-10-28T18:00:00Z")),/Future/);
});

test("turnovers do not affect ranking; insufficient reference cohorts never fabricate fallback",()=>{
  const f=fixture(),first=buildDraftBoard(config,f.history,f.supplement,at);
  for(const p of f.history.players)p.displayedPerGame.TO=100;
  const second=buildDraftBoard(config,f.history,f.supplement,at);
  assert.deepEqual(second.rows.map(p=>[p.fantraxId,p.categoryScore]),first.rows.map(p=>[p.fantraxId,p.categoryScore]));
  const tiny={...f.history,players:f.history.players.slice(0,4)};
  assert.throws(()=>buildDraftBoard(config,tiny,{...f.supplement,players:[]},at),/Insufficient reference/);
});

test("known out status leaves conditional forecast intact but excludes default pick recommendations",()=>{
  const f=fixture(),status={schemaVersion:1,season:"2026-27",observations:[{fantraxId:"p0",status:"out",draftAction:"manual-review-only",observedAt:at.toISOString(),sourceUrl:"https://www.rotowire.com/cbasketball/player/synthetic",sourcePublishedAt:"2026-10-28",reason:"Synthetic status test"}]};
  const b=buildDraftBoard(config,f.history,f.supplement,at,status),r=recommendDraft(b,session(b),at);
  assert.ok(b.rows.find(p=>p.fantraxId==="p0")!.stats.PTS>0);
  assert.ok(!r.recommendations.some(p=>p.playerId==="p0"));
  assert.equal(r.readyForPlatformExecution,false);assert.equal(r.liveActionsExecuted,0);
});

test("matching honors dual eligibility, all ten active slots, four reserves and snake turns",()=>{
  const players=Array.from({length:10},(_,i)=>({fantraxId:`g${i}`,eligibleGroups:["G" as const]}));
  assert.equal(canCompleteRoster(players),true);
  assert.equal(canCompleteRoster([...players,{fantraxId:"g11",eligibleGroups:["G"]}]),false);
  assert.equal(canCompleteRoster([...players,...Array.from({length:4},(_,i)=>({fantraxId:`f${i}`,eligibleGroups:["F/C" as const]}))]),true);
  assert.equal(canCompleteRoster([...players,{fantraxId:"dual",eligibleGroups:["G","F/C"]}]),true);
  const order=["0","1","2","3","4","own","6","7"];
  assert.equal(snakeTeam(order,6),"own");assert.equal(snakeTeam(order,11),"own");assert.equal(snakeTeam(order,22),"own");assert.equal(snakeTeam(order,107),"own");
});

test("local recommender validates contiguous unique picks and stops on stale state or stale board inputs",()=>{
  const b=board(),s=session(b),start=new Date("2026-10-29T01:00:10Z");s.phase="live";s.observedAt=start.toISOString();
  for(let i=0;i<5;i++)s.picks.push({overall:i+1,teamId:snakeTeam(s.teamOrder,i+1),playerId:b.rows[i]!.fantraxId});
  const r=recommendDraft(b,s,start);
  assert.equal(r.ownTurn,true);assert.equal(r.nextOwnOverall,6);assert.ok(r.recommendations.every(p=>!s.picks.some(x=>x.playerId===p.playerId)));
  assert.match(r.turnAuthority,/conditional-on-manual/);assert.deepEqual(r.coverage,b.counts);assert.equal(r.providerPublicationLabel,b.inputs.provider.publishedLabel);
  assert.equal(recommendDraft(b,s,new Date(start.getTime()+21000)).status,"stale-state");
  const later=new Date("2026-10-30T01:00:10Z");s.observedAt=later.toISOString();
  const stale=recommendDraft(b,s,later);assert.equal(stale.status,"stale-state");assert.equal(stale.recommendations.length,0);
  const duplicate=structuredClone(s);duplicate.picks[1]!.playerId=duplicate.picks[0]!.playerId;
  assert.throws(()=>recommendDraft(b,duplicate,later),/duplicate/);
  const badOrder=structuredClone(s);badOrder.picks[0]!.teamId="wrong";
  assert.throws(()=>recommendDraft(b,badOrder,later),/snake order/);
});
