import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileSelectedCost} from './cost-companion.mjs';
import {stageProblem,exactOracle,assess,feasibility} from './benchmark.mjs';
import {readFileSync} from 'node:fs';
test('cost companion corrects arithmetic only without altering model-selected controls',()=>{
 const p=stageProblem(2,0),o=exactOracle(p),wrong={selected:[...o.selected],cost:o.cost+19};
 const v=reconcileSelectedCost(p,wrong);
 assert.equal(v.adjusted,true);
 assert.equal(v.verifiedCost,o.cost);
 assert.deepEqual(v.answer.selected,wrong.selected);
 assert.equal(wrong.cost,o.cost+19);
 assert.equal(assess(p,v.answer).passed,true);
});
test('arithmetic normalization NEVER repairs invalid dependencies or unsupported selection',()=>{
 const p=stageProblem(2,0);
 const invalid={selected:['A'],cost:8};
 const v=reconcileSelectedCost(p,invalid);
 assert.deepEqual(v.answer.selected,['A']);
 assert.equal(assess(p,v.answer).passed,false);
 const unknown=reconcileSelectedCost(p,{selected:['FOO'],cost:1});
 assert.equal(unknown.adjusted,false);
});
test('infeasible NULL declaration is not silently mutated',()=>{
 const p=stageProblem(8,2),opt=exactOracle(p);
 assert.equal(opt.cost,null);
 const out={selected:[],cost:null};
 const v=reconcileSelectedCost(p,out);
 assert.equal(v.adjusted,false);
 assert.equal(v.answer.cost,null);
 assert.equal(assess(p,v.answer).passed,true);
});
test('main thread counts companion applications but keeps ancestor and hidden proof gates',()=>{
 const code=readFileSync(new URL('./live.mjs',import.meta.url),'utf8');
 assert.match(code,/reconcileSelectedCost\(problem,exec\.result\)/);
 assert.match(code,/const verified=assess\(problem,result\)/);
 assert.match(code,/await allAncestors\(state\.source,i\)/);
 assert.match(code,/if\(state\.verifiedDepth!==10\|\|state\.nodes\.length!==10/);
 assert.match(code,/report\.costNormalizations=/);
});
