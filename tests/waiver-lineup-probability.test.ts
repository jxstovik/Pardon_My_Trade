import test from 'node:test';
import assert from 'node:assert/strict';
import {createLineupProbabilityEvaluator,type HorizonPlayer} from '../src/agents/waiver-lineup-probability.js';
const qs=[5,10,25,50,75,90,95];
function forecast(id:string,position:'QB'|'WR',mean:number,spread=0,team='BUF'):HorizonPlayer {
 return {playerId:id,position,team,weeks:[{week:9,mean,quantiles:Object.fromEntries(qs.map((q,i)=>[String(q),mean+(i-3)*spread]))}]};
}
const slots=[{slot:'QB' as const,count:1},{slot:'WR' as const,count:1}];
test('paired simulations never promote a low-mean bench player using hindsight sampled scores',()=>{
 const forecasts=[forecast('qb','QB',20),forecast('starter','WR',15),forecast('bench','WR',1),forecast('new','WR',10,10)];
 const evaluate=createLineupProbabilityEvaluator({forecasts,weeks:[9],starterCounts:slots,nearTermWeeks:3,simulations:256});
 const fixed=[{playerId:'qb',slot:'QB' as const},{playerId:'starter',slot:'WR' as const}];
 const result=evaluate([...fixed,{playerId:'bench',slot:'WR'}],[...fixed,{playerId:'new',slot:'WR'}],'new');
 assert.equal(result.nextWeek.improves,0);assert.equal(result.nextWeek.worsens,0);
 assert.equal(result.probabilityAddedPlayerStarts,0);assert.equal(result.nextWeek.expectedGain,0);
});
test('evidenced QB-WR covariance changes matchup upside without inventing mean points',()=>{
 const forecasts=[forecast('qb','QB',20,5),forecast('old','WR',10),forecast('new','WR',10,5),forecast('oppq','QB',38,0,'NE'),forecast('oppw','WR',0,0,'NE')];
 const base={forecasts,weeks:[9],starterCounts:slots,nearTermWeeks:3,simulations:2048,opponentRoster:[{playerId:'oppq',slot:'QB' as const},{playerId:'oppw',slot:'WR' as const}]};
 const before=[{playerId:'qb',slot:'QB' as const},{playerId:'old',slot:'WR' as const}];
 const after=[{playerId:'qb',slot:'QB' as const},{playerId:'new',slot:'WR' as const}];
 const independent=createLineupProbabilityEvaluator(base)(before,after,'new');
 const correlated=createLineupProbabilityEvaluator({...base,correlations:[{qbPlayerId:'qb',receiverPlayerId:'new',rho:.8,sampleGames:4,gameIds:['a','b','c','d']}]})(before,after,'new');
 assert.equal(correlated.nextWeek.expectedGain,0);
 assert.ok(correlated.matchupWinProbabilityChange!>independent.matchupWinProbabilityChange!);
 assert.ok(correlated.matchupWinGainLowerBound!>0);
 assert.deepEqual(correlated.stackQbIds,['qb']);
 const unsupported=createLineupProbabilityEvaluator({...base,correlations:[{qbPlayerId:'qb',receiverPlayerId:'new',rho:.8,sampleGames:1,gameIds:['a']}]})(before,after,'new');
 assert.deepEqual(unsupported.stackQbIds,[]);assert.equal(unsupported.matchupWinProbabilityChange,independent.matchupWinProbabilityChange);
});

test('bye-week players are not counted as usable starting-lineup contributors',()=>{
 const own=forecast('own','QB',0),add=forecast('add','QB',0);
 add.weeks[0]!.playing=false;
 const evaluate=createLineupProbabilityEvaluator({forecasts:[own,add],weeks:[9],starterCounts:[{slot:'QB',count:1}],nearTermWeeks:3,simulations:128});
 const result=evaluate([{playerId:'own',slot:'QB'}],[{playerId:'add',slot:'QB'}],'add');
 assert.equal(result.probabilityAddedPlayerStarts,0);assert.equal(result.nextWeek.improves,0);
});
