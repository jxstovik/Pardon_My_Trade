import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadEnv } from '../dist/src/config/load-env.js';
import { loadRuntimeConfig } from '../dist/src/config/runtime-config.js';
import { EspnPlatformReader } from '../dist/src/adapters/espn/espn-platform-reader.js';
import { buildEspnLineupTransaction } from '../dist/src/adapters/espn/espn-platform-writer.js';
import { ESPN_SLOT_TO_POSITION } from '../dist/src/adapters/espn/espn-auth.js';
import { planWeeklyLineup } from '../dist/src/agents/weekly-lineup.js';
import { ActionQueue, SqliteActionQueueStore } from '../dist/src/agents/action-queue.js';
import { rosterFingerprint } from '../dist/src/agents/action-executor.js';
import { assertFreshWaiverTraining } from '../dist/src/agents/automatic-waivers.js';

loadEnv();
const root=resolve(import.meta.dirname,'..');
const execute=process.argv.includes('--execute');
if(process.argv.slice(2).some(a=>a!=='--execute'))throw Error('Use default preview or --execute.');
const config=loadRuntimeConfig();
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const authorization=await json(resolve(root,'config/football-lineup-authorization.json'));
const policy=await json(resolve(root,'config/football/automatic-transactions.json'));
if(!authorization.enabled||config.platform!=='espn'||config.leagueExternalId!==authorization.leagueId||config.teamExternalId!==authorization.teamId||config.season!==authorization.season)throw Error('Lineup scope differs from standing permission.');
const reader=new EspnPlatformReader();
const fresh=await reader.getLeagueFresh();
const week=fresh.scoringPeriodId;
if(String(fresh.id)!==config.leagueExternalId||String(fresh.seasonId)!==config.season||!Number.isInteger(week)||week<2||week>fresh.status.finalScoringPeriod)throw Error('Fresh scope/season/week invalid or offseason.');
const team=fresh.teams.find(t=>String(t.id)===config.teamExternalId);
if(!team)throw Error('Live team not found.');
const directory=resolve(root,`artifacts/week${week}-${config.season}-scout`);
const manifest=await json(resolve(directory,'manifest.json'));
assertFreshWaiverTraining(manifest,week,manifest.completedOutcomeCoverage?.gameIds??[],new Date(),policy);
const modelCodeHash=createHash('sha256').update(await readFile(resolve(root,'python/scout/weekly_scout.py'))).digest('hex');
if(manifest.modelCodeSha256!==modelCodeHash)throw Error('Weekly model producer changed; refresh models first.');
if(JSON.stringify(manifest.scoring)!==JSON.stringify(fresh.settings.scoringSettings))throw Error('Live scoring differs from model scoring.');
const forecasts=await json(resolve(directory,'player-forecasts.json'));
const modelById=new Map(forecasts.map(p=>[String(p.espnId),p]));
const roster=await reader.getRoster(config.leagueExternalId,config.teamExternalId);
const entries=team.roster?.entries??[];
const counts=Object.entries(fresh.settings.rosterSettings.lineupSlotCounts).filter(([slot,count])=>!['20','21'].includes(slot)&&count>0).map(([slot,count])=>{
 const position=ESPN_SLOT_TO_POSITION[Number(slot)];
 if(!position||['BN','IR'].includes(position))throw Error(`Unsupported live starter slot ${slot}; do not guess its eligibility.`);
 return {slot:position,count};
});
const points=new Map();
const unavailable=[];
const inputs=[...roster.starters,...roster.bench].filter(s=>s.player_id).map(slot=>{
 const entry=entries.find(e=>String(e.playerPoolEntry?.player?.id??e.playerId)===slot.player_id);
 const player=entry?.playerPoolEntry?.player;
 const model=modelById.get(slot.player_id);
 if(!player||!model||!Number.isFinite(model.mean))throw Error(`Live identity/current-week model coverage missing: ${slot.player_id}`);
 const currentStatus=player.injuryStatus??'ACTIVE';
 const out=['OUT','DOUBTFUL','IR','INJURY_RESERVE'].includes(currentStatus.toUpperCase());
 const liveTag=out?'OUT':currentStatus.toUpperCase()==='QUESTIONABLE'?'Q':'ACTIVE';
 const modelTag=['O','IR','D'].includes(model.status)?'OUT':model.status==='Q'?'Q':'ACTIVE';
 if(liveTag!==modelTag)throw Error(`Availability changed since model refresh for ${player.fullName}; refresh the weekly artifacts before optimization.`);
 const mean=out||model.bye?0:model.mean;
 points.set(slot.player_id,mean);
 if(out||model.bye)unavailable.push({playerId:slot.player_id,name:player.fullName,status:currentStatus,bye:!!model.bye});
 return {playerId:slot.player_id,slot:slot.slot_type,currentSlot:slot.slot_type,locked:slot.locked,eligiblePositions:(player.eligibleSlots??[]).map(n=>ESPN_SLOT_TO_POSITION[n]).filter(p=>p&&!['BN','IR'].includes(p))};
});
const plan=planWeeklyLineup(inputs,counts,points);
const action={type:'set_roster',teamId:config.teamExternalId,starters:plan.starters};
// This is pure wire validation, not a write. It checks every actual ESPN slot,
// eligibility, full starter counts, ownership, and last-read locks.
buildEspnLineupTransaction(action,'validation-only',week,entries,fresh.settings.rosterSettings.lineupSlotCounts);
const names=new Map(entries.map(e=>[String(e.playerPoolEntry?.player?.id??e.playerId),e.playerPoolEntry?.player?.fullName]));
const report={at:new Date().toISOString(),week,leagueId:config.leagueExternalId,teamId:config.teamExternalId,modelVersion:manifest.modelVersion,objective:'maximum current-week model expected points subject to exact live eligibility, capacity and locks',mode:execute?'execute':'preview',...plan,
 starters:plan.starters.map(p=>({...p,name:names.get(p.playerId),projectedPoints:points.get(p.playerId)})),changes:plan.changes.map(c=>({...c,name:names.get(c.playerId)})),unavailable,executed:false,verified:plan.currentLegal&&plan.changes.length===0};
