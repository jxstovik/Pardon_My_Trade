import {readFile} from 'node:fs/promises';import vm from 'node:vm';import assert from 'node:assert/strict';import {evaluatePredictions} from '../dist/src/projections/performance.js';
const dir='output/evaluation/2026-model-performance';const d=JSON.parse(await readFile(`${dir}/evaluation-data.json`,'utf8'));
assert.equal(d.rosterRows.length,80);assert.equal(d.rosterRows.filter(r=>r.actual!=null).length,80);
for(const r of d.replay){const q=Object.entries(r.quantiles).sort((a,b)=>Number(a[0])-Number(b[0])).map(([_,v])=>v);assert.ok(q.every(Number.isFinite));assert.ok(q.every((v,i)=>!i||v>=q[i-1]));assert.ok(r.variance>=0);}
for(const tr of d.trainingByPosition)assert.ok(tr.max2026Week<tr.week);
for(const size of [50,150]){
 const selected=d.replay.filter(r=>r.rank<=size);assert.equal(selected.length,size*5);
 const rows=selected.filter(r=>r.actual!=null).map(r=>({playerId:r.playerId,scoringPeriod:`2026-W${r.week}`,source:`top${size}`,predicted:r.predicted,actual:r.actual}));const [p]=evaluatePredictions(rows);assert.ok(Math.abs(p.mae-d.summary.overall[`all_top${size}`].mae)<1e-9);assert.ok(Math.abs(p.rmse-d.summary.overall[`all_top${size}`].rmse)<1e-9);
}
const html=await readFile(`${dir}/model-performance-interactive.html`,'utf8');const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];const defaults={evidence:'replay',cohort:'50',week:'all',position:'all',player:'Josh Allen'};const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{value:defaults[id]??'',textContent:id==='data'?JSON.stringify(d):'',innerHTML:'',insertAdjacentHTML(_where,s){this.innerHTML+=s;},querySelectorAll(){return [];}});return elements.get(id);}
vm.runInNewContext(script,{document:{getElementById:element},console});assert.ok(element('scatter').innerHTML.includes('<svg'));assert.ok(element('timeline').innerHTML.includes('W5'));assert.ok(!element('timeline').innerHTML.includes('data-xtick'));assert.ok(element('cards').innerHTML.includes('250 / 250'));
element('cohort').value='roster';element('cohort').onchange();assert.ok(element('cards').innerHTML.includes('80 / 80'));
element('evidence').value='archive';element('evidence').onchange();assert.ok(element('cards').innerHTML.includes('16 / 16'));assert.equal(element('cohort').disabled,true);
console.log('Verified causal cutoffs, complete roster actuals, PMT metric parity, quantiles, cohort counts and interactive filter logic.');

for(const r of d.calibrated){assert.ok(r.calibrationMaxWeek<r.week);assert.equal(r.predicted,d.replay.find(p=>p.week===r.week&&p.playerId===r.playerId).predicted);assert.ok(r.quantiles['10']<=r.uncalibratedQuantiles['10']);assert.ok(r.quantiles['90']>=r.uncalibratedQuantiles['90']);}
assert.equal(d.summary.targetAudit.dstMismatches,0);
element('evidence').value='calibrated';element('cohort').value='150';element('evidence').onchange();assert.ok(element('cards').innerHTML.includes('599 / 600'));assert.ok(element('scatter').innerHTML.includes('<svg'));
console.log('Verified earlier-only calibration, unchanged means, expanded intervals and calibrated dashboard filters.');
