import {createHash} from 'node:crypto';
const copy=x=>structuredClone(x);
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const machines=[
 {id:'M0',types:['a','b'],initialType:'a',setup:2,activation:6,maintenance:[[7,10],[19,22]]},
 {id:'M1',types:['b','c'],initialType:'c',setup:3,activation:4,maintenance:[[5,8],[20,23]]}
];
const jobs=[
 {id:'J0',type:'a',duration:4,release:0,due:4,weight:6,parents:[]},
 {id:'J1',type:'b',duration:3,release:0,due:4,weight:7,parents:[]},
 {id:'J2',type:'c',duration:4,release:1,due:7,weight:5,parents:['J1']},
 {id:'J3',type:'a',duration:3,release:2,due:8,weight:4,parents:['J0']},
 {id:'J4',type:'b',duration:4,release:1,due:9,weight:7,parents:['J0','J1']},
 {id:'J5',type:'c',duration:2,release:3,due:10,weight:8,parents:['J2','J4']},
 {id:'J6',type:'b',duration:3,release:4,due:12,weight:6,parents:['J3']}
];
export const publicProblem={machines:copy(machines),jobs:copy(jobs)};
const hidden1=copy(publicProblem);
hidden1.machines[0].maintenance=[[5,9],[20,24]];
hidden1.machines[1].maintenance=[[6,10],[18,23]];
hidden1.jobs[0].duration=5;hidden1.jobs[2].release=3;hidden1.jobs[6].due=9;
const hidden2=copy(publicProblem);
hidden2.machines[0].setup=4;hidden2.machines[0].maintenance=[[6,11],[17,21]];
hidden2.machines[1].setup=2;hidden2.machines[1].activation=8;
hidden2.jobs[1].duration=5;hidden2.jobs[4].duration=5;hidden2.jobs[5].due=8;
export const hiddenProblems=[hidden1,hidden2];
export const specification={
 task:'Globally minimize weighted lateness plus machine activation fees for precedence-constrained jobs on two different machines with setup times and hard maintenance outages.',
 input:'One JSON object: {machines:[{id,types,initialType,setup,activation,maintenance:[[begin,end],...]}],jobs:[{id,type,duration,release,due,weight,parents:[id,...]}]}. All times are integers.',
 output:'Exactly one JSON object with {"schedule":[{"id":"J0","machine":"M0","start":0},...],"cost":INTEGER}. The schedule must include each job exactly once, ordered so all parents appear earlier in the array.',
 rules:[
  'Job may run only on a machine whose types include the job type. There is one machine per id. Every machine starts idle at time zero and its previous type is initialType.',
  'Before each job on that machine, when its type differs from the previous job type, a SETUP of machine.setup whole time units occurs immediately before job work; matching types require zero setup.',
  'Machine occupied continuously from workStart minus setup until workStart plus duration. Setup must occur after previous job on machine ends.',
  'A machine may not perform setup OR process a job at ANY point inside any of its maintenance intervals [begin,end). Two machine blocks must not overlap.',
  'Job workStart must be at least its release and after completion of all its parent jobs. Parents may be on other machines. Work finishes at start+duration.',
  'Weighted lateness contribution is max(0,finish-due)*weight. Activation fee of machine.activation is paid ONCE iff machine executes one or more jobs. Objective=sum lateness contributions + activation fees.',
  'Time is integer. A machine may wait idle without penalty. Zero-length setup allowed. Find a globally optimal feasible witness, not merely any valid schedule.',
  'Use Python 3 standard library, read one JSON input from stdin and output one JSON object. Hidden inputs change releases, durations, maintenance and setup; do not hardcode example.'
 ]};
function intersects(begin,end,intervals){return intervals.some(([x,y])=>begin<y&&end>x);}
function earliest(p,m,prevType,clock,job,parentsEnd){
 const setup=prevType===job.type?0:m.setup;
 let start=Math.max(job.release,parentsEnd,clock+setup);
 for(let k=0;k<2000;k++,start++){
  if(!intersects(start-setup,start+job.duration,m.maintenance))return start;
 }
 throw Error('NO_VALID_INTERVAL');
}
export function evaluate(p,answer){
 if(!answer||!Array.isArray(answer.schedule)||answer.schedule.length!==p.jobs.length)return {ok:false,reason:'wrong_schedule_length'};
 const state=new Map(p.machines.map(m=>[m.id,{clock:0,previous:m.initialType,count:0}]));
 const done=new Map(),all=new Map(p.jobs.map(j=>[j.id,j]));let cost=0;
 for(const e of answer.schedule){
  const j=all.get(e?.id),m=p.machines.find(x=>x.id===e?.machine);
  if(!j||!m||!Number.isSafeInteger(e?.start)||e.start<0||done.has(j.id))return {ok:false,reason:'invalid_entry'};
  const st=state.get(m.id);
  if(!m.types.includes(j.type))return {ok:false,reason:'machine_ineligible'};
  if(!j.parents.every(id=>done.has(id)))return {ok:false,reason:'parent_missing'};
  const par=Math.max(0,...j.parents.map(id=>done.get(id)));
  const setup=st.previous===j.type?0:m.setup,begin=e.start-setup,end=e.start+j.duration;
  if(e.start<j.release||e.start<par||begin<st.clock)return {ok:false,reason:'release_dependency_or_setup'};
  if(intersects(begin,end,m.maintenance))return {ok:false,reason:'maintenance_overlap'};
  if(st.count===0)cost+=m.activation;
  cost+=Math.max(0,end-j.due)*j.weight;
  st.count++;st.clock=end;st.previous=j.type;done.set(j.id,end);
 }
 return {ok:true,cost};
}
export function exactOracle(p){
 if(p.jobs.length>8||p.machines.length!==2)throw Error('oracle_scope');
 let best=Infinity,witness=null,explored=0;
 const done=new Map(),st=p.machines.map(m=>({clock:0,previous:m.initialType,count:0})),schedule=[];
 function dfs(cost){
  if(cost>=best)return;
  if(done.size===p.jobs.length){best=cost;witness=schedule.slice();explored++;return;}
  for(const j of p.jobs){
   if(done.has(j.id)||j.parents.some(id=>!done.has(id)))continue;
   const parentEnd=Math.max(0,...j.parents.map(id=>done.get(id)));
   for(let i=0;i<p.machines.length;i++){
    const m=p.machines[i],s=st[i];if(!m.types.includes(j.type))continue;
    const start=earliest(p,m,s.previous,s.clock,j,parentEnd);
    const finish=start+j.duration;
    const delta=Math.max(0,finish-j.due)*j.weight+(s.count===0?m.activation:0);
    const prev={...s};s.clock=finish;s.previous=j.type;s.count++;done.set(j.id,finish);
    schedule.push({id:j.id,machine:m.id,start});dfs(cost+delta);
    schedule.pop();done.delete(j.id);Object.assign(s,prev);
   }
  }
 }dfs(0);
 if(!Number.isFinite(best)||!witness)throw Error('no_solution');
 return {cost:best,schedule:witness,explored};
}
export function grade(p,answer){
 const v=evaluate(p,answer);if(!v.ok)return {passed:false,reason:v.reason};
 if(!Number.isSafeInteger(answer.cost)||answer.cost!==v.cost)return {passed:false,reason:'wrong_claimed_cost',actual:v.cost};
 const exact=exactOracle(p);return {passed:exact.cost===v.cost,reason:exact.cost===v.cost?'optimal':'feasible_suboptimal',actual:v.cost,optimum:exact.cost};
}
