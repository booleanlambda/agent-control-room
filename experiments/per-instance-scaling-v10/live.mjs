// AAU V10: per-instance fresh deterministic optimization of 7/9/10/12 jobs.
// One optional Kimi proposal on PUBLIC 10-job instance. Other inputs held out.
// No false optimality claim beyond independently certified <=8-job cases.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixtures,scaling,seven,topologicalSeeds,compareInstance,admissibleLowerBound,hash} from './bench.mjs';
import {beamOptimize} from '../scheduler-beam-v9/beam.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {evaluate,exactOracle} from '../precise-diagnostics-v6/benchmark.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V10_RESEARCH!=='yes')throw Error('ISOLATED_ONLY');
const key=String(process.env.MOONSHOT_API_KEY||'').trim();if(!key)throw Error('CREDENTIAL_MISSING');
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const report={experiment:'AAU_PER_INSTANCE_SCALING_V10',workerCount:1,parallelProviderCalls:0,
 model:'kimi-k2.6',thinking:'disabled',state:'running',
 publicInputId:'new_ten_jobs',hiddenIds:['new_nine_jobs','new_twelve_jobs'],
 scenarios:[],modelTrials:[],providerCalls:0,providerTokens:0,maxCalls:2,
 maxReportedTokens:14000,reserved:0,reservationCeiling:32000,providerEvents:[],
 providerRetryPolicy:'no automatic resend on uncertainty or rejection',
 limits:{maxEvaluations:1400,beamWidth:12,maxDepth:9,exactJobLimit:8},
 rootProof:null,
 caveats:['Lower bound is mathematically admissible but may be loose on 9-12 jobs',
 'Hidden model generalization cannot be inferred from Kimi seeing only one 10-job input',
 'Model gains are attributed separately from deterministic optimizer gains',
 'Per-instance beam is a heuristic for 9+ jobs; no exact optimality claim']};
