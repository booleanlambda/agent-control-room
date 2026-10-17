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
