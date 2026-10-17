import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyIDA} from './ida.mjs';
import {certifyImproved} from '../tighter-bounds-v13/certifier.mjs';
import {generateStress,stressCases} from '../certificate-stress-v12/stress.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
const seed=p=>topologicalSeeds(p)[0];
const checked=(p,r)=>{
 const v=evaluate(p,{schedule:r.execution.schedule,cost:r.upperBound});
 assert.equal(v.ok,true);assert.equal(v.cost,r.upperBound);
 assert.ok(r.lowerBound<=r.upperBound);
 assert.equal(r.certifiedOptimal,r.lowerBound===r.upperBound);
 assert.equal(r.searchMemory,'depth_first_without_global_frontier');
 assert.ok(r.maxDepth<=p.jobs.length);
};
test('zero node, wall and heap budgets keep sound original lower bound',()=>{
 const p=stressCases[8].problem,incumbent=seed(p);
 for(const limits of [{maxExpansions:0},{maxWallMs:0},{maxHeapBytes:1}]){
  const r=certifyIDA(p,incumbent,{...limits,maxExpansions:limits.maxExpansions??100});
  checked(p,r);
  assert.equal(r.expanded,0);
  assert.equal(r.completedIterations,0);
  assert.equal(r.lowerBound,r.initialLower);
  assert.equal(r.certifiedOptimal,false);
 }
});
test('two-process exact independent oracle verifies 4–8 jobs across cases',()=>{
 for(const n of [4,5,6,7,8]){
  for(const variant of [0,1]){
   const p=generateStress(n,91123+973*n+variant*19831,variant);
   const known=exactOracle(p).cost;
   const r=certifyIDA(p,seed(p),{maxExpansions:22000,maxIterations:1000,maxWallMs:60000});
   checked(p,r);
   assert.ok(r.lowerBound<=known&&known<=r.upperBound,
    'certificate interval must cover independent exact answer');
   if(r.certifiedOptimal)assert.equal(r.upperBound,known);
  }
 }
});
test('partial interrupted IDA iterations never claim new lower bounds',()=>{
 const p=generateStress(7,71337,2),known=exactOracle(p).cost;
 const s=seed(p),limits=[0,1,2,5,20,100,300,800];
 let previousUpper=Infinity;
 for(const budget of limits){
  const r=certifyIDA(p,s,{maxExpansions:budget,maxIterations:500});
  checked(p,r);
  assert.ok(r.lowerBound<=known&&known<=r.upperBound);
  assert.ok(r.upperBound<=previousUpper);
  previousUpper=r.upperBound;
  assert.ok(r.completedIterations<=r.iterations);
  assert.ok(r.trace.every(x=>x.certifiedLower<=known&&x.certifiedLower<=x.incumbent));
 }
});
test('9 stress instances retain feasibility and honest bounds under 500 expansions',()=>{
 for(const f of stressCases){
  const p=f.problem;
  const r=certifyIDA(p,seed(p),{maxExpansions:500,maxIterations:500,maxWallMs:60000});
  checked(p,r);
  assert.ok(r.lowerBound>=admissibleLowerBound(p).value);
  assert.ok(r.expanded<=500&&r.maxDepth<=16);
  assert.equal(r.evidence.certificateHash.length,64);
 }
});
test('10–12 job feasible certificates versus independent V13 bounded search',()=>{
 for(const f of [stressCases[0],stressCases[1],stressCases[3]]){
  const p=f.problem,s=seed(p);
  const old=certifyImproved(p,s,{maxExpansions:700,maxFrontier:600});
  const now=certifyIDA(p,s,{maxExpansions:700,maxIterations:500});
  checked(p,now);
  assert.ok(now.upperBound>=old.lowerBound&&old.upperBound>=now.lowerBound,
   'independent sound certificates must overlap');
  assert.equal(evaluate(p,{schedule:now.execution.schedule,cost:now.upperBound}).ok,true);
 }
});
test('iteration count cap is honored; incomplete result not misclassified as solved',()=>{
 const p=stressCases[6].problem;
 const r=certifyIDA(p,seed(p),{maxExpansions:2000,maxIterations:1});
 checked(p,r);assert.ok(r.iterations<=1);
 assert.ok(['iteration_budget','proof_complete','expansion_budget'].includes(r.exitReason));
});
test('identical inputs produce deterministic proof trace and digest',()=>{
 const p=generateStress(7,121092,1),s=seed(p),opts={maxExpansions:1800,maxIterations:100};
 const a=certifyIDA(p,s,opts);
 const b=certifyIDA(structuredClone(p),structuredClone(s),opts);
 checked(p,a);checked(p,b);
 for(const field of ['upperBound','lowerBound','expanded','iterations','completedIterations','maxDepth','exitReason'])
  assert.equal(a[field],b[field]);
 assert.equal(a.evidence.certificateHash,b.evidence.certificateHash);
});
test('invalid initial schedules, model timing contamination and excessive limits fail closed',()=>{
 const p=generateStress(6,92188,0),s=seed(p);
 const bad=structuredClone(s);bad.jobs[0].machine='NOT_REAL';
 assert.throws(()=>certifyIDA(p,bad),/INITIAL_CERTIFIED_WITNESS_REQUIRED/);
 assert.throws(()=>certifyIDA(p,s,{maxExpansions:-1}),/BAD_IDA_BUDGET/);
 assert.throws(()=>certifyIDA(p,s,{maxIterations:3001}),/BAD_IDA_BUDGET/);
 assert.throws(()=>certifyIDA(p,s,{maxWallMs:600001}),/BAD_IDA_BUDGET/);
 assert.throws(()=>certifyIDA(p,s,{boundMode:'unknown'}),/BAD_IDA_BUDGET/);
 const extra=structuredClone(s);extra.jobs[0].start=0;
 assert.throws(()=>certifyIDA(p,extra),/INITIAL_CERTIFIED_WITNESS_REQUIRED/);
});
