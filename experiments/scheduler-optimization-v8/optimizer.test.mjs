import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleCandidate,searchBestCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {optimizeProposal} from './optimizer.mjs';
import {publicProblem,hiddenProblems,exactOracle,evaluate,grade} from '../precise-diagnostics-v6/benchmark.mjs';
const prev={jobs:[
 {id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
 {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},
 {id:'J5',machine:'M1'}]};
test('the documented Kimi v7 schedule is valid but suboptimal',()=>{
 const r=scheduleCandidate(publicProblem,prev);
 assert.equal(r.ok,true);assert.equal(r.cost,512);
 assert.equal(grade(publicProblem,{schedule:r.schedule,cost:r.cost}).passed,false);
 assert.equal(exactOracle(publicProblem).cost,415);
});
test('deterministic optimizer improves or preserves a previously suboptimal public candidate',()=>{
 const x=optimizeProposal(publicProblem,prev,{maxEvaluations:1200,maxRounds:18});
 assert.equal(x.ok,true);
 assert.equal(x.baselineCost,512);
 assert.ok(x.finalCost<512,'expected a real cost improvement');
 assert.ok(x.finalCost>=415,'cannot beat certified optimum');
 assert.equal(evaluate(publicProblem,{schedule:x.execution.schedule,cost:x.finalCost}).ok,true);
 assert.ok(x.trace.every(z=>z.nextCost<z.previousCost));
 assert.ok(x.trace.length<=18&&x.evaluations<=1200);
 assert.equal(x.execution.ledger.every(e=>e.setupStart>=0&&e.setupStart>=e.machineFinishBefore),true);
});
test('optimizer output remains independently feasible on both hidden variants',()=>{
 for(const p of hiddenProblems){
  const out=optimizeProposal(p,prev,{maxEvaluations:1200,maxRounds:18});
  const oracle=exactOracle(p);
  assert.equal(out.ok,true);
  assert.ok(out.finalCost>=oracle.cost);
  assert.ok(out.finalCost<=scheduleCandidate(p,prev).cost);
  assert.equal(evaluate(p,{schedule:out.execution.schedule,cost:out.finalCost}).ok,true);
  assert.ok(out.execution.ledger.every(z=>z.setupStart>=0));
 }
});
test('zero evaluations and zero rounds preserve input',()=>{
 const x=optimizeProposal(publicProblem,prev,{maxEvaluations:0,maxRounds:0});
 assert.equal(x.ok,true);assert.equal(x.finalCost,512);assert.equal(x.rounds,0);
 assert.deepEqual(x.proposal,prev);assert.equal(x.truncated,false);
});
test('invalid initial order is rejected without automatically repairing a bad agent assignment',()=>{
 const bad={jobs:prev.jobs.map(x=>({...x}))};
 const i=bad.jobs.findIndex(x=>x.id==='J5');bad.jobs.splice(i,1);bad.jobs.unshift({id:'J5',machine:'M1'});
 assert.equal(optimizeProposal(publicProblem,bad).reason,'initial_candidate_invalid');
});
test('unsupported input or unreasonable budgets fail closed',()=>{
 assert.throws(()=>optimizeProposal(publicProblem,prev,{maxEvaluations:-1}),/invalid_optimizer_budget/);
 assert.throws(()=>optimizeProposal(publicProblem,prev,{mode:'unbounded'}),/invalid_optimizer_budget/);
 assert.throws(()=>optimizeProposal(publicProblem,prev,{maxRounds:1000}),/invalid_optimizer_budget/);
});
test('deterministic replay gives identical moves, checksums, cost and assignment',()=>{
 const settings={maxEvaluations:500,maxRounds:10};
 const a=optimizeProposal(publicProblem,prev,settings);
 const b=optimizeProposal(structuredClone(publicProblem),structuredClone(prev),settings);
 assert.deepEqual(a,b);
});
test('distinct move modes never degrade starting plan',()=>{
 for(const mode of ['reassign','relocate','both']){
  const x=optimizeProposal(publicProblem,prev,{mode,maxEvaluations:300,maxRounds:8});
  assert.equal(x.ok,true);assert.ok(x.finalCost<=x.baselineCost);
  assert.equal(evaluate(publicProblem,{schedule:x.execution.schedule,cost:x.finalCost}).ok,true);
 }
});
test('adversarial randomized feasible inputs never create invalid timestamps or impossible cost',()=>{
 let seed=81702;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const int=(a,b)=>a+Math.floor(rnd()*(b-a+1));
 for(let k=0;k<16;k++){
  const p={machines:[
   {id:'M0',types:['a','b'],initialType:'a',setup:int(0,4),activation:int(2,7),maintenance:[[4,10]]},
   {id:'M1',types:['a','b'],initialType:'b',setup:int(0,4),activation:int(2,7),maintenance:[[7,12]]}],
   jobs:[]};
  for(let i=0;i<4;i++)p.jobs.push({id:'J'+i,type:rnd()<0.5?'a':'b',
   duration:int(1,5),release:int(0,4),due:int(1,12),weight:int(1,8),
   parents:i&&rnd()<0.35?['J'+int(0,i-1)]:[]});
  const initial={jobs:p.jobs.map(j=>({id:j.id,machine:rnd()<0.5?'M0':'M1'}))};
  const x=optimizeProposal(p,initial,{maxEvaluations:300,maxRounds:10});
  const reference=exactOracle(p);
  assert.equal(x.ok,true);
  assert.ok(x.finalCost<=x.baselineCost&&x.finalCost>=reference.cost);
  assert.equal(evaluate(p,{schedule:x.execution.schedule,cost:x.finalCost}).ok,true);
  assert.ok(x.execution.ledger.every(j=>j.setupStart>=j.machineFinishBefore&&j.setupStart>=0));
 }
});
test('exact search for all 3 benchmark cases agrees with original independent oracle',()=>{
 for(const p of [publicProblem,...hiddenProblems]){
  const r=searchBestCandidate(p);const oracle=exactOracle(p);
  assert.equal(r.ok,true);assert.equal(r.cost,oracle.cost);
  assert.equal(grade(p,{schedule:r.schedule,cost:r.cost}).passed,true);
 }
});
