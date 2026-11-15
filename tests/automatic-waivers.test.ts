import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {assertFreshWaiverTraining,selectAutomaticWaivers,type AutomaticWaiverPolicy,type TrainingManifest,type HorizonPlayer} from "../src/agents/automatic-waivers.js";
const policy:AutomaticWaiverPolicy={enabled:true,leagueId:"98806880",teamId:"7",season:2026,model:"gpt-6.1-sol",reasoningEffort:"medium",nearTermWeeks:3,suggestedNearTermLineupGain:6,suggestedSeasonLineupGain:20,simulations:128,maxClaims:2,protectTopRank:100,maxArtifactAgeHours:20,authority:"standing authorization"};
const at=new Date("2026-10-27T06:00:00Z");
function manifest():TrainingManifest{return {season:2026,targetWeek:8,cutoffWeek:7,builtAt:at.toISOString(),modelVersion:"fit-w7",validation:Object.fromEntries(["QB","RB","WR","TE","K","DST"].map(pos=>[pos,{final_training_rows:1000,final_training_end:2026}])),completedOutcomeCoverage:{cutoffWeek:7,gameIds:["game1","game2"],completedGames:2,maxObservedWeek:7}};}
function player(id:string,points:number):HorizonPlayer{return {playerId:id,position:"QB",weeks:Array.from({length:11},(_,i)=>({week:8+i,mean:points,quantiles:Object.fromEntries([5,10,25,50,75,90,95].map(q=>[String(q),points]))}))};}
function input(){return {policy,targetWeek:8,roster:[{playerId:"drop",slot:"QB" as const}],starterCounts:[{slot:"QB" as const,count:1}],forecasts:[player("drop",1),player("add",10),...Array.from({length:101},(_,i)=>player(`protected${i}`,30))],waiverPlayerIds:["add"]};}
test("training gate checks actual game identities, every fitted position, age and model floor",()=>{
 const valid=manifest();assert.doesNotThrow(()=>assertFreshWaiverTraining(valid,8,["game2","game1"],at,policy));
 for(const invalid of [{...valid,cutoffWeek:6},{...valid,builtAt:"2026-10-20T00:00:00Z"},{...valid,builtAt:"2026-10-28T00:00:00Z"},{...valid,completedOutcomeCoverage:{...valid.completedOutcomeCoverage,gameIds:["game1","other"]}},{...valid,validation:{...valid.validation,WR:{final_training_rows:10,final_training_end:2025}}}])assert.throws(()=>assertFreshWaiverTraining(invalid,8,["game1","game2"],at,policy));
 assert.throws(()=>assertFreshWaiverTraining(valid,8,["game1","game2"],at,{...policy,model:"gpt-6-luna"}),/Sol/);
 assert.throws(()=>assertFreshWaiverTraining(valid,8,["game1","game2"],at,{...policy,reasoningEffort:"low"}),/Sol/);
});
test("point benchmarks are soft: a probable starter upgrade below both suggestions qualifies",()=>{
 const x=input();
 const add=x.forecasts.find(p=>p.playerId==='add')!;
 add.weeks=player('add',1.5).weeks;
 const result=selectAutomaticWaivers(x);
 assert.equal(result.length,1);assert.equal(result[0].nearTermGain,1.5);assert.equal(result[0].seasonGain,5.5);
 assert.deepEqual(result[0].suggestions,{nearTermMet:false,seasonMet:false});
 assert.equal(result[0].probability.nearTerm.improves,1);
});
test("bench depth alone is not a lineup upgrade; protect core, injured and locked drops",()=>{
 const x=input();x.roster.push({playerId:'protected0',slot:'QB'});assert.equal(selectAutomaticWaivers(x).length,0);
 const y=input();assert.equal(selectAutomaticWaivers({...y,protectedPlayerIds:['drop']}).length,0);
 assert.equal(selectAutomaticWaivers({...y,roster:[{...y.roster[0],locked:true}]}).length,0);
 const z=input();z.forecasts=z.forecasts.filter(p=>!p.playerId.startsWith('protected'));assert.equal(selectAutomaticWaivers(z).length,0);
});
test("automatic plan fails closed on missing distributions and structural policy changes",()=>{
 const x=input();x.forecasts[0].weeks.pop();assert.throws(()=>selectAutomaticWaivers(x),/horizon/);
 assert.throws(()=>selectAutomaticWaivers({...input(),policy:{...policy,maxClaims:99}}),/policy/);
 assert.throws(()=>selectAutomaticWaivers({...input(),forecasts:input().forecasts.filter(p=>p.playerId!=='drop')}),/coverage/);
});
test("prioritized submission uses exact queue approval and stops on unknown or unconfirmed result",async()=>{
 const api=await import(pathToFileURL(resolve(import.meta.dirname,'../../scripts/run-automatic-waivers.mjs')).href);
 const plan=selectAutomaticWaivers(input());plan.push({...plan[0],action:{...plan[0].action,addPlayerId:'another',priority:2}});
 const calls:string[]=[];
 const deps={plan,prepare:async(choice:any)=>{calls.push('prepare');return {status:'pending',actionId:'id',action:choice.action};},approve:async()=>{calls.push('approve');},execute:async()=>{calls.push('execute');return {status:'unknown'};},confirm:async()=>{calls.push('confirm');return true;},beforeEach:async()=>{},record:async()=>{}};
 const result=await api.submitPrioritizedPlan(deps);assert.equal(result.length,1);assert.deepEqual(calls,['prepare','approve','execute']);
 calls.length=0;await api.submitPrioritizedPlan({...deps,execute:async()=>({status:'executed'}),confirm:async()=>false});assert.deepEqual(calls,['prepare','approve']);
 await assert.rejects(api.submitPrioritizedPlan({...deps,prepare:async()=>({status:'pending',actionId:'wrong',action:{...plan[0].action,priority:99}})}),/differs/);
 // DST-aware wall-clock enforcement: 02:00 EST is 07:00 UTC after Nov 1.
 assert.doesNotThrow(()=>api.assertTuesdayWindow(new Date('2026-11-10T07:00:00Z')));
 assert.throws(()=>api.assertTuesdayWindow(new Date('2026-11-10T06:00:00Z')));
 assert.throws(()=>api.assertTuesdayWindow(new Date('2026-11-05T07:00:00Z')));
 const pinned={id:'38da0b12383e',enabled:true,provider:'openai-codex',model:'gpt-6.1-sol',reasoning_effort:'medium',schedule:{expr:'0 2 * * 2'},script:null,prompt:'node scripts/run-automatic-waivers.mjs --execute'};
 assert.doesNotThrow(()=>api.assertPinnedAutomaticJob([pinned]));
 for(const patch of [{reasoning_effort:'low'},{model:'gpt-6-luna'},{enabled:false},{script:'old-training.sh'}])assert.throws(()=>api.assertPinnedAutomaticJob([{...pinned,...patch}]));
});

