// AAU V12 single-worker deterministic proof stress. No Kimi API or credentials.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stressCases,stressOne,sha} from './stress.mjs';
import {evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {certifyAnytime} from '../certified-anytime-v11/certifier.mjs';
import {topologicalSeeds} from '../per-instance-scaling-v10/bench.mjs';
import {exactOracle} from '../precise-diagnostics-v6/benchmark.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V12_RESEARCH!=='yes')throw Error('RESEARCH_CI_ONLY');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const report={experiment:'AAU_V12_INDEPENDENT_LARGE_CERTIFICATE_STRESS',
 scope:'isolated_single_worker_no_provider',state:'running',modelCalls:0,modelTokens:0,
 proofBudget:{warmupEvaluations:400,mediumExpansions:450,deepExpansions:2200,frontierCap:2400},
 cases:[],safety:{smallIndependentExactCrossChecks:[],noUnverifiedAcceptedOutputs:true,
  noDiscardedProofFrontier:true},rootDigest:null,
 limitations:['The synthetic 12–16-job fixtures are nine reproducible independent seeds, not statistical coverage',
 'A zero or partial proof budget must show [LB,UB], not assert optimality',
 'Every numeric upper is checked by a distinct feasibility evaluator; large optimalities are not independently exhaustively enumerated',
 'Expansion budgets constrain explored nodes; wall-clock times are observational'],
};
const path='stress-v12-evidence.json',persist=()=>writeFileSync(path,JSON.stringify(report,null,2)+'\n');
try{
 for(const item of stressCases){
  const v=stressOne(item,report.proofBudget);
  if(!v.logicalChecksPassed)throw Error('STRESS_UNSOUND');
  report.cases.push(v);persist();
 }
 for(let n=4;n<=7;n++){
  // Small full-oracle verification is independent of the stressed large-graph generator.
  const template=stressCases[0].problem;
  const p={machines:structuredClone(template.machines),jobs:structuredClone(template.jobs.slice(0,n))};
  const oracle=exactOracle(p),seed=topologicalSeeds(p)[0];
  const proof=certifyAnytime(p,seed,{maxExpansions:7500,maxFrontier:10000});
  const tested=evaluate(p,{schedule:proof.execution.schedule,cost:proof.upperBound});
  if(!tested.ok||tested.cost!==oracle.cost||proof.lowerBound!==oracle.cost||
    !proof.certifiedOptimal)throw Error('INDEPENDENT_SMALL_ORACLE_MISMATCH');
  report.safety.smallIndependentExactCrossChecks.push({jobs:n,optimum:oracle.cost,
   reproducedUpper:proof.upperBound,reproducedLower:proof.lowerBound,
   expanded:proof.expanded,inputHash:sha(p)});
  persist();
 }
 report.summary={
  fixtures:report.cases.length,
  checkpoints:report.cases.reduce((s,x)=>s+x.observations.length,0),
  earlyCensored:report.cases.filter(x=>!x.observations[1].certifiedOptimal).length,
  deepCensored:report.cases.filter(x=>!x.observations[2].certifiedOptimal).length,
  pressuredCensored:report.cases.filter(x=>x.observations[3].exit==='frontier_budget').length,
  deepCertified:report.cases.filter(x=>x.observations[2].certifiedOptimal).length,
  maxVerifiedGap:Math.max(...report.cases.map(x=>x.observations[2].certifiedGap))
 };
 report.rootDigest=digest({cases:report.cases.map(x=>({id:x.id,input:x.problemHash,
   proofs:x.observations.map(y=>({low:y.lower,high:y.upper,proof:y.certificateHash}))})),
   independent:report.safety.smallIndependentExactCrossChecks});
 report.state='passed';
}catch(e){report.state='failed';report.error=String(e?.stack||e).slice(0,1800)}
finally{
 report.finishedAt=new Date().toISOString();persist();
 console.log('AAU_V12_CERT_STRESS_FINAL='+JSON.stringify({
  state:report.state,modelCalls:0,caseCount:report.cases.length,summary:report.summary??null,
  comparisons:report.cases.map(x=>({id:x.id,n:x.jobCount,seedCost:x.warmBeamCost,
   zero:x.observations[0]?{lb:x.observations[0].lower,ub:x.observations[0].upper}:null,
   small:x.observations[1]?{lb:x.observations[1].lower,ub:x.observations[1].upper,status:x.observations[1].exit}:null,
   deep:x.observations[2]?{lb:x.observations[2].lower,ub:x.observations[2].upper,status:x.observations[2].exit,expanded:x.observations[2].expanded}:null,
   frontier:x.observations[3]?{lb:x.observations[3].lower,ub:x.observations[3].upper,status:x.observations[3].exit,remaining:x.observations[3].remainingFrontier}:null})),
  error:report.error??null,rootProof:!!report.rootDigest}));
 if(report.state!=='passed')process.exitCode=2;
}
