import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/basketball/contracts.js";
import { normalizeHistory, type readHistory } from "../src/basketball/history.js";
import { buildDraftBoard, FORECAST_RECIPE, type DraftBoard, type DraftForecastRecipe } from "../src/basketball/forecast.js";
import { contentHash } from "../src/basketball/store.js";
import { reconcileDraftBoard, ReconciliationEvidenceSchema, verifyEvidenceSourceFiles } from "../src/basketball/reconcile.js";

const config=ConfigSchema.parse(JSON.parse(await readFile("config/basketball/banging-3s.json","utf8")));
const baselineAt=new Date("2026-10-27T10:00:00Z");
const asOf=new Date("2026-10-28T21:00:00Z");
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");

function fixture() {
  const source={schemaVersion:1,leagueId:config.leagueId,leagueName:config.leagueName,leagueSeason:"2026-27",sourceUrl:`https://www.fantrax.com/fantasy/league/${config.leagueId}/players`,observedAt:"2026-10-27T09:00:00Z",kind:"official-csv-export",statsSeason:"2025-26",statsLabel:"2025-26 Reg Season - YTD",statsBasis:"per-game",filter:"all-available-players",completeness:"all-matching-export-rows",scopeVerification:"browser-league-header-and-selected-filters",statView:"standard",displayCountDecimals:1};
  const header=["ID","Player","Team","Position","RkOv","Status","Score","%D","ADP","GP","MIN","FGM","FGA","FG%","FTM","FTA","FT%","3PTM","REB","AST","ST","BLK","TO","PTS"];
  const rows=Array.from({length:121},(_,i)=>{
    const zeroExposure=i===118,excluded=i>=119;
    const name=i===119?"Synthetic 0":`Synthetic ${i}`;
    const group=i<60?"G":"F/C";
    const positions=i===0?"G,F/C":group;
    const gp=excluded?0:30,MIN=excluded?0:30+i%4;
    const FGA=excluded||zeroExposure?0:10+(i%12)*.2;
    const FGM=excluded||zeroExposure?0:4+(i%12)*.1;
    const FTA=excluded||zeroExposure?0:4+(i%9)*.1;
    const FTM=excluded||zeroExposure?0:3+(i%9)*.1;
    const three=excluded||zeroExposure?0:1+(i%5)*.1;
    const REB=excluded?0:(group==="G"?3:7)+(i%7)*.1;
    const AST=excluded?0:2+(i%10)*.2,ST=excluded?0:.8+(i%6)*.1,BLK=excluded?0:.2+(i%8)*.1;
    const PTS=2*FGM+three+FTM;
    return [`p${i}`,name,"SYN",positions,i+1,"FA",100,50,20+i,gp,MIN,FGM.toFixed(1),FGA.toFixed(1),(FGA?FGM/FGA:0).toFixed(3),FTM.toFixed(1),FTA.toFixed(1),(FTA?FTM/FTA:0).toFixed(3),three.toFixed(1),REB.toFixed(1),AST.toFixed(1),ST.toFixed(1),BLK.toFixed(1),excluded?0:2,PTS.toFixed(1)];
  });
  const csvCell=(value:unknown)=>`"${String(value).replace(/"/g,'""')}"`;
  const csv=[header.join(","),...rows.map(row=>row.map(csvCell).join(","))].join("\n");
  const history={schemaVersion:1,analysisVersion:"historical-display-v1",leagueId:config.leagueId,rawSha256:"b".repeat(64),revision:"a".repeat(64),directory:"synthetic-only",...normalizeHistory(config,source,csv)} as Awaited<ReturnType<typeof readHistory>>;
  const supplement={schemaVersion:1,season:"2026-27",source:{provider:"RotoWire",url:"https://www.rotowire.com/cbasketball/article/2026-27-college-basketball-player-rankings-fantasy-141463",observedAt:baselineAt.toISOString(),publishedLabel:"Synthetic test ranks; Oct. 27",scope:"Synthetic saved rank fixture only"},players:Array.from({length:10},(_,i)=>({
    fantraxId:`p${i}`,name:`Synthetic ${i}`,schoolLabel:"SYN",providerRank:i+1,minutes:30,PTS:18+i,REB:4+i/2,AST:3+i/2,notes:"Synthetic evidence row",matchMethod:"Exact synthetic ID/name/school"}))};
  const board=buildDraftBoard(config,history,supplement,baselineAt);
  return {history,supplement,board};
}