test("games after the league's final fantasy week cannot create qualifying value",()=>{
 const x=input();x.forecasts.find(p=>p.playerId==='add')!.weeks=player('add',1).weeks;
 for(const p of x.forecasts)p.weeks=p.weeks.filter(w=>w.week<=17);
 assert.equal(selectAutomaticWaivers({...x,seasonEndWeek:17}).length,0);
});

test("attended submission requires a fresh exact-scope human request while scheduled runs keep their window",async()=>{
 const api=await import(pathToFileURL(resolve(import.meta.dirname,'../../scripts/run-automatic-waivers.mjs')).href);
 const now=new Date('2026-11-10T14:00:00Z');
 const authorization={leagueId:'98806880',teamId:'7',season:2026,requestedAt:'2026-11-10T13:30:00Z',expiresAt:'2026-11-10T15:30:00Z',request:'Run the modeling and waiver priorities workflow, then submit appropriate waiver claims.'};
 assert.doesNotThrow(()=>api.assertSubmissionWindow(now,authorization));
 assert.throws(()=>api.assertSubmissionWindow(now));
 for(const patch of [{teamId:'8'},{season:2025},{request:'inspect only'},{expiresAt:'2026-11-10T13:59:00Z'},{requestedAt:'2026-11-10T14:01:00Z'},{expiresAt:'2026-11-10T16:00:00Z'}])assert.throws(()=>api.assertSubmissionWindow(now,{...authorization,...patch}));
});

