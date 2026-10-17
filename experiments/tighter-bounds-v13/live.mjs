// AAU V13 — new bound, compressed parent-pointer search, strict budget guards.
// Exactly the same nine V12 stress fixtures and feasible beam incumbents.
// This research workflow makes ZERO Moonshot/Kimi/provider calls.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stressCases,sha} from '../certificate-stress-v12/stress.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {beamOptimize} from '../scheduler-beam-v9/beam.mjs';
import {certifyAnytime} from '../certified-anytime-v11/certifier.mjs';
import {certifyImproved} from './certifier.mjs';
import {evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V13_ISOLATED!=='yes')
 throw Error('RESEARCH_ONLY');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const report={experiment:'AAU_V13_TIGHTER_RANK_LOWER_BOUNDS_AND_COMPACT_PROOF_STRESS',
 state:'running',modelCalls:0,modelTokens:0,workerCount:1,
 budgets:{warmupEvaluations:400,expansions:2200,maxFrontier:2400,
  maxWallMs:60000,maxHeapBytes:512000000,pressureFrontier:100},
 cases:[],independentChecks:[],rootDigest:null,
 limitations:['Same nine synthetic V12 fixtures; not unseen real-world benchmark families',
 'Heap-byte limit checks between node expansions; does not bound short-lived allocation peaks',
 'Process heap usage is not an apples-to-apples measurement of original V12 due to sequential execution and garbage collector',
 'Stronger admissible lower bounds are not sufficient to prove every larger case optimal under a fixed budget',
 'Improvement in certified gap must be attributed to deterministic bound/search, not LLM']};
