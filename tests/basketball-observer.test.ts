import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileObservation } from "../src/basketball/draft-observer.js";
import { DraftJournal } from "../src/basketball/draft-journal.js";
import { guardMockPick, verifyMockPickReceipt } from "../src/basketball/draft-browser-actor.js";
import { snakeTeam, type DraftSession } from "../src/basketball/draft.js";
import type { DraftBoard } from "../src/basketball/forecast.js";
import type { CopilotState, DraftObservation, MockPickIntent } from "../src/basketball/copilot-contracts.js";

const leagueId = "synthetic-league";
const teamId = "own";
const teamOrder = ["t0","t1","t2","t3","t4",teamId,"t6","t7"];
const boardRevision = "a".repeat(64);
const baseTime = Date.parse("2026-10-28T21:00:00.000Z");

const board = {
  leagueId, teamId, revision:boardRevision,
  rows:Array.from({length:120},(_,i)=>({fantraxId:`p${i}`,eligibleGroups:i%2===0?["G"]:["F/C"],flags:[],reviewRequired:false})),
  excluded:[],statusObservations:[]
} as unknown as DraftBoard;

function picks(count:number, playerOffset=0):DraftSession["picks"] {
  return Array.from({length:count},(_,i)=>({overall:i+1,teamId:snakeTeam(teamOrder,i+1),playerId:`p${i+playerOffset}`}));
}

function draftSession(options:{count?:number;phase?:DraftSession["phase"];picks?:DraftSession["picks"];observedAt?:string;teamOrder?:string[];teamId?:string;leagueId?:string;boardRevision?:string}={}):DraftSession {
  const count=options.count??5;
  return {
    schemaVersion:1,
    leagueId:options.leagueId??leagueId,
    teamId:options.teamId??teamId,
    boardRevision:options.boardRevision??boardRevision,
    sourceKind:"local-simulator",
    observedAt:options.observedAt??new Date(baseTime).toISOString(),
    draftStart:"2026-10-28T20:00:00.000Z",
    phase:options.phase??"live",
    teamOrder:options.teamOrder??teamOrder,
    rounds:14,
    unavailablePlayerIds:[],
    picks:options.picks??picks(count)
  };
}

function observation(options:{sequence?:number;session?:DraftSession;receivedAt?:string;observedAt?:string;currentTeamId?:string|null;clockSeconds?:number|null;venue?:DraftObservation["venue"];pageUrl?:string;completeHistory?:boolean;identityVerified?:boolean;correction?:boolean;sessionId?:string}={}):DraftObservation {
  const session=options.session??draftSession({observedAt:options.observedAt});
  const phase=session.phase;
  return {
    schemaVersion:1,
    sessionId:options.sessionId??"mock-session-1",
    venue:options.venue??"local-mock",
    pageUrl:options.pageUrl??"http://127.0.0.1:3000/basketball-copilot/mock",
    receivedAt:options.receivedAt??new Date(baseTime).toISOString(),
    sequence:options.sequence??1,
    completeHistory:options.completeHistory??true,
    identityVerified:options.identityVerified??true,
    currentTeamId:options.currentTeamId===undefined?(phase==="live"?snakeTeam(session.teamOrder,session.picks.length+1):null):options.currentTeamId,
    clockSeconds:options.clockSeconds===undefined?(phase==="live"?60:null):options.clockSeconds,
    correction:options.correction??false,
    session
  };
}

function reconcile(input:unknown,previous:CopilotState|null=null,asOf=new Date(baseTime)) {
  return reconcileObservation(board,input,previous,asOf);
}

function nextPickState(before:CopilotState,playerId:string,sequence=2):CopilotState {
  const nextPicks=[...before.session.picks,{overall:before.session.picks.length+1,teamId:before.session.teamOrder[before.session.picks.length]!,playerId}];
  const session=draftSession({picks:nextPicks,observedAt:new Date(baseTime+1000).toISOString()});
  return reconcile(observation({sequence,session,receivedAt:new Date(baseTime+1000).toISOString(),currentTeamId:snakeTeam(teamOrder,nextPicks.length+1)}),before,new Date(baseTime+1000));
}