const reports=resolve(root,'output/football-automation/lineup-review-2026-11-05');await mkdir(reports,{recursive:true});
const reportPath=resolve(reports,`weekly-lineup-${Date.now()}.json`);
await writeFile(reportPath,JSON.stringify(report,null,2));
if(execute&&plan.changes.length){
 const queue=new ActionQueue(new SqliteActionQueueStore(config.databasePath));
 const currentHash=rosterFingerprint(roster);
 // Superseded pending proposals cannot supply approval for a changed roster.
 for(const old of await queue.pending())if(old.action.type==='set_roster'&&old.action.teamId===config.teamExternalId&&old.preconditions?.leagueExternalId===config.leagueExternalId&&old.preconditions?.expectedRosterHashes?.[config.teamExternalId]!==currentHash)await queue.reject(old.actionId,'superseded-live-roster');
 const queued=await queue.enqueue(action,'low',`Maximum legal weekly model score (${manifest.modelVersion}); ${plan.expectedGain.toFixed(2)} projected-point improvement.`,{ttlMs:30*60*1000,preconditions:{leagueExternalId:config.leagueExternalId,scoringPeriod:`${config.season}-W${week}`,expectedRosterHashes:{[config.teamExternalId]:currentHash}}});
 report.actionId=queued.actionId;
 const output=await new Promise((ok,bad)=>{
  const child=spawn(process.execPath,[resolve(root,'scripts/execute-automatic-lineup.mjs'),queued.actionId],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  child.on('error',bad);child.on('exit',code=>code===0?ok(stdout):bad(Error(`Lineup execution not verified: ${stderr||stdout}`)));
 });
 const result=JSON.parse(output);report.executed=['executed','already_executed'].includes(result.status);report.verified=result.verified;report.audit=result.audit;
 await writeFile(reportPath,JSON.stringify(report,null,2));
}
console.log(JSON.stringify({...report,reportPath},null,2));
