import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyAnytime} from './certifier.mjs';
import {fixtures,topologicalSeeds,compareInstance,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {evaluate,exactOracle} from '../precise-diagnostics-v6/benchmark.mjs';
const incumbent=p=>compareInstance(p,{maxEvaluations:800,beamWidth:8,maxDepth:7}).beamProposal;
test('heap-based certifier produces exact proofs for tiny precedence/setup/outage case',()=>{
 const p={machines:[
  {id:'M0',types:['a','b'],initialType:'b',setup:2,activation:4,maintenance:[[5,8]]},
  {id:'M1',types:['b','c'],initialType:'c',setup:1,activation:5,maintenance:[[7,11]]}],
  jobs:[
   {id:'J0',type:'a',duration:3,release:0,due:2,weight:3,parents:[]},
   {id:'J1',type:'b',duration:2,release:0,due:3,weight:5,parents:[]},
   {id:'J2',type:'c',duration:4,release:1,due:6,weight:4,parents:['J1']},
   {id:'J3',type:'b',duration:2,release:3,due:8,weight:6,parents:['J0','J2']}
  ]};
 const seed=topologicalSeeds(p)[0],oracle=exactOracle(p);
 const proof=certifyAnytime(p,seed,{maxExpansions:5000});
 assert.equal(proof.certifiedOptimal,true);
 assert.equal(proof.upperBound,oracle.cost);
 assert.equal(proof.lowerBound,oracle.cost);
 assert.equal(proof.gapUpper,0);
 assert.equal(evaluate(p,{schedule:proof.execution.schedule,cost:proof.upperBound}).ok,true);
});
test('certified root bound is at least V10 relaxation, and never overstates exact minimum',()=>{
 for(const {problem:p,size} of fixtures.filter(x=>x.size===7)){
  const seed=incumbent(p),previous=admissibleLowerBound(p),oracle=exactOracle(p);
  const proof=certifyAnytime(p,seed,{maxExpansions:0});
  assert.equal(proof.exitReason,'expansion_budget');
  assert.equal(proof.expanded,0);
  assert.ok(proof.lowerBound>=previous.value);
  assert.ok(proof.lowerBound<=oracle.cost&&oracle.cost<=proof.upperBound);
  assert.ok(proof.execution.ledger.every(j=>j.setupStart>=0));
 }
});
test('seven-job cost intervals contain independent exact optimum under bounded search',()=>{
 for(const {problem:p} of fixtures.filter(x=>x.size===7)){
  const initial=incumbent(p),oracle=exactOracle(p);
  const proof=certifyAnytime(p,initial,{maxExpansions:3500});
  assert.ok(proof.lowerBound<=oracle.cost&&oracle.cost<=proof.upperBound);
  assert.equal(proof.gapUpper,proof.upperBound-proof.lowerBound);
  assert.equal(proof.certifiedOptimal,proof.lowerBound===proof.upperBound);
  if(proof.certifiedOptimal)assert.equal(proof.upperBound,oracle.cost);
  assert.equal(evaluate(p,{schedule:proof.execution.schedule,cost:proof.upperBound}).ok,true);
 }
});
test('new 9,10,12 job cases have safe budgets and independent valid incumbents',()=>{
 for(const {problem:p,size} of fixtures.filter(x=>x.size>8)){
  const initial=incumbent(p),before=scheduleCandidate(p,initial);
  const proof=certifyAnytime(p,initial,{maxExpansions:2400,maxFrontier:30000});
  assert.equal(proof.evidence.certificateHash.length,64);
  assert.ok(proof.upperBound<=before.cost);
  assert.ok(proof.lowerBound>=admissibleLowerBound(p).value);
  assert.ok(proof.lowerBound<=proof.upperBound);
  assert.ok(proof.expanded<=2400);
  assert.ok(proof.gapUpper>=0);
  assert.equal(evaluate(p,{schedule:proof.execution.schedule,cost:proof.upperBound}).ok,true);
  if(proof.certifiedOptimal)assert.equal(proof.gapUpper,0);
  assert.equal(p.jobs.length,size);
 }
});
test('zero expansion is an honest open-frontier lower bound, not an optimality assertion',()=>{
 const p=fixtures.find(x=>x.size===12).problem;
 const proof=certifyAnytime(p,incumbent(p),{maxExpansions:0});
 assert.equal(proof.expanded,0);assert.equal(proof.remainingFrontier,1);
 assert.equal(proof.certifiedOptimal,false);
 assert.ok(proof.gapUpper>0);
});
test('certificate proof is deterministic across identical inputs and budgets',()=>{
 const p=fixtures[0].problem,seed=incumbent(p);
 const a=certifyAnytime(p,seed,{maxExpansions:1300});
 const b=certifyAnytime(structuredClone(p),structuredClone(seed),{maxExpansions:1300});
 const fields=['upperBound','lowerBound','gapUpper','expanded','generated','pruned','dominancePruned','remainingFrontier','exitReason'];
 for(const f of fields)assert.equal(a[f],b[f]);
 assert.deepEqual(a.incumbent,b.incumbent);
 assert.equal(a.evidence.certificateHash,b.evidence.certificateHash);
});
test('more expansion cannot lose the previous known feasible incumbent',()=>{
 const p=fixtures[3].problem,seed=incumbent(p);
 const a=certifyAnytime(p,seed,{maxExpansions:50});
 const b=certifyAnytime(p,seed,{maxExpansions:700});
 assert.ok(b.upperBound<=a.upperBound);
 assert.ok(a.lowerBound<=a.upperBound&&b.lowerBound<=b.upperBound);
});
test('incorrect user seed and invalid budgets are rejected before search',()=>{
 const p=fixtures[0].problem,seed=incumbent(p);
 const wrong=structuredClone(seed);wrong.jobs[0].machine='NO_MACHINE';
 assert.throws(()=>certifyAnytime(p,wrong),/INITIAL_CERTIFIED_WITNESS_REQUIRED/);
 assert.throws(()=>certifyAnytime(p,seed,{maxExpansions:-1}),/BAD_CERTIFIER_BUDGET/);
 assert.throws(()=>certifyAnytime(p,seed,{maxFrontier:20}),/BAD_CERTIFIER_BUDGET/);
 assert.throws(()=>certifyAnytime(p,seed,{maxExpansions:999999}),/BAD_CERTIFIER_BUDGET/);
});
test('recorded lower bound cannot exceed an exact verified completed schedule from randomized cases',()=>{
 let seed=297112;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const n=(a,b)=>a+Math.floor(rand()*(b-a+1));
 for(let t=0;t<12;t++){
  const p={machines:[
   {id:'M0',types:['a','b'],initialType:'a',setup:n(0,3),activation:n(1,7),maintenance:[[5,9]]},
   {id:'M1',types:['b','c'],initialType:'c',setup:n(0,3),activation:n(1,7),maintenance:[[8,12]]}
  ],jobs:[]};
  for(let i=0;i<4;i++)p.jobs.push({id:'J'+i,type:['a','b','c'][n(0,2)],duration:n(1,5),
   release:n(0,4),due:n(1,14),weight:n(1,8),parents:i&&rand()<0.4?['J'+n(0,i-1)]:[]});
  const oracle=exactOracle(p);
  const proof=certifyAnytime(p,topologicalSeeds(p)[0],{maxExpansions:1600});
  assert.ok(proof.lowerBound<=oracle.cost&&oracle.cost<=proof.upperBound);
  assert.equal(proof.certifiedOptimal,proof.gapUpper===0);
 }
});