for(const position of ['DST','K'] as const)test(`${position} streams qualify on next-week starter improvement despite season loss`,()=>{
 const drop={...player('drop',5),position};
 const add={...player('add',0),position};add.weeks[0]={...player('add',6).weeks[0]};
 const x={policy,targetWeek:8,roster:[{playerId:'drop',slot:position}],starterCounts:[{slot:position,count:1}],forecasts:[drop,add],waiverPlayerIds:['add']};
 const result=selectAutomaticWaivers(x);assert.equal(result.length,1);
 assert.equal(result[0].strategy,position==='DST'?'stream_defense':'stream_kicker');
 assert.equal(result[0].probability.nextWeek.improves,1);assert.ok(result[0].seasonGain<0);
 assert.equal(selectAutomaticWaivers({...x,protectedPlayerIds:['drop']}).length,0);
});

test("a handcuff must improve an actual injury-scenario lineup, not merely share an NFL team",()=>{
 const leader={...player('leader',20),position:'RB' as const,team:'BUF'};
 const backup={...player('backup',4),position:'RB' as const,team:'BUF'};
 const bench={...player('bench',1),position:'WR' as const};
 const x={...input(),roster:[{playerId:'leader',slot:'RB' as const},{playerId:'bench',slot:'WR' as const}],starterCounts:[{slot:'RB' as const,count:1}],forecasts:[leader,backup,bench,...input().forecasts.filter(p=>p.playerId.startsWith('protected'))],waiverPlayerIds:['backup']};
 assert.equal(selectAutomaticWaivers(x).length,0);
 const evidence={leaderPlayerId:'leader',backupPlayerId:'backup',probability:.25,sampleGames:8,absentGames:2,gameIds:['g1','g2'],conditionalWeeks:player('backup',15).weeks};
 const result=selectAutomaticWaivers({...x,handcuffs:[evidence]});assert.equal(result.length,1);
 assert.equal(result[0].strategy,'rb_handcuff');assert.equal(result[0].action.dropPlayerId,'bench');
 assert.ok(result[0].probability.probabilityAddedPlayerStarts>0);assert.ok(result[0].probability.season.improves>0);
 assert.equal(selectAutomaticWaivers({...x,handcuffs:[{...evidence,absentGames:1}]}).length,0);
});

test("same-team WRs get no automatic stack bonus and bench-only upside cannot qualify",()=>{
 const q={...player('q',20),team:'BUF'};
 const old={...player('old',12),position:'WR' as const,team:'NE'};
 const add={...player('new',10),position:'WR' as const,team:'BUF'};
 const x={...input(),roster:[{playerId:'q',slot:'QB' as const},{playerId:'old',slot:'WR' as const}],starterCounts:[{slot:'QB' as const,count:1},{slot:'WR' as const,count:1}],forecasts:[q,old,add,...input().forecasts.filter(p=>p.playerId.startsWith('protected'))],waiverPlayerIds:['new']};
 assert.equal(selectAutomaticWaivers(x).length,0);
 assert.equal(selectAutomaticWaivers({...x,correlations:[{qbPlayerId:'q',receiverPlayerId:'new',rho:.8,sampleGames:4,gameIds:['1','2','3','4']}]}).length,0);
});

test("five-transaction preview may select more than two disjoint improvements without changing the active two-claim policy",()=>{
 const x=input();
 const roster=[1,2,3].map(i=>({playerId:`drop${i}`,slot:'QB' as const}));
 const forecasts=[...roster.map((p,i)=>player(p.playerId,i+1)),...['a','b','c'].map((id,i)=>player(id,10-i)),...x.forecasts.filter(p=>p.playerId.startsWith('protected'))];
 const options={...x,roster,forecasts,starterCounts:[{slot:'QB' as const,count:3}],waiverPlayerIds:['a','b','c']};
 assert.equal(selectAutomaticWaivers({...options,policy:{...policy,maxClaims:5}}).length,3);
 assert.equal(selectAutomaticWaivers(options).length,2);
 assert.throws(()=>selectAutomaticWaivers({...options,policy:{...policy,maxClaims:6}}),/policy/);
});