const file='per-instance-v10-evidence.json',save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));let lastTime=0;
const SYSTEM='Provide only one compact valid JSON object: {"action":"propose","strategy":"short","jobs":[{"id":"J0","machine":"M0"},...]}. Choose the machine assignments and a topological order for ALL TEN jobs exactly once. Parents appear before children. Eligible machine only. Do NOT output start/finish times, costs, Python, explanation beyond short strategy, or any extra fields in jobs. The trusted deterministic runtime owns time and cost.';
async function kimi(stage,input){
 if(report.providerCalls>=report.maxCalls||report.providerTokens>=report.maxReportedTokens){report.state='budget_exhausted';save();return null;}
 const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(input)}];
 const cap=5200,reserve=Math.ceil(JSON.stringify(messages).length/2)+cap;
 if(report.reserved+reserve>report.reservationCeiling){report.state='reservation_exhausted';save();return null;}
 await pause(Math.max(0,lastTime+23000-Date.now()));lastTime=Date.now();
 const attempt={stage,status:'sent_or_uncertain',at:new Date().toISOString(),reserve};
 report.providerEvents.push(attempt);report.providerCalls++;report.reserved+=reserve;save();
 const control=new AbortController(),timeout=setTimeout(()=>control.abort(),175000);
 try{
  const res=await fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',
   signal:control.signal,redirect:'manual',headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0.6,
    max_tokens:cap,response_format:{type:'json_object'},stream:false,messages})});
  const body=await res.json().catch(()=>({}));attempt.http=res.status;
  const used=body?.usage?.total_tokens;
  if(Number.isSafeInteger(used)&&used>=0){report.providerTokens+=used;attempt.reportedTokens=used;}
  const choice=body?.choices?.[0];attempt.finish=choice?.finish_reason??null;
  if(!res.ok){attempt.status='provider_rejected';attempt.errorCode=String(body?.error?.code??'').slice(0,100);
   report.state='manual_hold';save();return null;}
  if(attempt.finish!=='stop'||choice?.message?.reasoning_content){attempt.status='incomplete_response';
   report.state='manual_hold';save();return null;}
  let answer;try{answer=JSON.parse(choice?.message?.content??'')}catch{attempt.status='invalid_json';
   report.state='manual_hold';save();return null;}
  if(answer?.action!=='propose'||!Array.isArray(answer.jobs)){attempt.status='bad_contract';
   report.state='manual_hold';save();return null;}
  attempt.status='journaled';attempt.answerHash=sha(answer);attempt.answer=answer;save();return answer;
 }catch(e){attempt.status='uncertain_outcome';attempt.kind=e?.name==='AbortError'?'timeout':'transport';
  report.state='manual_hold';save();return null;}
 finally{clearTimeout(timeout)}
}
const halt=x=>{report.state=x;save();throw Error('STOP')};
const validate=(p,result)=>{
 const r=evaluate(p,{schedule:result.schedule,cost:result.cost});
 return {feasible:r.ok&&r.cost===result.cost,reason:r.reason??null,
  observedCost:r.ok?r.cost:null};
};
try{
 // All deterministic evaluation must be completed BEFORE provider calls.
 for(const {id,size,problem,exactKnown} of fixtures){
  const start=process.hrtime.bigint();
  const out=compareInstance(problem,{...report.limits});
  const ns=Number(process.hrtime.bigint()-start);
  const valid=validate(problem,out.beamExecution);
  if(!valid.feasible||out.beamCost<out.lowerBound||out.evaluations>report.limits.maxEvaluations)
   halt('kernel_or_bound_failure');
  if(exactKnown&&(out.exactOptimalCost!==exactOracle(problem).cost))halt('exact_reference_disagreement');
  report.scenarios.push({id,size,problemHash:hash(problem),
   initialSeedCost:out.baseline,beamCost:out.beamCost,
   lowerBound:out.lowerBound,certifiedGapUpper:out.lowerBoundGap,
   exactOptimum:out.exactOptimalCost,exactGap:out.exactGap,
   provablyOptimal:out.provablyOptimal,evaluations:out.evaluations,
   validEvaluations:out.validEvaluations,depth:out.beamIterations,
   elapsedNs:ns,independentVerification:valid,proof:out.beamEvidence});
  save();
 }
 const target=scaling.find(x=>x.size===10).problem;
 const publicInfo={machines:target.machines,jobs:target.jobs};
 const baseline=report.scenarios.find(x=>x.id==='new_ten_jobs');
 const proposalInput={instruction:'Assign each job to an eligible machine and order so all parents precede children. Minimize weighted tardiness and activation; output just compact jobs JSON, no time/cost fields.',problem:publicInfo,
  referenceFeasibleCost:baseline.initialSeedCost,independentBound:admissibleLowerBound(target).value};
 let model=await kimi('ten_job_initial',proposalInput);
 if(!model)throw Error('STOP');
 let seed={jobs:model.jobs},evaluated=scheduleCandidate(target,seed);
 report.modelTrials.push({attempt:1,proposal:seed,success:evaluated.ok,
  cost:evaluated.ok?evaluated.cost:null,failure:evaluated.ok?null:{reason:evaluated.reason,detail:evaluated.detail}});save();
 if(!evaluated.ok){
  model=await kimi('ten_job_public_revision',{problem:publicInfo,
   previousProposal:seed,publicFailure:{reason:evaluated.reason,detail:evaluated.detail},
   instruction:'Your previous assignment/order was rejected. Supply a complete corrected legal ten-job assignment/order only.'});
  if(!model)throw Error('STOP');
  seed={jobs:model.jobs};evaluated=scheduleCandidate(target,seed);
  report.modelTrials.push({attempt:2,proposal:seed,success:evaluated.ok,
   cost:evaluated.ok?evaluated.cost:null,failure:evaluated.ok?null:{reason:evaluated.reason,detail:evaluated.detail}});save();
 }
 if(!evaluated.ok)halt('model_proposal_invalid_after_revision');
 const start=process.hrtime.bigint();
 const augmented=beamOptimize(target,[...topologicalSeeds(target),seed].slice(0,20),{...report.limits});
 const elapsedNs=Number(process.hrtime.bigint()-start);
 if(!augmented.ok||!validate(target,augmented.execution).feasible||augmented.finalCost<admissibleLowerBound(target).value)
  halt('model_augmented_optimizer_invalid');
 report.modelExperiment={
  proposedCost:evaluated.cost,publicBaselineSeedCost:baseline.initialSeedCost,
  deterministicOnlyCost:baseline.beamCost,
  augmentedBeamCost:augmented.finalCost,
  deterministicGainFromModelSeed:evaluated.cost-augmented.finalCost,
  incrementalGainVsDeterministicOnly:baseline.beamCost-augmented.finalCost,
  independentLegal:true,evaluations:augmented.evaluations,elapsedNs,
  evidence:augmented.evidence,lowerBound:admissibleLowerBound(target).value};
 // Hidden 9/12 remain unshown to Kimi. Each has its OWN independent beam.
 report.rootProof=sha({scenarios:report.scenarios.map(x=>({id:x.id,hash:x.problemHash,proof:x.proof,independent:x.independentVerification})),
  model:report.modelExperiment,providerReceipts:report.providerEvents.map(x=>x.answerHash??null)});
 report.state='passed';
}catch(e){if(e.message!=='STOP'){report.state='runner_exception';report.exception=String(e?.message||e).slice(0,260)}}
finally{
 report.finishedAt=new Date().toISOString();save();
 console.log('AAU_V10_PER_INSTANCE_RESULT='+JSON.stringify({status:report.state,calls:report.providerCalls,
  tokens:report.providerTokens,scenarios:report.scenarios.map(x=>({id:x.id,size:x.size,
   baseline:x.initialSeedCost,beam:x.beamCost,lowerBound:x.lowerBound,exact:x.exactOptimum,
   certifiableGapUpper:x.certifiedGapUpper,evaluations:x.evaluations,feasible:x.independentVerification.feasible})),
  modelProposals:report.modelTrials.map(x=>({success:x.success,cost:x.cost})),
  modelAugmented:report.modelExperiment?{modelCost:report.modelExperiment.proposedCost,
   augmentedBeamCost:report.modelExperiment.augmentedBeamCost,
   deterministicOnlyCost:report.modelExperiment.deterministicOnlyCost,
   incrementalGain:report.modelExperiment.incrementalGainVsDeterministicOnly}:null,
  rootProof:!!report.rootProof}));
 if(report.state!=='passed')process.exitCode=2;
}
