import test from 'node:test';
import assert from 'node:assert/strict';
import {publicProblem,hiddenProblems,digest,exactOracle,grade,evaluate} from './benchmark.mjs';
const cases=[publicProblem,...hiddenProblems];
test('all three cases are nontrivial with strictly POSITIVE exact weighted costs',()=>{
 for(const p of cases){const o=exactOracle(p);assert.ok(o.cost>=15,JSON.stringify({cost:o.cost}));
  assert.equal(grade(p,{schedule:o.schedule,cost:o.cost}).passed,true);
 }
});
test('three independently different materials',()=>assert.equal(new Set(cases.map(digest)).size,3));
test('forged numeric cost rejected',()=>{
 const o=exactOracle(publicProblem);assert.equal(grade(publicProblem,{schedule:o.schedule,cost:o.cost-1}).passed,false);
});
test('parent missing rejected',()=>{
 const o=exactOracle(publicProblem);const schedule=structuredClone(o.schedule);
 const x=schedule.findIndex(j=>j.id==='J0');schedule.splice(x,1);
 assert.equal(evaluate(publicProblem,{schedule,cost:o.cost}).ok,false);
});
test('hard maintenance window violation rejected',()=>{
 const o=exactOracle(publicProblem);const schedule=structuredClone(o.schedule);
 const j=schedule.find(j=>j.machine==='M0');assert.ok(j);
 j.start=7;
 assert.equal(evaluate(publicProblem,{schedule,cost:o.cost}).ok,false);
});
test('one job missing rejected',()=>{
 const o=exactOracle(publicProblem);assert.equal(grade(publicProblem,{schedule:o.schedule.slice(0,-1),cost:o.cost}).passed,false);
});
test('wrong machine type rejected',()=>{
 const o=exactOracle(publicProblem);const schedule=structuredClone(o.schedule);
 schedule.find(j=>j.id==='J2').machine='M0';
 assert.equal(evaluate(publicProblem,{schedule,cost:o.cost}).ok,false);
});
test('submission with noninteger start rejected',()=>{
 const o=exactOracle(publicProblem);const schedule=structuredClone(o.schedule);schedule[0].start=1.5;
 assert.equal(grade(publicProblem,{schedule,cost:o.cost}).passed,false);
});

test('precise public predecessor counterexample identifies correct job and completion time',()=>{
 const p={machines:[{id:'M0',types:['a','b'],initialType:'a',setup:2,activation:1,maintenance:[]},
                    {id:'M1',types:['b'],initialType:'b',setup:2,activation:1,maintenance:[]}],
 jobs:[{id:'A',type:'a',duration:4,release:0,due:20,weight:2,parents:[]},
       {id:'B',type:'b',duration:3,release:0,due:20,weight:2,parents:['A']}]};
 const s={schedule:[{id:'A',machine:'M0',start:0},{id:'B',machine:'M1',start:3}],cost:2};
 const v=grade(p,s);assert.equal(v.passed,false);assert.equal(v.reason,'release_dependency_or_setup');
 assert.equal(v.failure.jobId,'B');assert.equal(v.failure.machineId,'M1');
 assert.equal(v.failure.actualStart,3);assert.equal(v.failure.requiredPredecessorFinish,4);
 assert.deepEqual(v.failure.predecessors,[{id:'A',finishedAt:4}]);
 assert.deepEqual(v.failure.violatedConstraints,['before_predecessor_finish']);
 assert.equal(v.failure.minimumWorkStart,4);
 assert.equal(v.failure.setupDuration,0);assert.equal(v.failure.previousMachineFinish,0);
 assert.equal(v.failure.actualSetupStart,3);
});
test('precise setup counterexample identifies setup overlap on same machine',()=>{
 const p={machines:[{id:'M0',types:['a','b'],initialType:'a',setup:2,activation:1,maintenance:[]}],
 jobs:[{id:'A',type:'a',duration:4,release:0,due:20,weight:1,parents:[]},
       {id:'B',type:'b',duration:2,release:0,due:20,weight:1,parents:[]}]};
 const v=grade(p,{schedule:[{id:'A',machine:'M0',start:0},{id:'B',machine:'M0',start:5}],cost:0});
 assert.equal(v.reason,'release_dependency_or_setup');assert.equal(v.failure.jobId,'B');
 assert.equal(v.failure.previousMachineFinish,4);assert.equal(v.failure.setupDuration,2);
 assert.equal(v.failure.actualSetupStart,3);assert.equal(v.failure.minimumWorkStart,6);
 assert.deepEqual(v.failure.violatedConstraints,['machine_or_setup_overlap']);
});
test('release violation provides exact required release',()=>{
 const p={machines:[{id:'M0',types:['a'],initialType:'a',setup:0,activation:1,maintenance:[]}],
 jobs:[{id:'A',type:'a',duration:2,release:7,due:10,weight:3,parents:[]}]};
 const v=grade(p,{schedule:[{id:'A',machine:'M0',start:6}],cost:1});
 assert.equal(v.failure.jobRelease,7);assert.equal(v.failure.actualStart,6);
 assert.deepEqual(v.failure.violatedConstraints,['before_release']);
});
test('maintenance conflicts report intersecting exact downtime windows',()=>{
 const p={machines:[{id:'M0',types:['a'],initialType:'a',setup:0,activation:1,maintenance:[[3,9]]}],
 jobs:[{id:'A',type:'a',duration:4,release:0,due:10,weight:2,parents:[]}]};
 const v=grade(p,{schedule:[{id:'A',machine:'M0',start:2}],cost:1});
 assert.equal(v.reason,'maintenance_overlap');assert.equal(v.failure.jobId,'A');
 assert.deepEqual(v.failure.overlappingWindows,[[3,9]]);
});
test('valid oracle witnesses remain independently verifiable and contain no diagnostic leak',()=>{
 for(const p of [publicProblem,...hiddenProblems]){
  const o=exactOracle(p);const v=grade(p,{schedule:o.schedule,cost:o.cost});
  assert.equal(v.passed,true);assert.equal('failure' in v,false);
 }
});
