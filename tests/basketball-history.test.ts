import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/basketball/contracts.js";
import { importHistory, normalizeHistory, readHistory, renderHistory } from "../src/basketball/history.js";

const config=ConfigSchema.parse(JSON.parse(await readFile("config/basketball/banging-3s.json","utf8")));
const source={schemaVersion:1,leagueId:config.leagueId,leagueName:config.leagueName,leagueSeason:"2026-27",
  sourceUrl:`https://www.fantrax.com/fantasy/league/${config.leagueId}/players`,observedAt:"2026-10-27T08:00:08Z",
  kind:"official-csv-export",statsSeason:"2025-26",statsLabel:"2025-26 Reg Season - YTD",statsBasis:"per-game",
  filter:"all-available-players",completeness:"all-matching-export-rows",scopeVerification:"browser-league-header-and-selected-filters",
  statView:"standard",displayCountDecimals:1};
// Synthetic unit-test rows only, never imported to the live league data directory.
const row={ID:"*abc*",Player:"Synthetic Player",Team:"SYN",Position:"G",RkOv:"1",Status:"FA",Score:"100","%D":"-",ADP:"-",
  GP:"34",MIN:"35.3",FGM:"5.1",FGA:"12.8","FG%":".402",FTM:"4.0",FTA:"4.9","FT%":".810","3PTM":"1.5",REB:"8.1",AST:"2.9",ST:"2.1",BLK:"1.1",TO:"1.9",PTS:"15.8"};
const csv=(r:Record<string,string>=row) => Object.keys(r).join(",")+"\n"+Object.values(r).join(",")+"\n";

test("historical display importer preserves rounded rates without enforcing exact box-score arithmetic",()=>{
  const h=normalizeHistory(config,source,csv());
  assert.equal(h.players[0]!.gamesPlayed,34);
  assert.equal(h.players[0]!.displayedPerGame.FGA,12.8);
  assert.equal(h.players[0]!.historicalPerGame["FG%"],.402);
  assert.ok(Math.abs(5.1/12.8-.402)>.001);
  assert.deepEqual(h.players[0]!.flags,[]);
  assert.equal(h.quality.currentSeasonForecasts,0);
  assert.ok(h.quality.warnings.some(w=>w.includes("never multiply rates by GP")));
});

test("coherence outliers are retained and quarantined; zero displayed games remain unresolved",()=>{
  const outlier=normalizeHistory(config,source,csv({...row,PTS:"2.3",FGM:".3",FGA:"1.0",FTM:".7",FTA:"1.0","3PTM":".3"}));
  assert.equal(outlier.quality.quarantined,1); assert.equal(outlier.quality.baselineResearchRows,0);
  assert.equal(outlier.players[0]!.displayedPerGame.PTS,2.3);
  const noGames={...row,GP:"0"};
  for(const k of ["MIN","FGM","FGA","FTM","FTA","3PTM","REB","AST","ST","BLK","TO","PTS"]) noGames[k as keyof typeof noGames]="0";
  const h=normalizeHistory(config,source,csv(noGames));
  assert.equal(h.quality.zeroGamesUnresolved,1); assert.equal(h.quality.baselineResearchRows,0);
  assert.equal(h.players[0]!.coverage,"zero-displayed-games-unresolved");
});

test("history rejects wrong scope/season, missing attempts, fractional GP and malformed precision",()=>{
  assert.throws(()=>normalizeHistory(config,{...source,leagueId:"wrong"},csv()),/scope/);
  assert.throws(()=>normalizeHistory(config,{...source,statsSeason:"2026-27",statsLabel:"2026-27 Reg Season - YTD"},csv()),/prior-season/);
  const {FGA,...missing}=row;
  assert.throws(()=>normalizeHistory(config,source,csv(missing)),/requires games/);
  assert.throws(()=>normalizeHistory(config,source,csv({...row,GP:"1.5"})),/integer/);
  assert.throws(()=>normalizeHistory(config,source,csv({...row,FGA:"12.81"})),/one-decimal/);
  assert.throws(()=>normalizeHistory(config,source,csv({...row,FTM:"5.0"})),/makes exceed/);
  assert.throws(()=>normalizeHistory(config,source,csv({...row,GP:"0"})),/zero displayed GP/);
});

test("history is immutable, preserves source time on replay, and a failed import retains the prior pointer",async()=>{
  const root=await mkdtemp(join(tmpdir(),"pmt-history-"));
  try{
    const first=await importHistory(root,config,source,Buffer.from(csv()),new Date("2026-10-27T08:01:00Z"));
    const replay=await importHistory(root,config,source,Buffer.from(csv()),new Date("2026-10-28T08:01:00Z"));
    assert.equal(replay.revision,first.revision); assert.equal(replay.source.observedAt,source.observedAt);
    await assert.rejects(importHistory(root,config,source,Buffer.from(csv({...row,GP:"NaN"})),new Date()));
    const saved=await readHistory(root,config); assert.equal(saved.revision,first.revision);
    assert.match(renderHistory(saved),/no turnover category/);
    await writeFile(join(first.directory,`${first.rawSha256}.csv`),"tamper");
    await assert.rejects(readHistory(root,config),/raw hash/);
  }finally{await rm(root,{recursive:true,force:true});}
});
