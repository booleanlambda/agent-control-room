import test from 'node:test';
import assert from 'node:assert/strict';
import {beamOptimize,exactSmall} from './beam.mjs';
import {optimizeProposal} from '../scheduler-optimization-v8/optimizer.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {publicProblem,hiddenProblems,exactOracle,evaluate,grade} from '../precise-diagnostics-v6/benchmark.mjs';
const baseline={jobs:[
 {id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
 {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},
 {id:'J5',machine:'M1'}]};
const independentlyValid=(p,result)=>{
 const e=evaluate(p,{schedule:result.execution.schedule,cost:result.finalCost});
 assert.equal(e.ok,true);assert.equal(e.cost,result.finalCost);
 assert.ok(result.execution.ledger.every(j=>j.setupStart>=0&&j.setupStart>=j.machineFinishBefore));
};
test('v9 beam bounded valid solutions compared with v8 local descent and exact independent reference across all scenarios',()=>{
 for(const p of [publicProblem,...hiddenProblems]){
  const b=beamOptimize(p,[baseline],{maxEvaluations:1200,beamWidth:12,maxDepth:10});
  const old=optimizeProposal(p,baseline,{maxEvaluations:1200,maxRounds:16});
  const exact=exactOracle(p);
  assert.equal(b.ok,true);independentlyValid(p,b);
  assert.ok(b.finalCost<=scheduleCandidate(p,baseline).cost);
  assert.ok(b.finalCost>=exact.cost);
  assert.ok(old.finalCost>=exact.cost);
  assert.ok(b.evaluations<=1200&&b.depth<=10&&b.trace.every(x=>x.newCost<x.oldCost));
  const small=exactSmall(p);assert.equal(small.ok,true);assert.equal(small.cost,exact.cost);
  assert.equal(grade(p,{schedule:small.execution.schedule,cost:small.cost}).passed,true);
  assert.ok(Number.isSafeInteger(small.searchedCompleteAssignments)&&small.searchedCompleteAssignments>0);
 }
});
test('beam trace monotonic, hashes, deterministic complete replay',()=>{
 const opts={maxEvaluations:300,beamWidth:8,maxDepth:6};
 const a=beamOptimize(publicProblem,[baseline],opts),b=beamOptimize(structuredClone(publicProblem),[structuredClone(baseline)],opts);
 assert.deepEqual(a,b);
 assert.equal(a.evidence.ledgerHash.length,64);
 assert.ok(a.passes.every(x=>x.frontierCosts.length<=8));
 assert.ok(a.trace.every(x=>x.newCost<x.oldCost));
});
test('zero evaluation budget cannot invent improvement',()=>{
 const b=beamOptimize(publicProblem,[baseline],{maxEvaluations:0,beamWidth:7,maxDepth:5});
 assert.equal(b.ok,true);assert.equal(b.evaluations,0);
 assert.equal(b.baselineCost,512);assert.equal(b.finalCost,512);
 assert.deepEqual(b.proposal,baseline);
 assert.equal(b.truncatedByEvaluationBudget,false);
});
test('zero depth likewise returns legal seed without search',()=>{
 const b=beamOptimize(publicProblem,[baseline],{maxEvaluations:100,beamWidth:5,maxDepth:0});
 assert.equal(b.ok,true);assert.equal(b.finalCost,512);assert.equal(b.evaluations,0);
});
test('invalid model seed rejected, valid fallback accepted',()=>{
 const bad=structuredClone(baseline);
 bad.jobs[0].machine='M1'; // J0 cannot be assigned to M1
 const b=beamOptimize(publicProblem,[bad,baseline],{maxEvaluations:80,beamWidth:4,maxDepth:4});
 assert.equal(b.ok,true);assert.equal(b.validSeeds,1);
 assert.equal(b.rejectedSeeds[0].reason,'machine_ineligible');
 assert.ok(b.finalCost<=512);independentlyValid(publicProblem,b);
});
test('no feasible initial seed fails closed',()=>{
 const bad=structuredClone(baseline);bad.jobs.splice(1,1);
 const r=beamOptimize(publicProblem,[bad]);assert.equal(r.ok,false);assert.equal(r.reason,'NO_VALID_SEED');
});
test('hard budget clamps reject invalid sizes',()=>{
 for(const bad of [{maxEvaluations:-1},{maxEvaluations:20001},{beamWidth:0},{beamWidth:65},{maxDepth:33},{maxDepth:-1}]){
  assert.throws(()=>beamOptimize(publicProblem,[baseline],bad),/INVALID_BEAM_BUDGET/);
 }
 assert.throws(()=>exactSmall(publicProblem,{jobCeiling:9}),/INVALID_EXACT_CEILING/);
});
test('exact solver refuses larger problems instead of claiming optimality',()=>{
 const p=structuredClone(publicProblem);
 p.jobs.push({id:'J7',type:'a',duration:3,release:0,due:10,weight:2,parents:[]});
 p.jobs.push({id:'J8',type:'b',duration:2,release:0,due:15,weight:3,parents:[]});
 const r=exactSmall(p);
 assert.equal(r.ok,false);assert.equal(r.reason,'EXACT_SCOPE_EXCEEDED');
 const b=beamOptimize(p,[{jobs:[...baseline.jobs,{id:'J7',machine:'M0'},{id:'J8',machine:'M1'}]}],{maxEvaluations:180,beamWidth:5,maxDepth:4});
 assert.equal(b.ok,true);independentlyValid(p,b);
 assert.equal(b.optimalityClaim,false);
});
test('randomized independent small scheduling cases never violate windows and never beat oracle',()=>{
 let state=190823;const rnd=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 const int=(a,b)=>a+Math.floor(rnd()*(b-a+1));
 for(let z=0;z<20;z++){
  const p={machines:[
   {id:'M0',types:['a','b'],initialType:'a',setup:int(0,3),activation:int(1,8),maintenance:[[5,10]]},
   {id:'M1',types:['a','b'],initialType:'b',setup:int(0,3),activation:int(1,8),maintenance:[[6,12]]}
  ],jobs:[]};
  for(let i=0;i<5;i++)p.jobs.push({id:'J'+i,type:rnd()<.5?'a':'b',duration:int(1,5),
   release:int(0,6),due:int(1,16),weight:int(1,7),
   parents:i>0&&rnd()<.5?['J'+int(0,i-1)]:[]});
  const s={jobs:p.jobs.map(j=>({id:j.id,machine:rnd()<.5?'M0':'M1'}))};
  const b=beamOptimize(p,[s],{maxEvaluations:220,beamWidth:7,maxDepth:5});
  const oracle=exactOracle(p);
  assert.equal(b.ok,true);independentlyValid(p,b);
  assert.ok(b.finalCost<=b.baselineCost&&b.finalCost>=oracle.cost);
  assert.equal(exactSmall(p).cost,oracle.cost);
 }
});
