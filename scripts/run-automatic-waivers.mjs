import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadEnv } from '../dist/src/config/load-env.js';
import { loadEspnCredentials } from '../dist/src/adapters/espn/espn-auth.js';
import { loadRuntimeConfig } from '../dist/src/config/runtime-config.js';
import { EspnPlatformReader } from '../dist/src/adapters/espn/espn-platform-reader.js';
import { EspnPlatformWriter } from '../dist/src/adapters/espn/espn-platform-writer.js';
import { ActionQueue, SqliteActionQueueStore, canonicalJson } from '../dist/src/agents/action-queue.js';
import { ActionExecutor, SqliteActionExecutionStore, rosterFingerprint } from '../dist/src/agents/action-executor.js';
import { assertFreshWaiverTraining, selectAutomaticWaivers } from '../dist/src/agents/automatic-waivers.js';
import { acquisitionCapacity } from '../dist/src/agents/transaction-protocol.js';
import { prepareWaiverClaim, readWaiverContext } from '../dist/src/mcp/waiver-context.js';
import { publishedWeeks, selectPlanningTarget } from './refresh-tuesday-projections.mjs';

const root=resolve(import.meta.dirname,'..');
const run=promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path,'utf8'));
const python=process.env.PMT_SCOUT_PYTHON ?? '/home/jordan-stovik/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
async function get(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Required source returned HTTP ${response.status}`);
  return response;
}
export function assertTuesdayWindow(at) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));
  if(parts.weekday!=='Tue'||Number(parts.hour)<2||Number(parts.hour)>=6)throw Error('Automatic submission is limited to Tuesday 02:00–06:00 America/New_York; initial check is scheduled at 02:00.');
}

/** A fresh, scoped human request permits an attended run outside the scheduled window. */
export function assertSubmissionWindow(at, authorization) {
  if (!authorization) return assertTuesdayWindow(at);
  const requested = Date.parse(authorization.requestedAt), expires = Date.parse(authorization.expiresAt);
  if (authorization.leagueId !== '98806880' || authorization.teamId !== '7' || authorization.season !== 2026 ||
      authorization.request !== 'Run the modeling and waiver priorities workflow, then submit appropriate waiver claims.' ||
      !Number.isFinite(requested) || !Number.isFinite(expires) || expires <= requested || expires - requested > 2 * 3600000 ||
      at.getTime() < requested || at.getTime() >= expires) throw Error('Manual waiver authorization is absent, expired or outside the authorized scope.');
}

export function assertPinnedAutomaticJob(jobs) {
  const job=jobs.find(job=>job.id==='38da0b12383e');
  if(!job?.enabled||job.state==='paused'||job.provider!=='openai-codex'||!['gpt-6.1-sol','gpt-6-astra'].includes(job.model)||!['medium','high','xhigh','max','ultra'].includes(job.reasoning_effort)||job.schedule?.expr!=='0 2 * * 2'||job.script||!job.prompt?.includes('scripts/run-automatic-waivers.mjs --execute'))throw Error('Installed automatic job is disabled, unpinned, downgraded or changed.');
}

/** Injectable side-effect boundary for testing: prepare -> policy approval -> executor -> confirm. */
export async function submitPrioritizedPlan({plan,prepare,approve,execute,confirm,beforeEach,record}) {
  const outcomes=[];
  for(const choice of plan) {
    await beforeEach(choice,outcomes);
    const queued=await prepare(choice);
    if(queued.status!=='pending'||canonicalJson(queued.action)!==canonicalJson(choice.action))throw Error('Prepared action differs from the authorized plan.');
    await record({stage:'prepared',actionId:queued.actionId,choice});
    await approve(queued.actionId);
    await record({stage:'submission_may_start',actionId:queued.actionId});
    const result=await execute(queued.actionId);
    await record({stage:'execution_result',actionId:queued.actionId,result});
    outcomes.push(result);
    if(!['executed','already_executed'].includes(result.status))break;
    if(!await confirm(choice)) {
      await record({stage:'submitted_unverified',actionId:queued.actionId});
      break; // Never resubmit a completed or ambiguous attempt.
    }
  }
  return outcomes;
}

async function main() {
  loadEnv();process.chdir(root);
  const argv=process.argv.slice(2);
  const manualIndex=argv.indexOf('--manual-authorization');
  let manualAuthorization;
  if(manualIndex!==-1) {
    if(!argv[manualIndex+1]||argv[manualIndex+1].startsWith('--'))throw Error('Manual submission requires a scoped authorization file.');
    manualAuthorization=await json(resolve(argv[manualIndex+1]));
    argv.splice(manualIndex,2);
    if(!argv.includes('--execute'))throw Error('Manual authorization requires --execute.');
  }
  if(argv.some(arg=>!['--execute','--check-only'].includes(arg))||argv.includes('--execute')&&argv.includes('--check-only'))throw Error('Use default dry-run, --check-only, or --execute.');
  const execute=argv.includes('--execute');
  const policyRaw=await readFile(resolve(root,'config/football/automatic-waivers.json'),'utf8');
  const policy=JSON.parse(policyRaw),policyHash=sha(policyRaw);
  const config=loadRuntimeConfig(),credentials=loadEspnCredentials();
  if(config.platform!=='espn'||config.leagueExternalId!==policy.leagueId||config.teamExternalId!==policy.teamId||Number(config.season)!==policy.season||credentials.leagueId!==policy.leagueId||Number(credentials.season)!==policy.season||!policy.enabled)throw Error('Automatic waiver scope/authority mismatch.');
  if(execute) {
    const reconciliation=await readFile(resolve(config.dataDir,'acquisitions-reconciliation.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
    if(reconciliation)throw Error('A prior acquisition needs platform confirmation reconciliation before any further submission.');
    assertSubmissionWindow(new Date(),manualAuthorization);
    assertPinnedAutomaticJob((await json(resolve(process.env.HERMES_HOME??resolve(homedir(),'.hermes'),'cron/jobs.json'))).jobs);
  }
  const sharedLockPath=resolve(config.dataDir,`acquisitions-${policy.leagueId}-${policy.teamId}.lock`);
  const sharedLock=execute?await open(sharedLockPath,'wx'):undefined;
  try {
  const reader=new EspnPlatformReader({credentials});
  let fresh=await reader.getLeagueFresh();
  const proTeams=(await (await get(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${credentials.season}?view=proTeamSchedules_wl`)).json()).settings?.proTeams;
  const target=selectPlanningTarget({at:new Date(),season:credentials.season,espnWeek:fresh.scoringPeriodId,weeks:publishedWeeks(proTeams)});
  if(target.timing!=='before_first_kickoff')throw Error('Waivers must be planned before the upcoming week starts.');
  const week=target.targetWeek;
  const seasonEndWeek=fresh.status?.finalScoringPeriod;
  if(!Number.isInteger(seasonEndWeek)||seasonEndWeek>18||seasonEndWeek<week)throw Error('No remaining verified fantasy-season scoring weeks; no claims authorized.');
  await mkdir(resolve(root,'data/nflverse'),{recursive:true});
  for(const [file,url] of [['games.csv','https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'],['stats_player_week_2026.csv','https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv']])await writeFile(resolve(root,'data/nflverse',file),Buffer.from(await (await get(url)).arrayBuffer()));
  const trainingState=JSON.parse((await run(python,['scripts/waiver-training-state.py',String(week)],{cwd:root})).stdout);
  const artifactDir=resolve(root,`artifacts/week${week}-2026-scout`);
  let manifest,horizon;
  async function checkTraining() {
    manifest=await json(resolve(artifactDir,'manifest.json'));
    assertFreshWaiverTraining(manifest,week,trainingState.gameIds,new Date(),policy);
    if(manifest.modelCodeSha256!==sha(await readFile(resolve(root,'python/scout/weekly_scout.py')))||manifest.waiverHorizonCodeSha256!==sha(await readFile(resolve(root,'python/scout/waiver_horizon.py')))||manifest.scoringCodeSha256!==sha(await readFile(resolve(root,'python/scout/dst_scoring.py'))))throw Error('Model producer changed since training.');
    for(const key of ['stats','games'])if(manifest.sourceSha256[key]!==trainingState.sourceSha256[key])throw Error('Training source changed since fitting.');
    const raw=await readFile(resolve(artifactDir,'waiver-horizon.json'));
    if(manifest.waiverHorizonSha256!==sha(raw))throw Error('Season forecast hash mismatch.');
    horizon=JSON.parse(raw);
    if(horizon.schemaVersion!==2||horizon.modelVersion!==manifest.modelVersion||horizon.targetWeek!==week||horizon.cutoffWeek!==week-1||horizon.season!==policy.season)throw Error('Season forecast provenance mismatch.');
  }
  let initialCheck='current';
  try {await checkTraining();} catch(error) {
    initialCheck=error.message;
    if(argv.includes('--check-only'))throw error;
    // Refresh source priors and fit candidates through exactly the last complete NFL week.
    await run(process.execPath,['scripts/weekly-planning.mjs'],{cwd:root,env:{...process.env,PMT_MCP_ROLE:'read',PMT_EXECUTION_ENABLED:'false'},maxBuffer:16*1024*1024,timeout:50*60*1000});
    // Training refresh re-downloads feeds; a changed source requires a fresh coverage proof.
    Object.assign(trainingState,JSON.parse((await run(python,['scripts/waiver-training-state.py',String(week)],{cwd:root})).stdout));
    await checkTraining();
  }
  const evaluatedModelVersion=manifest.modelVersion,evaluatedHorizonHash=manifest.waiverHorizonSha256;
  fresh=await reader.getLeagueFresh();
  if(canonicalJson(manifest.scoring)!==canonicalJson(fresh.settings?.scoringSettings))throw Error('Live league scoring differs from model scoring.');
  const context=await readWaiverContext(reader,policy.leagueId,policy.teamId);
  if(context.settings.type!=='rolling'||context.settings.acquisition_type!=='WAIVERS_TRADITIONAL')throw Error('Automatic policy supports only traditional priority waivers.');
  let pendingClaimReadiness='verified empty';
  try {
    if((await reader.getPendingWaiverClaims(policy.leagueId,policy.teamId)).length)pendingClaimReadiness='Existing ESPN pending claims require reconciliation before this weekly batch.';
  } catch(error) {pendingClaimReadiness=error.message;}
  if(execute&&pendingClaimReadiness!=='verified empty')throw Error(pendingClaimReadiness);
  const roster=await reader.getRoster(policy.leagueId,policy.teamId),rosterHash=rosterFingerprint(roster);
  const players=await reader.getPlayers('football',credentials.season);
  const free=await reader.getFreeAgents(policy.leagueId);
  const byId=new Map([...players,...free].map(p=>[p.player_id,p]));
  const owned=[...roster.starters,...roster.bench,...roster.injured_reserve,...roster.taxi].filter(s=>s.player_id);
  const protectedPlayerIds=owned.filter(s=>!byId.get(s.player_id)||byId.get(s.player_id).status!=='active'||['IR','TAXI'].includes(s.slot_type)).map(s=>s.player_id);
  const waiverIds=new Set(await reader.getWaiverPlayerIds(policy.leagueId));
  const activeCandidates=free.filter(p=>waiverIds.has(p.player_id)&&p.status==='active').map(p=>p.player_id);
  const rosterSettings=await reader.getRosterSettings(policy.leagueId);
  const matchupPeriod=Object.entries(fresh.settings?.scheduleSettings?.matchupPeriods??{}).find(([,periods])=>periods.includes(week))?.[0]??String(week);
  const matchup=fresh.schedule?.find(m=>String(m.matchupPeriodId)===String(matchupPeriod)&&[m.home?.teamId,m.away?.teamId].includes(Number(policy.teamId)));
  const opponentId=[matchup?.home?.teamId,matchup?.away?.teamId].find(id=>id!==undefined&&String(id)!==policy.teamId);
  let opponentRoster,opponentHash;
  const horizonIds=new Set(horizon.players.map(p=>p.playerId));
  if(opponentId!==undefined) {
    const r=await reader.getRoster(policy.leagueId,String(opponentId));
    const slots=[...r.starters,...r.bench].filter(s=>s.player_id);
    if(slots.length&&slots.every(s=>horizonIds.has(s.player_id)&&byId.has(s.player_id))) {
      opponentRoster=slots.map(s=>({playerId:s.player_id,slot:byId.get(s.player_id).positions[0],eligiblePositions:byId.get(s.player_id).positions,currentSlot:s.slot_type,locked:s.locked}));
      opponentHash=rosterFingerprint(r);
    }
  }
  const nflAlias=value=>({LA:'LAR',JAC:'JAX',WSH:'WAS',OAK:'LV',SD:'LAC',STL:'LAR'}[value]??value);
  const clubs=new Map(proTeams.map(t=>[String(t.id),nflAlias(t.abbrev??t.abbreviation)]));
  const predicted=new Map(horizon.players.map(p=>[p.playerId,p]));
  const verifiedClub=id=>{const team=clubs.get(byId.get(id)?.team);return team&&team===nflAlias(predicted.get(id)?.team)?team:undefined;};
  const handcuffs=(horizon.handcuffs??[]).filter(h=>verifiedClub(h.leaderPlayerId)&&verifiedClub(h.leaderPlayerId)===verifiedClub(h.backupPlayerId));
  const correlations=(horizon.correlations??[]).filter(c=>verifiedClub(c.qbPlayerId)&&verifiedClub(c.qbPlayerId)===verifiedClub(c.receiverPlayerId));
  const plan=selectAutomaticWaivers({policy,targetWeek:week,seasonEndWeek,forecasts:horizon.players.map(p=>({...p,weeks:p.weeks.filter(w=>w.week<=seasonEndWeek)})),protectedPlayerIds,
    waiverPlayerIds:activeCandidates,handcuffs,correlations,opponentRoster,
    roster:owned.map(s=>({playerId:s.player_id,slot:byId.get(s.player_id)?.positions[0]??s.slot_type,eligiblePositions:byId.get(s.player_id)?.positions,currentSlot:s.slot_type,locked:s.locked})),
    starterCounts:rosterSettings.slots.filter(s=>!['BN','IR','TAXI'].includes(s.slot)&&s.count>0).map(s=>({slot:s.slot,count:s.count}))});
  const identityStatus = map => canonicalJson([...new Set([...owned.map(s=>s.player_id),...(opponentRoster??[]).map(p=>p.playerId),...plan.map(c=>c.action.addPlayerId)])].sort().map(id=>({id,status:map.get(id)?.status,team:map.get(id)?.team,positions:map.get(id)?.positions})));
  const evaluatedStatus=identityStatus(byId);
  const report={version:1,at:new Date().toISOString(),week,seasonEndWeek,leagueId:policy.leagueId,teamId:policy.teamId,modelVersion:manifest.modelVersion,policyHash,initialTrainingCheck:initialCheck,trainingGameCount:trainingState.gameIds.length,waiverRank:context.teamWaiverRank,opponentId,relationshipCoverage:{handcuffsInArtifact:(horizon.handcuffs??[]).length,handcuffsWithVerifiedClub:handcuffs.length,correlationsInArtifact:(horizon.correlations??[]).length,correlationsWithVerifiedClub:correlations.length},opponentCoverage:opponentRoster?"covered":"unavailable; no stack matchup probability",mode:execute?(manualAuthorization?'attended':'automatic'):'dry-run',manualAuthorization,plan,events:[],outcomes:[],platformWrites:0};
  report.pendingClaimReadiness=pendingClaimReadiness;
  const directory=resolve(config.dataDir,'automatic-waivers');await mkdir(directory,{recursive:true});
  const reportPath=resolve(directory,`2026-W${week}-${execute?'attempt':'dry-run'}.json`);
  if(!execute||!plan.length) {
    await writeFile(execute?resolve(directory,`2026-W${week}-no-claims.json`):reportPath,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));return;
  }
  assertSubmissionWindow(new Date(),manualAuthorization);
  // A durable one-attempt journal prevents retries after crashes, uncertain POSTs,
  // or later runs with different artifacts. No automatic stale-lock removal.
  const journal=await open(reportPath,'wx',0o600);await journal.writeFile(JSON.stringify(report,null,2));await journal.sync();await journal.close();
  const persist=async event=>{report.events.push({...event,at:new Date().toISOString()});const temp=reportPath+'.tmp';const file=await open(temp,'w',0o600);await file.writeFile(JSON.stringify(report,null,2));await file.sync();await file.close();const {rename}=await import('node:fs/promises');await rename(temp,reportPath);};
  const queue=new ActionQueue(new SqliteActionQueueStore(config.databasePath));
  const store=new SqliteActionExecutionStore(config.databasePath);
  const actor=`standing-waivers:2026-11-05:${policy.model}/${policy.reasoningEffort}:${policyHash}:${manifest.modelVersion}`;
  const executor=new ActionExecutor({queue,reader,writer:new EspnPlatformWriter({credentials}),store,leagueExternalId:policy.leagueId,actor});
  report.outcomes=await submitPrioritizedPlan({plan,record:persist,
    beforeEach:async(choice,outcomes)=>{
      assertSubmissionWindow(new Date(),manualAuthorization);
      assertPinnedAutomaticJob((await json(resolve(process.env.HERMES_HOME??resolve(homedir(),'.hermes'),'cron/jobs.json'))).jobs);
      await checkTraining();
      if(manifest.modelVersion!==evaluatedModelVersion||manifest.waiverHorizonSha256!==evaluatedHorizonHash)throw Error('Model evidence changed after claim evaluation.');
      const currentPolicy=await readFile(resolve(root,'config/football/automatic-waivers.json'),'utf8');if(sha(currentPolicy)!==policyHash)throw Error('Standing policy changed during run.');
      const live=await reader.getLeagueFresh();
      if(live.status?.finalScoringPeriod!==seasonEndWeek)throw Error('Fantasy season end changed during evaluation.');
      if(canonicalJson(manifest.scoring)!==canonicalJson(live.settings?.scoringSettings))throw Error('Scoring changed during evaluation.');
      const livePlayers=[...await reader.getPlayers('football',credentials.season),...await reader.getFreeAgents(policy.leagueId)];
      if(identityStatus(new Map(livePlayers.map(p=>[p.player_id,p])))!==evaluatedStatus)throw Error('Player status or eligibility changed after evaluation.');
      if(rosterFingerprint(await reader.getRoster(policy.leagueId,policy.teamId))!==rosterHash)throw Error('Roster changed during evaluation.');
      if(opponentHash&&rosterFingerprint(await reader.getRoster(policy.leagueId,String(opponentId)))!==opponentHash)throw Error('Opponent roster changed after matchup evaluation.');
      const pending=await reader.getPendingWaiverClaims(policy.leagueId,policy.teamId);
      const capacity=acquisitionCapacity(await queue.list(),await store.listReceipts(),pending.flatMap(p=>p.items.filter(i=>i.type==='ADD').map(i=>String(i.playerId))),{leagueId:policy.leagueId,teamId:policy.teamId,period:`${policy.season}-W${week}`},5);
      if(!capacity.remaining)throw Error('Shared five-transaction weekly limit is used or reserved.');
      if(pending.length!==outcomes.length||pending.some(p=>!plan.slice(0,outcomes.length).some(c=>c.action.priority===p.priority&&p.items.some(i=>i.type==='ADD'&&String(i.playerId)===c.action.addPlayerId)&&p.items.some(i=>i.type==='DROP'&&String(i.playerId)===c.action.dropPlayerId))))throw Error('Pending ESPN claims changed during this batch.');
    },
    prepare:async choice=>(await prepareWaiverClaim(reader,queue,policy.leagueId,choice.action,{idempotencyKey:`automatic-waiver:${policy.season}-W${week}:${choice.action.addPlayerId}`,rationale:`${actor}; ${choice.rationale}; horizon SHA ${evaluatedHorizonHash}`})).action,
    approve:id=>queue.approve(id,actor),execute:id=>executor.execute(id),
    confirm:async choice=>{const pending=await reader.getPendingWaiverClaims(policy.leagueId,policy.teamId);const verified=pending.some(p=>p.priority===choice.action.priority&&p.items.some(i=>i.type==='ADD'&&String(i.playerId)===choice.action.addPlayerId)&&p.items.some(i=>i.type==='DROP'&&String(i.playerId)===choice.action.dropPlayerId));if(!verified)await writeFile(resolve(config.dataDir,'acquisitions-reconciliation.json'),JSON.stringify({at:new Date().toISOString(),action:choice.action,reason:'Submitted claim not confirmed; reconcile before further acquisition submissions.'}));return verified;}});
  report.platformWrites=report.outcomes.filter(r=>['executed','already_executed','unknown'].includes(r.status)).length;
  await persist({stage:'finished'});
  console.log(JSON.stringify(report));
  } finally { if(sharedLock){await sharedLock.close();await unlink(sharedLockPath);} }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(async error=>{
  const failure={status:'blocked',at:new Date().toISOString(),reason:error.message,note:'No automatic retry. Inspect the attempt journal and execution audit before reconciling any submission.'};
  await mkdir(resolve(root,'data/automatic-waivers'),{recursive:true});await writeFile(resolve(root,'data/automatic-waivers/last-failure.json'),JSON.stringify(failure,null,2));console.error(JSON.stringify(failure));process.exitCode=1;
});
