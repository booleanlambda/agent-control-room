// Deterministic root partition of every admissible topological order and eligible
// machine assignment. Each root identifies a disjoint exact subspace of schedules.
import {createHash} from 'node:crypto';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function rootPartitions(p){
 if(!p||p.jobs.length>8||p.machines.length!==2)throw Error('ROOT_PARTITION_SCOPE');
 const roots=[];
 for(const j of p.jobs){
  if(j.parents.length)continue;
  for(const m of p.machines)if(m.types.includes(j.type)){
   roots.push({id:j.id+'@'+m.id,entry:{id:j.id,machine:m.id}});
  }
 }
 if(!roots.length)throw Error('NO_ROOT_PARTITIONS');
 return roots;
}
export function solvePartition(p,root,{maxLeaves=50000}={}){
 if(!Number.isSafeInteger(maxLeaves)||maxLeaves<1)throw Error('BAD_LEAF_BUDGET');
 const candidates=new Map(p.jobs.map(j=>[j.id,j]));
 if(!candidates.has(root.id)||!p.machines.some(m=>m.id===root.machine&&m.types.includes(candidates.get(root.id).type))||
    candidates.get(root.id).parents.length)throw Error('INVALID_ROOT');
 const selected=new Set([root.id]),path=[{id:root.id,machine:root.machine}];
 let explored=0,best=null;
 const dfs=()=>{
  if(selected.size===p.jobs.length){
   if(explored>=maxLeaves)throw Error('PARTITION_BUDGET_EXHAUSTED_NO_PROOF');
   const proposal={jobs:path.map(x=>({...x}))};
   const checked=scheduleCandidate(p,proposal);
   if(!checked.ok)throw Error('TRUSTED_KERNEL_REJECTED_EXHAUSTIVE_BRANCH:'+checked.reason);
   explored++;
   if(!best||checked.cost<best.cost)best={cost:checked.cost,
     schedule:checked.schedule,proposal,ledgerHash:checked.evidence.ledgerDigest};
   return;
  }
  for(const job of p.jobs){
   if(selected.has(job.id)||job.parents.some(id=>!selected.has(id)))continue;
   for(const machine of p.machines){
    if(!machine.types.includes(job.type))continue;
    selected.add(job.id);path.push({id:job.id,machine:machine.id});
    dfs();
    path.pop();selected.delete(job.id);
   }
  }
 };
 dfs();
 if(!best||explored===0)throw Error('NO_COMPLETE_BRANCH');
 return {root,explored,...best,proof: digest({root,explored,bestCost:best.cost,proposal:best.proposal,ledgerHash:best.ledgerHash})};
}
