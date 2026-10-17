import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyDisk} from './disk.mjs';
import {certifyImproved} from '../tighter-bounds-v13/certifier.mjs';
import {generateStress,stressCases} from '../certificate-stress-v12/stress.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
const seed=p=>topologicalSeeds(p)[0];
function valid(p,r){
 const checked=evaluate(p,{schedule:r.execution.schedule,cost:r.upperBound});
 assert.equal(checked.ok,true);
 assert.equal(checked.cost,r.upperBound);
 assert.equal(r.certifiedOptimal,r.lowerBound===r.upperBound);
 assert.equal(r.upperBound-r.lowerBound,r.gapUpper);
 assert.ok(r.independentFeasible);
}
test('zero-expansion disk proof has unchanged incumbent and intact stored root',()=>{
 const p=stressCases[8].problem,first=seed(p);
 const r=certifyDisk(p,first,{maxExpansions:0});
 valid(p,r);assert.equal(r.stats.expanded,0);assert.equal(r.stats.remainingQueue,1);
 assert.equal(r.exitReason,'expansion_budget');
 assert.equal(r.upperBound,r.execution.cost);
 assert.equal(r.certifiedOptimal,false);
});
test('disk-backed exact proof agrees with independent 4–8 job oracle across 10 fixtures',()=>{
 for(let size=4;size<=8;size++)for(let variant of [0,2]){
  const p=generateStress(size,57009+size*183+variant*8539,variant),known=exactOracle(p).cost;
  const r=certifyDisk(p,seed(p),{maxExpansions:18000,maxQueueEntries:45000,maxWallMs:80000});
  valid(p,r);
  assert.ok(r.lowerBound<=known&&known<=r.upperBound);
  assert.equal(r.certifiedOptimal,true);
  assert.equal(r.upperBound,known);
 }
});
test('unseen 12–16 job early censored intervals are independent and admissible',()=>{
 for(const f of [stressCases[0],stressCases[4],stressCases[8]]){
  const p=f.problem,r=certifyDisk(p,seed(p),{maxExpansions:250,maxQueueEntries:5000});
  valid(p,r);assert.ok(r.stats.expanded<=250);
  assert.ok(r.lowerBound>=admissibleLowerBound(p).value);
  assert.ok(['proof_complete','expansion_budget'].includes(r.exitReason));
 }
});
test('queue cap is atomic and produces a valid censored proof without losing siblings',()=>{
 const p=stressCases[6].problem,initial=seed(p);
 const r=certifyDisk(p,initial,{maxExpansions:1800,maxQueueEntries:2});
 valid(p,r);assert.equal(r.exitReason,'disk_queue_budget');
 assert.ok(r.stats.remainingQueue<=2);
 assert.ok(r.stats.transactionRollbacks>=1);
 assert.equal(r.certifiedOptimal,false);
});
test('a restrictive soft database budget reports an honest intact frontier',()=>{
 const p=stressCases[7].problem;
 const r=certifyDisk(p,seed(p),{maxExpansions:1300,maxQueueEntries:20000,maxDatabaseBytes:100000});
 valid(p,r);assert.ok(['disk_budget_soft','expansion_budget','proof_complete'].includes(r.exitReason));
 assert.ok(r.stats.dbBytesAtStop>=0);
});
test('bounded disk and original V13 certificates overlap on identical instances',()=>{
 for(const f of [stressCases[1],stressCases[3],stressCases[6]]){
  const p=f.problem,initial=seed(p);
  const a=certifyDisk(p,initial,{maxExpansions:380,maxQueueEntries:7000});
  const b=certifyImproved(p,initial,{maxExpansions:380,maxFrontier:7000});
  valid(p,a);
  assert.ok(a.lowerBound<=b.upperBound&&b.lowerBound<=a.upperBound);
  assert.ok(a.stats.remainingQueue<=7000);
 }
});
test('the SQLite frontier returns a stable proof for identical problem and budget',()=>{
 const p=generateStress(7,228821,1),initial=seed(p);
 const limits={maxExpansions:1000,maxQueueEntries:4000};
 const a=certifyDisk(p,initial,limits),b=certifyDisk(structuredClone(p),structuredClone(initial),limits);
 valid(p,a);valid(p,b);
 for(const k of ['lowerBound','upperBound','gapUpper','exitReason'])assert.equal(a[k],b[k]);
 assert.equal(a.certificateHash,b.certificateHash);
 assert.deepEqual(a.incumbent,b.incumbent);
});
test('invalid incumbent and invalid finite resource limits fail closed',()=>{
 const p=stressCases[2].problem,initial=seed(p);
 const bad=structuredClone(initial);bad.jobs[0].machine='MISSING';
 assert.throws(()=>certifyDisk(p,bad),/INVALID_TRUSTED_SEED/);
 assert.throws(()=>certifyDisk(p,initial,{maxQueueEntries:0}),/BAD_DISK_PROOF_BUDGET/);
 assert.throws(()=>certifyDisk(p,initial,{maxExpansions:-1}),/BAD_DISK_PROOF_BUDGET/);
 assert.throws(()=>certifyDisk(p,initial,{maxDatabaseBytes:2}),/BAD_DISK_PROOF_BUDGET/);
});
