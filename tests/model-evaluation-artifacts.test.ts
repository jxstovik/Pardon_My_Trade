import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {evaluatePredictions} from '../src/projections/performance.js';
test('performance calculation preserves large misses and signed bias',()=>{
 const rows=[{playerId:'a',scoringPeriod:'2026-W1',source:'replay',predicted:10,actual:20},{playerId:'b',scoringPeriod:'2026-W1',source:'replay',predicted:10,actual:5}];
 const [m]=evaluatePredictions(rows);assert.equal(m.mae,7.5);assert.equal(m.bias,-2.5);assert.equal(m.rmse,Math.sqrt(62.5));
});
