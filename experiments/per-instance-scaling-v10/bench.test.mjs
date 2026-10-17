import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures,seven,scaling,topologicalSeeds,admissibleLowerBound,compareInstance,hash} from './bench.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {exactOracle,evaluate,grade} from '../precise-diagnostics-v6/benchmark.mjs';
import {exactSmall} from '../scheduler-beam-v9/beam.mjs';
test('all six fixture inputs are distinct and size buckets are 7/9/10/12',()=>{
 assert.equal(fixtures.length,6);
 assert.deepEqual(fixtures.map(x=>x.size),[7,7,7,9,10,12]);
 assert.equal(new Set(fixtures.map(x=>hash(x.problem))).size,6);
});
test('each original seven-job instance independently agrees with exact verifier',()=>{
 for(const p of seven){
  const e=exactSmall(p),oracle=exactOracle(p);
  assert.equal(e.ok,true);assert.equal(e.cost,oracle.cost);
  assert.equal(grade(p,{schedule:e.execution.schedule,cost:e.cost}).passed,true);
 }
});
test('admissible bound never exceeds exact optimum, including changed hidden cases',()=>{
 for(const p of seven){
  const b=admissibleLowerBound(p);
  assert.ok(b.value>=0&&b.value<=exactOracle(p).cost);
  assert.ok(b.relaxedTardiness>=0&&b.compulsoryActivationBound>=0);
  assert.equal(b.certifiesOptimality,false);
 }
});
test('all deterministic topological seeds are feasible and accept no model-owned clock',()=>{
 for(const {problem:p} of fixtures){
  const seeds=topologicalSeeds(p);
  assert.ok(seeds.length>=1&&seeds.length<=10);
  for(const s of seeds){
   assert.equal(s.jobs.length,p.jobs.length);
   assert.ok(s.jobs.every(x=>Object.keys(x).sort().join(',')==='id,machine'));
   const r=scheduleCandidate(p,s);
   assert.equal(r.ok,true);
   assert.equal(evaluate(p,{schedule:r.schedule,cost:r.cost}).ok,true);
  }
 }
});
test('reoptimization of EACH changed seven-job instance compared to independent optimum',()=>{
 for(const p of seven){
  const x=compareInstance(p,{maxEvaluations:1400,beamWidth:12,maxDepth:10});
  assert.ok(x.beamCost<=x.baseline);
  assert.ok(x.lowerBound<=x.beamCost&&x.beamCost<=x.exactOptimalCost);
  assert.ok(x.evaluations<=1400&&x.exactWitnessVerified);
  assert.equal(grade(p,{schedule:x.beamExecution.schedule,cost:x.beamCost}).reason,
   x.provablyOptimal?'optimal':'feasible_suboptimal');
 }
});
test('new 9/10/12 job cases meet limits and independent feasible grader without false optimality claims',()=>{
 for(const {problem:p,size} of scaling){
  const x=compareInstance(p,{maxEvaluations:950,beamWidth:8,maxDepth:7});
  assert.equal(x.size,size);
  assert.ok(x.evaluations<=950);
  assert.ok(x.beamCost<=x.baseline&&x.beamCost>=x.lowerBound);
  assert.equal(x.exactOptimalCost,null);assert.equal(x.provablyOptimal,false);
  assert.equal(x.exactWitnessVerified,null);
  const checked=evaluate(p,{schedule:x.beamExecution.schedule,cost:x.beamCost});
  assert.equal(checked.ok,true);assert.equal(checked.cost,x.beamCost);
  assert.ok(x.beamExecution.ledger.every(j=>j.setupStart>=0&&j.setupStart>=j.machineFinishBefore));
 }
});
test('one fixed old public plan is not reused as an optimum for changed instances',()=>{
 const previous={jobs:[
  {id:'J0',machine:'M0'},{id:'J3',machine:'M0'},{id:'J1',machine:'M0'},
  {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},
  {id:'J5',machine:'M1'}]};
 for(const p of seven.slice(1)){
  const stale=scheduleCandidate(p,previous),newResult=compareInstance(p,{maxEvaluations:1400,beamWidth:12,maxDepth:10});
  assert.equal(stale.ok,true);
  assert.ok(newResult.beamCost<=newResult.baseline);
  assert.ok(newResult.beamCost<=stale.cost);
 }
});
test('each instance receives a different proof digest and individual result',()=>{
 const rows=fixtures.map(({problem})=>compareInstance(problem,{maxEvaluations:200,beamWidth:5,maxDepth:3}));
 assert.equal(new Set(rows.map(r=>r.problemHash)).size,6);
 assert.ok(rows.every(r=>r.beamEvidence.ledgerHash.length===64&&r.beamEvidence.proposalHash.length===64));
});
test('bounded evaluation zero returns unchanged valid seed and no claimed optimum for large',()=>{
 const p=scaling[1].problem;const x=compareInstance(p,{maxEvaluations:0,beamWidth:4,maxDepth:0});
 assert.equal(x.evaluations,0);assert.equal(x.beamCost,x.baseline);assert.equal(x.exactOptimalCost,null);
});
test('detects impossible cycles and missing parent IDs in lower bound',()=>{
 const p=structuredClone(seven[0]);
 p.jobs[0].parents=['J6'];
 assert.throws(()=>admissibleLowerBound(p),/CYCLIC_OR_MISSING_DEPENDENCY/);
});
test('a seeded positive-cost four-job random sample respects an independently computed optimum',()=>{
 let s=118237;const rnd=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
 const num=(a,b)=>a+Math.floor(rnd()*(b-a+1));
 for(let k=0;k<12;k++){
  const p={machines:[
   {id:'M0',types:['a','b'],initialType:'a',setup:num(0,3),activation:num(1,6),maintenance:[[7,11]]},
   {id:'M1',types:['b','c'],initialType:'c',setup:num(0,3),activation:num(1,6),maintenance:[[9,13]]}
  ],jobs:[]};
  for(let i=0;i<4;i++)p.jobs.push({id:'J'+i,type:['a','b','c'][num(0,2)],
   duration:num(1,4),release:num(0,6),due:num(1,12),weight:num(1,9),
   parents:i>0&&rnd()<0.3?['J'+num(0,i-1)]:[]});
  const lb=admissibleLowerBound(p),o=exactOracle(p);
  assert.ok(lb.value<=o.cost);
  const got=compareInstance(p,{maxEvaluations:150,beamWidth:5,maxDepth:5});
  assert.ok(got.beamCost>=o.cost&&got.beamCost<=got.baseline);
  assert.equal(evaluate(p,{schedule:got.beamExecution.schedule,cost:got.beamCost}).ok,true);
 }
});
