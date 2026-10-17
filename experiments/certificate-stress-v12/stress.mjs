// AAU V12: independently seeded, reproducible stress cases beyond the V11 six fixtures.
// No model calls, no production state, only two-machine scheduling benchmarks.
import {createHash} from 'node:crypto';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {beamOptimize} from '../scheduler-beam-v9/beam.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {certifyAnytime} from '../certified-anytime-v11/certifier.mjs';
import {evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
export const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function generateStress(size,seed,variant=0){
 if(!Number.isSafeInteger(size)||size<4||size>16||!Number.isSafeInteger(seed)||![0,1,2].includes(variant))throw Error('BAD_STRESS_GENERATOR_INPUT');
 let x=seed>>>0;
 const rand=()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296);
 const draw=(a,b)=>a+Math.floor(rand()*(b-a+1));
 const windows=variant===0?[[9,15],[29,34]]:variant===1?[[6,13],[23,30]]:[[12,17],[26,33]];
 const w1=variant===0?[[7,12],[28,33]]:variant===1?[[11,18],[25,31]]:[[8,14],[23,29]];
 const machines=[
  {id:'M0',types:['a','b'],initialType:'a',setup:draw(1,4),activation:draw(3,10),maintenance:windows},
  {id:'M1',types:['b','c'],initialType:'c',setup:draw(1,4),activation:draw(3,10),maintenance:w1}
 ];
 const jobs=[];
 for(let i=0;i<size;i++){
  const type=['a','b','c'][draw(0,2)],parents=[];
  const chance=variant===0?0.20:variant===1?0.35:0.48;
  if(i>0&&rand()<chance)parents.push('J'+draw(0,i-1));
  if(i>3&&rand()<(variant===2?0.28:0.1)){
   const id='J'+draw(0,i-1);if(!parents.includes(id))parents.push(id);
  }
  jobs.push({id:'J'+i,type,duration:draw(2,7),release:draw(0,14),
   due:draw(4,23),weight:draw(1,10),parents});
 }
 return {machines,jobs};
}
export const stressCases=[
 ...[12,14,16].flatMap((n,i)=>[0,1,2].map((variant)=>({
  id:'n'+n+'_variant'+variant,jobCount:n,seed:((n*17231+variant*9899+55113)>>>0),
  variant,problem:generateStress(n,(n*17231+variant*9899+55113)>>>0,variant)
 })))
];
const verify=(p,s)=>{
 if(!s?.ok)throw Error('MISSING_TRUSTED_WITNESS');
 const independent=evaluate(p,{schedule:s.schedule,cost:s.cost});
 if(!independent.ok||independent.cost!==s.cost)throw Error('INDEPENDENT_FEASIBILITY_OR_COST_FAILED');
 if(s.ledger.some(e=>e.setupStart<0||e.setupStart<e.machineFinishBefore))throw Error('ILLEGAL_SETUP');
 return true;
};
export function stressOne(entry,{warmupEvaluations=500,mediumExpansions=600,deepExpansions=2300,frontierCap=2000}={}){
 if(!Number.isSafeInteger(warmupEvaluations)||warmupEvaluations<0||warmupEvaluations>2000||
  !Number.isSafeInteger(mediumExpansions)||mediumExpansions<0||mediumExpansions>20000||
  !Number.isSafeInteger(deepExpansions)||deepExpansions<0||deepExpansions>20000||
  mediumExpansions>deepExpansions||!Number.isSafeInteger(frontierCap)||frontierCap<100||frontierCap>25000)
  throw Error('INVALID_STRESS_BUDGET');
 const p=entry.problem,seeds=topologicalSeeds(p);
 const initial=seeds.map(proposal=>({proposal,result:scheduleCandidate(p,proposal)}))
  .filter(x=>x.result.ok).sort((a,b)=>a.result.cost-b.result.cost)[0];
 if(!initial)throw Error('NO_INITIAL_FEASIBLE_WITNESS');
 const warmed=beamOptimize(p,seeds,{maxEvaluations:warmupEvaluations,beamWidth:8,maxDepth:7});
 if(!warmed.ok)throw Error('WARMUP_SEARCH_FAILED');
 verify(p,warmed.execution);
 const seed=warmed.proposal;
 const original=admissibleLowerBound(p).value;
 const budgets=[{name:'censored_zero',limit:0,frontier:frontierCap},
  {name:'censored_early',limit:mediumExpansions,frontier:frontierCap},
  {name:'bounded_deep',limit:deepExpansions,frontier:frontierCap},
  {name:'frontier_pressure',limit:deepExpansions,frontier:100}];
 const observations=[];
 for(const b of budgets){
  const proof=certifyAnytime(p,seed,{maxExpansions:b.limit,maxFrontier:b.frontier});
  verify(p,proof.execution);
  if(proof.lowerBound<original||proof.lowerBound>proof.upperBound||
   proof.upperBound>warmed.finalCost||proof.expanded>b.limit||
   proof.remainingFrontier>b.frontier||proof.certifiedOptimal!==(proof.gapUpper===0)||
   (proof.certifiedOptimal&&proof.exitReason!=='proof_complete'))
   throw Error('BOUND_OR_BUDGET_UNSOUND_'+b.name);
  const recorded={name:b.name,nodeBudget:b.limit,frontierBudget:b.frontier,
   lower:proof.lowerBound,upper:proof.upperBound,certifiedGap:proof.gapUpper,
   certifiedOptimal:proof.certifiedOptimal,expanded:proof.expanded,generated:proof.generated,
   pruned:proof.pruned,remainingFrontier:proof.remainingFrontier,peakFrontier:proof.maxHeap,
   exit:proof.exitReason,elapsedNs:proof.elapsedNs,certificateHash:proof.evidence.certificateHash,
   incumbentHash:proof.evidence.finalHash,feasible:true};
  observations.push(recorded);
 }
 if(observations[0].expanded!==0)throw Error('ZERO_BUDGET_EXPANDED');
 const normal=observations.slice(0,3);
 for(let i=1;i<normal.length;i++){
  if(normal[i].upper>normal[i-1].upper)throw Error('LOST_FEASIBLE_INCUMBENT');
 }
 return {id:entry.id,jobCount:entry.jobCount,variant:entry.variant,seed:entry.seed,
  problemHash:sha(p),initialCost:initial.result.cost,warmBeamCost:warmed.finalCost,
  initialStaticLower:original,warmupEvaluations:warmed.evaluations,
  observations,logicalChecksPassed:true};
}