function manifestFor(f:ReturnType<typeof fixture>) {
  const byId=new Map([...f.board.rows,...f.board.excluded].map(p=>[p.fantraxId,p]));
  const timestamp="2026-10-28T19:56:03Z";
  const poolRecords=[...f.history.players.map(p=>({fantraxId:p.fantraxId,providerName:p.fullName,schoolLabel:p.schoolLabel,values:{available:true,eligibleGroups:p.eligibleGroups},missingFields:[],fieldObservedAt:{available:timestamp,eligibleGroups:timestamp},matchMethod:"Exact synthetic ID/name/school"})),
    {fantraxId:"pool-only",providerName:"Pool Only Prospect",schoolLabel:"NEW",values:{available:true,eligibleGroups:["G"]},missingFields:[],fieldObservedAt:{available:timestamp,eligibleGroups:timestamp},matchMethod:"Exact synthetic ID/name/school"}];
  const rankedIds=[...Array.from({length:10},(_,i)=>`p${i}`),"p120","p119"];
  const rankRecords=rankedIds.map((fantraxId,i)=>{const p=byId.get(fantraxId)!;return {fantraxId,providerName:p.name,schoolLabel:p.school,values:{providerRank:i+1},missingFields:[],fieldObservedAt:{providerRank:"2026-10-27T10:00:00Z"},matchMethod:"Exact synthetic ID/name/school"};});
  const projections=Array.from({length:10},(_,i)=>{
    const p=f.board.rows.find(row=>row.fantraxId===`p${i}`)!;
    return {fantraxId:p.fantraxId,providerName:p.name,schoolLabel:p.school,values:{MIN:p.minutes+1,PTS:p.stats.PTS,REB:p.stats.REB,AST:p.stats.AST,ST:p.stats.ST,BLK:p.stats.BLK,"3PTM":p.stats["3PTM"]+(i===0?.1:0),TO:1+i/10,DD:0,TD:0},missingFields:[],fieldObservedAt:Object.fromEntries(["MIN","PTS","REB","AST","ST","BLK","3PTM","TO","DD","TD"].map(field=>[field,timestamp])),matchMethod:"Exact synthetic ID/name/school"};
  });
  const weights={PTS:1,REB:1.25,AST:1.5,"3PTM":.5,ST:2,BLK:2,TO:-.5,DD:1.5,TD:3};
  const sources=[
    {id:"saved-ranks",kind:"provider-rank",provider:"Synthetic saved source",url:"https://example.test/rankings",observedAt:"2026-10-27T10:00:00Z",sha256:"1".repeat(64),scope:"Top 12 synthetic saved rankings",fields:["providerRank"],records:rankRecords},
    {id:"fresh-lines",kind:"provider-projection",provider:"Synthetic public source",url:"https://example.test/projections",observedAt:timestamp,sha256:"2".repeat(64),scope:"Ten complete synthetic counting lines",fields:["MIN","PTS","REB","AST","ST","BLK","3PTM","TO","DD","TD"],records:projections},
    {id:"current-pool",kind:"available-pool",provider:"Synthetic export",url:"https://example.test/pool",observedAt:timestamp,sha256:"3".repeat(64),scope:"all available players current full pool",fields:["available","eligibleGroups"],records:poolRecords},
    {id:"scoring",kind:"rules",provider:"RotoWire synthetic description",url:"https://example.test/scoring",observedAt:timestamp,sha256:"4".repeat(64),scope:"Provider-described only",fields:["scoringWeights","missingBonusEventDefinitions"],records:[{fantraxId:null,providerName:"Synthetic provider scoring",schoolLabel:"N/A",values:{scoringWeights:weights,missingBonusEventDefinitions:true},missingFields:[],fieldObservedAt:{scoringWeights:timestamp,missingBonusEventDefinitions:timestamp}}]},
    {id:"partial-direct",kind:"provider-projection",provider:"Synthetic partial direct line",url:"https://example.test/partial",observedAt:timestamp,sha256:"5".repeat(64),scope:"Intentional partial shooting line test",fields:["FGM"],records:[{fantraxId:"p1",providerName:"Synthetic 1",schoolLabel:"SYN",values:{FGM:4},missingFields:[],fieldObservedAt:{FGM:timestamp},matchMethod:"Exact synthetic ID/name/school"}]}
  ];
  return ReconciliationEvidenceSchema.parse({schemaVersion:1,asOf:"2026-10-28T20:00:00Z",baseline:{path:"synthetic-frozen-board.json",sha256:"a".repeat(64),revision:f.board.revision},sources});
}

