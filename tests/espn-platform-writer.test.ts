import assert from 'node:assert/strict';
import test from 'node:test';
import { EspnPlatformWriter, buildEspnAcquisitionPayload, buildEspnLineupTransaction } from '../src/adapters/espn/espn-platform-writer.js';
const credentials={leagueId:'98806880',season:'2026',espnS2:'fixture-cookie',swid:'{fixture-member}'};
const action={type:'add_drop' as const,teamId:'7',addPlayerIds:['4241474'],dropPlayerIds:['3886598']};
test('acquisition sends member identity, fresh period and exact add/drop to write host',async()=>{
 const requests:Array<{url:string;method:string;body?:Record<string,unknown>}>=[];
 const writer=new EspnPlatformWriter({credentials,fetchImpl:async(input,init)=>{
  const method=init?.method??'GET';requests.push({url:String(input),method,body:init?.body?JSON.parse(String(init.body)):undefined});
  return new Response(JSON.stringify(method==='GET'?{id:98806880,seasonId:2026,scoringPeriodId:5,teams:[{id:7,owners:['fixture-member']}]}:{id:'transaction-1',status:'EXECUTED'}),{status:200});
 }});
 await writer.addDrop('98806880',action);
 const post=requests.find(r=>r.method==='POST')!;
 assert.equal(post.url,'https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/98806880/transactions/');
 assert.deepEqual(post.body,{isLeagueManager:false,teamId:7,type:'FREEAGENT',memberId:'{fixture-member}',scoringPeriodId:5,executionType:'EXECUTE',items:[{playerId:4241474,type:'ADD',toTeamId:7},{playerId:3886598,type:'DROP',fromTeamId:7}]});
});
for(const [name,fresh] of Object.entries({wrongOwner:{id:98806880,seasonId:2026,scoringPeriodId:5,teams:[{id:7,owners:['someone-else']}]},missingPeriod:{id:98806880,seasonId:2026,teams:[{id:7,owners:['fixture-member']}]},wrongSeason:{id:98806880,seasonId:2025,scoringPeriodId:5,teams:[{id:7,owners:['fixture-member']}]}})){
 test(`acquisition refuses ${name} before POST`,async()=>{let posts=0;const writer=new EspnPlatformWriter({credentials,fetchImpl:async(_input,init)=>{if(init?.method==='POST')posts++;return new Response(JSON.stringify(fresh));}});await assert.rejects(writer.addDrop('98806880',action));assert.equal(posts,0);});
}
test('missing authentication prevents even the preflight GET',async()=>{const writer=new EspnPlatformWriter({credentials:{leagueId:'98806880',season:'2026'},fetchImpl:async()=>{throw new Error('Unexpected I/O');}});await assert.rejects(writer.addDrop('98806880',action),/requires authenticated/);});
test('invalid or overlapping player IDs are rejected; waiver includes bid',()=>{assert.throws(()=>buildEspnAcquisitionPayload('7','member',5,['1'],['1'],'FREEAGENT'));assert.throws(()=>buildEspnAcquisitionPayload('7','member',5,['NaN'],[],'FREEAGENT'));assert.equal(buildEspnAcquisitionPayload('7','member',5,['1'],['2'],'WAIVER',3).bidAmount,3);});

test('team defense acquisition preserves ESPN signed IDs and rejects invalid negatives',()=>{
 const payload=buildEspnAcquisitionPayload('7','member',5,['-16013'],['-16002'],'FREEAGENT');
 assert.deepEqual(payload.items,[{playerId:-16013,type:'ADD',toTeamId:7},{playerId:-16002,type:'DROP',fromTeamId:7}]);
 for(const id of ['-1','-16000','-16035','0','9007199254740992']) assert.throws(()=>buildEspnAcquisitionPayload('7','member',5,[id],[],'FREEAGENT'));
});

test('lineup uses each prior slot and benches the displaced starter',()=>{
 const entry=(id:number,slot:number,eligibleSlots:number[],rosterLocked=false)=>({lineupSlotId:slot,playerPoolEntry:{rosterLocked,player:{id,eligibleSlots}}});
 const entries=[entry(1,2,[2,23]),entry(2,23,[2,23]),entry(3,20,[4,23])];
 const action={type:'set_roster' as const,teamId:'7',starters:[{playerId:'2',slot:'RB' as const},{playerId:'3',slot:'FLEX' as const}]};
 const body=buildEspnLineupTransaction(action,'member',6,entries,{'2':1,'23':1,'20':1});
 assert.equal(body.type,'ROSTER');assert.equal(body.scoringPeriodId,6);
 assert.deepEqual(body.items,[{playerId:1,type:'LINEUP',fromLineupSlotId:2,toLineupSlotId:20},{playerId:2,type:'LINEUP',fromLineupSlotId:23,toLineupSlotId:2},{playerId:3,type:'LINEUP',fromLineupSlotId:20,toLineupSlotId:23}]);
 assert.throws(()=>buildEspnLineupTransaction(action,'member',6,[entry(1,2,[2,23],true),...entries.slice(1)],{'2':1,'23':1}));
 assert.throws(()=>buildEspnLineupTransaction({...action,starters:[{playerId:'3',slot:'QB'}]},'member',6,entries,{'0':1}));
 assert.throws(()=>buildEspnLineupTransaction({...action,starters:[{playerId:'2',slot:'RB'}]},'member',6,entries,{'2':1,'23':1}));
});
test('lineup writer posts authenticated roster transaction to write host after fresh ownership check',async()=>{
 const requests:Array<{url:string;method:string;body?:Record<string,unknown>}>=[];
 const writer=new EspnPlatformWriter({credentials,fetchImpl:async(input,init)=>{
  const method=init?.method??'GET';requests.push({url:String(input),method,body:init?.body?JSON.parse(String(init.body)):undefined});
  const entry=(id:number,slot:number)=>({lineupSlotId:slot,playerPoolEntry:{player:{id,eligibleSlots:[2,23]}}});
  return new Response(JSON.stringify(method==='GET'?{id:98806880,seasonId:2026,scoringPeriodId:6,settings:{rosterSettings:{lineupSlotCounts:{'2':1,'23':1}}},teams:[{id:7,owners:['fixture-member'],roster:{entries:[entry(1,2),entry(2,23)]}}]}:{status:'EXECUTED'}));
 }});
 await writer.setRoster('98806880',{type:'set_roster',teamId:'7',starters:[{playerId:'1',slot:'FLEX'},{playerId:'2',slot:'RB'}]});
 const post=requests.find(r=>r.method==='POST')!;
 assert.match(post.url,/lm-api-writes.*\/transactions\/$/);assert.equal(post.body?.memberId,'{fixture-member}');assert.equal(post.body?.type,'ROSTER');assert.equal((post.body?.items as unknown[]).length,2);
});
