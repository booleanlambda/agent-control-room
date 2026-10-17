import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyImproved} from './certifier.mjs';
import {certifyAnytime} from '../certified-anytime-v11/certifier.mjs';
import {stressCases,generateStress} from '../certificate-stress-v12/stress.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
const seed=p=>topologicalSeeds(p)[0];
const verify=(p,r)=>{
 const g=evaluate(p,{schedule:r.execution.schedule,cost:r.upperBound});
 assert.equal(g.ok,true);assert.equal(g.cost,r.upperBound);
 assert.ok(r.lowerBound<=r.upperBound);
 assert.equal(r.gapUpper,r.upperBound-r.lowerBound);
 assert.equal(r.certifiedOptimal,r.gapUpper===0);
};
test('enhanced forced-rank bound never overstates 4–8-job exact reference optimum',()=>{
 for(let size=4;size<=8;size++){
  for(let variant=0;variant<=2;variant++){
   const p=generateStress(size,41237+size*173+variant*17009,variant),oracle=exactOracle(p);
   const a=certifyAnytime(p,seed(p),{maxExpansions:0,maxFrontier:300});
   const b=certifyImproved(p,seed(p),{maxExpansions:0,maxFrontier:300});
   verify(p,b);
   assert.ok(a.lowerBound<=b.lowerBound,
    'stronger bound must dominate original for size '+size+' variant '+variant);
   assert.ok(b.lowerBound<=oracle.cost&&oracle.cost<=b.upperBound);
  }
 }
});
test('compact parent-pointer reconstruction yields correct exact proof on 4–7 jobs',()=>{
 for(let size=4;size<=7;size++){
  const p=generateStress(size,18238+size*377,2),oracle=exactOracle(p);
  const a=certifyImproved(p,seed(p),{maxExpansions:9000,maxFrontier:20000});
  verify(p,a);
  assert.equal(a.certifiedOptimal,true);assert.equal(a.upperBound,oracle.cost);
  assert.equal(a.exitReason,'proof_complete');
  assert.ok(a.expanded<=9000);
 }
});
test('zero wall-clock budget halts without losing frontier or falsely certifying',()=>{
 const p=stressCases[8].problem,a=certifyImproved(p,seed(p),{maxExpansions:5000,maxWallMs:0,maxFrontier:500});
 verify(p,a);assert.equal(a.expanded,0);
 assert.equal(a.remainingFrontier,1);assert.equal(a.exitReason,'wall_budget');
 assert.equal(a.certifiedOptimal,false);
});
test('heap budget reports honest interval before exploration',()=>{
 const p=stressCases[7].problem,a=certifyImproved(p,seed(p),{maxExpansions:5000,maxHeapBytes:1,maxFrontier:500});
 verify(p,a);assert.equal(a.expanded,0);
 assert.equal(a.remainingFrontier,1);assert.equal(a.exitReason,'heap_budget');
});
test('tight 100-state frontier is strict and never silently discards branches',()=>{
 for(const f of [stressCases[0],stressCases[4],stressCases[8]]){
  const p=f.problem,r=certifyImproved(p,seed(p),
    {maxExpansions:1500,maxFrontier:100,maxWallMs:60000});
  verify(p,r);
  assert.ok(r.remainingFrontier<=100&&r.maxHeap<=100);
  assert.ok(r.lowerBound>=admissibleLowerBound(p).value);
  assert.ok(['proof_complete','frontier_budget','expansion_budget'].includes(r.exitReason));
 }
});
test('compressed v13 and original V12 bound modes produce comparable certificates',()=>{
 for(const f of [stressCases[1],stressCases[3],stressCases[6]]){
  const p=f.problem,incumbent=seed(p),settings={maxExpansions:500,maxFrontier:900};
  const old=certifyAnytime(p,incumbent,settings);
  const equivalent=certifyImproved(p,incumbent,{...settings,boundMode:'v12'});
  verify(p,equivalent);
  assert.equal(equivalent.lowerBound,old.lowerBound);
  assert.equal(equivalent.upperBound,old.upperBound);
  assert.equal(equivalent.expanded,old.expanded);
  assert.equal(equivalent.remainingFrontier,old.remainingFrontier);
 }
});
test('rank bound maintains sound intervals for all nine independent 12–16 job cases',()=>{
 for(const f of stressCases){
  const p=f.problem,incumbent=seed(p);
  const proof=certifyImproved(p,incumbent,{maxExpansions:900,maxFrontier:1200});
  verify(p,proof);
  assert.ok(proof.lowerBound>=admissibleLowerBound(p).value);
  assert.ok(proof.expanded<=900&&proof.maxHeap<=1200);
  assert.equal(proof.evidence.certificateHash.length,64);
 }
});
test('deterministic replay with same proof options preserves results and certificate hash',()=>{
 const p=stressCases[2].problem,incumbent=seed(p),options={maxExpansions:450,maxFrontier:800};
 const a=certifyImproved(p,incumbent,options);
 const b=certifyImproved(structuredClone(p),structuredClone(incumbent),options);
 for(const field of ['lowerBound','upperBound','expanded','generated','remainingFrontier','exitReason'])
  assert.equal(a[field],b[field]);
 assert.equal(a.evidence.certificateHash,b.evidence.certificateHash);
 assert.deepEqual(a.incumbent,b.incumbent);
});
test('invalid objective/budget input fails closed',()=>{
 const p=stressCases[0].problem,incumbent=seed(p);
 assert.throws(()=>certifyImproved(p,incumbent,{boundMode:'nonexistent'}),/BAD_CERTIFIER_BUDGET/);
 assert.throws(()=>certifyImproved(p,incumbent,{maxWallMs:-1}),/BAD_CERTIFIER_BUDGET/);
 assert.throws(()=>certifyImproved(p,incumbent,{maxHeapBytes:0}),/BAD_CERTIFIER_BUDGET/);
 assert.throws(()=>certifyImproved(p,incumbent,{maxFrontier:2}),/BAD_CERTIFIER_BUDGET/);
});
