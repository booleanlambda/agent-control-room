// AAU V14 isolated, zero-model memory-bounded iterative deepening comparison.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stressCases,sha} from '../certificate-stress-v12/stress.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {beamOptimize} from '../scheduler-beam-v9/beam.mjs';
import {certifyImproved} from '../tighter-bounds-v13/certifier.mjs';
import {certifyIDA} from './ida.mjs';
import {evaluate,exactOracle} from '../precise-diagnostics-v6/benchmark.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V14_RESEARCH!=='yes')throw Error('RESEARCH_ISOLATION_REQUIRED');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const report={experiment:'AAU_MEMORY_BOUNDED_ITERATIVE_DEEPENING_V14',
 state:'running',oneWorker:true,modelCalls:0,modelTokens:0,
 comparisonBudget:{warmupEvaluations:400,maxExpansions:2200,maxFrontierV13:2400,maxIterationsV14:200,maxWallMs:60000,maxHeapBytes:512000000},
 cases:[],independentSmall:[],deepExploration:[],rootDigest:null,
 caveats:['IDA* is depth-first, but retries the tree each threshold round; it may consume far more CPU for a given node budget.',
 'A partially completed IDA iteration never advances the certified lower bound.',
 'Node expansion counts compare search work, not normalized wall-clock time or effective search diversity.',
 'Memory is depth bounded structurally, but JavaScript garbage collection/RSS peaks are not a hard bound.',
 'No claim about global scaling from nine synthetic fixture inputs.']};
const file='ida-v14-evidence.json',save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
function verdict(p,r){
 const v=evaluate(p,{schedule:r.execution.schedule,cost:r.upperBound});
 if(!v.ok||v.cost!==r.upperBound||r.lowerBound>r.upperBound)
  throw Error('INDEPENDENT_CERTIFICATION_FAILURE');
 return {lower:r.lowerBound,upper:r.upperBound,gap:r.gapUpper,
  proved:r.certifiedOptimal,expanded:r.expanded,iterations:r.iterations??null,
  completed:r.completedIterations??null,depth:r.maxDepth??null,
  exit:r.exitReason,elapsedNs:r.elapsedNs,hash:r.evidence.certificateHash,
  feasible:true,usedHeap:r.peakMeasuredHeapBytes??null};
}
try{
 for(const item of stressCases){
  const p=item.problem;
  const seeds=topologicalSeeds(p),warm=beamOptimize(p,seeds,{maxEvaluations:report.comparisonBudget.warmupEvaluations,beamWidth:8,maxDepth:7});
  if(!warm.ok)throw Error('INVALID_WARM_SEED_'+item.id);
  const previous=certifyImproved(p,warm.proposal,{
   maxExpansions:2200,maxFrontier:2400,boundMode:'forced_rank'});
  const next=certifyIDA(p,warm.proposal,{
   maxExpansions:2200,maxIterations:200,maxWallMs:60000,maxHeapBytes:512000000,boundMode:'forced_rank'});
  const a=verdict(p,previous),b=verdict(p,next),loose=admissibleLowerBound(p).value;
  if(a.lower<loose||b.lower<loose||a.lower>b.upper||b.lower>a.upper||
   b.expanded>2200||b.depth>p.jobs.length)throw Error('CROSS_CERTIFICATE_OR_BUDGET_ERROR_'+item.id);
  report.cases.push({id:item.id,jobs:item.jobCount,problemHash:sha(p),
   warmSeedCost:warm.finalCost,relaxedLower:loose,frontier:a,ida:b,
   gapReduction:a.gap-b.gap,proofImproved:!a.proved&&b.proved,
   bothIndependentlyFeasible:true});
  save();
 }
 for(const item of stressCases.filter(x=>x.jobCount>=14).slice(0,3)){
  const p=item.problem;
  const seeds=topologicalSeeds(p),warm=beamOptimize(p,seeds,{maxEvaluations:400,beamWidth:8,maxDepth:7});
  const deeper=certifyIDA(p,warm.proposal,{maxExpansions:15000,maxIterations:450,
   maxWallMs:60000,maxHeapBytes:512000000});
  const result=verdict(p,deeper);
  report.deepExploration.push({id:item.id,nodeBudget:15000,iterationBudget:450,...result});
  save();
 }
 // Same independent oracle as previous experiments, but V14's own DFS decisions.
 for(let size=4;size<=7;size++){
  const p={machines:structuredClone(stressCases[1].problem.machines),
   jobs:structuredClone(stressCases[1].problem.jobs.slice(0,size))};
  const oracle=exactOracle(p),seed=topologicalSeeds(p)[0];
  const r=certifyIDA(p,seed,{maxExpansions:10000,maxIterations:800});
  const value=verdict(p,r);
  if(value.lower>oracle.cost||value.upper<oracle.cost||
   (value.proved&&value.upper!==oracle.cost))
    throw Error('INDEPENDENT_ORACLE_MISMATCH_'+size);
  report.independentSmall.push({size,exact:oracle.cost,...value});save();
 }
 report.summary={cases:report.cases.length,oldProven:report.cases.filter(x=>x.frontier.proved).length,
  idaProven:report.cases.filter(x=>x.ida.proved).length,
  oldGapSum:report.cases.reduce((n,x)=>n+x.frontier.gap,0),
  idaGapSum:report.cases.reduce((n,x)=>n+x.ida.gap,0),
  smallerGap:report.cases.filter(x=>x.ida.gap<x.frontier.gap).length,
  worseGap:report.cases.filter(x=>x.ida.gap>x.frontier.gap).length,
  certifiedWithDeeperBudget:report.deepExploration.filter(x=>x.proved).length,
  averageCompletedIterations:report.cases.reduce((n,x)=>n+x.ida.completed,0)/report.cases.length};
 report.rootDigest=hash({cases:report.cases.map(x=>({id:x.id,p:x.problemHash,old:x.frontier.hash,new:x.ida.hash})),
  deep:report.deepExploration.map(x=>x.hash),small:report.independentSmall.map(x=>x.hash)});
 report.state='passed';
}catch(e){report.state='failed';report.error=String(e?.stack||e).slice(0,1700)}
finally{
 report.finishedAt=new Date().toISOString();save();
 console.log('AAU_V14_IDA_RESULT='+JSON.stringify({state:report.state,modelCalls:0,
  summary:report.summary??null,
  cases:report.cases.map(x=>({id:x.id,n:x.jobs,old:{lb:x.frontier.lower,ub:x.frontier.upper,gap:x.frontier.gap,expanded:x.frontier.expanded,exit:x.frontier.exit},
   ida:{lb:x.ida.lower,ub:x.ida.upper,gap:x.ida.gap,expanded:x.ida.expanded,iterations:x.ida.completed,exit:x.ida.exit}})),
  deep:report.deepExploration.map(x=>({id:x.id,lower:x.lower,upper:x.upper,iterations:x.completed,expanded:x.expanded,exit:x.exit})),
  error:report.error??null,rootProof:!!report.rootDigest}));
 if(report.state!=='passed')process.exitCode=2;
}
