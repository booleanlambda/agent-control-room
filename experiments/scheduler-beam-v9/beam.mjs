// AAU v9: bounded model-independent beam search and exact small-job fallback.
// Kimi supplies assignment/order ONLY; trusted v7 kernel supplies clocks/cost.
import {createHash} from 'node:crypto';
import {scheduleCandidate,searchBestCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const cloned=p=>({jobs:p.jobs.map(j=>({id:j.id,machine:j.machine}))});
function* neighborhood(problem,proposal) {
 const a=proposal.jobs,n=a.length;
 // Reassign a job to another eligible machine.
 for(let i=0;i<n;i++){
  const job=problem.jobs.find(j=>j.id===a[i].id);
  if(!job)continue;
  for(const machine of problem.machines)if(machine.id!==a[i].machine&&machine.types.includes(job.type)){
   const b=cloned(proposal);b.jobs[i].machine=machine.id;
   yield {candidate:b,move:{type:'reassign',id:job.id,to:machine.id}};
  }
 }
 // Relocation changes precedence-sensitive order; invalid ones are rejected.
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j){
  const b=cloned(proposal),[item]=b.jobs.splice(i,1);b.jobs.splice(j,0,item);
  yield {candidate:b,move:{type:'relocate',id:item.id,from:i,to:j}};
 }
 // Pair swap helps cross assignment/order energy barriers.
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  const b=cloned(proposal);[b.jobs[i],b.jobs[j]]=[b.jobs[j],b.jobs[i]];
  yield {candidate:b,move:{type:'swap',left:a[i].id,right:a[j].id}};
 }
}
const byCost=(a,b)=>a.cost-b.cost||(a.key<b.key?-1:a.key>b.key?1:0);
export function beamOptimize(problem,seeds,{maxEvaluations=1200,beamWidth=10,maxDepth=9}={}){
 if(!Array.isArray(seeds)||seeds.length===0||seeds.length>20||![maxEvaluations,beamWidth,maxDepth].every(Number.isSafeInteger)||
  maxEvaluations<0||maxEvaluations>20000||beamWidth<1||beamWidth>64||maxDepth<0||maxDepth>32)
  throw Error('INVALID_BEAM_BUDGET');
 const seen=new Set(),initial=[],rejections=[];let evaluations=0,validEvaluations=0;
 for(let index=0;index<seeds.length;index++){
  const candidate=cloned(seeds[index]);const key=hash(candidate);
  if(seen.has(key))continue;seen.add(key);
  const schedule=scheduleCandidate(problem,candidate);
  if(!schedule.ok){rejections.push({seed:index,reason:schedule.reason});continue;}
  initial.push({proposal:candidate,cost:schedule.cost,schedule,key,source:'seed_'+index});
 }
 if(!initial.length)return {ok:false,reason:'NO_VALID_SEED',rejections};
 initial.sort(byCost);
 const seedBest=initial[0],allInitial=initial.map(x=>({source:x.source,cost:x.cost,key:x.key}));
 let best=seedBest,frontier=initial.slice(0,beamWidth),depth=0;
 const trace=[],passes=[];
 while(depth<maxDepth&&evaluations<maxEvaluations&&frontier.length){
  const next=[];
  for(const parent of frontier){
   for(const {candidate,move} of neighborhood(problem,parent.proposal)){
    if(evaluations>=maxEvaluations)break;
    const key=hash(candidate);if(seen.has(key))continue;
    seen.add(key);evaluations++;
    const schedule=scheduleCandidate(problem,candidate);
    if(!schedule.ok)continue;
    validEvaluations++;
    const state={proposal:candidate,cost:schedule.cost,schedule,key,source:'beam'};
    next.push(state);
    if(byCost(state,best)<0){
     const old=best.cost;best=state;
     trace.push({depth:depth+1,move,oldCost:old,newCost:state.cost,
      proposalHash:key,ledgerHash:schedule.evidence.ledgerDigest});
    }
   }
   if(evaluations>=maxEvaluations)break;
  }
  if(!next.length)break;
  next.sort(byCost);
  frontier=next.slice(0,beamWidth);
  depth++;
  passes.push({depth,expanded:next.length,frontierCosts:frontier.map(x=>x.cost),
   globalBest:best.cost,visited:seen.size});
 }
 return {ok:true,baselineCost:seedBest.cost,finalCost:best.cost,
  optimalityClaim:false,proposal:best.proposal,execution:best.schedule,
  evaluations,validEvaluations,depth,beamWidth,maxDepth,maxEvaluations,
  initialCosts:allInitial,trace,passes,validSeeds:initial.length,rejectedSeeds:rejections,
  truncatedByEvaluationBudget:maxEvaluations>0&&evaluations>=maxEvaluations,
  evidence:{seedHash:hash(allInitial),proposalHash:best.key,ledgerHash:best.schedule.evidence.ledgerDigest,
   traceHash:hash(trace),passesHash:hash(passes)}};
}
// Small instances only. This function is exact only within v7's defined scope;
// its result MUST still be verified independently by the v6 exhaustive oracle.
export function exactSmall(problem,{jobCeiling=8}={}){
 if(!Number.isSafeInteger(jobCeiling)||jobCeiling<0||jobCeiling>8)throw Error('INVALID_EXACT_CEILING');
 if(!Array.isArray(problem?.jobs)||problem.jobs.length>jobCeiling)
  return {ok:false,reason:'EXACT_SCOPE_EXCEEDED',jobCeiling};
 const begun=process.hrtime.bigint();
 const result=searchBestCandidate(problem,{maxJobs:jobCeiling});
 const elapsedNs=Number(process.hrtime.bigint()-begun);
 if(!result.ok)return {...result,elapsedNs};
 return {ok:true,cost:result.cost,proposal:result.proposal,execution:result,
  searchedCompleteAssignments:result.enumeratedCompleteCandidates,elapsedNs,
  evidence:{proposalHash:hash(result.proposal),ledgerHash:result.evidence.ledgerDigest}};
}
