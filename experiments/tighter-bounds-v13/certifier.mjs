// AAU V13: strengthened forced-machine rank bound and shared-parent states.
// No LLM, no shared implementation of the reference oracle or trusted kernel.
// Partial cost is exact; remaining cost relaxed but never overstated.
import {createHash} from 'node:crypto';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

class MinHeap {
 constructor(){this.v=[]}
 get size(){return this.v.length}
 peek(){return this.v[0]}
 push(x){let a=this.v,i=a.length;a.push(x);while(i){let p=(i-1)>>1;if(!less(x,a[p]))break;a[i]=a[p];i=p}a[i]=x}
 pop(){let a=this.v,n=a.length,top=a[0],last=a.pop();if(n>1){let i=0;while(2*i+1<a.length){let l=2*i+1,r=l+1,c=r<a.length&&less(a[r],a[l])?r:l;if(!less(a[c],last))break;a[i]=a[c];i=c}a[i]=last}return top}
}
const less=(a,b)=>a.lb<b.lb||(a.lb===b.lb&&(a.mask>b.mask||(a.mask===b.mask&&a.serial<b.serial)));
const overlaps=(start,end,windows)=>windows.some(([a,b])=>start<b&&end>a);
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
export function certifyImproved(p,incumbent,{maxExpansions=16000,maxFrontier=100000,maxWallMs=60000,maxHeapBytes=512000000,boundMode='forced_rank'}={}){
 if(!Number.isSafeInteger(maxExpansions)||maxExpansions<0||maxExpansions>150000||
  !Number.isSafeInteger(maxFrontier)||maxFrontier<100||maxFrontier>350000||
  !Number.isSafeInteger(maxWallMs)||maxWallMs<0||maxWallMs>600000||
  !Number.isSafeInteger(maxHeapBytes)||maxHeapBytes<1||maxHeapBytes>4000000000||
  !['forced_rank','v12'].includes(boundMode))
  throw Error('BAD_CERTIFIER_BUDGET');
 if(!Array.isArray(p?.jobs)||p.jobs.length<1||p.jobs.length>16||
  !Array.isArray(p?.machines)||p.machines.length<1||p.machines.length>10)
  throw Error('CERTIFIER_SCOPE_EXCEEDED');
 const initial=scheduleCandidate(p,incumbent);
 if(!initial.ok)throw Error('INITIAL_CERTIFIED_WITNESS_REQUIRED:'+initial.reason);
 const {indices,order}=topoIndices(p);
 const node={mask:0,ends:Array(p.jobs.length).fill(-1),machines:p.machines.map(m=>({clock:0,last:m.initialType,used:false})),
  cost:0,parent:null,step:null,serial:0};
 node.lb=relaxedBound(p,node,order,boundMode);
 const rootBound=node.lb;
 const heap=new MinHeap();heap.push(node);
 let upper=initial.cost,best=structuredClone(incumbent),bestResult=initial;
 let expansions=0,generated=1,pruned=0,dominancePruned=0,serial=1,maxHeap=1,frontierBudgetHalt=false,wallBudgetHalt=false,heapBudgetHalt=false;
 const memo=new Map(),start=process.hrtime.bigint(),wallStart=Date.now();
 let peakMeasuredHeapBytes=process.memoryUsage().heapUsed;
 const fullMask=(1<<p.jobs.length)-1;
 while(heap.size&&expansions<maxExpansions&&heap.size<maxFrontier){
  const used=process.memoryUsage().heapUsed;
  if(used>peakMeasuredHeapBytes)peakMeasuredHeapBytes=used;
  if(Date.now()-wallStart>=maxWallMs){wallBudgetHalt=true;break;}
  if(used>=maxHeapBytes){heapBudgetHalt=true;break;}
  // Cheapest possible unfinished branch is already no better than the
  // certified feasible incumbent: full proof, no need to enumerate ties.
  if(heap.peek().lb>=upper){heap.v.length=0;break;}
  const current=heap.pop();
  if(current.lb>=upper){pruned++;continue}
  const signature=JSON.stringify([current.mask,current.machines,current.ends]);
  const earlier=memo.get(signature);
  if(earlier!==undefined&&earlier<=current.cost){dominancePruned++;continue}
  memo.set(signature,current.cost);
  if(current.mask===fullMask){
   expansions++;
   if(current.cost<upper){
    const steps=[];for(let t=current;t&&t.step;t=t.parent)steps.push(t.step);
    steps.reverse();const witness={jobs:steps};
    const checked=scheduleCandidate(p,witness);
    if(!checked.ok||checked.cost!==current.cost)throw Error('CERTIFIER_KERNEL_DISAGREEMENT');
    upper=current.cost;best=witness;bestResult=checked;
   }
   continue;
  }
  // Build a COMPLETE set of children before modifying the priority queue.
  // If the frontier would exceed its cap, put the whole unexpanded parent
  // back into the heap. Its lower bound remains a sound certificate for
  // every unexamined branch: no partial expansion or discarded siblings.
  const pending=[];let locallyPruned=0;
  for(let i=0;i<p.jobs.length;i++){
   if(current.mask&(1<<i))continue;
   const j=p.jobs[i],pi=j.parents.map(id=>indices.get(id));
   if(pi.some(k=>!(current.mask&(1<<k))))continue;
   const parentTime=Math.max(0,...pi.map(k=>current.ends[k]));
   for(let m=0;m<p.machines.length;m++){
    const machine=p.machines[m];
    if(!machine.types.includes(j.type))continue;
    const timing=legalTransition(j,machine,current.machines[m],parentTime);
    const fee=current.machines[m].used?0:machine.activation;
    const cost=current.cost+fee+Math.max(0,timing.finish-j.due)*j.weight;
    if(cost>=upper){locallyPruned++;continue}
    const child={mask:current.mask|(1<<i),ends:current.ends.slice(),
     machines:current.machines.map(x=>({...x})),cost,
     parent:current,step:{id:j.id,machine:machine.id},serial:serial++};
    child.ends[i]=timing.finish;
    child.machines[m]={clock:timing.finish,last:j.type,used:true};
    child.lb=relaxedBound(p,child,order,boundMode);
    if(child.lb>=upper){locallyPruned++;continue}
    pending.push(child);
   }
  }
  if(heap.size+pending.length>maxFrontier){
   heap.push(current);
   frontierBudgetHalt=true;
   maxHeap=Math.max(maxHeap,heap.size);
   break;
  }
  expansions++;pruned+=locallyPruned;
  for(const child of pending){heap.push(child);generated++;}
  maxHeap=Math.max(maxHeap,heap.size);
 }
 // Any pruned state cannot improve upper. Only surviving frontier remains.
 // Note: taking min with upper also covers an empty frontier => proven optimum.
 const lower=heap.size?Math.min(upper,heap.peek().lb):upper;
 if(lower>upper||lower<rootBound)throw Error('BAD_CERTIFICATE_INTERVAL');
 const independentlyVerified=scheduleCandidate(p,best);
 if(!independentlyVerified.ok||independentlyVerified.cost!==upper)throw Error('INCUMBENT_NOT_REPRODUCIBLE');
 const certifiedOptimal=lower===upper;
 const elapsedNs=Number(process.hrtime.bigint()-start);
 return {upperBound:upper,lowerBound:lower,gapUpper:upper-lower,certifiedOptimal,
  rootBound,initialUpper:initial.cost,incumbent:best,execution:bestResult,
  expanded:expansions,generated,pruned,dominancePruned,maxHeap,remainingFrontier:heap.size,
  exitReason:certifiedOptimal?'proof_complete':wallBudgetHalt?'wall_budget':heapBudgetHalt?'heap_budget':frontierBudgetHalt||heap.size>=maxFrontier?'frontier_budget':expansions>=maxExpansions?'expansion_budget':'stopped',
  elapsedNs,boundMode,maxWallMs,maxHeapBytes,peakMeasuredHeapBytes,
  evidence:{problemHash:sha(p),initialHash:sha(incumbent),finalHash:sha(best),
   scheduleHash:bestResult.evidence.scheduleDigest,
   certificateHash:sha({p:sha(p),lower,upper,expanded:expansions,frontier:heap.size,rootBound})}};
}
