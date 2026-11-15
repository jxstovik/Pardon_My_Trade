import {writeFile} from 'node:fs/promises';
import {loadEnv} from '../../../dist/src/config/load-env.js';
import {loadEspnCredentials} from '../../../dist/src/adapters/espn/espn-auth.js';
import {EspnPlatformReader} from '../../../dist/src/adapters/espn/espn-platform-reader.js';
import {EspnKickoffSource} from '../../../dist/src/adapters/espn/kickoff-source.js';
loadEnv();const c=loadEspnCredentials();const r=new EspnPlatformReader({credentials:c});const l=await r.getLeagueFresh();
if(l.id!==98806880||l.seasonId!==2026||l.scoringPeriodId!==10||!l.teams.find(t=>t.id===7)?.owners?.some(id=>id.toLowerCase()===c.swid.toLowerCase()))throw Error('Scope mismatch');
const roster=await r.getRoster('98806880','7');const pool=await r.getFreeAgents('98806880');const source=new EspnKickoffSource();
const ids=['4869645','4596334','4038441','4575131'];
const reports=[];for(const id of ids){try{reports.push({id,player:pool.find(p=>p.player_id===id),news:await source.playerNews(id,new Date())});}catch(e){reports.push({id,error:e.message});}}
const page=await r.client.getJson('',{view:['kona_player_info'],scope:{segment:0,readHost:true},query:{scoringPeriodId:10},filter:{players:{filterStatus:{value:['FREEAGENT','WAIVERS']},filterSlotIds:{value:[]},limit:1500,offset:0,sortPercOwned:{sortPriority:1,sortAsc:false},sortDraftRanks:{sortPriority:100,sortAsc:true,value:'STANDARD'}}}});
const acquisitionStatus=page.players.filter(p=>ids.includes(String(p.player?.id))).map(p=>({id:String(p.player.id),status:p.status,rosterLocked:p.rosterLocked}));
const result={retrievedAt:new Date().toISOString(),scope:{leagueId:l.id,season:l.seasonId,week:l.scoringPeriodId,team:7},roster,pool,reports,acquisitionStatus};
await writeFile(new URL('./review-'+Date.now()+'.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({retrievedAt:result.retrievedAt,owned:roster.starters.length+roster.bench.length,reports,acquisitionStatus},null,2));
