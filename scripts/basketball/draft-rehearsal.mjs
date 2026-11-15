// Run after building. This is a synthetic draft using real forecast inputs, never a Fantrax client.
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {recommendDraft,snakeTeam,activeSlotCount,canCompleteRoster} from '../../dist/src/basketball/draft.js';
const directory=process.argv[2]??'artifacts/basketball/2026-10-27/draft-forecast';
const board=JSON.parse(await readFile(`${directory}/board.json`,'utf8'));
const prepared=JSON.parse(await readFile(`${directory}/session.pre-draft.json`,'utf8'));
const asOf=new Date(),start=performance.now();
const state={...prepared,phase:'live',observedAt:asOf.toISOString(),draftStart:asOf.toISOString(),picks:[]};
const ordered=board.rows.filter(p=>p.draftRank!==null).sort((a,b)=>a.draftRank-b.draftRank);
const taken=new Set(),own=[];
for(let overall=1;overall<=112;overall++){
 const teamId=snakeTeam(state.teamOrder,overall);
 const advice=recommendDraft(board,state,asOf);
 if(advice.status==='stale-state')throw new Error('Rehearsal needs fresh real forecast inputs');
 const playerId=teamId===state.teamId?advice.recommendations[0]?.playerId:ordered.find(p=>!taken.has(p.fantraxId))?.fantraxId;
 if(!playerId||taken.has(playerId))throw new Error('Missing/duplicate synthetic selection');
 taken.add(playerId);state.picks.push({overall,teamId,playerId});
 if(teamId===state.teamId)own.push(board.rows.find(p=>p.fantraxId===playerId));
}
state.phase='complete';
const completed=recommendDraft(board,state,asOf);
if(completed.status!=='complete'||own.length!==14||!canCompleteRoster(own)||activeSlotCount(own)!==10)throw new Error('Synthetic draft completion failed');
const result={synthetic:true,realForecastInputs:true,observedAt:asOf.toISOString(),boardRevision:board.revision,
 purpose:'Local recommendation/selection replay with scripted opponents; no accuracy, platform latency or opponent behavior validation.',
 liveActionsExecuted:0,platformCalls:0,selectedCount:taken.size,ownCount:own.length,activeSlots:activeSlotCount(own),reserveCount:own.length-activeSlotCount(own),
 localElapsedMs:performance.now()-start,picks:state.picks,ownRoster:own.map(p=>({id:p.fantraxId,name:p.name,eligibleGroups:p.eligibleGroups,draftRank:p.draftRank})),
 finalStatus:completed.status};
await writeFile(`${directory}/synthetic-draft-rehearsal.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,picks:undefined,ownRoster:undefined},null,2));