test("repeated full snapshots are idempotent while clock refreshes preserve the state revision",()=>{
  const first=reconcile(observation());
  const repeat=reconcile(observation({sequence:2,clockSeconds:59,receivedAt:new Date(baseTime+1000).toISOString(),observedAt:new Date(baseTime+1000).toISOString(),session:draftSession({observedAt:new Date(baseTime+1000).toISOString()})}),first,new Date(baseTime+1000));
  assert.equal(repeat.status,"ready");
  assert.equal(repeat.revision,first.revision);
  assert.equal(repeat.session.picks.length,5);
  const duplicateSequence=reconcile(observation({receivedAt:new Date(baseTime+1000).toISOString()}),first,new Date(baseTime+1000));
  assert.equal(duplicateSequence.status,"ready");
  assert.equal(duplicateSequence.revision,first.revision);
});

test("wrong scope, page, partial history, and identity failures preserve the last good state",()=>{
  const good=reconcile(observation());
  const wrongScope=reconcile(observation({sequence:2,session:draftSession({leagueId:"other-league"}),receivedAt:new Date(baseTime+1000).toISOString(),observedAt:new Date(baseTime+1000).toISOString()}),good,new Date(baseTime+1000));
  assert.equal(wrongScope.status,"blocked");
  assert.equal(wrongScope.revision,good.revision);
  assert.equal(wrongScope.session.picks.length,good.session.picks.length);
  assert.equal(wrongScope.observation.sessionId,good.observation.sessionId);
  for(const session of [draftSession({teamId:"other-team"}),draftSession({boardRevision:"b".repeat(64)})]) {
    const rejected=reconcile(observation({sequence:2,session}),good,new Date(baseTime));
    assert.equal(rejected.status,"blocked");
    assert.equal(rejected.revision,good.revision);
  }
  for(const invalid of [
    observation({sequence:2,pageUrl:"https://attacker.example/fantasy/league/synthetic-league/draft",receivedAt:new Date(baseTime+1000).toISOString(),observedAt:new Date(baseTime+1000).toISOString()}),
    observation({sequence:2,completeHistory:false,receivedAt:new Date(baseTime+1000).toISOString(),observedAt:new Date(baseTime+1000).toISOString()}),
    observation({sequence:2,identityVerified:false,receivedAt:new Date(baseTime+1000).toISOString(),observedAt:new Date(baseTime+1000).toISOString()})
  ]) {
    const rejected=reconcile(invalid,good,new Date(baseTime+1000));
    assert.equal(rejected.status,"blocked");
    assert.equal(rejected.revision,good.revision);
    assert.equal(rejected.session.picks.length,5);
  }
});

test("history ownership, stable IDs, duplicates, sequence and scope are strict",()=>{
  const good=reconcile(observation());
  const at=new Date(baseTime+1000),receivedAt=at.toISOString();
  const badOwner=picks(5);badOwner[1]!.teamId="wrong";
  const duplicate=picks(5);duplicate[1]!.playerId=duplicate[0]!.playerId;
  const unknown=picks(5);unknown[4]!.playerId="unmapped-player";
  for(const session of [draftSession({picks:badOwner,observedAt:receivedAt}),draftSession({picks:duplicate,observedAt:receivedAt}),draftSession({picks:unknown,observedAt:receivedAt})]) {
    const rejected=reconcile(observation({sequence:2,session,receivedAt}),good,at);
    assert.equal(rejected.status,"blocked");
    assert.equal(rejected.revision,good.revision);
  }
  const sameSequenceChanged=reconcile(observation({session:draftSession({picks:picks(5,10)})}),good,new Date(baseTime));
  assert.equal(sameSequenceChanged.status,"blocked");
  const backward=reconcile(observation({sequence:0}),good,new Date(baseTime));
  assert.equal(backward.status,"blocked");
  const changedClock=reconcile(observation({clockSeconds:30}),good,new Date(baseTime));
  assert.equal(changedClock.status,"blocked");
});

