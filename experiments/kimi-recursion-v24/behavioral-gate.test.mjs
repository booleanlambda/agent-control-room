import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {behaviorCatalog,behaviorProbesAt,verifyDiscrimination} from './behavioral-probes.mjs';
import {publicCasesFor,hiddenCases,assess,exactOracle,sha} from './benchmark.mjs';
import {reconcileSelectedCost} from './cost-companion.mjs';
import {runIsolatedPython} from '../recursion-tree-v0/unseen-python-sandbox.mjs';
const load=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('all ten invariant layers have nonredundant, independently proved public behavioral contrasts',()=>{
 const catalog=behaviorCatalog(),checks=verifyDiscrimination();
 assert.equal(catalog.length,12);assert.equal(checks.length,catalog.length);
 for(let i=0;i<10;i++)assert.ok(behaviorProbesAt(i).length>=1);
 const allHashes=new Set(catalog.map(x=>sha(x.input)));
 assert.equal(allHashes.size,12);
 // Even transformed benchmark cases are not recycled hidden data.
 for(const h of hiddenCases)assert.equal(allHashes.has(sha(h)),false);
 for(const c of catalog){
  assert.ok(c.input.controls.length<=4);
  assert.ok(behaviorProbesAt(c.level).some(x=>x.id===c.id));
  const best=exactOracle(c.input);
  assert.equal(assess(c.input,{selected:best.selected,cost:best.cost}).passed,true);
 }
});
test('a known Kimi program that reached nine levels fails exact-zero acceptance probe',async()=>{
 const known=load('./fixtures/failed-hidden-v24b.py');
 // This is the genuine model-authored source from the archived run, not
 // a simulated omission. Sandbox never receives database or provider secrets.
 const old=publicCasesFor(8)[0];
 const prior=await runIsolatedPython(known,old,{timeoutMs:10000});
 assert.equal(prior.ok,true,'original archived program should execute');
 const oldCheck=assess(old,reconcileSelectedCost(old,prior.result).answer);
 assert.equal(oldCheck.passed,true,'original public test must still pass');
 const p=behaviorProbesAt(8).find(x=>x.id==='exactly_zero_console').input;
 const result=await runIsolatedPython(known,p,{timeoutMs:10000});
 assert.equal(result.ok,true);
 const verified=assess(p,reconcileSelectedCost(p,result.result).answer);
 assert.equal(verified.passed,false,'new gate must reject the actual omitted acceptance condition');
 assert.equal(verified.reason,'EXACT_TAG_COUNT');
});
test('conditional dependency acceptance is behaviorally checked on a separate public counterexample',()=>{
 const a=behaviorProbesAt(9).find(x=>x.id==='conditional_selected_trigger').input;
 const o=exactOracle(a);
 assert.deepEqual(o.selected,['A','B']);
 assert.equal(assess(a,{selected:['A'],cost:1}).passed,false);
 assert.equal(assess(a,{selected:o.selected,cost:o.cost}).passed,true);
});
test('live runner stops child advancement on missing behavioral constraint and preserves verifier isolation',()=>{
 const live=load('./live.mjs');
 assert.match(live,/for\(const probe of behaviorProbesAt\(j\)\)/);
 assert.match(live,/PUBLIC_BEHAVIORAL_INVARIANT_COUNTEREXAMPLE/);
 assert.match(live,/if\(!check\.passed\)/);
 assert.match(live,/state\.lastFailure=check\.failure/);
 assert.match(live,/next\('repair_'\+i/);
 assert.match(live,/await allAncestors\(state\.source,i\)/);
 assert.match(live,/if\(i===9\)/);
 assert.match(live,/for\(const input of hiddenCases\)/);
 assert.match(live,/noInjectedDefects:true/);
 assert.doesNotMatch(live,/searchBestCandidate|certifyImproved|beamOptimize/);
});
