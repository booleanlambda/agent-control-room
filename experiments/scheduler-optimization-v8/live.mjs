// Isolated AAU V8: Kimi makes candidate decisions; trusted kernel schedules;
// bounded deterministic neighborhood improver improves without relaxing checks.
// Separate Kimi-attributable gains from engine-attributable gains.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {publicProblem,hiddenProblems,grade,evaluate,exactOracle,digest} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate,searchBestCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {optimizeProposal} from './optimizer.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V8_LIVE!=='yes')
 throw Error('RESEARCH_ONLY_NOT_AUTHORIZED');
const key=String(process.env.MOONSHOT_API_KEY||'').trim();if(!key)throw Error('PROVIDER_CREDENTIAL_MISSING');
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const baseline={jobs:[{id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
 {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},{id:'J5',machine:'M1'}]};
const report={experiment:'AAU_SERIAL_AGENT_GUIDED_SCHEDULE_OPTIMIZATION_V8',model:'kimi-k2.6',
 thinking:'disabled',workerCount:1,modelWritesTimingCode:false,
 publicHash:digest(publicProblem),hiddenHashes:hiddenProblems.map(digest),
 modelCalls:0,modelTokens:0,maxModelCalls:2,maxReportedTokens:14000,
 reserved:0,maxReservationUnits:30000,noAmbiguousProviderRetries:true,api:[],
 state:'running',baseline:null,modelTrials:[],independentOracles:[],
 optimizer:null,hiddenVerification:null,rootProof:null,
 limitations:['Two calls and one schedule family do not establish robust model optimization',
 'Deterministic engine gains must NOT be attributed to Kimi',
 'Hidden oracle data never appears in model prompts']};
const file='optimization-v8-evidence.json',persist=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let lastTime=0;
const SYS='You are choosing topological job order and machine assignment only. All times, penalties and legal setup windows are calculated by a trusted deterministic scheduler. Your task is to improve the verified scheduling cost. Submit only JSON {"action":"propose","strategy":"...","jobs":[{"id":"J0","machine":"M0"},...]}. Every job exactly once; all parents must occur earlier than children; machines must be eligible. No timestamps, costs or extra fields in jobs. No code. Never claim that you ran an experiment.';
async function kimi(stage,prompt){
 if(report.modelCalls>=report.maxModelCalls||report.modelTokens>=report.maxReportedTokens){report.state='budget_exhausted';persist();return null;}
 const messages=[{role:'system',content:SYS},{role:'user',content:JSON.stringify(prompt)}],cap=2200;
 const reserve=Math.ceil(JSON.stringify(messages).length/2)+cap;
 if(report.reserved+reserve>report.maxReservationUnits){report.state='reservation_exhausted';persist();return null;}
 await sleep(Math.max(0,lastTime+23000-Date.now()));lastTime=Date.now();
 const call={stage,status:'request_sent_or_uncertain',at:new Date().toISOString(),reserved:reserve};
 report.api.push(call);report.modelCalls++;report.reserved+=reserve;persist();
 const ctrl=new AbortController(),clock=setTimeout(()=>ctrl.abort(),175000);
 try{
  const res=await fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',signal:ctrl.signal,redirect:'manual',
   headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0.6,max_tokens:cap,
    response_format:{type:'json_object'},stream:false,messages})});
  const obj=await res.json().catch(()=>({}));call.http=res.status;
  const t=obj?.usage?.total_tokens;if(Number.isSafeInteger(t)&&t>=0){report.modelTokens+=t;call.tokens=t;}
  const choice=obj?.choices?.[0];call.finish=choice?.finish_reason??null;
  if(!res.ok){call.status='provider_rejected';call.errorCode=obj?.error?.code??null;report.state='manual_hold';persist();return null;}
  if(call.finish!=='stop'||choice?.message?.reasoning_content){call.status='truncated_or_reasoning';report.state='manual_hold';persist();return null;}
  let result;try{result=JSON.parse(choice?.message?.content??'')}catch{call.status='malformed_json';report.state='manual_hold';persist();return null;}
  if(result?.action!=='propose'||!Array.isArray(result.jobs)){call.status='malformed_contract';report.state='manual_hold';persist();return null;}
  call.status='journaled';call.digest=sha(result);call.result=result;persist();return result;
 }catch(e){call.status='transport_uncertain';call.kind=e?.name==='AbortError'?'timeout':'transport';report.state='manual_hold';persist();return null;}
 finally{clearTimeout(clock)}
}
const check=(p,solution)=>{
 const independent=evaluate(p,{schedule:solution.schedule,cost:solution.cost});
 if(!independent.ok||independent.cost!==solution.cost)return {valid:false,reason:independent.reason??'cost_disagreement'};
 const gradeResult=grade(p,{schedule:solution.schedule,cost:solution.cost});
 return {valid:true,optimal:gradeResult.passed,observedCost:solution.cost,
  optimum:gradeResult.optimum,optimalityGap:solution.cost-gradeResult.optimum};
};
const halt=state=>{report.state=state;persist();throw Error('STOP')};
const assess=(answer,index)=>{
 const proposal={jobs:answer.jobs};
 const computed=scheduleCandidate(publicProblem,proposal);
 const result={attempt:index,strategy:answer.strategy??null,proposal,status:computed.ok?'valid':'rejected',
  public:computed.ok?{cost:computed.cost,verification:check(publicProblem,computed),ledgerDigest:computed.evidence.ledgerDigest}:
    {reason:computed.reason,detail:computed.detail}};
 report.modelTrials.push(result);persist();return result;
};
try{
 // Zero-provider-cost independent proof that deterministic kernel and exact oracle match.
 for(const problem of [publicProblem,...hiddenProblems]){
  const exact=exactOracle(problem),found=searchBestCandidate(problem);
  if(!found.ok||found.cost!==exact.cost)halt('kernel_oracle_disagreement');
  const verification=check(problem,found);
  if(!verification.valid||!verification.optimal)halt('kernel_independent_reference_failure');
  report.independentOracles.push({hash:digest(problem),exactCost:exact.cost,
   trustedKernelCost:found.cost,verified:true,proof:found.evidence.ledgerDigest});persist();
 }
 const prev=scheduleCandidate(publicProblem,baseline);
 if(!prev.ok||prev.cost!==512||!check(publicProblem,prev).valid)halt('historical_baseline_invalid');
 report.baseline={proposal:baseline,cost:prev.cost,hash:sha(baseline)};persist();
 const publicInfo={machines:publicProblem.machines.map(m=>({id:m.id,types:m.types,initialType:m.initialType,setup:m.setup,maintenance:m.maintenance})),
  jobs:publicProblem.jobs.map(j=>({id:j.id,type:j.type,parents:j.parents,release:j.release,duration:j.duration,due:j.due,weight:j.weight})),
  objective:'sum weighted late penalties and once-per-used-machine activation fees',
  activation:publicProblem.machines.map(m=>({machine:m.id,fee:m.activation}))};
 const first=await kimi('candidate_1',{instruction:'Improve the trusted prior candidate. You control assignment/order ONLY. Find an eligible topological order expected to lower public cost. No dates/times/costs in output.',publicSpecification:publicInfo,originalProposal:baseline,originalVerifiedCost:prev.cost});
 if(!first)throw Error('STOP');
 const firstGrade=assess(first,1);
 const second=await kimi('candidate_2',{instruction:'Improve on prior public cost using ONLY model-authored assignments/order. Fix any rejection; choose deliberate optimization. No timestamps or costs in jobs. Return a full jobs array.',publicSpecification:publicInfo,originalCost:prev.cost,
  previousProposal:firstGrade.proposal,previousFeedback:firstGrade.public,
  priorBestPublicCost:firstGrade.status==='valid'?Math.min(512,firstGrade.public.cost):512});
 if(!second)throw Error('STOP');
 assess(second,2);
 const valid=report.modelTrials.filter(x=>x.status==='valid');
 valid.sort((a,b)=>a.public.cost-b.public.cost);
 const modelBest=valid[0]??null;
 report.modelBest=modelBest?{attempt:modelBest.attempt,cost:modelBest.public.cost,publicGap:modelBest.public.verification.optimalityGap,
  improvementFromHistoricalBaseline:512-modelBest.public.cost,proposal:modelBest.proposal}:null;
 // Attribution is explicit: if all model candidates are worse, deterministic baseline is retained.
 const seed=modelBest&&modelBest.public.cost<512?modelBest.proposal:baseline;
 const seedSource=seed===baseline?'historical_baseline':'kimi_model_candidate';
 const optimized=optimizeProposal(publicProblem,seed,{maxEvaluations:1100,maxRounds:16,mode:'both'});
 if(!optimized.ok)halt('deterministic_optimizer_failure');
 const verdict=check(publicProblem,optimized.execution);
 if(!verdict.valid||!optimized.trace.every(x=>x.nextCost<x.previousCost))halt('optimizer_invariant_failure');
 report.optimizer={seedSource,seedCost:optimized.baselineCost,finalCost:optimized.finalCost,
  gainFromSeed:optimized.baselineCost-optimized.finalCost,
  independentVerdict:verdict,proposal:optimized.proposal,trace:optimized.trace,
  evaluations:optimized.evaluations,rounds:optimized.rounds,evidence:optimized.evidence};
 // Same public-learned optimized assignment is tested on hidden changed timing inputs.
 report.hiddenVerification=[];
 for(const p of hiddenProblems){
  const scheduled=scheduleCandidate(p,optimized.proposal);
  if(!scheduled.ok)halt('hidden_schedule_invalid');
  const truth=check(p,scheduled);
  if(!truth.valid)halt('hidden_independent_grade_failed');
  report.hiddenVerification.push({hash:digest(p),modelDidNotSeeInput:true,
   observedCost:scheduled.cost,independentVerdict:truth,ledgerDigest:scheduled.evidence.ledgerDigest});
 }
 const nodes=[{id:'R',parent:null,source:'model',digest:sha(report.modelTrials.map(x=>({proposal:x.proposal,status:x.status})))},
  {id:'R.001',parent:'R',source:'deterministic_optimizer',digest:sha(report.optimizer)},
  {id:'R.002',parent:'R.001',source:'independent_verifier',digest:sha({public:verdict,hidden:report.hiddenVerification})}];
 report.nodes=nodes;
 report.rootProof=sha({nodes,referenceChecks:report.independentOracles,
  receipts:report.api.map(x=>x.digest??null),finalProposal:sha(optimized.proposal)});
 report.state='passed';persist();
}catch(e){if(e.message!=='STOP'){report.state='runner_exception';report.error=String(e?.message||e).slice(0,200)}}
finally{
 report.finishedAt=new Date().toISOString();persist();
 console.log('AAU_SCHEDULER_OPTIMIZATION_V8='+JSON.stringify({state:report.state,
  calls:report.modelCalls,tokens:report.modelTokens,modelTrialCosts:report.modelTrials.map(x=>x.status==='valid'?x.public.cost:null),
  modelBestCost:report.modelBest?.cost??null,modelImprovement:report.modelBest?.improvementFromHistoricalBaseline??null,
  baselineCost:report.baseline?.cost??null,optimizerSeedCost:report.optimizer?.seedCost??null,
  optimizedCost:report.optimizer?.finalCost??null,optimizerGain:report.optimizer?.gainFromSeed??null,
  publicOptimum:report.independentOracles[0]?.exactCost??null,
  hiddenCosts:report.hiddenVerification?.map(x=>x.observedCost)??null,
  hiddenOptima:report.independentOracles.slice(1).map(x=>x.exactCost),
  hiddenFeasible:report.hiddenVerification?.filter(x=>x.independentVerdict.valid).length??0,
  rootProof:!!report.rootProof}));
 if(report.state!=='passed')process.exitCode=2;
}