test("stale, future, and out-of-order observation times cannot replace a good state",()=>{
  const good=reconcile(observation());
  const staleTime=new Date(baseTime+5_000).toISOString();
  const stale=reconcile(observation({sequence:2,receivedAt:staleTime,observedAt:staleTime,session:draftSession({observedAt:staleTime})}),good,new Date(baseTime+30_000));
  assert.equal(stale.status,"blocked");
  assert.equal(stale.observation.sequence,good.observation.sequence);
  const future=new Date(baseTime+2000).toISOString();
  const futureResult=reconcile(observation({sequence:2,receivedAt:future,observedAt:future,session:draftSession({observedAt:future})}),good,new Date(baseTime+1000));
  assert.equal(futureResult.status,"blocked");
  const receiveBeforeObserved=reconcile(observation({sequence:2,receivedAt:new Date(baseTime).toISOString(),observedAt:new Date(baseTime+1000).toISOString(),session:draftSession({observedAt:new Date(baseTime+1000).toISOString()})}),good,new Date(baseTime+1000));
  assert.equal(receiveBeforeObserved.status,"blocked");
});

test("turn, clock, phase, and venue-page agreement are required",()=>{
  const good=reconcile(observation());
  const at=new Date(baseTime+1000),receivedAt=at.toISOString();
  const badTurn=reconcile(observation({sequence:2,currentTeamId:"t0",receivedAt,observedAt:receivedAt,session:draftSession({observedAt:receivedAt})}),good,at);
  assert.equal(badTurn.status,"blocked");
  const missingClock=reconcile(observation({sequence:2,clockSeconds:null,receivedAt,observedAt:receivedAt,session:draftSession({observedAt:receivedAt})}),good,at);
  assert.equal(missingClock.status,"blocked");
  const fantraxPage=reconcile(observation({venue:"fantrax-league",pageUrl:"https://www.fantrax.com/fantasy/league/synthetic-league/draft",receivedAt,observedAt:receivedAt,session:{...draftSession({observedAt:receivedAt}),sourceKind:"browser-dom"}}),null,at);
  assert.equal(fantraxPage.status,"ready");
  assert.throws(()=>reconcile(observation({venue:"fantrax-league",pageUrl:"https://www.fantrax.com/fantasy/league/other/draft",receivedAt,observedAt:receivedAt,session:{...draftSession({observedAt:receivedAt}),sourceKind:"browser-dom"}}),null,at),/page does not match/);
});

test("unmarked rewrites fail; explicit corrections and fresh local session IDs invalidate intents",()=>{
  const good=reconcile(observation());
  const receivedAt=new Date(baseTime+1000).toISOString();
  const corrected=picks(5);corrected[1]!.playerId="p20";
  const rewrite=observation({sequence:2,session:draftSession({picks:corrected,observedAt:receivedAt}),receivedAt,observedAt:receivedAt});
  const rejected=reconcile(rewrite,good,new Date(baseTime+1000));
  assert.equal(rejected.status,"blocked");
  const accepted=reconcile({...rewrite,correction:true},good,new Date(baseTime+1000));
  assert.equal(accepted.status,"ready");
  assert.notEqual(accepted.revision,good.revision);
  const undoSession=draftSession({picks:picks(4),observedAt:receivedAt});
  const undo=reconcile(observation({sequence:2,session:undoSession,receivedAt,observedAt:receivedAt,correction:true}),good,new Date(baseTime+1000));
  assert.equal(undo.status,"ready");
  assert.equal(undo.session.picks.length,4);
  assert.notEqual(undo.revision,good.revision);
  const resetSession=draftSession({count:0,phase:"pre-draft",observedAt:receivedAt});
  const reset=reconcile(observation({sequence:3,session:resetSession,sessionId:"mock-session-2",receivedAt,observedAt:receivedAt}),good,new Date(baseTime+1000));
  assert.equal(reset.status,"ready");
  assert.notEqual(reset.revision,good.revision);
  const realReset=reconcile(observation({sequence:3,venue:"fantrax-league",pageUrl:"https://www.fantrax.com/fantasy/league/synthetic-league/draft",session:{...resetSession,sourceKind:"browser-dom"},sessionId:"new-live-session",receivedAt,observedAt:receivedAt}),good,new Date(baseTime+1000));
  assert.equal(realReset.status,"blocked");
});

