import test from 'node:test';
import assert from 'node:assert/strict';
import {TASKS,sha} from './benchmark.mjs';
for(const task of TASKS){
 test(task.id+': three independent exact feasible witnesses',()=>{
  for(const input of [task.publicInput,...task.hiddenInputs]){
   const truth=task.oracle(input);
   assert.ok(Number.isInteger(truth.cost));
   const x=task.id.startsWith('precedence')?{schedule:truth.schedule,cost:truth.cost}:{actions:truth.actions,cost:truth.cost};
   assert.equal(task.grade(input,x).passed,true);
  }
 });
 test(task.id+': reject fabricated cost',()=>{
  const truth=task.oracle(task.publicInput);
  const x=task.id.startsWith('precedence')?{schedule:truth.schedule,cost:truth.cost+1}:{actions:truth.actions,cost:truth.cost+1};
  assert.equal(task.grade(task.publicInput,x).passed,false);
 });
 test(task.id+': reject missing output',()=>assert.equal(task.grade(task.publicInput,{}).passed,false));
 test(task.id+': hidden variants distinct',()=>assert.equal(new Set([task.publicInput,...task.hiddenInputs].map(sha)).size,3));
}
test('reject scheduling order that violates predecessors',()=>{
 const task=TASKS[0];
 const bad={schedule:[{id:'J2',machine:'M1',start:0},...task.oracle(task.publicInput).schedule],cost:0};
 assert.equal(task.grade(task.publicInput,bad).passed,false);
});
test('reject graph charge at noncharger',()=>{
 const task=TASKS[1];
 assert.equal(task.grade(task.publicInput,{actions:[{type:'charge',at:'S'}],cost:0}).passed,false);
});
