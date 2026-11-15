import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

/** Priors resolve the published whole week; candidate training consumes that exact target. */
export async function runWeeklyPlanning({refresh, scout}) {
  const priors=await refresh();
  if(priors.status!=='complete'||!Number.isInteger(priors.targetWeek)||priors.scoringPeriod!==`2026-W${priors.targetWeek}`) throw Error('Verified complete target-week priors required before training');
  const candidate=await scout(priors.targetWeek);
  if(candidate.status!=='complete') throw Error('Weekly candidate training did not complete');
  return {status:'complete',targetWeek:priors.targetWeek,priors,candidate,platformWrites:0,modelPromotions:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const root=resolve(import.meta.dirname,'..');
  const run=promisify(execFile);
  const env={...process.env,PMT_MCP_ROLE:'read',PMT_EXECUTION_ENABLED:'false'};
  const result=await runWeeklyPlanning({
    refresh:async()=>{
      const {stdout}=await run(process.execPath,['scripts/refresh-tuesday-projections.mjs'],{cwd:root,env,maxBuffer:8*1024*1024});
      return JSON.parse(stdout.trim());
    },
    scout:async week=>{
      await run(process.execPath,['scripts/weekly-scout.mjs','--week',String(week),'--pdf-operation-started'],{cwd:root,env,maxBuffer:8*1024*1024});
      return JSON.parse(await readFile(resolve(root,`output/pdf/week${week}-scout/workflow-status.json`),'utf8'));
    }
  });
  console.log(JSON.stringify(result));
}