test("mock action guard binds session, revision, player, turn, slot, expiry, and a safe clock",()=>{
  const state=reconcile(observation());
  const intent:MockPickIntent={sessionId:state.observation.sessionId,stateRevision:state.revision,overall:6,playerId:"p20",teamId,slot:"G",expiresAt:new Date(baseTime+20_000).toISOString()};
  assert.deepEqual(guardMockPick(board,state,intent,new Date(baseTime)),{allowed:true,reasons:[]});
  assert.equal(guardMockPick(board,state,{...intent,stateRevision:"old"},new Date(baseTime)).allowed,false);
  assert.equal(guardMockPick(board,state,{...intent,playerId:"missing"},new Date(baseTime)).allowed,false);
  const unavailableSession={...state.session,unavailablePlayerIds:[intent.playerId]};
  const unavailableState=reconcile(observation({session:unavailableSession}),null,new Date(baseTime));
  assert.equal(guardMockPick(board,unavailableState,{...intent,stateRevision:unavailableState.revision},new Date(baseTime)).allowed,false);
  assert.equal(guardMockPick(board,state,{...intent,slot:"F/C"},new Date(baseTime)).allowed,false);
  assert.equal(guardMockPick(board,state,{...intent,expiresAt:new Date(baseTime+61_000).toISOString()},new Date(baseTime)).allowed,false);
  const lowClock=reconcile(observation({sequence:2,clockSeconds:10}),state,new Date(baseTime));
  assert.equal(guardMockPick(board,lowClock,{...intent,stateRevision:lowClock.revision},new Date(baseTime)).allowed,false);
  const liveFantrax=reconcile(observation({sequence:2,venue:"fantrax-league",pageUrl:"https://www.fantrax.com/fantasy/league/synthetic-league/draft",session:{...state.session,sourceKind:"browser-dom"}}),null,new Date(baseTime));
  assert.equal(guardMockPick(board,liveFantrax,{...intent,stateRevision:liveFantrax.revision},new Date(baseTime)).allowed,false);
});

test("mock pick receipt requires the exact authoritative next selection",()=>{
  const before=reconcile(observation());
  const intent:MockPickIntent={sessionId:before.observation.sessionId,stateRevision:before.revision,overall:6,playerId:"p20",teamId,slot:"G",expiresAt:new Date(baseTime+20_000).toISOString()};
  const after=nextPickState(before,intent.playerId);
  assert.equal(after.status,"ready");
  assert.equal(verifyMockPickReceipt(before,after,intent),true);
  const wrong=nextPickState(before,"p21");
  assert.equal(verifyMockPickReceipt(before,wrong,intent),false);
  assert.equal(verifyMockPickReceipt(before,before,intent),false);
  const incomplete={...after,observation:{...after.observation,completeHistory:false}};
  assert.equal(verifyMockPickReceipt(before,incomplete,intent),false);
});

