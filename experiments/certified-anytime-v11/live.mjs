// AAU V11: deterministic-only, no provider inference. Every claimed bound is
// derived from full remaining frontier of a bounded branch-and-bound search.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixtures,compareInstance,admissibleLowerBound,hash} from '../per-instance-scaling-v10/bench.mjs';
import {certifyAnytime} from './certifier.mjs';
import {evaluate,exactOracle} from '../precise-diagnostics-v6/benchmark.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V11_ISOLATED!=='yes')
 throw Error('ISOLATED_ONLY');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const report={experiment:'AAU_ANYTIME_PROOF_BOUNDED_SCALING_V11',runClass:'research_no_provider_calls',
 status:'running',modelCalls:0,modelTokens:0,parallelWorkers:1,
 budget:{nine:10000,ten:12000,twelve:16000,seven:16000,maxFrontier:85000},
 cases:[],verification:{},rootProof:null,
 caveats:['A remaining-frontier lower bound certifies a numeric gap; it is not equivalent to exact optimality unless gap=0',
 'The 9/10/12 tasks are the same synthetic V10 fixture generator and only one seed per size',
 'The search uses earliest legal work start for every fixed order and machine assignment',
 'A safe result on tiny cases does not imply production scaling']};
const path='anytime-v11-evidence.json';
const persist=()=>writeFileSync(path,JSON.stringify(report,null,2)+'\n');
try{
 for(const f of fixtures){
  const old=compareInstance(f.problem,{maxEvaluations:1400,beamWidth:12,maxDepth:9});
  const root=admissibleLowerBound(f.problem);
  const maxExpansions=f.size===7?report.budget.seven:f.size===9?report.budget.nine:f.size===10?report.budget.ten:report.budget.twelve;
  const proof=certifyAnytime(f.problem,old.beamProposal,{maxExpansions,maxFrontier:report.budget.maxFrontier});
  const verified=evaluate(f.problem,{schedule:proof.execution.schedule,cost:proof.upperBound});
  if(!verified.ok||verified.cost!==proof.upperBound)throw Error('INDEPENDENT_WITNESS_REJECTED_'+f.id);
  if(proof.lowerBound>proof.upperBound||proof.lowerBound<root.value)throw Error('INVALID_BOUNDS_'+f.id);
  let independentExact=null;
  if(f.size===7){
   independentExact=exactOracle(f.problem).cost;
   if(proof.lowerBound>independentExact||proof.upperBound<independentExact)throw Error('COVERAGE_PROOF_ERROR_'+f.id);
   if(proof.certifiedOptimal&&proof.upperBound!==independentExact)throw Error('FALSE_OPTIMALITY_'+f.id);
  }
  report.cases.push({id:f.id,size:f.size,problemHash:hash(f.problem),
   v10BeamCost:old.beamCost,previousLooseLowerBound:root.value,
   v11FeasibleUpper:proof.upperBound,v11CertifiedLower:proof.lowerBound,
   v11CertifiedGapUpper:proof.gapUpper,
   independentlyKnownOptimum:independentExact,
   provenOptimal:proof.certifiedOptimal,
   provenExactAgreement:independentExact===null?null:independentExact===proof.upperBound,
   expanded:proof.expanded,generated:proof.generated,pruned:proof.pruned,
   dominancePruned:proof.dominancePruned,maxHeap:proof.maxHeap,
   remainingFrontier:proof.remainingFrontier,exitReason:proof.exitReason,
   maxExpansions,elapsedNs:proof.elapsedNs,independentFeasible:true,
   evidence:proof.evidence,optimalityLanguage:proof.certifiedOptimal?
    'exact_optimum_certified':'feasible_incumbent_with_proven_lower_bound_only'});
  persist();
 }
 report.rootProof=sha({cases:report.cases.map(x=>({id:x.id,input:x.problemHash,up:x.v11FeasibleUpper,
   low:x.v11CertifiedLower,verified:x.independentFeasible,proof:x.evidence.certificateHash})),modelCalls:0});
 report.status='passed';
}catch(e){report.status='failed';report.error=String(e?.stack??e).slice(0,1300)}
finally{
 report.finishedAt=new Date().toISOString();persist();
 console.log('AAU_V11_ANYTIME_RESULT='+JSON.stringify({status:report.status,modelCalls:0,
  cases:report.cases.map(x=>({id:x.id,n:x.size,beam:x.v10BeamCost,oldLower:x.previousLooseLowerBound,
   certifiedLower:x.v11CertifiedLower,verifiedUpper:x.v11FeasibleUpper,gapUpper:x.v11CertifiedGapUpper,
   provenOptimal:x.provenOptimal,expanded:x.expanded,frontier:x.remainingFrontier,
   exit:x.exitReason,independentlyKnownOptimum:x.independentlyKnownOptimum})),
  error:report.error??null,rootProof:!!report.rootProof}));
 if(report.status!=='passed')process.exitCode=2;
}
