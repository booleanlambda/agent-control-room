// Experiment V10: independent per-instance scheduling inputs and certified
// admissible lower bound for cases too large for v9's 8-job exact solver.
import {createHash} from 'node:crypto';
import {publicProblem,hiddenProblems,exactOracle} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {beamOptimize,exactSmall} from '../scheduler-beam-v9/beam.mjs';
export const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>structuredClone(x);
function generate(size,seed){
 if(![9,10,12].includes(size))throw Error('UNSUPPORTED_FIXTURE_SIZE');
 let s=seed>>>0;const rand=()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296);
 const pick=(a,b)=>a+Math.floor(rand()*(b-a+1));
 const p={machines:[
  {id:'M0',types:['a','b'],initialType:'a',setup:pick(1,4),activation:pick(4,9),maintenance:[[8,13],[25,29]]},
  {id:'M1',types:['b','c'],initialType:'c',setup:pick(1,4),activation:pick(3,8),maintenance:[[7,11],[23,28]]}
 ],jobs:[]};
 for(let i=0;i<size;i++){
  const type=['a','b','c'][pick(0,2)];
  const parents=[];
  if(i>0&&rand()<0.62)parents.push('J'+pick(0,i-1));
  if(i>3&&rand()<0.23){const j='J'+pick(0,i-1);if(!parents.includes(j))parents.push(j);}
  p.jobs.push({id:'J'+i,type,duration:pick(2,6),release:pick(0,10),
   due:pick(5,24),weight:pick(2,9),parents});
 }
 return p;
}
export const seven=[publicProblem,...hiddenProblems];
export const scaling=[
 {id:'new_nine_jobs',size:9,problem:generate(9,74111)},
 {id:'new_ten_jobs',size:10,problem:generate(10,95277)},
 {id:'new_twelve_jobs',size:12,problem:generate(12,83109)}
];
export const fixtures=[
 ...seven.map((problem,i)=>({id:['seven_public','seven_hidden_1','seven_hidden_2'][i],size:7,problem,exactKnown:true})),
 ...scaling.map(x=>({...x,exactKnown:false}))
];
const minset=(machines,types)=>{
 let optimum=Infinity;
 if(machines.length>14)throw Error('BOUND_MACHINE_SCOPE');
 for(let mask=1;mask<1<<machines.length;mask++){
  let price=0;const union=new Set();
  for(let i=0;i<machines.length;i++)if(mask&(1<<i)){
   price+=machines[i].activation;
   for(const type of machines[i].types)union.add(type);
  }
  if(types.every(t=>union.has(t))&&price<optimum)optimum=price;
 }
 if(!Number.isFinite(optimum))throw Error('INELIGIBLE_TYPES');
 return optimum;
};
export function admissibleLowerBound(p){
 if(!Array.isArray(p.jobs)||!Array.isArray(p.machines)||p.jobs.length>60||p.machines.length>14)
  throw Error('BOUND_SCOPE');
 const complete=new Map(),pending=new Map(p.jobs.map(j=>[j.id,j]));
 let tardiness=0;
 // Relax away machine contention, setup, and maintenance. Precedence/release
 // remain. Earliest completion in this relaxation cannot exceed a real finish.
 while(pending.size){
  let progress=false;
  for(const [id,j] of pending){
   if(j.parents.some(dep=>!complete.has(dep)))continue;
   const parentsDone=Math.max(0,...j.parents.map(dep=>complete.get(dep)));
   const relaxedFinish=Math.max(j.release,parentsDone)+j.duration;
   complete.set(id,relaxedFinish);
   tardiness+=Math.max(0,relaxedFinish-j.due)*j.weight;
   pending.delete(id);progress=true;
  }
  if(!progress)throw Error('CYCLIC_OR_MISSING_DEPENDENCY');
 }
 const activation=minset(p.machines,[...new Set(p.jobs.map(j=>j.type))]);
 return {value:tardiness+activation,relaxedTardiness:tardiness,
  compulsoryActivationBound:activation,certifiesOptimality:false};
}
export function topologicalSeeds(p){
 const byId=new Map(p.jobs.map(j=>[j.id,j]));
 const orders=[];
 for(const mode of ['input','weight','due','release','duration']){
  const done=new Set(),order=[];
  while(order.length<p.jobs.length){
   const eligible=p.jobs.filter(j=>!done.has(j.id)&&j.parents.every(id=>done.has(id)));
   if(!eligible.length)throw Error('CYCLIC_OR_INVALID_DEPENDENCY');
   const rank=j=>mode==='weight'?-j.weight:mode==='due'?j.due:
     mode==='release'?j.release:mode==='duration'?-j.duration:p.jobs.indexOf(j);
   eligible.sort((a,b)=>rank(a)-rank(b)||a.id.localeCompare(b.id));
   const j=eligible[0];done.add(j.id);order.push(j);
  }
  orders.push(order);
 }
 const seeds=[],seen=new Set();
 for(let i=0;i<orders.length;i++)for(const bMachine of ['M0','M1']){
  const jobs=orders[i].map((j,index)=>{
   const choices=p.machines.filter(m=>m.types.includes(j.type));
   if(!choices.length)throw Error('MACHINE_INELIGIBLE');
   const preferred=choices.find(m=>m.id===bMachine)??choices[index%choices.length];
   return {id:j.id,machine:preferred.id};
  });
  const proposal={jobs},key=hash(proposal);
  if(!seen.has(key)&&scheduleCandidate(p,proposal).ok){seen.add(key);seeds.push(proposal);}
 }
 if(!seeds.length)throw Error('NO_FEASIBLE_SEEDS');
 return seeds;
}
export function compareInstance(p,{maxEvaluations=1400,beamWidth=12,maxDepth=10,extraSeeds=[]}={}){
 const bound=admissibleLowerBound(p);
 const seeds=topologicalSeeds(p);
 const original=beamOptimize(p,seeds,{maxEvaluations:0,beamWidth,maxDepth:0});
 if(!original.ok)throw Error('BASELINE_INVALID');
 const start=process.hrtime.bigint();
 const result=beamOptimize(p,[...seeds,...extraSeeds].slice(0,20),{maxEvaluations,beamWidth,maxDepth});
 const elapsedNs=Number(process.hrtime.bigint()-start);
 if(!result.ok)throw Error('BEAM_SEARCH_FAILED');
 if(result.finalCost<bound.value)throw Error('IMPOSSIBLE_BELOW_PROVEN_LOWER_BOUND');
 const exact=p.jobs.length<=8?exactSmall(p):{ok:false,reason:'EXACT_SCOPE_EXCEEDED'};
 let optimum=null,exactWitnessVerified=null;
 if(exact.ok){
  const external=exactOracle(p);
  if(exact.cost!==external.cost)throw Error('EXACT_ORACLES_DISAGREE');
  optimum=external.cost;exactWitnessVerified=true;
 }
 return {size:p.jobs.length,problemHash:hash(p),baseline:original.finalCost,beamCost:result.finalCost,
  beamIterations:result.depth,evaluations:result.evaluations,validEvaluations:result.validEvaluations,
  elapsedNs,beamEvidence:result.evidence,beamProposal:result.proposal,beamExecution:result.execution,
  lowerBound:bound.value,lowerBoundGap:result.finalCost-bound.value,
  exactOptimalCost:optimum,exactGap:optimum===null?null:result.finalCost-optimum,
  exactWitnessVerified,provablyOptimal:optimum!==null&&result.finalCost===optimum,
  seedsUsed:Math.min(20,seeds.length+extraSeeds.length),hiddenOrNew:p.jobs.length>8};
}