test("journal leases one writer, persists corrections, and replays after restart",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pmt-draft-journal-"));
  try {
    const first=reconcile(observation());
    const journal=new DraftJournal(directory);
    await journal.open();
    const competing=new DraftJournal(directory);
    await assert.rejects(()=>competing.open(),/writer lease/);
    await journal.append(first);
    assert.equal((await journal.current())?.revision,first.revision);
    await journal.close();

    const restarted=new DraftJournal(directory);
    await restarted.open();
    assert.equal((await restarted.current())?.revision,first.revision);
    const correctedPicks=picks(5);correctedPicks[2]!.playerId="p30";
    const at=new Date(baseTime+1000).toISOString();
    const correction=reconcile(observation({sequence:2,session:draftSession({picks:correctedPicks,observedAt:at}),receivedAt:at,observedAt:at,correction:true}),first,new Date(baseTime+1000));
    await restarted.append(correction);
    assert.notEqual((await restarted.current())?.revision,first.revision);
    await restarted.close();

    const recovered=new DraftJournal(directory);
    await recovered.open();
    assert.equal((await recovered.current())?.session.picks[2]?.playerId,"p30");
    await recovered.close();
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("journal serializes concurrent appends in invocation order",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pmt-draft-journal-race-"));
  try {
    const first=reconcile(observation());
    const second=nextPickState(first,"p20",2);
    const third=nextPickState(second,"p21",3);
    const journal=await new DraftJournal(directory).open();
    await Promise.all([journal.append(first),journal.append(second),journal.append(third)]);
    assert.equal((await journal.current())?.session.picks.length,7);
    assert.equal((await journal.current())?.observation.sequence,3);
    await journal.close();
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("fresh receipts cannot refresh an old acquisition or automatically clear pause",()=>{
  const before=reconcile(observation());
  const now=new Date(baseTime+10_000);
  const delayed=reconcile(observation({receivedAt:now.toISOString()}),null,now);
  const intent:MockPickIntent={sessionId:delayed.observation.sessionId,stateRevision:delayed.revision,overall:6,playerId:"p20",teamId,slot:"G",expiresAt:new Date(baseTime+25_000).toISOString()};
  assert.equal(guardMockPick(board,delayed,intent,now).allowed,false);
  const paused={...before,paused:true};
  const refreshed=reconcile(observation({sequence:2,receivedAt:now.toISOString(),session:draftSession({observedAt:now.toISOString()})}),paused,now);
  assert.equal(refreshed.paused,true);
});

test("observed Fantrax view parameters are scoped but unknown or repeated query keys are rejected",()=>{
  const session={...draftSession(),sourceKind:"browser-dom" as const};
  const url="https://www.fantrax.com/fantasy/league/synthetic-league/draft?groupId=ALL&sortKey=RANK&sortDir=-1&bottomSheetView=PLAYERS";
  assert.equal(reconcile(observation({venue:"fantrax-league",pageUrl:url,session})).status,"ready");
  assert.throws(()=>reconcile(observation({venue:"fantrax-league",pageUrl:url+"&token=untrusted",session})),/page does not match/);
  assert.throws(()=>reconcile(observation({venue:"fantrax-league",pageUrl:url+"&groupId=ALL",session})),/page does not match/);
});

test("a post-append publication failure poisons further writes until durable replay",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pmt-draft-journal-poison-"));
  const journal=await new DraftJournal(directory).open();
  try {
    const first=reconcile(observation()),second=nextPickState(first,"p20",2),third=nextPickState(second,"p21",3);
    await journal.append(first);
    await unlink(join(directory,"current.json"));await mkdir(join(directory,"current.json"));
    await assert.rejects(()=>journal.append(second));
    assert.throws(()=>journal.append(third),/close\/reopen/);
    await journal.close();await rm(join(directory,"current.json"),{recursive:true});
    const recovered=await new DraftJournal(directory).open();
    try {assert.equal((await recovered.current())?.session.picks.length,6);}finally{await recovered.close();}
  } finally {await journal.close();await rm(directory,{recursive:true,force:true});}
});

