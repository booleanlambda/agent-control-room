import test from 'node:test';
import assert from 'node:assert/strict';
import {TASKS,oracle,check,grade} from './unseen-python-benchmarks.mjs';
const expected={
 assignment:[{cost:90,count:168},{cost:99,count:878}],
 routing:[{cost:40},{cost:39}],
 'number-theory':[{score:378,count:3,triple:[4,10,6]},
   {score:519,count:6,triple:[12,7,8]}],
};
test('all three genuinely distinct task families have two feasible, different instances',()=>{
 assert.deepEqual(TASKS.map(x=>x.id),['assignment','routing','number-theory']);
 for(const task of TASKS)assert.notDeepEqual(task.public,task.hidden);
});
for(const task of TASKS)for(const [i,key] of ['public','hidden'].entries()){
 test(task.id+' '+key+' sealed oracle is feasible and accepted by independent checker',()=>{
  const input=task[key],r=oracle(task.id,input),e=expected[task.id][i];
  for(const [k,v] of Object.entries(e))assert.deepEqual(r[k],v);
  let output=null;
  if(task.id==='assignment')output={cost:r.cost,assignment:r.optimal};
  if(task.id==='routing')output={cost:r.cost,path:r.path,charges:r.charges};
  if(task.id==='number-theory')output={score:r.score,count:r.count,triple:r.triple};
  const c=check(task.id,input,output),g=grade(task.id,input,output);
  assert.equal(c.ok,true,JSON.stringify({task:task.id,key,c}));
  assert.equal(g.passed,true,JSON.stringify({task:task.id,key,g}));
 });
 test(task.id+' '+key+' mutated claimed cost or infeasible schedule is rejected',()=>{
  const r=oracle(task.id,task[key]);
  let candidate=task.id==='assignment'?{cost:r.cost+1,assignment:r.optimal}:
   task.id==='routing'?{cost:r.cost+1,path:r.path,charges:r.charges}:
   {score:r.score+1,count:r.count,triple:r.triple};
  assert.equal(grade(task.id,task[key],candidate).passed,false);
 });
}
