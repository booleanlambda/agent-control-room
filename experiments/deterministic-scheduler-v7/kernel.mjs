// AAU V7 — trusted, deterministic scheduling transition kernel.
// LLM supplies ONLY job order and machine allocation, never a clock or a cost.
// This module MUST remain independent of the reference grader and exact oracle.
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const integer=n=>Number.isSafeInteger(n);
const fail=(reason,detail={})=>({ok:false,reason,detail});
const overlaps=(start,end,a,b)=>start<b&&end>a;

function validateProblem(p){
 if(!p||!Array.isArray(p.machines)||!Array.isArray(p.jobs)||!p.machines.length||!p.jobs.length||p.jobs.length>64)return 'invalid_problem_size';
 const machineIds=new Set(),jobIds=new Set();
 for(const m of p.machines){
  if(typeof m.id!=='string'||!m.id||machineIds.has(m.id)||!Array.isArray(m.types)||!m.types.every(t=>typeof t==='string')||
    typeof m.initialType!=='string'||!integer(m.setup)||m.setup<0||!integer(m.activation)||m.activation<0||
    !Array.isArray(m.maintenance)||m.maintenance.some(w=>!Array.isArray(w)||w.length!==2||!w.every(integer)||w[0]<0||w[1]<=w[0]))
   return 'invalid_machine_definition';
  machineIds.add(m.id);
 }
 for(const j of p.jobs){
  if(typeof j.id!=='string'||!j.id||jobIds.has(j.id)||typeof j.type!=='string'||!integer(j.duration)||j.duration<=0||
   !integer(j.release)||j.release<0||!integer(j.due)||j.due<0||!integer(j.weight)||j.weight<0||
   !Array.isArray(j.parents)||!j.parents.every(x=>typeof x==='string')||new Set(j.parents).size!==j.parents.length)
   return 'invalid_job_definition';
  jobIds.add(j.id);
 }
 if(p.jobs.some(j=>j.parents.some(parent=>parent===j.id||!jobIds.has(parent))))return 'invalid_dependency_reference';
 return null;
}
// Work starts after all predecessors finish; prep is non-preemptible and
// IMMEDIATELY precedes work. Entire [workStart-setup, workStart+duration)
// must be outside every blackout. Time cannot go negative.
function earliestLegal(machine,last,job,parentsFinished){
 const setup=last.previousType===job.type?0:machine.setup;
 let start=Math.max(job.release,parentsFinished,last.finish+setup);
 const windows=machine.maintenance.slice().sort((a,b)=>a[0]-b[0]);
 for(let iteration=0;iteration<=windows.length+1;iteration++){
  const preparationStart=start-setup,finish=start+job.duration;
  const blocking=windows.find(([a,b])=>overlaps(preparationStart,finish,a,b));
  if(!blocking){
   if(preparationStart<last.finish||preparationStart<0)throw Error('NEGATIVE_OR_OVERLAPPING_SETUP');
   return {start,finish,setup,preparationStart};
  }
  start=Math.max(start+1,blocking[1]+setup,job.release,parentsFinished,last.finish+setup);
  if(!integer(start)||start>Number.MAX_SAFE_INTEGER-job.duration)throw Error('TIME_OVERFLOW');
 }
 throw Error('MAINTENANCE_SEARCH_DID_NOT_CONVERGE');
}
export function scheduleCandidate(problem,proposal){
 const bad=validateProblem(problem);if(bad)return fail(bad);
 if(!proposal||!Array.isArray(proposal.jobs)||proposal.jobs.length!==problem.jobs.length)
  return fail('wrong_number_of_jobs',{expected:problem.jobs.length,received:proposal?.jobs?.length??null});
 const jobs=new Map(problem.jobs.map(j=>[j.id,j]));
 const machines=new Map(problem.machines.map(m=>[m.id,m]));
 const states=new Map(problem.machines.map(m=>[m.id,{finish:0,previousType:m.initialType,count:0}]));
 const finished=new Map(),schedule=[],ledger=[];
 let cost=0;
 for(let index=0;index<proposal.jobs.length;index++){
  const e=proposal.jobs[index];
  if(!e||typeof e.id!=='string'||typeof e.machine!=='string'||Object.keys(e).some(k=>k!=='id'&&k!=='machine'))return fail('invalid_proposal_shape',{index});
  const job=jobs.get(e.id),machine=machines.get(e.machine);
  if(!job)return fail('unknown_job',{index,id:e.id});
  if(!machine)return fail('unknown_machine',{index,id:e.id,machine:e.machine});
  if(finished.has(job.id))return fail('duplicate_job',{index,id:job.id});
  if(!machine.types.includes(job.type))return fail('machine_ineligible',{index,id:job.id,machine:machine.id,type:job.type});
  const missing=job.parents.filter(id=>!finished.has(id));
  if(missing.length)return fail('parent_not_completed',{index,id:job.id,missing});
  const st=states.get(machine.id),parentsFinished=Math.max(0,...job.parents.map(id=>finished.get(id)));
  let timing;
  try{timing=earliestLegal(machine,st,job,parentsFinished);}
  catch(e){return fail('scheduling_overflow_or_invalid_windows',{index,id:job.id,detail:String(e?.message||e)})}
  const activation=st.count===0?machine.activation:0;
  const tardiness=Math.max(0,timing.finish-job.due)*job.weight;
  cost+=activation+tardiness;
  if(!integer(cost))return fail('cost_overflow',{index,id:job.id});
  schedule.push({id:job.id,machine:machine.id,start:timing.start});
  ledger.push({index,id:job.id,machine:machine.id,release:job.release,
   predecessors:job.parents.map(id=>({id,finish:finished.get(id)})),
   machineFinishBefore:st.finish,previousType:st.previousType,
   setup:timing.setup,setupStart:timing.preparationStart,start:timing.start,finish:timing.finish,
   activation,tardiness,totalCostAfter:cost});
  finished.set(job.id,timing.finish);
  st.finish=timing.finish;st.previousType=job.type;st.count++;
 }
 if(finished.size!==jobs.size)return fail('job_omitted');
 const evidence={problemDigest:hash(problem),proposalDigest:hash(proposal),scheduleDigest:hash(schedule),ledgerDigest:hash(ledger)};
 return {ok:true,schedule,cost,ledger,evidence};
}
// Optional exhaustive search for small instances. Exactness is independently
// certified by the separate reference oracle, NEVER by trusting this method.
export function searchBestCandidate(problem,{maxJobs=8}={}){
 const bad=validateProblem(problem);if(bad)return fail(bad);
 if(problem.jobs.length>maxJobs)return fail('search_scope_exceeded',{maxJobs});
 let best=Infinity,proposal=null,visited=0;
 const assigned=new Map(),sequence=[];
 const jobs=problem.jobs,machines=problem.machines;
 function dfs(){
  if(assigned.size===jobs.length){
   visited++;
   const run=scheduleCandidate(problem,{jobs:sequence});
   if(run.ok&&run.cost<best){best=run.cost;proposal={jobs:sequence.map(x=>({...x}))};}
   return;
  }
  for(const j of jobs){
   if(assigned.has(j.id)||j.parents.some(x=>!assigned.has(x)))continue;
   for(const m of machines){
    if(!m.types.includes(j.type))continue;
    assigned.set(j.id,m.id);sequence.push({id:j.id,machine:m.id});
    dfs();
    sequence.pop();assigned.delete(j.id);
   }
  }
 }
 dfs();
 if(!proposal)return fail('no_feasible_assignment');
 const result=scheduleCandidate(problem,proposal);
 return {...result,proposal,enumeratedCompleteCandidates:visited,internallySearchedMinimum:best};
}
