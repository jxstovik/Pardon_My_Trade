import assert from "node:assert/strict";
import test from "node:test";
import {selectAutomaticWaivers,type AutomaticWaiverPolicy,type HorizonPlayer} from "../src/agents/automatic-waivers.js";

test("a dominated second tight end may cover another deficit while retaining the better tight end",()=>{
 const policy:AutomaticWaiverPolicy={enabled:true,leagueId:"98806880",teamId:"7",season:2026,model:"gpt-6.1-sol",reasoningEffort:"medium",nearTermWeeks:3,suggestedNearTermLineupGain:6,suggestedSeasonLineupGain:20,simulations:128,maxClaims:5,protectTopRank:100,maxArtifactAgeHours:20,authority:"test"};
 const p=(id:string,position:'TE'|'RB',mean:number):HorizonPlayer=>({playerId:id,position,weeks:Array.from({length:10},(_,i)=>({week:9+i,mean,quantiles:Object.fromEntries([5,10,25,50,75,90,95].map(q=>[q,mean]))}))});
 const x={policy,targetWeek:9,roster:[{playerId:'te1',slot:'TE' as const},{playerId:'te2',slot:'TE' as const},{playerId:'rb',slot:'RB' as const}],starterCounts:[{slot:'TE' as const,count:1},{slot:'RB' as const,count:1}],forecasts:[p('te1','TE',15),p('te2','TE',8),p('rb','RB',1),p('add','RB',10)],waiverPlayerIds:['add']};
 assert.equal(selectAutomaticWaivers(x).length,0);
 const result=selectAutomaticWaivers({...x,allowRedundantTightEndReplacement:true});
 assert.equal(result.length,1);assert.equal(result[0].action.dropPlayerId,'te2');
 assert.equal(selectAutomaticWaivers({...x,allowRedundantTightEndReplacement:true,protectedPlayerIds:['te2']}).length,0);
 assert.equal(selectAutomaticWaivers({...x,allowRedundantTightEndReplacement:true,roster:[x.roster[0],{...x.roster[1],locked:true},x.roster[2]]}).length,0);
});