test("default forecast is exactly reproducible and zero historical attempts stay finite under zero prior strength",()=>{
  const f=fixture();
  const first=buildDraftBoard(config,f.history,f.supplement,baselineAt);
  const repeated=buildDraftBoard(config,f.history,f.supplement,baselineAt);
  const explicit=buildDraftBoard(config,f.history,f.supplement,baselineAt,undefined,FORECAST_RECIPE);
  assert.equal(first.revision,f.board.revision);
  assert.equal(repeated.revision,first.revision);
  assert.equal(explicit.revision,first.revision);
  const noPrior:DraftForecastRecipe={...FORECAST_RECIPE,priorGames:0,fgPseudoAttempts:0,ftPseudoAttempts:0,version:"synthetic-zero-prior"};
  const noPriorBoard=buildDraftBoard(config,f.history,f.supplement,baselineAt,undefined,noPrior);
  const zeroAttempt=noPriorBoard.rows.find(p=>p.fantraxId==="p118")!;
  assert.ok(Number.isFinite(zeroAttempt.fg)&&Number.isFinite(zeroAttempt.ft));
  assert.ok(Object.values(zeroAttempt.stats).every(Number.isFinite));
});

test("reconciliation keeps a separate stat-free provider candidate, exact same-pool scoring, and safe import/rehearsal boundaries",async()=>{
  const f=fixture(),evidence=manifestFor(f),baselineSha=evidence.baseline.sha256;
  const result=reconcileDraftBoard(f.board,evidence,JSON.parse(await readFile("config/basketball/draft-reconciliation-scenarios.v1.json","utf8")),asOf,baselineSha,{
    candidateBase:f.board,priorStrengthReplay:()=>f.board,baselineReproduction:{status:"exact-match",rebuiltRevision:f.board.revision}
  });
  const report={...result.report} as Record<string,unknown>;
  const revision=report.revision;delete report.revision;
  assert.equal(contentHash(report),revision);
  assert.equal(result.providerFirstRankOnly.reconciliationRevision,result.revision);
  assert.equal(result.providerFirstRankOnly.evidenceHash,(result.report as any).evidenceHash);
  assert.equal((result.report as any).candidateBoards.providerFirst.rowsHash,contentHash(result.providerFirstRankOnly.rows));
  assert.equal(result.providerFirstRankOnly.statisticsIncluded,false);
  assert.ok(result.providerFirstRankOnly.rows.every((row:any)=>!("stats" in row)&&!("minutes" in row)));
  const providerRankOnly=result.providerFirstRankOnly.rows.find((row:any)=>row.fantraxId==="p120")!;
  assert.equal(providerRankOnly.forecastAvailable,false);
  assert.equal(providerRankOnly.providerRank,11);
  const unrankedUnforecasted=result.providerFirstRankOnly.rows.find((row:any)=>row.fantraxId==="pool-only")!;
  assert.equal(unrankedUnforecasted.providerRank,null);
  assert.equal(unrankedUnforecasted.modelRank,null);
  assert.equal(unrankedUnforecasted.rankSource,"unmodeled-review-only");
  assert.equal((result.providerFirstRankOnly as any).unmodeledReviewCount,1);
  const providerRehearsal=(result.report as any).rehearsals.providerFirst;
  assert.ok(providerRehearsal.picks.some((pick:any)=>pick.playerId==="p120"));
  assert.ok(!providerRehearsal.picks.some((pick:any)=>pick.playerId==="pool-only"));
  assert.ok(providerRehearsal.rosterLegality.every((team:any)=>team.legal));
  assert.equal(providerRehearsal.summary.totalPicks,112);
  assert.equal(providerRehearsal.summary.uniquePlayers,112);
  const correctedRehearsal=(result.report as any).rehearsals.corrected;
  assert.ok(correctedRehearsal.rosterLegality.every((team:any)=>team.legal));
  assert.equal(correctedRehearsal.summary.totalPicks,112);
  assert.ok((result.report as any).coverage.nativeImportIdentityConflicts.some((group:any)=>group.some((p:any)=>p.fantraxId==="p0")&&group.some((p:any)=>p.fantraxId==="p119")));
  assert.ok(!result.artifacts["fantrax-rank-import.provider-first.PROPOSED.csv"].includes('"Synthetic 0","SYN"'));
  assert.ok(!result.artifacts["fantrax-rank-import.corrected.PROPOSED.csv"].includes('"Synthetic 0","SYN"'));
  assert.ok(!result.artifacts["fantrax-rank-import.provider-first.PROPOSED.csv"].includes("pool-only"));
  assert.equal(result.correctedBoard.strategy,"balanced");
  assert.equal(result.correctedBoard.status,"experimental-reconciliation-candidate-review-only");
  assert.ok((result.correctedBoard as any).reconciledAt===asOf.toISOString());
  assert.ok(Date.parse(result.correctedBoard.generatedAt)<=Date.parse(f.board.inputs.provider.observedAt));
  assert.ok(result.correctedBoard.rows.every(p=>p.draftRank===p.rank&&Math.abs(p.positionValue-p.categoryScore)<1e-12));
  const p0Before=f.board.rows.find(p=>p.fantraxId==="p0")!,p0After=result.correctedBoard.rows.find(p=>p.fantraxId==="p0")!;
  assert.ok(Math.abs(p0After.stats.PTS-p0Before.stats.PTS)<1e-9,"a newer 3PTM-only update must reconcile around the older sourced PTS");
  assert.ok(p0After.stats["3PTM"]>p0Before.stats["3PTM"]);
  assert.ok(Math.abs(p0After.sensitivity.low.PTS/p0After.stats.PTS-p0After.scenarioMinutes.low/p0After.minutes)<1e-8);
  const providerScoring=(result.report as any).scenarioTables.providerScoring;
  assert.equal(providerScoring.comparablePool.commonPoolSize,10);
  assert.equal(providerScoring.rows.filter((row:any)=>row.modelVsProviderCommonPool!==null).length,10);
  assert.ok(providerScoring.rows.every((row:any)=>row.fullProviderScore===null));
  assert.ok(providerScoring.comparablePool.rows.every((row:any)=>row.modelCategoryRankWithinSamePlayers!==null));
  assert.ok((result.report as any).diagnostics.commonPoolVsGlobal.poolSizes.providerModelIntersection>0);
  assert.ok((result.report as any).diagnostics.normalizationComparison.recomputedGlobal.poolSize>0);
  assert.ok((result.report as any).diagnostics.normalizationComparison.recomputedMatchedProvider.reference.poolSize>0);
  const scoringSource=(result.report as any).scenarioTables.providerScoring;
  assert.match(scoringSource.note,/DD\/TD remain excluded/);
  assert.ok((result.report as any).outlierCards.projectionErrors.some((error:any)=>error.fantraxId==="p1"));
  const outlier=(result.report as any).outlierCards.top20Outliers[0];
  assert.equal(outlier.baselineCategoryRank,f.board.rows.find(p=>p.fantraxId===outlier.fantraxId)?.rank??null);
  assert.ok(Object.keys(outlier.categoryContributions).length===8);
  assert.ok(Array.isArray(outlier.largestCategoryAblationRankShifts));
  assert.deepEqual(outlier.frozenPriorStrengthRankResults.map((scenario:any)=>scenario.multiplier),[0,1,2]);
  assert.ok(outlier.fieldProvenance&&outlier.evidenceQuality&&outlier.roleStatusNotes);
  assert.equal(outlier.disposition,"unresolved");
  const correctedRehearsalArtifact=result.artifacts["synthetic-rehearsal.corrected.json"] as any;
  const providerRehearsalArtifact=result.artifacts["synthetic-rehearsal.provider-first.json"] as any;
  assert.equal(correctedRehearsalArtifact.candidateKind,"corrected-category-value");
  assert.equal(correctedRehearsalArtifact.correctedBoardRevision,result.correctedBoard.revision);
  assert.equal(correctedRehearsalArtifact.evidenceHash,(result.report as any).evidenceHash);
  assert.equal(correctedRehearsalArtifact.orderHash,(result.report as any).rehearsals.corrected.orderHash);
  assert.equal(correctedRehearsalArtifact.reconciliationRevision,result.revision);
  assert.equal(providerRehearsalArtifact.candidateKind,"provider-first-rank-only");
  assert.equal(providerRehearsalArtifact.providerRowsHash,(result.report as any).candidateBoards.providerFirst.rowsHash);
  assert.equal(providerRehearsalArtifact.evidenceHash,(result.report as any).evidenceHash);
  assert.equal(providerRehearsalArtifact.orderHash,(result.report as any).rehearsals.providerFirst.orderHash);
  assert.equal(providerRehearsalArtifact.reconciliationRevision,result.revision);
  assert.ok((result.report as any).scenarioTables.priorStrength.every((scenario:any)=>scenario.status==="computed-frozen-source-replay"));
  assert.ok((result.report as any).scenarioTables.minutes.every((scenario:any)=>scenario.rankChanges.length>0));
  assert.ok((result.report as any).teamPercentageScenarios.every((scenario:any)=>scenario.baseRoster.count===10&&scenario.reserveIds.length===4));
});

