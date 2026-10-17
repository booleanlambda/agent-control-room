import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleCandidate,searchBestCandidate} from './kernel.mjs';
import {publicProblem,hiddenProblems,exactOracle,grade,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
const fixture=(jobs,machines)=>({jobs,machines});
const mach=(id,types,initialType,setup=0,activation=0,maintenance=[])=>({id,types,initialType,setup,activation,maintenance});
const job=(id,type,duration,release=0,due=20,weight=1,parents=[])=>({id,type,duration,release,due,weight,parents});
const run=(p,jobs)=>scheduleCandidate(p,{jobs});
const score=(p,x)=>{const valid=evaluate(p,{schedule:x.schedule,cost:x.cost});if(!valid.ok||valid.cost!==x.cost)return {passed:false};return p.machines.length===2?grade(p,{schedule:x.schedule,cost:x.cost}):{passed:true};};
test('V7 exact independent public and both hidden positive-cost benchmarks',()=>{
 for(const p of [publicProblem,...hiddenProblems]){
  const witness=searchBestCandidate(p);
  assert.equal(witness.ok,true,JSON.stringify(witness));
  const oracle=exactOracle(p);
  assert.ok(oracle.cost>=15);
  assert.equal(witness.cost,oracle.cost);
  assert.equal(score(p,witness).passed,true);
  assert.equal(witness.evidence.problemDigest.length,64);
  assert.equal(witness.schedule.length,p.jobs.length);
  assert.ok(witness.ledger.every(x=>x.setupStart>=x.machineFinishBefore&&x.setupStart>=0));
 }
});
test('no setup may begin before time zero, even first use',()=>{
 const p=fixture([job('J','b',3,0)], [mach('M',['a','b'],'a',3,5)]);
 const a=run(p,[{id:'J',machine:'M'}]);
 assert.equal(a.ok,true);
 assert.equal(a.schedule[0].start,3);
 assert.equal(a.ledger[0].setupStart,0);
 assert.equal(a.ledger[0].setup,3);
 assert.equal(a.cost,5);
 assert.equal(score(p,a).passed,true);
});
test('cross-machine parent must have completed, not merely started',()=>{
 const p=fixture([job('P','a',15,0),job('C','b',2,0,8,4,['P'])],
  [mach('A',['a'],'a'),mach('B',['b'],'b')]);
 const a=run(p,[{id:'P',machine:'A'},{id:'C',machine:'B'}]);
 assert.equal(a.ok,true);
 assert.equal(a.schedule[1].start,15);
 assert.equal(a.ledger[1].predecessors[0].finish,15);
 assert.equal(score(p,a).passed,true);
});
test('maintenance blackout covers setup plus processing',()=>{
 const p=fixture([job('X','b',4,0,20,1)],
  [mach('M',['a','b'],'a',2,0,[[3,9]])]);
 const a=run(p,[{id:'X',machine:'M'}]);
 assert.equal(a.ok,true);
 assert.equal(a.ledger[0].setupStart,9);
 assert.equal(a.schedule[0].start,11);
 assert.equal(a.ledger[0].finish,15);
 assert.equal(score(p,a).passed,true);
});
test('overlapping unsorted maintenance intervals are handled',()=>{
 const p=fixture([job('X','b',3)],[mach('M',['a','b'],'a',2,0,[[10,16],[2,7],[6,12]])]);
 const a=run(p,[{id:'X',machine:'M'}]);
 assert.equal(a.ok,true);assert.equal(a.schedule[0].start,18);assert.equal(score(p,a).passed,true);
});
test('consecutive setup transitions respect previous finish',()=>{
 const p=fixture([job('A','a',3),job('B','b',2),job('C','a',4)],
  [mach('M',['a','b'],'a',2)]);
 const a=run(p,[{id:'A',machine:'M'},{id:'B',machine:'M'},{id:'C',machine:'M'}]);
 assert.deepEqual(a.schedule.map(x=>x.start),[0,5,9]);
 assert.deepEqual(a.ledger.map(x=>x.setupStart),[0,3,7]);
 assert.equal(score(p,a).passed,true);
});
test('no setup when last type matches; release and predecessor still apply',()=>{
 const p=fixture([job('A','a',3,0),job('B','a',2,10,13,5,['A'])],[mach('M',['a'],'a',99)]);
 const a=run(p,[{id:'A',machine:'M'},{id:'B',machine:'M'}]);
 assert.equal(a.ok,true);assert.deepEqual(a.schedule.map(x=>x.start),[0,10]);
 assert.equal(a.ledger[1].setup,0);assert.equal(score(p,a).passed,true);
});
test('activation fee charged only once for each active machine',()=>{
 const p=fixture([job('A','a',1),job('B','a',1),job('C','b',1)],
 [mach('M0',['a'],'a',0,5),mach('M1',['b'],'b',0,7)]);
 const a=run(p,[{id:'A',machine:'M0'},{id:'B',machine:'M0'},{id:'C',machine:'M1'}]);
 assert.equal(a.cost,12);assert.deepEqual(a.ledger.map(x=>x.activation),[5,0,7]);
 assert.equal(score(p,a).passed,true);
});
test('reject late dependency, duplicate or missing assignment and ineligible machines',()=>{
 const p=fixture([job('A','a',2),job('B','b',2,0,10,2,['A'])],
 [mach('M0',['a'],'a'),mach('M1',['b'],'b')]);
 assert.equal(run(p,[{id:'B',machine:'M1'},{id:'A',machine:'M0'}]).reason,'parent_not_completed');
 assert.equal(run(p,[{id:'A',machine:'M0'},{id:'A',machine:'M0'}]).reason,'duplicate_job');
 assert.equal(run(p,[{id:'A',machine:'M0'}]).reason,'wrong_number_of_jobs');
 assert.equal(run(p,[{id:'A',machine:'M1'},{id:'B',machine:'M1'}]).reason,'machine_ineligible');
});
test('model may not provide start, finish or trusted cost as executable state',()=>{
 const p=fixture([job('A','a',3)],[mach('M',['a'],'a')]);
 assert.equal(run(p,[{id:'A',machine:'M',start:-99}]).reason,'invalid_proposal_shape');
 assert.equal(run(p,[{id:'A',machine:'M',cost:0}]).reason,'invalid_proposal_shape');
});
test('validate invalid model input and problem graph',()=>{
 const p=fixture([job('A','a',3,0,5,2,['X'])],[mach('M',['a'],'a')]);
 assert.equal(run(p,[{id:'A',machine:'M'}]).reason,'invalid_dependency_reference');
});
test('deterministic replay identical, including hashes and ledger',()=>{
 const p=publicProblem,proposal={jobs:exactOracle(p).schedule.map(x=>({id:x.id,machine:x.machine}))};
 const a=scheduleCandidate(p,proposal),b=scheduleCandidate(p,structuredClone(proposal));
 assert.equal(a.ok,true);assert.deepEqual(a,b);
 assert.equal(score(p,a).passed,true);
});
test('randomized small positive-penalty schedules independently agree with exact exhaustive oracle',()=>{
 let seed=27719;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const int=(a,b)=>a+Math.floor(rnd()*(b-a+1));
 for(let i=0;i<24;i++){
  const p=fixture([],[mach('M0',['a','b'],'a',int(0,3),int(1,7),[[int(5,7),int(9,13)]]),
     mach('M1',['a','b'],'b',int(0,3),int(1,7),[[int(4,6),int(8,12)]])]);
  for(let j=0;j<4;j++){
   const parents=j>0&&rnd()<0.45?['J'+int(0,j-1)]:[];
   p.jobs.push(job('J'+j,rnd()<0.5?'a':'b',int(1,5),int(0,6),int(0,10),int(1,8),parents));
  }
  const candidate=searchBestCandidate(p);
  const oracle=exactOracle(p);
  assert.equal(candidate.ok,true);
  assert.equal(candidate.cost,oracle.cost,'mismatch seed case '+i);
  assert.equal(score(p,candidate).passed,true);
  assert.ok(candidate.ledger.every(x=>x.setupStart>=0&&x.setupStart>=x.machineFinishBefore));
 }
});
