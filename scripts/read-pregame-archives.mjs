import {readdir,mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {readPregameArchive} from '../dist/src/probabilistic/pregame-archive.js';
const dir=resolve('data/forecast-archives');let names=[];try{names=await readdir(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
const snapshots=[];for(const name of names.filter(n=>n.endsWith('.json')).sort()){const r=await readPregameArchive(resolve(dir,name));snapshots.push({sha256:r.sha256,recordedAt:r.recordedAt,season:r.payload.season,week:r.payload.week,firstKickoff:r.payload.firstKickoff,modelManifest:r.payload.modelManifest,forecasts:r.payload.forecasts});}
await mkdir('data/scout',{recursive:true});await writeFile('data/scout/verified-forecast-archives.json',JSON.stringify(snapshots));console.log(`Verified ${snapshots.length} immutable pregame snapshots.`);
