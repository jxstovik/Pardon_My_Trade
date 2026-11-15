// Read-only comparison of all available acquisition types against optimized lineups.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnv } from '../dist/src/config/load-env.js';
import { loadRuntimeConfig } from '../dist/src/config/runtime-config.js';
import { loadEspnCredentials } from '../dist/src/adapters/espn/espn-auth.js';
import { EspnPlatformReader } from '../dist/src/adapters/espn/espn-platform-reader.js';
import { assertFreshWaiverTraining, selectAutomaticWaivers } from '../dist/src/agents/automatic-waivers.js';
import { canonicalJson } from '../dist/src/agents/action-queue.js';

loadEnv();
const root=resolve(import.meta.dirname,'..');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const config=loadRuntimeConfig(),credentials=loadEspnCredentials();
if(config.platform!=='espn'||config.leagueExternalId!=='98806880'||config.teamExternalId!=='7'||config.season!=='2026'||credentials.leagueId!=='98806880'||credentials.season!=='2026')throw Error('Evaluation scope mismatch.');
const reader=new EspnPlatformReader({credentials});
const live=await reader.getLeagueFresh();
const week=live.scoringPeriodId,seasonEndWeek=live.status?.finalScoringPeriod;
if(live.id!==98806880||live.seasonId!==2026||!Number.isInteger(week)||!Number.isInteger(seasonEndWeek)||week<2||week>seasonEndWeek||seasonEndWeek>18)throw Error('No verified active fantasy scoring week.');
const policy={...await json(resolve(root,'config/football/automatic-transactions.json')),authority:'Read-only user-requested acquisition comparison'};
const artifact=resolve(root,`artifacts/week${week}-2026-scout`);
const manifest=await json(resolve(artifact,'manifest.json'));
const training=JSON.parse(execFileSync(process.env.PMT_SCOUT_PYTHON??'/home/jordan-stovik/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',['scripts/waiver-training-state.py',String(week)],{cwd:root,encoding:'utf8'}));
assertFreshWaiverTraining(manifest,week,training.gameIds,new Date(),policy);
for(const [key,path] of [['modelCodeSha256','python/scout/weekly_scout.py'],['waiverHorizonCodeSha256','python/scout/waiver_horizon.py'],['scoringCodeSha256','python/scout/dst_scoring.py']])if(manifest[key]!==sha(await readFile(resolve(root,path))))throw Error('Model producer changed since fitting.');
for(const key of ['stats','games'])if(manifest.sourceSha256[key]!==training.sourceSha256[key])throw Error('Training source changed since fitting.');
const raw=await readFile(resolve(artifact,'waiver-horizon.json'));
if(sha(raw)!==manifest.waiverHorizonSha256||canonicalJson(manifest.scoring)!==canonicalJson(live.settings.scoringSettings))throw Error('Forecast or scoring provenance mismatch.');
const horizon=JSON.parse(raw);
if(horizon.schemaVersion!==2||horizon.modelVersion!==manifest.modelVersion||horizon.targetWeek!==week||horizon.cutoffWeek!==week-1)throw Error('Horizon scope mismatch.');
const roster=await reader.getRoster('98806880','7');
const free=await reader.getFreeAgents('98806880');
const players=await reader.getPlayers('football','2026');
const byId=new Map([...players,...free].map(p=>[p.player_id,p]));
const owned=[...roster.starters,...roster.bench,...roster.injured_reserve,...roster.taxi].filter(s=>s.player_id);
const protectedPlayerIds=owned.filter(s=>!byId.has(s.player_id)||byId.get(s.player_id).status!=='active'||['IR','TAXI'].includes(s.slot_type)).map(s=>s.player_id);
const statuses=new Map();
let completePool=false;
for(let offset=0;offset<45000;offset+=1500){
 const page=await reader.client.getJson('',{view:['kona_player_info'],scope:{segment:0,readHost:true},query:{scoringPeriodId:week},filter:{players:{filterStatus:{value:['FREEAGENT','WAIVERS']},filterSlotIds:{value:[]},limit:1500,offset,sortPercOwned:{sortPriority:1,sortAsc:false},sortDraftRanks:{sortPriority:100,sortAsc:true,value:'STANDARD'}}}});
 if(!Array.isArray(page.players))throw Error('Available-player status view unavailable.');
 for(const p of page.players)if(p.player)statuses.set(String(p.player.id),p.status);
 if(page.players.length<1500){completePool=true;break;}
}
if(!completePool)throw Error('Available-player pool truncated.');
const forecastIds=new Set(horizon.players.map(p=>p.playerId));
const active=free.filter(p=>p.status==='active'&&['WAIVERS','FREEAGENT'].includes(statuses.get(p.player_id))&&forecastIds.has(p.player_id)).map(p=>p.player_id);
const settings=await reader.getRosterSettings('98806880');
const rosterInputs=slots=>slots.map(s=>({playerId:s.player_id,slot:byId.get(s.player_id)?.positions[0]??s.slot_type,eligiblePositions:byId.get(s.player_id)?.positions,currentSlot:s.slot_type,locked:s.locked}));
const period=Object.entries(live.settings.scheduleSettings.matchupPeriods).find(([,weeks])=>weeks.includes(week))?.[0];
const match=live.schedule.find(m=>String(m.matchupPeriodId)===period&&[m.home?.teamId,m.away?.teamId].includes(7));
const opponentId=[match?.home?.teamId,match?.away?.teamId].find(id=>id!==undefined&&id!==7);
let opponentRoster;
if(opponentId!==undefined){const r=await reader.getRoster('98806880',String(opponentId));const slots=[...r.starters,...r.bench].filter(s=>s.player_id);if(slots.every(s=>forecastIds.has(s.player_id)&&byId.has(s.player_id)))opponentRoster=rosterInputs(slots);}
// Validate current NFL clubs before assigning historical handcuff/covariance evidence.
const response=await fetch('https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026?view=proTeamSchedules_wl',{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error('NFL club identity view unavailable.');
const clubs=(await response.json()).settings?.proTeams??[];
const alias=x=>({LA:'LAR',JAC:'JAX',WSH:'WAS',OAK:'LV',SD:'LAC',STL:'LAR'}[x]??x);
const clubById=new Map(clubs.map(t=>[String(t.id),alias(t.abbrev??t.abbreviation)]));
const predictions=new Map(horizon.players.map(p=>[p.playerId,p]));
const club=id=>{const c=clubById.get(byId.get(id)?.team);return c&&c===alias(predictions.get(id)?.team)?c:undefined;};
const handcuffs=(horizon.handcuffs??[]).filter(h=>club(h.leaderPlayerId)&&club(h.leaderPlayerId)===club(h.backupPlayerId));
const correlations=(horizon.correlations??[]).filter(c=>club(c.qbPlayerId)&&club(c.qbPlayerId)===club(c.receiverPlayerId));
const input={policy,targetWeek:week,seasonEndWeek,roster:rosterInputs(owned),starterCounts:settings.slots.filter(s=>!['BN','IR','TAXI'].includes(s.slot)&&s.count>0).map(s=>({slot:s.slot,count:s.count})),forecasts:horizon.players.map(p=>({...p,weeks:p.weeks.filter(w=>w.week<=seasonEndWeek)})),waiverPlayerIds:active,protectedPlayerIds,allowRedundantTightEndReplacement:policy.allowRedundantTightEndReplacement===true,handcuffs,correlations,opponentRoster};
const named=c=>({...c,addName:byId.get(c.action.addPlayerId)?.full_name,dropName:byId.get(c.action.dropPlayerId)?.full_name,acquisitionStatus:statuses.get(c.action.addPlayerId)});
const plan=selectAutomaticWaivers(input).map(named);
// Single-add comparisons expose alternatives that share a conditional drop.
const alternatives=active.flatMap(id=>selectAutomaticWaivers({...input,policy:{...policy,maxClaims:1},waiverPlayerIds:[id]})).map(named).sort((a,b)=>b.nearTermGain-a.nearTermGain||b.seasonGain-a.seasonGain);
let submissionReadiness='verified empty';
try{if((await reader.getPendingWaiverClaims('98806880','7')).length)submissionReadiness='Existing pending claims need reconciliation.';}catch(e){submissionReadiness=e.message;}
const report={at:new Date().toISOString(),week,seasonEndWeek,leagueId:'98806880',teamId:'7',modelVersion:manifest.modelVersion,cutoffWeek:manifest.cutoffWeek,trainingGames:training.gameIds.length,availablePlayers:free.length,modeledHealthyCandidates:active.length,matchedAvailable:free.filter(p=>forecastIds.has(p.player_id)).length,plan,alternatives,injuryHolds:protectedPlayerIds.map(id=>({playerId:id,name:byId.get(id)?.full_name,status:byId.get(id)?.status,reason:'No sourced recovery model was supplied; no automatic injury-based drop inferred.'})),submissionReadiness,platformWrites:0,limitations:['All gains compare optimized legal starting lineups, not bench totals.','Conditional model simulations are not calibrated probabilities.','Availability, injury return dates and new roles require fresh evidence before submission.','A five-choice preview does not itself establish remaining weekly acquisition capacity or execution authority.']};
const output=resolve(root,'output/football-automation',`week${week}-acquisition-review.json`);
await mkdir(resolve(root,'output/football-automation'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({reportPath:output,...report},null,2));
