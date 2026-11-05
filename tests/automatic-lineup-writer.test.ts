import assert from 'node:assert/strict';
import test from 'node:test';
import { EspnPlatformWriter, buildEspnLineupTransaction } from '../src/adapters/espn/espn-platform-writer.js';
const credentials={leagueId:'98806880',season:'2026',espnS2:'fixture-cookie',swid:'{fixture-member}'};
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
