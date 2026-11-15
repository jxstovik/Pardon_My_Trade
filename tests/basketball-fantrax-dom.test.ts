import test from "node:test";
import assert from "node:assert/strict";
import { decodeFantraxPreflight } from "../src/basketball/fantrax-dom.js";
import { type DraftBoard } from "../src/basketball/forecast.js";
import { type DraftSession, snakeTeam } from "../src/basketball/draft.js";

const at=new Date("2026-10-27T14:00:00Z");
function fixture(){
  const board={leagueId:"fixture",teamId:"own",season:"2026-27",revision:"a".repeat(64)} as DraftBoard;
  const order=["a","b","c","d","e","own","g","h"],names=Object.fromEntries(order.map(x=>[x,`Team ${x}`]));
  const session:DraftSession={schemaVersion:1,leagueId:board.leagueId,teamId:board.teamId,boardRevision:board.revision,sourceKind:"manual-local",observedAt:at.toISOString(),draftStart:"2026-10-28T21:00:00-04:00",phase:"pre-draft",teamOrder:order,rounds:14,picks:[],unavailablePlayerIds:[]};
  const cells=Array.from({length:112},(_,i)=>{const label=`${Math.floor(i/8)+1}-${i%8+1}`;return {column:order.indexOf(snakeTeam(order,i+1)),label,text:label,playerName:null as string|null,schoolText:null as string|null};});
  const raw={schemaVersion:1,pageUrl:"https://www.fantrax.com/fantasy/league/fixture/draft",capturedAt:at.toISOString(),teamNames:order.map(x=>names[x]),phase:"pre-draft",clockSeconds:null,cells,limitations:["Synthetic DOM test"]};
  return {board,session,names,raw};
}
test("DOM bootstrap verifies full snake ownership and preserves actual source time",()=>{
  const f=fixture(),r=decodeFantraxPreflight(f.board,f.session,f.raw,f.names,new Date(at.getTime()+1000));
  assert.equal(r.session.observedAt,at.toISOString());assert.equal(r.session.sourceKind,"browser-dom");
  assert.equal(r.session.phase,"pre-draft");assert.equal(r.currentTeamId,null);assert.equal(r.clockSeconds,null);
  assert.equal(r.completeHistory,true);assert.deepEqual(r.session.picks,[]);
});
test("DOM bootstrap rejects wrong identity, partial/duplicate cells, extra content and unsupported live inference",()=>{
  const f=fixture(),decode=(r:unknown)=>decodeFantraxPreflight(f.board,f.session,r,f.names,at);
  assert.throws(()=>decode({...f.raw,pageUrl:"https://www.fantrax.com/fantasy/league/other/draft"}),/scope/);
  assert.throws(()=>decode({...f.raw,teamNames:[...f.raw.teamNames].reverse()}),/order/);
  assert.throws(()=>decode({...f.raw,cells:f.raw.cells.slice(1)}),/incomplete/);
  const bad=structuredClone(f.raw);bad.cells[0]!.column=2;assert.throws(()=>decode(bad),/owners/);
  const selected=structuredClone(f.raw);selected.cells[0]!.playerName="Ambiguous J. Smith";assert.throws(()=>decode(selected),/selected/);
  const extra=structuredClone(f.raw);extra.cells[0]!.text+=" unknown";assert.throws(()=>decode(extra),/unexpected/);
  assert.throws(()=>decode({...f.raw,phase:"unknown"}),/not verified/);
  assert.throws(()=>decodeFantraxPreflight(f.board,f.session,f.raw,f.names,new Date(at.getTime()+21000)),/stale/);
});
