/** Execute one PMT-selected acquisition under the user's scoped standing policy. */
import { readFile, writeFile, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnv } from '../dist/src/config/load-env.js';
import { loadRuntimeConfig } from '../dist/src/config/runtime-config.js';
import { loadEspnCredentials } from '../dist/src/adapters/espn/espn-auth.js';
import { EspnPlatformReader } from '../dist/src/adapters/espn/espn-platform-reader.js';
import { EspnPlatformWriter } from '../dist/src/adapters/espn/espn-platform-writer.js';
import { ActionQueue, SqliteActionQueueStore, actionPayloadHash, canonicalJson } from '../dist/src/agents/action-queue.js';
import { ActionExecutor, SqliteActionExecutionStore, rosterFingerprint } from '../dist/src/agents/action-executor.js';
import { assertFreshWaiverTraining, selectAutomaticWaivers } from '../dist/src/agents/automatic-waivers.js';
import { acquisitionCapacity, injuryScenario } from '../dist/src/agents/transaction-protocol.js';
import { readWaiverContext } from '../dist/src/mcp/waiver-context.js';

loadEnv();
const root=resolve(import.meta.dirname,'..');
const [actionId,evidencePath]=process.argv.slice(2);
if(!actionId||!evidencePath||process.argv.length!==4)throw Error('Usage: node scripts/execute-automatic-transaction.mjs <queued-action-id> <news-evidence.json>');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const policyPath=resolve(root,'config/football/automatic-transactions.json');
const policyRaw=await readFile(policyPath);const policy=JSON.parse(policyRaw);
const config=loadRuntimeConfig();const credentials=loadEspnCredentials();
if(!policy.enabled||config.platform!=='espn'||config.leagueExternalId!==policy.leagueId||config.teamExternalId!==policy.teamId||Number(config.season)!==policy.season||credentials.leagueId!==policy.leagueId||Number(credentials.season)!==policy.season)throw Error('Standing transaction authority or scope mismatch.');
const evidence=await json(resolve(evidencePath));
const newsAge=Date.now()-Date.parse(evidence.newsRefreshedAt);
if(!Number.isFinite(newsAge)||newsAge<0||newsAge>3600000)throw Error('Refresh player news/injuries and record the actual refresh timestamp before submission.');
const lockPath=resolve(config.dataDir,`acquisitions-${policy.leagueId}-${policy.teamId}.lock`);
const lock=await open(lockPath,'wx').catch(()=>{throw Error('Another acquisition run or unreconciled crash lock exists.');});
try {
 const reconcilePath=resolve(config.dataDir,'acquisitions-reconciliation.json');
 const unresolvedConfirmation=await json(reconcilePath).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
 if(unresolvedConfirmation)throw Error('A previous acquisition needs platform confirmation reconciliation before further submissions.');
 const queue=new ActionQueue(new SqliteActionQueueStore(config.databasePath));
 const store=new SqliteActionExecutionStore(config.databasePath);
 const queued=await queue.get(actionId);
 if(!queued||!['add_drop','waiver_claim'].includes(queued.action.type)||queued.risk!=='high'||queued.action.teamId!==policy.teamId||queued.preconditions?.leagueExternalId!==policy.leagueId||queued.payloadHash!==actionPayloadHash(queued.action)||!['pending','approved'].includes(queued.status)||Date.parse(queued.expiresAt)<=Date.now())throw Error('Exact acquisition proposal is invalid, expired, resolved, or outside standing scope.');
 const reader=new EspnPlatformReader({credentials});
 const fresh=await reader.getLeagueFresh();const week=fresh.scoringPeriodId;
 if(String(fresh.id)!==policy.leagueId||fresh.seasonId!==policy.season||!Number.isInteger(week)||week<2||week>18||queued.preconditions.scoringPeriod!==`${policy.season}-W${week}`)throw Error('Fresh league/season/period mismatch.');
 const context=await readWaiverContext(reader,policy.leagueId,policy.teamId);
 if(context.settings.type!=='rolling'||context.settings.acquisition_type!=='WAIVERS_TRADITIONAL')throw Error('Changed acquisition rules require review; no FAAB spending is authorized.');
 const pending=await reader.getPendingWaiverClaims(policy.leagueId,policy.teamId);
 const pendingIds=pending.flatMap(p=>p.items.filter(i=>i.type==='ADD').map(i=>String(i.playerId)));
 const capacity=acquisitionCapacity(await queue.list(),await store.listReceipts(),pendingIds,{leagueId:policy.leagueId,teamId:policy.teamId,period:`${policy.season}-W${week}`},policy.maximumSuccessfulAcquisitionsPerScoringWeek);
 if(!capacity.remaining)throw Error('Five-transaction weekly limit is fully used or reserved.');
 const action=queued.action;
 const addId=action.type==='add_drop'?action.addPlayerIds[0]:action.addPlayerId;
 const dropId=action.type==='add_drop'?action.dropPlayerIds[0]:action.dropPlayerId;
 if(action.type==='add_drop'&&(action.addPlayerIds.length!==1||action.dropPlayerIds.length!==1)||!dropId||addId===dropId||action.faabBid!==undefined)throw Error('Only one exact add/conditional drop with no FAAB spending is authorized.');
 if(pendingIds.includes(addId)||pending.some(p=>p.items.some(i=>i.type==='DROP'&&String(i.playerId)===dropId)))throw Error('Conflicting pending ESPN claim requires reconciliation.');
 const roster=await reader.getRoster(policy.leagueId,policy.teamId);
 if(queued.preconditions.expectedRosterHashes?.[policy.teamId]!==rosterFingerprint(roster))throw Error('Roster changed since preparation; prepare a new validated proposal.');
 const free=await reader.getFreeAgents(policy.leagueId);const players=await reader.getPlayers('football',String(policy.season));
 const byId=new Map([...players,...free].map(p=>[p.player_id,p]));
 const add=free.find(p=>p.player_id===addId);
 const expected=action.type==='waiver_claim'?'WAIVERS':'FREEAGENT';
 if(!add||await reader.getAcquisitionStatus(policy.leagueId,addId)!==expected)throw Error('Player acquisition status changed.');
 const additionReview=(evidence.additionReviews??[]).find(p=>p.playerId===addId);
 if(!additionReview||additionReview.availableThisWeek!==true||additionReview.hasOffensiveRole!==true||!/^https:\/\//.test(additionReview.sourceUrl)||!additionReview.quote?.trim()||!Number.isFinite(Date.parse(additionReview.publishedAt))||Date.parse(additionReview.publishedAt)>Date.now()||!Number.isFinite(Date.parse(additionReview.retrievedAt))||Date.now()-Date.parse(additionReview.retrievedAt)>3600000||Date.parse(additionReview.retrievedAt)>Date.now())throw Error('A fresh sourced availability and role review is required for the addition; a roster Active label is insufficient.');
 const slots=[...roster.starters,...roster.bench,...roster.injured_reserve,...roster.taxi].filter(s=>s.player_id);
 if(slots.some(s=>s.player_id===addId)||!slots.some(s=>s.player_id===dropId&&!s.locked))throw Error('Add/drop ownership or lock state invalid.');
 const dropSlot=slots.find(s=>s.player_id===dropId);
 if(['IR','TAXI'].includes(dropSlot.slot_type)){
  const activeCapacity=Object.entries(fresh.settings?.rosterSettings?.lineupSlotCounts??{}).filter(([slot])=>!['21','88'].includes(slot)).reduce((n,[,count])=>n+Number(count),0);
  if(!activeCapacity||roster.starters.length+roster.bench.length>=activeCapacity)throw Error('Replacing a reserve player would exceed active-roster capacity; review a legal IR/active-roster transition first.');
 }
 const artifactDir=resolve(root,`artifacts/week${week}-${policy.season}-scout`);
 const manifest=await json(resolve(artifactDir,'manifest.json'));const horizonRaw=await readFile(resolve(artifactDir,'waiver-horizon.json'));const horizon=JSON.parse(horizonRaw);
 assertFreshWaiverTraining(manifest,week,manifest.completedOutcomeCoverage?.gameIds??[],new Date(),{...policy,enabled:true});
 if(evidence.modelVersion!==manifest.modelVersion||hash(horizonRaw)!==manifest.waiverHorizonSha256||horizon.modelVersion!==manifest.modelVersion||canonicalJson(manifest.scoring)!==canonicalJson(fresh.settings.scoringSettings))throw Error('Model evidence, horizon or live scoring mismatch.');
 for(const [key,file] of [['modelCodeSha256','python/scout/weekly_scout.py'],['waiverHorizonCodeSha256','python/scout/waiver_horizon.py'],['scoringCodeSha256','python/scout/dst_scoring.py']])if(manifest[key]!==hash(await readFile(resolve(root,file))))throw Error('Model producer changed; rebuild before acquisition decisions.');
 for(const [key,file] of [['stats',`data/nflverse/stats_player_week_${policy.season}.csv`],['games','data/nflverse/games.csv']])if(manifest.sourceSha256[key]!==hash(await readFile(resolve(root,file))))throw Error('Model source changed; revalidate coverage and rebuild.');
 const seasonEndWeek=fresh.status.finalScoringPeriod;
 if(!Number.isInteger(seasonEndWeek)||seasonEndWeek<week||seasonEndWeek>18)throw Error('Fantasy season is over or boundary unavailable.');
 const owned=new Set(slots.map(s=>s.player_id));const healthy=new Map((horizon.healthyPlayers??[]).map(p=>[p.playerId,p]));
 const recoveries=new Map((evidence.recoveries??[]).map(p=>[p.playerId,p]));
 const missing=new Set();
 const forecasts=horizon.players.map(p=>{
  const status=byId.get(p.playerId)?.status;
  if(status&&status!=='active'){
   if(!healthy.has(p.playerId)){missing.add(p.playerId);return p;}
   return injuryScenario(healthy.get(p.playerId),recoveries.get(p.playerId),owned.has(p.playerId),week);
  }
  return p;
 }).map(p=>({...p,weeks:p.weeks.filter(w=>w.week<=seasonEndWeek)}));
 const noStat=new Set((manifest.unavailableWithoutStatisticalIdentity??[]).map(p=>p.espnId));
 if(missing.has(addId)||missing.has(dropId)||noStat.has(addId)||noStat.has(dropId))throw Error('Healthy-return model coverage missing for this injury-dependent transaction.');
 const settings=await reader.getRosterSettings(policy.leagueId);
 const choices=selectAutomaticWaivers({policy:{...policy,maxClaims:1},targetWeek:week,seasonEndWeek,forecasts,allowRedundantTightEndReplacement:policy.allowRedundantTightEndReplacement===true,
  roster:slots.map(s=>({playerId:s.player_id,slot:byId.get(s.player_id)?.positions[0]??s.slot_type,eligiblePositions:byId.get(s.player_id)?.positions,currentSlot:s.slot_type,locked:s.locked})),
  starterCounts:settings.slots.filter(s=>!['BN','IR','TAXI'].includes(s.slot)&&s.count>0).map(s=>({slot:s.slot,count:s.count})),
  waiverPlayerIds:[addId],protectedPlayerIds:[...missing,...noStat,...slots.filter(s=>!byId.has(s.player_id)).map(s=>s.player_id)]});
 const choice=choices.find(c=>c.action.addPlayerId===addId&&c.action.dropPlayerId===dropId);
 if(!choice)throw Error('PMT does not support this exact improvement under current injury/recovery scenarios.');
 const uncertainInjury=byId.get(dropId)?.status!=='active'&&recoveries.get(dropId)?.earliestReturnWeek===undefined;
 if(uncertainInjury&&choice.nearTermGain<policy.suggestedNearTermLineupGain&&choice.seasonGain<policy.suggestedSeasonLineupGain)throw Error('Unknown-duration injury replacement does not meet the existing high-value benchmarks against a healthy-return baseline.');
 if(hash(await readFile(policyPath))!==hash(policyRaw))throw Error('Standing policy changed during validation.');
 if(queued.status==='pending')await queue.approve(actionId,`standing-transactions:${policy.authorizedBy}`);
 const executor=new ActionExecutor({queue,reader,writer:new EspnPlatformWriter({credentials}),store,leagueExternalId:policy.leagueId,actor:`standing-transactions:${policy.authorizedBy}`});
 const result=await executor.execute(actionId);
 let verified=false;
 if(['executed','already_executed'].includes(result.status)){
  await reader.getLeagueFresh();
  if(action.type==='add_drop'){
   const r=await reader.getRoster(policy.leagueId,policy.teamId);const ids=[...r.starters,...r.bench,...r.injured_reserve,...r.taxi].map(s=>s.player_id);verified=ids.includes(addId)&&!ids.includes(dropId);
  }else verified=(await reader.getPendingWaiverClaims(policy.leagueId,policy.teamId)).some(p=>p.items.some(i=>i.type==='ADD'&&String(i.playerId)===addId)&&p.items.some(i=>i.type==='DROP'&&String(i.playerId)===dropId));
 }
 const report={at:new Date().toISOString(),actionId,status:result.status,reason:result.reason,verified,capacityBefore:capacity,modelVersion:manifest.modelVersion,policyHash:hash(policyRaw),choice,recoveries:evidence.recoveries??[],additionReview,audit:(await store.listAudit()).filter(r=>r.actionId===actionId)};
 await writeFile(resolve(config.dataDir,`transaction-${actionId}.json`),JSON.stringify(report,null,2));
 if(!verified&&['executed','already_executed','unknown'].includes(result.status))await writeFile(reconcilePath,JSON.stringify({actionId,status:result.status,recordedAt:report.at,reason:'Submission outcome or platform confirmation needs reconciliation. No automatic retry.'},null,2));
 console.log(JSON.stringify({actionId,status:result.status,reason:result.reason,verified,capacityBefore:capacity}));
 if(!verified)process.exitCode=1;
} finally { await lock.close();await unlink(lockPath); }
