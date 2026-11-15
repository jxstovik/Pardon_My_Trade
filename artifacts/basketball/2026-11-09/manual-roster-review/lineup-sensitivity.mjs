// Actual-stat sensitivity only, not forecasts or a model promotion.
import fs from 'node:fs';
import {optimizeWeeklyLineup} from '../../../../dist/src/basketball/weekly.js';
const board=JSON.parse(fs.readFileSync('artifacts/basketball/2026-10-28/reconciliation/revisions/344df1b91ab3126860cc43ec650a4b03835d9846cf16e067717d4f78a5d203f1/corrected-category-board.json'));
// Exact summed shooting/count stats from observed game logs or coherent YTD
// GP/rate/percentage reconciliation. Preserve totals rather than average ratios.
// name, eligibility, GP, PTS REB AST ST BLK 3PTM FGM FGA FTM FTA, listed games
const raw=[
 ['Markus Burton',['G'],2,21,4,9,2,0,3,7,15,4,6,2],
 ['Tavari Johnson',['G'],2,24,2,9,3,1,5,9,19,1,2,2],
 ['Kyle Evans',['F/C'],2,13,9,3,1,4,1,4,9,4,4,2],
 ['Jaiden Feroah',['F/C'],3,27,14,4,1,4,4,11,14,1,2,2],
 ['Keyshawn Hall',['F/C'],2,39,13,2,2,0,2,14,26,9,9,2],
 ['Pryce Sandfort',['F/C'],2,45,6,6,4,0,4,16,27,9,10,2],
 ['Daeshun Ruffin',['G'],2,22,4,11,1,0,0,5,18,12,14,3],
 ['Michael James',['G'],1,16,2,2,0,0,3,5,11,3,3,3],
 ['Trevan Leonhardt',['G'],2,7,5,7,2,0,2,2,3,1,2,2],
 ['Jalen Cox',['G'],2,2,0,0,1,0,0,1,1,0,0,2],
 ['Keshawn Fisher',['G','F/C'],2,47,11,4,5,4,7,17,25,6,8,2],
 ['Max Weisbrod',['G'],3,50,11,24,4,0,12,14,29,10,14,2],
 ['Jayden Reid',['G'],2,58,2,8,5,0,5,17,32,19,23,2],
 ['Caleb Sanders',['F/C'],3,56,22,8,3,3,3,18,35,17,22,2]
];
const keys=['PTS','REB','AST','ST','BLK','3PTM','FGM','FGA','FTM','FTA'];
const input=raw.map(([name,eligibleGroups,gp,...nums])=>({name,eligibleGroups,gp,seasonTotals:Object.fromEntries(keys.map((k,i)=>[k,nums[i]])),listedGames:nums[10]}));
const scenarios=[];
for(const acquisition of [false,true])for(const namedOnly of [false,true]){
 const roster=input.filter(p=>acquisition?!['Jalen Cox','Caleb Sanders'].includes(p.name):!['Keshawn Fisher','Max Weisbrod','Jayden Reid','Caleb Sanders'].includes(p.name));
 const players=roster.map(p=>{
  const games=namedOnly&&['Michael James','Max Weisbrod'].includes(p.name)?1:p.listedGames;
  const totals=Object.fromEntries(keys.map(k=>[k,p.seasonTotals[k]/p.gp*games]));
  const score=['PTS','REB','AST','ST','BLK','3PTM','FG%','FT%'].reduce((s,k)=>s+(k==='FG%'?totals.FGM-board.reference.refFG*totals.FGA:k==='FT%'?totals.FTM-board.reference.refFT*totals.FTA:totals[k])/board.reference.moments[k].sd,0)/8;
  return {id:p.name,name:p.name,school:'source-transcription',ownership:'own',eligibleGroups:p.eligibleGroups,games,score,totals,lowTotals:totals,highTotals:totals,flags:['actual-YTD-sensitivity-not-forecast'],waiverLabel:null};
 });
 scenarios.push({acquisition,namedOpponentsOnly:namedOnly,result:optimizeWeeklyLineup(players)});
}
const output={kind:'actual-YTD-sensitivity-not-forecast',sourceReadWindowUTC:'2026-11-09 approximately 15:50–16:10Z',baselineRevision:board.revision,baselineAgePreserved:true,exclusions:{Tyson:'ineligible',Quion:'no verified college schedule',Campbell:'GTD, conservative bench scenario, not known out',Karasinski:'GTD concussion, conservative bench scenario, not known out'},limits:['0–3 game samples, no calibrated forecasts','Shooting/count totals reconciled from rounded YTD displays where complete logs not captured','Future listed games are schedule scenarios, not validated counted starts','No opponent or acquisition activation model','No platform actions'],input,scenarios};
fs.writeFileSync('artifacts/basketball/2026-11-09/manual-roster-review/lineup-sensitivity.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(scenarios.map(s=>({acquisition:s.acquisition,namedOnly:s.namedOpponentsOnly,active:s.result?.active,reserves:s.result?.reserveIds})),null,2));