test("evidence wrapper and upstream hashes bind manifest records fail-closed",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pmt-reconcile-evidence-"));
  try {
    const upstream=JSON.stringify({source:"synthetic upstream capture",value:1});
    await writeFile(join(directory,"upstream.json"),upstream);
    const record={fantraxId:"synthetic",providerName:"Synthetic",schoolLabel:"SYN",values:{providerRank:1},missingFields:[],fieldObservedAt:{providerRank:"2026-10-27T10:00:00Z"}};
    const wrapper={id:"rank-source",kind:"provider-rank",provider:"Synthetic",url:"https://example.test/rank",observedAt:"2026-10-27T10:00:00Z",scope:"One row",fields:["providerRank"],records:[record],upstreamArtifactPath:"upstream.json",upstreamArtifactSha256:sha(upstream)};
    const wrapperRaw=JSON.stringify(wrapper)+"\n";
    await writeFile(join(directory,"capture.json"),wrapperRaw);
    const evidence={schemaVersion:1,baseline:{path:"frozen.json",sha256:"a".repeat(64),revision:"b".repeat(64)},sources:[{id:wrapper.id,kind:wrapper.kind,provider:wrapper.provider,url:wrapper.url,observedAt:wrapper.observedAt,sha256:sha(wrapperRaw),artifactPath:"capture.json",scope:wrapper.scope,fields:wrapper.fields,records:wrapper.records}]};
    const verified=await verifyEvidenceSourceFiles(evidence,directory);
    assert.equal(verified.length,1);
    const tampered=structuredClone(evidence);tampered.sources[0]!.records[0]!.values.providerRank=2;
    await assert.rejects(()=>verifyEvidenceSourceFiles(tampered,directory),/manifest records do not match/);
    const changedUpstream=JSON.stringify({source:"synthetic upstream capture",value:2});
    await writeFile(join(directory,"upstream.json"),changedUpstream);
    await assert.rejects(()=>verifyEvidenceSourceFiles(evidence,directory),/upstream artifact hash mismatch/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
