import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { buildAdaptiveAdvice } from '../../dist/src/basketball/draft-adaptive.js';
import { activeSlotCount, canCompleteRoster } from '../../dist/src/basketball/draft.js';
import { contentHash } from '../../dist/src/basketball/store.js';

const value = flag => { const i=process.argv.indexOf(flag); if(i<0||!process.argv[i+1])throw new Error(`Missing ${flag}`); return resolve(process.argv[i+1]); };
const boardPath=value('--board'),journalPath=value('--journal'),out=value('--out');
const board=JSON.parse(await readFile(boardPath,'utf8'));
const {revision,...content}=board;
if(contentHash(content)!==revision)throw new Error('Board hash mismatch');
const journalBytes=await readFile(journalPath);
const entries=journalBytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
for(const entry of entries)if(contentHash(entry.state)!==entry.digest)throw new Error('Journal hash mismatch');
const sessions=new Map();
for(const {state}of entries)sessions.set(state.observation.sessionId,state);
const complete=[...sessions.values()].filter(state=>state.session.picks.length===112).slice(-3);
if(complete.length!==3)throw new Error('Need three completed local mock sessions');
const byId=new Map(board.rows.map(row=>[row.fantraxId,row]));
await mkdir(out,{recursive:true});
await writeFile(resolve(out,'journal-benchmark-snapshot.jsonl.gz'),gzipSync(journalBytes),{flag:'wx'});
const runs=[];
for(let i=0;i<complete.length;i++){
  const state=complete[i],session=state.session;
  if(state.observation.venue!=='local-mock'||session.sourceKind!=='local-simulator')throw new Error('Non-synthetic state cannot enter mock validation');
  const rosters=session.teamOrder.map(teamId=>{
    const players=session.picks.filter(p=>p.teamId===teamId).map(p=>byId.get(p.playerId));
    if(players.some(p=>!p)||players.length!==14||!canCompleteRoster(players)||activeSlotCount(players)!==10)throw new Error('Incomplete/illegal mock roster');
    return {teamId,players:players.length,activeSlots:10,reserve:4};
  });
  const scenario=['balanced','guards','bigs'][i];
  const artifact={schemaVersion:1,kind:'synthetic-browser-rehearsal-final-state',scenario,boardRevision:revision,state,rosters,liveActionsExecuted:0};
  await writeFile(resolve(out,`mock-run-${scenario}.json`),JSON.stringify(artifact,null,2)+'\n');
  runs.push({scenario,sessionId:state.observation.sessionId,ownPicks:14,picks:112,rosters});
}
const ids=new Set(complete.map(state=>state.observation.sessionId));
const unique=new Map();
for(const {state}of entries)if(ids.has(state.observation.sessionId))unique.set(`${state.observation.sessionId}:${state.session.picks.length}`,state);
const states=[...unique.values()];
const samples=[];
for(let i=0;i<100;i++){
  const state=states[Math.floor(i*(states.length-1)/99)];
  const start=performance.now();
  // Replays retain the capture instant. This benchmark does not refresh evidence.
  const advice=buildAdaptiveAdvice(board,state.session,new Date(state.session.observedAt));
  const elapsedMs=performance.now()-start;
  samples.push({index:i,sessionId:state.observation.sessionId,picks:state.session.picks.length,observedAt:state.session.observedAt,elapsedMs,status:advice.status});
}
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
const result={schemaVersion:1,kind:'local-synthetic-state-replay-engine-benchmark',measuredAt:new Date().toISOString(),boardRevision:revision,forecastRows:board.rows.length,journalSha256:createHash('sha256').update(journalBytes).digest('hex'),runs,samples,engine:{count:samples.length,p50Ms:percentile(samples.map(s=>s.elapsedMs),.5),p95Ms:percentile(samples.map(s=>s.elapsedMs),.95),maxMs:Math.max(...samples.map(s=>s.elapsedMs)),targetP95Ms:500},sourceRefresh:false,liveActionsExecuted:0,limitations:['Deterministic engine timing on saved simulated draft states; not browser acquisition or orchestration latency.','Real saved player forecast inputs; simulated selections and opponents. No accuracy or win-probability validation.']};
await writeFile(resolve(out,'engine-benchmark.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({runs:runs.length,ownPicks:42,...result.engine}));
