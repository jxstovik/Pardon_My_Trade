import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('weekly planning passes verified published target into scout without historical configuration', async () => {
  const api = await import(pathToFileURL(resolve(import.meta.dirname,'../../scripts/weekly-planning.mjs')).href).catch(()=>({} as any));
  assert.equal(typeof api.runWeeklyPlanning,'function','weekly orchestration is implemented');
  const calls: any[]=[];
  const result=await api.runWeeklyPlanning({refresh:async()=>({status:'complete',targetWeek:8,scoringPeriod:'2026-W8'}), scout:async(week: number)=>{calls.push(week);return {status:'complete'};}});
  assert.deepEqual(calls,[8]);
  assert.equal(result.targetWeek,8);
  await assert.rejects(api.runWeeklyPlanning({refresh:async()=>({status:'failed',targetWeek:8}),scout:async()=>assert.fail('must not train after failed priors')}),/verified|complete/);
});
