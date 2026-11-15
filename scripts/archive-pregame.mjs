import {readFile,readdir} from 'node:fs/promises';import {resolve} from 'node:path';
import {savePregameArchive} from '../dist/src/probabilistic/pregame-archive.js';
const week=Number(process.argv[process.argv.indexOf('--week')+1]);
if(!Number.isInteger(week)||week<1||week>18)throw Error('Supply --week 1..18');
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,`artifacts/week${week}-2026-scout`);
const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));const reportData=JSON.parse(await readFile(resolve(root,'public/scout-data.json'),'utf8'));
if(manifest.targetWeek!==week||reportData.meta.week!==week||manifest.season!==2026)throw Error('Forecast scope mismatch');
// Parse the schedule with Python's CSV parser and zoneinfo, not guessed UTC offsets.
const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const python=process.env.PMT_SCOUT_PYTHON??'/home/jordan-stovik/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const firstKickoff=(await promisify(execFile)(python,['-c',`import csv,sys\nfrom datetime import datetime,timezone\nfrom zoneinfo import ZoneInfo\nrows=[r for r in csv.DictReader(open(sys.argv[1])) if r['season']=='2026' and r['week']==sys.argv[2] and r['game_type']=='REG']\nprint(min(datetime.fromisoformat(r['gameday']+'T'+r['gametime']).replace(tzinfo=ZoneInfo('America/New_York')).astimezone(timezone.utc) for r in rows).isoformat())`,resolve(root,'data/nflverse/games.csv'),String(week)],{encoding:'utf8'})).stdout.trim();
const models={};for(const name of (await readdir(dir)).filter(n=>n.endsWith('.txt')).sort())models[name]=await readFile(resolve(dir,name),'utf8');
const forecasts=JSON.parse(await readFile(resolve(dir,'player-forecasts.json'),'utf8'));
const result=await savePregameArchive(resolve(root,'data/forecast-archives'),{season:2026,week,leagueId:'98806880',teamId:'7',builtAt:manifest.builtAt,firstKickoff,cutoffWeek:manifest.cutoffWeek,modelManifest:manifest,forecasts,models,reportData});
console.log(JSON.stringify(result));