const path='v13-comparison-evidence.json',save=()=>writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const thin=(proof,p,mode)=>{
 const checked=evaluate(p,{schedule:proof.execution.schedule,cost:proof.upperBound});
 if(!checked.ok||checked.cost!==proof.upperBound)throw Error('INDEPENDENT_WITNESS_INVALID_'+mode);
 return {mode,lower:proof.lowerBound,upper:proof.upperBound,gap:proof.gapUpper,
  certifiedOptimal:proof.certifiedOptimal,
  expanded:proof.expanded,generated:proof.generated,
  exit:proof.exitReason,frontier:proof.remainingFrontier,
  peakFrontier:proof.maxHeap,elapsedNs:proof.elapsedNs,
  proof:proof.evidence.certificateHash,
  measuredHeapBytes:proof.peakMeasuredHeapBytes??null,
  independentFeasible:true};
};
try{
 for(const entry of stressCases){
  const p=entry.problem,seeds=topologicalSeeds(p);
  const warm=beamOptimize(p,seeds,{maxEvaluations:report.budgets.warmupEvaluations,beamWidth:8,maxDepth:7});
  if(!warm.ok)throw Error('WARMUP_INVALID_'+entry.id);
  const relaxed=admissibleLowerBound(p).value;
  const option={maxExpansions:report.budgets.expansions,maxFrontier:report.budgets.maxFrontier};
  const old=thin(certifyAnytime(p,warm.proposal,option),p,'v12_original');
  const current=thin(certifyImproved(p,warm.proposal,{
   ...option,maxWallMs:report.budgets.maxWallMs,maxHeapBytes:report.budgets.maxHeapBytes,
   boundMode:'forced_rank'
  }),p,'v13_rank_compressed');
  const tight=thin(certifyImproved(p,warm.proposal,{
   maxExpansions:report.budgets.expansions,maxFrontier:report.budgets.pressureFrontier,
   maxWallMs:report.budgets.maxWallMs,maxHeapBytes:report.budgets.maxHeapBytes
  }),p,'v13_tight_frontier');
  const before=thin(certifyImproved(p,warm.proposal,{
   maxExpansions:0,maxFrontier:report.budgets.maxFrontier
  }),p,'v13_zero_budget');
  for(const proof of [old,current,tight,before]){
   if(proof.lower<relaxed||proof.lower>proof.upper||proof.upper>warm.finalCost||
    proof.certifiedOptimal!==(proof.gap===0))throw Error('BAD_CERTIFICATE_'+entry.id+'_'+proof.mode);
  }
  if(current.frontier>report.budgets.maxFrontier||current.peakFrontier>report.budgets.maxFrontier||
   tight.frontier>report.budgets.pressureFrontier||tight.peakFrontier>report.budgets.pressureFrontier||
   before.expanded!==0||before.exit!=='expansion_budget')
   throw Error('BUDGET_INVARIANT_FAIL_'+entry.id);
  // V13's rank bound is a max(old bound, forced-job relaxation);
  // this makes the zero-expansion bound at least as strong as V12.
  if(before.lower<relaxed)throw Error('ROOT_BOUND_UNSOUND');
  const row={id:entry.id,size:entry.jobCount,seed:entry.seed,problemHash:sha(p),
   feasibleBeamIncumbent:warm.finalCost,oldRelaxedLower:relaxed,
   v12:old,v13:current,tight,before,
   strengthenedGapBy:old.gap-current.gap,
   savedExpansions:old.expanded-current.expanded,
   bothFeasible:true};
  report.cases.push(row);save();
 }
 const sample=stressCases[8],seeds=topologicalSeeds(sample.problem);
 for(const {label,maxWallMs,maxHeapBytes} of [
  {label:'zero_wall',maxWallMs:0,maxHeapBytes:512000000},
  {label:'zero_heap',maxWallMs:60000,maxHeapBytes:1}
 ]){
  const r=certifyImproved(sample.problem,seeds[0],{
   maxExpansions:2200,maxFrontier:500,maxWallMs,maxHeapBytes});
  const verified=thin(r,sample.problem,label);
  if(verified.expanded!==0||verified.certifiedOptimal||verified.frontier!==1)
   throw Error('CENSORED_BUDGET_BAD_'+label);
  report.independentChecks.push(verified);save();
 }
 report.summary={
  cases:report.cases.length,zeroModelCalls:true,
  v12Proved:report.cases.filter(x=>x.v12.certifiedOptimal).length,
  v13Proved:report.cases.filter(x=>x.v13.certifiedOptimal).length,
  v12TotalGap:report.cases.reduce((n,x)=>n+x.v12.gap,0),
  v13TotalGap:report.cases.reduce((n,x)=>n+x.v13.gap,0),
  v13FewerExpanded:report.cases.filter(x=>x.v13.expanded<x.v12.expanded).length,
  v13ImprovedGap:report.cases.filter(x=>x.v13.gap<x.v12.gap).length,
  v13WorseGap:report.cases.filter(x=>x.v13.gap>x.v12.gap).length,
  tightPressureStopped:report.cases.filter(x=>x.tight.exit==='frontier_budget').length,
  maxV13MeasuredHeapBytes:Math.max(...report.cases.map(x=>x.v13.measuredHeapBytes??0))
 };
 report.rootDigest=hash({cases:report.cases.map(x=>({id:x.id,hash:x.problemHash,
  old:x.v12.proof,new:x.v13.proof,tight:x.tight.proof})),
  checks:report.independentChecks.map(x=>x.proof)});
 report.state='passed';
}catch(e){report.state='failed';report.exception=String(e?.stack??e).slice(0,1400)}
finally{
 report.finishedAt=new Date().toISOString();save();
 console.log('AAU_V13_TIGHT_BOUNDS='+JSON.stringify({
  state:report.state,modelCalls:0,summary:report.summary??null,
  cases:report.cases.map(x=>({id:x.id,n:x.size,seedCost:x.feasibleBeamIncumbent,
   v12:{low:x.v12.lower,up:x.v12.upper,expanded:x.v12.expanded,exit:x.v12.exit},
   v13:{low:x.v13.lower,up:x.v13.upper,expanded:x.v13.expanded,exit:x.v13.exit,peak:x.v13.peakFrontier},
   tight:{low:x.tight.lower,up:x.tight.upper,exit:x.tight.exit,peak:x.tight.peakFrontier}})),
  error:report.exception??null,rootProof:!!report.rootDigest}));
 if(report.state!=='passed')process.exitCode=2;
}
