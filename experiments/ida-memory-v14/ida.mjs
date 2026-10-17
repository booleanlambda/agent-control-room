// AAU V14: memory-bounded IDA* branch and bound; frontier never materialized.
import {createHash} from 'node:crypto';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function legalTransition(job,m,ms,parentsDone){
 const setup=ms.last===job.type?0:m.setup;
 let start=Math.max(job.release,parentsDone,ms.clock+setup);
 const windows=m.maintenance.slice().sort((a,b)=>a[0]-b[0]);
 for(let attempt=0;attempt<=windows.length+2;attempt++){
  const from=start-setup,end=start+job.duration;
  const blocked=windows.find(([a,b])=>start-setup<b&&end>a);
  if(!blocked)return {start,finish:end,setupStart:from,setup};
  start=Math.max(start+1,blocked[1]+setup);
 }
 throw Error('TRANSITION_MAINTENANCE_NONCONVERGENCE');
}
function activationRemaining(p,state){
 const needed=[...new Set(p.jobs.filter((j,i)=>!(state.mask&(1<<i))).map(j=>j.type))];
 const already=new Set();
 p.machines.forEach((m,i)=>{if(state.machines[i].used)for(const t of m.types)already.add(t)});
 const notCovered=needed.filter(t=>!already.has(t));
 if(!notCovered.length)return 0;
 const available=p.machines.map((m,i)=>({m,i})).filter(({i})=>!state.machines[i].used);
 let best=Infinity;
 for(let subset=1;subset<(1<<available.length);subset++){
  let charge=0,covered=new Set(already);
  for(let k=0;k<available.length;k++)if(subset&(1<<k)){
   charge+=available[k].m.activation;
   for(const t of available[k].m.types)covered.add(t);
  }
  if(notCovered.every(t=>covered.has(t)))best=Math.min(best,charge);
 }
 if(!Number.isFinite(best))throw Error('NO_MACHINE_COVER');
 return best;
}
function relaxedBound(p,state,topo,mode){
 const finished=state.ends.slice();
 let pendingTardiness=0;
 for(const i of topo){
  if(state.mask&(1<<i))continue;
  const job=p.jobs[i];
  const parentFinish=Math.max(0,...job.parents.map(id=>finished[p.jobs.findIndex(j=>j.id===id)]));
  let earliest=Infinity;
  for(let k=0;k<p.machines.length;k++){
   const m=p.machines[k],ms=state.machines[k];
   if(m.types.includes(job.type))
    earliest=Math.min(earliest,ms.clock+(ms.last===job.type?0:m.setup));
  }
  if(!Number.isFinite(earliest))throw Error('NO_MACHINE_TYPE');
  const end=Math.max(job.release,parentFinish,earliest)+job.duration;
  finished[i]=end;
  pendingTardiness+=Math.max(0,end-job.due)*job.weight;
 }
 const additionalActivation=activationRemaining(p,state);
 const forced=mode==='forced_rank'?forcedRankBound(p,state,finished):pendingTardiness;
 return state.cost+Math.max(pendingTardiness,forced)+additionalActivation;
}
// Safe additive relaxation for jobs that have EXACTLY ONE eligible machine.
// For each forced machine, the k-th forced job completed cannot finish before
// (machine ready + sum of k shortest forced durations). Min-cost subset DP
// assigns each forced job a completion rank. Precedence remains relaxed here,
// so every result is a true lower bound. Flexible jobs retain independent
// earliest-finish bounds. This DP never replaces real scheduling transitions.
function forcedRankBound(p,state,optimisticFinish){
 const groups=p.machines.map(()=>[]),flexible=[];
 for(let i=0;i<p.jobs.length;i++){
  if(state.mask&(1<<i))continue;
  const j=p.jobs[i],eligible=[];
  p.machines.forEach((m,k)=>{if(m.types.includes(j.type))eligible.push(k)});
  if(eligible.length===1)groups[eligible[0]].push(i);
  else flexible.push(i);
 }
 let total=0;
 for(const i of flexible){
  const j=p.jobs[i];
  total+=Math.max(0,optimisticFinish[i]-j.due)*j.weight;
 }
 for(let machine=0;machine<groups.length;machine++){
  const indices=groups[machine],n=indices.length;
  if(!n)continue;
  if(n>9){ // bound evaluation must remain capped; fall back to safe independent costs
   for(const i of indices){const j=p.jobs[i];total+=Math.max(0,optimisticFinish[i]-j.due)*j.weight}
   continue;
  }
  const durations=indices.map(i=>p.jobs[i].duration).sort((a,b)=>a-b),rankMin=[0];
  for(let r=0;r<n;r++)rankMin.push(rankMin[r]+durations[r]);
  const dp=new Float64Array(1<<n);dp.fill(Infinity);dp[0]=0;
  for(let mask=0;mask<(1<<n)-1;mask++){
   if(!Number.isFinite(dp[mask]))continue;
   let rank=1;
   for(let b=mask;b;b&=b-1)rank++;
   for(let bit=0;bit<n;bit++){
    if(mask&(1<<bit))continue;
    const i=indices[bit],j=p.jobs[i];
    const floor=Math.max(
     state.machines[machine].clock+rankMin[rank],
     j.release+j.duration,
     optimisticFinish[i]);
    const penalty=Math.max(0,floor-j.due)*j.weight;
    const next=mask|(1<<bit),cost=dp[mask]+penalty;
    if(cost<dp[next])dp[next]=cost;
   }
  }
  total+=dp[(1<<n)-1];
 }
 return total;
}

