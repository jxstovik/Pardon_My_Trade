import test from 'node:test';import assert from 'node:assert/strict';
import {scoutPaths,getScoutingReport} from '../src/mcp/scout-workflow.js';
test('weekly scouting paths reject invalid periods and preserve separate week artifacts',()=>{
 for(const week of [0,19,1.5,NaN])assert.throws(()=>scoutPaths(week));
 assert.match(scoutPaths(6).html,/week6-scout\/week6-scout-interactive\.html$/);
 assert.notEqual(scoutPaths(5).status,scoutPaths(6).status);
});
test('missing scouting run returns not_run without starting external work',async()=>{
 const r=await getScoutingReport(18);assert.equal((r.workflow as {status:string}).status,'not_run');
});
