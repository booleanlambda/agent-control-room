import test from 'node:test';
import assert from 'node:assert/strict';
import {stressCases,generateStress,stressOne,sha} from './stress.mjs';
import {certifyAnytime} from '../certified-anytime-v11/certifier.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';

test('nine seeded fixtures cover 12/14/16 with independent hashes and varied DAGs',()=>{
 assert.equal(stressCases.length,9);
 assert.deepEqual(stressCases.map(x=>x.jobCount),[12,12,12,14,14,14,16,16,16]);
 assert.equal(new Set(stressCases.map(x=>sha(x.problem))).size,9);
 for(const f of stressCases){
  assert.equal(f.problem.jobs.length,f.jobCount);
  assert.equal(sha(generateStress(f.jobCount,f.seed,f.variant)),sha(f.problem));
  assert.ok(f.problem.jobs.every((j,i)=>j.parents.every(id=>Number(id.slice(1))<i)));
 }
});
test('admissible bounds survive six randomized independent small exact oracle checks',()=>{
 for(let i=0;i<6;i++){
  const p=generateStress(5+i%3,13073+i*9929,i%3);
  const trueOptimum=exactOracle(p).cost;
  const initial=topologicalSeeds(p)[0];
  const proof=certifyAnytime(p,initial,{maxExpansions:0,maxFrontier:100});
  assert.ok(proof.lowerBound<=trueOptimum&&trueOptimum<=proof.upperBound);
  assert.ok(proof.lowerBound>=admissibleLowerBound(p).value);
  const complete=certifyAnytime(p,initial,{maxExpansions:4500,maxFrontier:20000});
  assert.equal(complete.certifiedOptimal,true);
  assert.equal(complete.upperBound,trueOptimum);
  assert.equal(evaluate(p,{schedule:complete.execution.schedule,cost:complete.upperBound}).ok,true);
 }
});
test('censored node budgets cannot claim unsupported exact optimality',()=>{
 const f=stressCases[8],seed=topologicalSeeds(f.problem)[0];
 const p=certifyAnytime(f.problem,seed,{maxExpansions:0,maxFrontier:100});
 assert.equal(p.expanded,0);
 assert.equal(p.exitReason,'expansion_budget');
 assert.equal(p.remainingFrontier,1);
 assert.ok(p.upperBound>p.lowerBound);
 assert.equal(p.certifiedOptimal,false);
});
test('bounded stress each size with audited intervals and accurate flags',()=>{
 for(const f of [stressCases[0],stressCases[3],stressCases[6]]){
  const result=stressOne(f,{warmupEvaluations:180,mediumExpansions:80,
   deepExpansions:650,frontierCap:1000});
  assert.equal(result.logicalChecksPassed,true);
  assert.equal(result.observations.length,4);
  for(const record of result.observations){
   assert.ok(record.lower<=record.upper);
   assert.equal(record.certifiedOptimal,record.certifiedGap===0);
   assert.ok(record.expanded<=record.nodeBudget);
   assert.ok(record.remainingFrontier<=record.frontierBudget);
   assert.equal(record.feasible,true);
  }
 }
});
test('search with maxFrontier 100 is hard-capped, never silently deletes frontier states',()=>{
 const f=stressCases[6],seed=topologicalSeeds(f.problem)[0];
 const proof=certifyAnytime(f.problem,seed,{maxExpansions:4000,maxFrontier:100});
 assert.ok(proof.remainingFrontier<=100);
 assert.ok(proof.lowerBound<=proof.upperBound);
 assert.equal(proof.certifiedOptimal,proof.gapUpper===0);
});
test('result certificate reproducible for repeated seeded stress case',()=>{
 const f=stressCases[4],seed=topologicalSeeds(f.problem)[0];
 const a=certifyAnytime(f.problem,seed,{maxExpansions:140,maxFrontier:300});
 const b=certifyAnytime(structuredClone(f.problem),structuredClone(seed),{maxExpansions:140,maxFrontier:300});
 assert.equal(a.evidence.certificateHash,b.evidence.certificateHash);
 assert.equal(a.lowerBound,b.lowerBound);
 assert.equal(a.upperBound,b.upperBound);
 assert.equal(a.expanded,b.expanded);
 assert.equal(a.remainingFrontier,b.remainingFrontier);
});
test('invalid incumbent remains blocked by trusted validator',()=>{
 const f=stressCases[1],p=f.problem,seed=topologicalSeeds(p)[0];
 const bad=structuredClone(seed);
 bad.jobs[0].machine='NOT_A_MACHINE';
 assert.equal(scheduleCandidate(p,bad).ok,false);
 assert.throws(()=>certifyAnytime(p,bad,{maxExpansions:100}),/INITIAL_CERTIFIED_WITNESS_REQUIRED/);
});
test('bounded search refuses excessive node and job counts without pretending proof',()=>{
 const f=stressCases[7],seed=topologicalSeeds(f.problem)[0];
 assert.throws(()=>certifyAnytime(f.problem,seed,{maxExpansions:150001}),/BAD_CERTIFIER_BUDGET/);
 const big=structuredClone(f.problem);
 big.jobs.push({id:'J16',type:'b',duration:2,release:0,due:14,weight:1,parents:[]});
 big.jobs.push({id:'J17',type:'b',duration:2,release:0,due:14,weight:1,parents:[]});
 assert.throws(()=>certifyAnytime(big,{jobs:[...seed.jobs,{id:'J16',machine:'M0'},{id:'J17',machine:'M0'}]}),/CERTIFIER_SCOPE_EXCEEDED/);
});
