// Read/model/queue only: this preview never imports a platform writer or executor.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnv } from '../dist/src/config/load-env.js';
import { EspnPlatformReader } from '../dist/src/adapters/espn/espn-platform-reader.js';
import { selectAutomaticWaivers } from '../dist/src/agents/automatic-waivers.js';
import { actionPayloadHash, ActionQueue, SqliteActionQueueStore } from '../dist/src/agents/action-queue.js';
import { rosterFingerprint } from '../dist/src/agents/action-executor.js';
import { prepareWaiverClaim, readWaiverContext } from '../dist/src/mcp/waiver-context.js';
import { injuryScenario } from '../dist/src/agents/transaction-protocol.js';

loadEnv();
const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,'output/football-automation/transaction-preview-2026-11-05');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const reader=new EspnPlatformReader();
const fresh=await reader.getLeagueFresh();
if(String(fresh.id)!=='98806880'||fresh.seasonId!==2026||fresh.scoringPeriodId!==9)throw Error('This review is scoped to league 98806880, team 7, 2026 Week 9.');
const context=await readWaiverContext(reader,'98806880','7');
const pending=await reader.getPendingWaiverClaims('98806880','7');
if(pending.length)throw Error('Existing pending ESPN claims need reconciliation before a combined plan.');
const roster=await reader.getRoster('98806880','7');
const free=await reader.getFreeAgents('98806880');
const players=await reader.getPlayers('football','2026');
const byId=new Map([...players,...free].map(p=>[p.player_id,p]));
const artifactDir=resolve(root,'artifacts/week9-2026-scout');
const manifest=await json(resolve(artifactDir,'manifest.json'));
const raw=await readFile(resolve(artifactDir,'waiver-horizon.json'));
const horizon=JSON.parse(raw);
if(manifest.targetWeek!==9||manifest.cutoffWeek!==8||horizon.targetWeek!==9||horizon.cutoffWeek!==8||manifest.modelVersion!==horizon.modelVersion||createHash('sha256').update(raw).digest('hex')!==manifest.waiverHorizonSha256)throw Error('Model horizon provenance mismatch.');
if(Date.now()-Date.parse(manifest.builtAt)>20*3600000)throw Error('Model artifact stale.');
if(JSON.stringify(manifest.scoring)!==JSON.stringify(fresh.settings.scoringSettings))throw Error('Live scoring differs from model.');
const policy=await json(resolve(root,'config/football/automatic-waivers.json'));
const proposed=await json(resolve(directory,'proposed-authorization.json'));
const activePolicy=await json(resolve(root,'config/football/automatic-transactions.json'));
const deficits=process.argv.includes('--deficits');
const evidenceIndex=process.argv.indexOf('--evidence');
const evidence=evidenceIndex>=0?await json(resolve(root,process.argv[evidenceIndex+1])):undefined;
const recoveryById=new Map((evidence?.recoveries??[]).map(p=>[p.playerId,p]));
const reviewedAdds=evidence?new Set((evidence.additionReviews??[]).filter(p=>p.availableThisWeek&&p.hasOffensiveRole).map(p=>p.playerId)):undefined;
if(proposed.leagueId!=='98806880'||proposed.teamId!=='7'||proposed.season!==2026)throw Error('Proposed policy scope mismatch.');
// This engine receives the union of available acquisition types. No submission
// authority is inferred from the existing Tuesday policy's enabled field.
const statuses=new Map();
for(let offset=0;offset<45000;offset+=1500){
  const page=await reader.client.getJson('',{view:['kona_player_info'],scope:{segment:0,readHost:true},query:{scoringPeriodId:9},filter:{players:{filterStatus:{value:['FREEAGENT','WAIVERS']},filterSlotIds:{value:[]},limit:1500,offset,sortPercOwned:{sortPriority:1,sortAsc:false},sortDraftRanks:{sortPriority:100,sortAsc:true,value:'STANDARD'}}}});
  for(const p of page.players??[])if(p.player)statuses.set(String(p.player.id),p.status);
  if((page.players??[]).length<1500)break;
}
const slots=[...roster.starters,...roster.bench,...roster.injured_reserve,...roster.taxi].filter(s=>s.player_id);
const healthy=new Map((horizon.healthyPlayers??[]).map(p=>[p.playerId,p]));
const ownedIds=new Set(slots.map(s=>s.player_id));
const scenarioForecasts=horizon.players.map(p=>deficits&&byId.get(p.playerId)?.status!=='active'&&healthy.has(p.playerId)?injuryScenario(healthy.get(p.playerId),recoveryById.get(p.playerId),ownedIds.has(p.playerId),9):p);
const protectedPlayerIds=slots.filter(s=>!byId.has(s.player_id)||(!deficits&&byId.get(s.player_id).status!=='active')||(deficits&&byId.get(s.player_id).status!=='active'&&!healthy.has(s.player_id))||['IR','TAXI'].includes(s.slot_type)).map(s=>s.player_id);
// The present horizon explicitly has no injury-recovery model. Under the revised
// policy these are evidence/coverage holds, not a blanket prohibition on injury.
const injuryReview=slots.filter(s=>byId.has(s.player_id)&&byId.get(s.player_id).status!=='active').map(s=>({playerId:s.player_id,name:byId.get(s.player_id).full_name,status:byId.get(s.player_id).status,decision:'human_review',reason:'Current horizon carries health forward and does not model a sourced return window; cannot infer injury-adjusted remaining-season drop value.'}));
const seasonEndWeek=fresh.status.finalScoringPeriod;
if(!Number.isInteger(seasonEndWeek)||seasonEndWeek<9||seasonEndWeek>18)throw Error('Unverified fantasy-season boundary.');
const rosterSettings=await reader.getRosterSettings('98806880');
const choices=selectAutomaticWaivers({policy:{...policy,maxClaims:proposed.proposedLimits.maximumSuccessfulAcquisitionsPerScoringWeek},targetWeek:9,seasonEndWeek,allowRedundantTightEndReplacement:deficits&&activePolicy.allowRedundantTightEndReplacement===true,
  roster:slots.map(s=>({playerId:s.player_id,slot:byId.get(s.player_id)?.positions[0]??s.slot_type,eligiblePositions:byId.get(s.player_id)?.positions,currentSlot:s.slot_type,locked:s.locked})),
  starterCounts:rosterSettings.slots.filter(s=>!['BN','IR','TAXI'].includes(s.slot)&&s.count>0).map(s=>({slot:s.slot,count:s.count})),
  forecasts:scenarioForecasts.map(p=>({...p,weeks:p.weeks.filter(w=>w.week<=seasonEndWeek)})),
  waiverPlayerIds:free.filter(p=>p.status==='active'&&(!reviewedAdds||reviewedAdds.has(p.player_id))&&['FREEAGENT','WAIVERS'].includes(statuses.get(p.player_id))).map(p=>p.player_id),protectedPlayerIds
});
const queue=new ActionQueue(new SqliteActionQueueStore(resolve(root,'data/pmt.sqlite')));
const plan=[];
for(const choice of choices){
  const kind=statuses.get(choice.action.addPlayerId);
  if(await reader.getAcquisitionStatus('98806880',choice.action.addPlayerId)!==kind)throw Error('Availability changed during evaluation.');
  const action=kind==='WAIVERS'?choice.action:{type:'add_drop',teamId:'7',addPlayerIds:[choice.action.addPlayerId],dropPlayerIds:[choice.action.dropPlayerId]};
  const explanation=`Preview only, awaiting human decision; ${choice.rationale}; model ${manifest.modelVersion}`;
  const existing=(await queue.pending()).find(q=>q.preconditions?.leagueExternalId==='98806880'&&q.preconditions?.scoringPeriod==='2026-W9'&&q.preconditions?.expectedRosterHashes?.['7']===rosterFingerprint(roster)&&q.payloadHash===actionPayloadHash(action)&&Date.parse(q.expiresAt)>Date.now());
  const queued=existing??(kind==='WAIVERS'
    ?(await prepareWaiverClaim(reader,queue,'98806880',choice.action,{rationale:explanation})).action
    :await queue.enqueue(action,'high',explanation,{ttlMs:30*60*1000,preconditions:{leagueExternalId:'98806880',scoringPeriod:'2026-W9',expectedRosterHashes:{'7':rosterFingerprint(roster)}}}));
  plan.push({...choice,action,acquisitionStatus:kind,addName:byId.get(choice.action.addPlayerId)?.full_name,dropName:byId.get(choice.action.dropPlayerId)?.full_name,actionId:queued.actionId,status:queued.status,expiresAt:queued.expiresAt});
}
const report={readAt:new Date().toISOString(),leagueId:'98806880',teamId:'7',week:9,seasonEndWeek,mode:'preview_only',authorityEnabled:false,transactionLimit:proposed.proposedLimits.maximumSuccessfulAcquisitionsPerScoringWeek,injuryReview,injuredAvailableRequiringRecoveryModel:free.filter(p=>p.status!=='active').length,modelStatus:manifest.status,modelVersion:manifest.modelVersion,cutoffWeek:manifest.cutoffWeek,trainingCoverage:manifest.completedOutcomeCoverage,availablePlayers:free.length,matchedAvailable:free.filter(p=>horizon.players.some(f=>f.playerId===p.player_id)).length,waiverRank:context.teamWaiverRank,waiverRules:context.settings,pendingClaims:pending.length,plan,platformWrites:0,
  limitations:['Outcome-trained candidate model is not production-promoted; proposed authorization must explicitly accept validated PMT artifacts for acquisition decisions.','Conditional model probabilities are not calibrated empirical success rates.','Preview omits optional handcuff and covariance scenarios; same-team relationships alone never justify a transaction.']};
await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,deficits?'transaction-preview-deficits.json':'transaction-preview-five.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