function topoIndices(p){
 const indices=new Map(p.jobs.map((x,i)=>[x.id,i])),visited=new Set(),order=[];
 while(order.length<p.jobs.length){
  let progressed=false;
  for(let i=0;i<p.jobs.length;i++)if(!visited.has(i)&&p.jobs[i].parents.every(dep=>visited.has(indices.get(dep)))){
   visited.add(i);order.push(i);progressed=true;
  }
  if(!progressed)throw Error('INVALID_OR_CYCLIC_PRECEDENCE');
 }
 return {indices,order};
}


export function certifyIDA(problem,incumbent,{maxExpansions=16000,maxIterations=500,maxWallMs=60000,maxHeapBytes=512000000,boundMode='forced_rank'}={}){
 if(!Number.isSafeInteger(maxExpansions)||maxExpansions<0||maxExpansions>150000||
    !Number.isSafeInteger(maxIterations)||maxIterations<0||maxIterations>3000||
    !Number.isSafeInteger(maxWallMs)||maxWallMs<0||maxWallMs>600000||
    !Number.isSafeInteger(maxHeapBytes)||maxHeapBytes<1||maxHeapBytes>4000000000||
    !['forced_rank','v12'].includes(boundMode))
    throw Error('BAD_IDA_BUDGET');
 const p=problem;
 if(!Array.isArray(p?.jobs)||p.jobs.length<1||p.jobs.length>16||
    !Array.isArray(p?.machines)||p.machines.length<1||p.machines.length>10)
    throw Error('IDA_SCOPE_EXCEEDED');
 const original=scheduleCandidate(p,incumbent);
 if(!original.ok)throw Error('INITIAL_CERTIFIED_WITNESS_REQUIRED:'+original.reason);
 const {indices,order}=topoIndices(p);
 const root={mask:0,ends:Array(p.jobs.length).fill(-1),
   machines:p.machines.map(m=>({clock:0,last:m.initialType,used:false})),
   cost:0,step:null};
 root.lb=relaxedBound(p,root,order,boundMode);
 let ub=original.cost,best=structuredClone(incumbent),bestExecution=original;
 let lb=Math.min(root.lb,ub),threshold=root.lb;
 let expanded=0,generated=0,iterations=0,completedIterations=0,pruned=0;
 let cutoffMinimum=Infinity,maxDepth=0,peakMeasuredHeapBytes=0,reason=null;
 const active=[],iterationRecords=[];
 const beginning=process.hrtime.bigint(),wallStart=Date.now();
 const fullMask=(1<<p.jobs.length)-1;
 const elapsedMs=()=>Number(process.hrtime.bigint()-beginning)/1e6;
 function budget(){
  if(expanded>=maxExpansions)return 'expansion_budget';
  if(elapsedMs()>=maxWallMs)return 'wall_budget';
  const used=process.memoryUsage().heapUsed;
  if(used>peakMeasuredHeapBytes)peakMeasuredHeapBytes=used;
  if(used>=maxHeapBytes)return 'heap_budget';
  return null;
 }
 function dfs(node,depth){
  if(reason)return;
  if(node.lb>=ub){pruned++;return;}
  if(node.lb>threshold){if(node.lb<cutoffMinimum)cutoffMinimum=node.lb;return;}
  const hit=budget();if(hit){reason=hit;return;}
  expanded++;maxDepth=Math.max(depth,maxDepth);
  if(node.mask===fullMask){
   if(node.cost<ub){
    const proposal={jobs:active.map(x=>({...x}))};
    const checked=scheduleCandidate(p,proposal);
    if(!checked.ok||checked.cost!==node.cost)throw Error('IDA_KERNEL_WITNESS_DISAGREEMENT');
    ub=node.cost;best=proposal;bestExecution=checked;
   }
   return;
  }
  for(let i=0;i<p.jobs.length&&!reason;i++){
   if(node.mask&(1<<i))continue;
   const j=p.jobs[i],parents=j.parents.map(id=>indices.get(id));
   if(parents.some(k=>!(node.mask&(1<<k))))continue;
   const finished=Math.max(0,...parents.map(k=>node.ends[k]));
   for(let m=0;m<p.machines.length&&!reason;m++){
    const machine=p.machines[m];
    if(!machine.types.includes(j.type))continue;
    const times=legalTransition(j,machine,node.machines[m],finished);
    const fee=node.machines[m].used?0:machine.activation;
    const cost=node.cost+fee+Math.max(0,times.finish-j.due)*j.weight;
    if(cost>=ub){pruned++;continue;}
    const next={mask:node.mask|(1<<i),ends:node.ends.slice(),
       machines:node.machines.map(x=>({...x})),cost,
       step:{id:j.id,machine:machine.id}};
    next.ends[i]=times.finish;
    next.machines[m]={clock:times.finish,last:j.type,used:true};
    next.lb=relaxedBound(p,next,order,boundMode);
    generated++;
    active.push(next.step);dfs(next,depth+1);active.pop();
   }
  }
 }
 while(lb<ub&&iterations<maxIterations){
  reason=budget();
  if(reason)break;
  iterations++;
  cutoffMinimum=Infinity;reason=null;
  const beforeExpanded=expanded;
  dfs(root,0);
  if(reason)break; // Interrupted pass: retain lower bound of LAST COMPLETE pass.
  completedIterations++;
  const completeLower=Math.min(ub,cutoffMinimum);
  if(completeLower<lb)throw Error('IDA_LOWER_BOUND_REGRESSED');
  lb=Math.max(lb,completeLower);
  iterationRecords.push({iteration:iterations,threshold,expanded:expanded-beforeExpanded,
    certifiedLower:lb,incumbent:ub,minimumCutoff:Number.isFinite(cutoffMinimum)?cutoffMinimum:null});
  if(lb===ub)break;
  if(!(cutoffMinimum>threshold&&cutoffMinimum<Infinity))throw Error('IDA_NO_PROGRESS_CUTOFF');
  threshold=cutoffMinimum;
 }
 const certifiedOptimal=lb===ub;
 if(certifiedOptimal)reason='proof_complete';
 else if(!reason)reason=iterations>=maxIterations?'iteration_budget':'incomplete';
 const independent=scheduleCandidate(p,best);
 if(!independent.ok||independent.cost!==ub)throw Error('IDA_BAD_INCUMBENT');
 if(lb>ub||lb<Math.min(root.lb,ub))throw Error('IDA_INVALID_BOUND_INTERVAL');
 const elapsedNs=Number(process.hrtime.bigint()-beginning);
 return {lowerBound:lb,upperBound:ub,gapUpper:ub-lb,certifiedOptimal,
  initialUpper:original.cost,initialLower:root.lb,incumbent:best,execution:bestExecution,
  expanded,generated,pruned,iterations,completedIterations,maxDepth,
  peakMeasuredHeapBytes,maxWallMs,maxHeapBytes,exitReason:reason,
  elapsedNs,boundMode,trace:iterationRecords,
  searchMemory:'depth_first_without_global_frontier',
  proofRule:'Only fully completed threshold iterations advance certified lower bound',
  evidence:{problemHash:sha(p),initialHash:sha(incumbent),finalHash:sha(best),
    scheduleHash:bestExecution.evidence.scheduleDigest,
    certificateHash:sha({p:sha(p),lb,ub,completedIterations,expanded,exit:reason,threshold})}};
}
