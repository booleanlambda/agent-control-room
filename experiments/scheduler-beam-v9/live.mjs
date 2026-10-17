// AAU V9 isolated: 2 serial Kimi scheduling proposals, bounded V8 local
// optimizer, V9 beam and small exact solver, all checked by independent oracle.
// Never attribute deterministic gains to Kimi.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {optimizeProposal} from '../scheduler-optimization-v8/optimizer.mjs';
import {beamOptimize,exactSmall} from './beam.mjs';
import {publicProblem,hiddenProblems,grade,evaluate,exactOracle,digest} from '../precise-diagnostics-v6/benchmark.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V9_ISOLATED_LIVE!=='yes')
 throw Error('RESEARCH_CI_ONLY');
const key=String(process.env.MOONSHOT_API_KEY||'').trim();
if(!key)throw Error('NO_PROVIDER_KEY');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const baseline={jobs:[{id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
 {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},{id:'J5',machine:'M1'}]};
const report={experiment:'AAU_BOUNDED_BEAM_AND_EXACT_V9',status:'running',singleWorker:true,
 maxConcurrentCalls:1,model:'kimi-k2.6',thinking:'disabled',providerCalls:0,
 providerTokens:0,maxProviderCalls:2,maxReportedTokens:19000,reserved:0,maxReserved:35000,
 autoRetries:false,api:[],modelProposals:[],reference:[],comparisons:{},hidden:[],rootProof:null,
 limitations:['This is one previously used scheduling family, not proof of generalization to new domains',
 'Exact small-case optimum is earned by deterministic exhaustive enumeration; Kimi does not get credit for that',
 'No hidden problem data or oracle answer is disclosed in model prompts']};
const file='beam-v9-evidence.json';const persist=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let prior=0;
const SYSTEM='Act as a scheduling strategy agent. Produce ONLY valid compact JSON: {"action":"propose","strategy":"six words maximum","jobs":[{"id":"J0","machine":"M0"},...]}. Include exactly seven jobs, each once, with parents before descendants and jobs assigned only to eligible machines. Never provide start times, completion times, computed cost, code or long explanations. The trusted scheduler handles all arithmetic. Do not claim to have run tools.';
async function kimi(label,prompt){
 if(report.providerCalls>=report.maxProviderCalls||report.providerTokens>=report.maxReportedTokens){report.status='budget_exhausted';persist();return null;}
 const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(prompt)}],max_tokens=5200;
 const reserve=Math.ceil(JSON.stringify(messages).length/2)+max_tokens;
 if(report.reserved+reserve>report.maxReserved){report.status='reservation_exhausted';persist();return null;}
 await wait(Math.max(0,prior+23000-Date.now()));prior=Date.now();
 const event={label,status:'request_sent_or_uncertain',at:new Date().toISOString(),reserved:reserve};
 report.api.push(event);report.providerCalls++;report.reserved+=reserve;persist();
 const ctrl=new AbortController(),clock=setTimeout(()=>ctrl.abort(),175000);
 try{
  const res=await fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',signal:ctrl.signal,redirect:'manual',
   headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0.6,
    response_format:{type:'json_object'},max_tokens,stream:false,messages})});
  const pkt=await res.json().catch(()=>({}));event.http=res.status;
  const used=pkt?.usage?.total_tokens;
  if(Number.isSafeInteger(used)&&used>=0){report.providerTokens+=used;event.providerTokens=used;}
  const ch=pkt?.choices?.[0];event.finish=ch?.finish_reason??null;
  if(!res.ok){event.status='provider_rejected';event.errorCode=String(pkt?.error?.code??'').slice(0,100);
   report.status='manual_hold';persist();return null;}
  if(event.finish!=='stop'||ch?.message?.reasoning_content){event.status='incomplete';report.status='manual_hold';persist();return null;}
  let output;try{output=JSON.parse(ch?.message?.content??'')}catch{event.status='bad_json';report.status='manual_hold';persist();return null;}
  if(output?.action!=='propose'||!Array.isArray(output.jobs)){event.status='bad_contract';report.status='manual_hold';persist();return null;}
  event.status='journaled';event.resultDigest=sha(output);event.result=output;persist();return output;
 }catch(e){event.status='uncertain_provider_outcome';event.reason=e?.name==='AbortError'?'timeout':'transport';
  report.status='manual_hold';persist();return null;}
 finally{clearTimeout(clock)}
}
const halt=state=>{report.status=state;persist();throw Error('STOP')};
function verify(problem,result){
 const independent=evaluate(problem,{schedule:result.schedule,cost:result.cost});
 if(!independent.ok||independent.cost!==result.cost)return {valid:false,reason:independent.reason??'cost_mismatch'};
 const graded=grade(problem,{schedule:result.schedule,cost:result.cost});
 return {valid:true,optimal:graded.passed,actual:independent.cost,optimum:graded.optimum,
  gap:independent.cost-graded.optimum};
}
function time(fn){
 const start=process.hrtime.bigint();
 const result=fn();
 return {result,elapsedNs:Number(process.hrtime.bigint()-start)};
}
try{
 const tasks=[publicProblem,...hiddenProblems];
 for(const p of tasks){
  const oracle=time(()=>exactOracle(p));
  const exact=time(()=>exactSmall(p));
  if(!exact.result.ok||exact.result.cost!==oracle.result.cost||!verify(p,exact.result.execution).optimal)halt('exact_independent_mismatch');
  report.reference.push({problemHash:digest(p),independentOptimum:oracle.result.cost,
   independentOracleNs:oracle.elapsedNs,exactSmallNs:exact.elapsedNs,
   exactCompleteAssignments:exact.result.searchedCompleteAssignments,
   verified:true,smallCaseOnly:true});persist();
 }
 const base=scheduleCandidate(publicProblem,baseline);
 if(!base.ok||base.cost!==512)halt('historical_baseline_changed');
 const instructions={machines:publicProblem.machines.map(m=>({id:m.id,types:m.types,initialType:m.initialType,setup:m.setup,
  maintenance:m.maintenance,activation:m.activation})),
  jobs:publicProblem.jobs.map(j=>({id:j.id,type:j.type,parents:j.parents,duration:j.duration,release:j.release,due:j.due,weight:j.weight})),
  goal:'Find lower total weighted lateness and activation cost by changing machine choices and topological job order; output no timestamps'};
 const a=await kimi('first_candidate',{input:instructions,historicalBaseline:baseline,verifiedBaselineCost:512,
  instruction:'Give a seven-job valid schedule assignment/order that improves on the baseline. Return ONLY concise JSON.'});
 if(!a)throw Error('STOP');
 const readModel=(x,attempt)=>{
  const proposal={jobs:x.jobs},run=scheduleCandidate(publicProblem,proposal);
  const v=run.ok?verify(publicProblem,run):{valid:false,reason:run.reason,detail:run.detail};
  const entry={attempt,strategy:x.strategy??null,proposal,verdict:v,publicCost:run.ok?run.cost:null,
   ledgerHash:run.ok?run.evidence.ledgerDigest:null};
  report.modelProposals.push(entry);persist();return entry;
 };
 const aa=readModel(a,1);
 const b=await kimi('feedback_refinement',{input:instructions,
  previousProposal:aa.proposal,publicFeedback:aa.verdict,
  baselineCost:512,previousPublicCost:aa.publicCost,
  instruction:'Produce one improved full seven-job assignment/order. If previous invalid, fix. No arithmetic output; concise JSON only.'});
 if(!b)throw Error('STOP');
 const bb=readModel(b,2);
 const valid=report.modelProposals.filter(x=>x.verdict.valid).sort((x,y)=>x.publicCost-y.publicCost);
 const modelBest=valid[0]??null;
 report.modelAttribution={bestValidCost:modelBest?.publicCost??null,
  bestTrial:modelBest?.attempt??null,improvementFromHistorical512:modelBest?512-modelBest.publicCost:null};
 const seeds=[baseline,...valid.map(x=>x.proposal)];
 const v8=time(()=>optimizeProposal(publicProblem,baseline,{maxEvaluations:1200,maxRounds:16}));
 const beamBase=time(()=>beamOptimize(publicProblem,[baseline],{maxEvaluations:1200,beamWidth:12,maxDepth:10}));
 const beamCombined=time(()=>beamOptimize(publicProblem,seeds,{maxEvaluations:1200,beamWidth:12,maxDepth:10}));
 if(!v8.result.ok||!beamBase.result.ok||!beamCombined.result.ok)halt('optimizer_bad_result');
 // Select best feasible candidate; compare fixed budgets and never invent gain.
 const contenders=[
  {name:'v8_local_from_historical_baseline',run:v8.result.execution,proposal:v8.result.proposal},
  {name:'v9_beam_baseline_only',run:beamBase.result.execution,proposal:beamBase.result.proposal},
  {name:'v9_beam_model_augmented',run:beamCombined.result.execution,proposal:beamCombined.result.proposal}
 ];
 contenders.sort((x,y)=>x.run.cost-y.run.cost);
 const chosen=contenders[0];const verdict=verify(publicProblem,chosen.run);
 if(!verdict.valid)halt('independent_verifier_rejected_output');
 report.comparisons={historicalCost:512,
  modelBestCost:modelBest?.publicCost??null,modelBestDelta:modelBest?512-modelBest.publicCost:null,
  v8Local:{cost:v8.result.finalCost,evals:v8.result.evaluations,elapsedNs:v8.elapsedNs},
  v9BeamBaseline:{cost:beamBase.result.finalCost,evals:beamBase.result.evaluations,depth:beamBase.result.depth,elapsedNs:beamBase.elapsedNs},
  v9BeamCombined:{cost:beamCombined.result.finalCost,evals:beamCombined.result.evaluations,depth:beamCombined.result.depth,elapsedNs:beamCombined.elapsedNs},
  certifiedExact:{cost:report.reference[0].independentOptimum,elapsedNs:report.reference[0].exactSmallNs,
   exhaustiveAssignments:report.reference[0].exactCompleteAssignments},
  selected:{source:chosen.name,cost:chosen.run.cost,verdict,proposal:chosen.proposal,
   ledgerDigest:chosen.run.evidence.ledgerDigest}};
 // Separate held-out suitability of the publicly chosen order, no hidden tuning.
 for(const p of hiddenProblems){
  const execution=scheduleCandidate(p,chosen.proposal);
  if(!execution.ok)halt('hidden_execution_invalid');
  const checked=verify(p,execution);if(!checked.valid)halt('hidden_independent_verifier_rejected');
  report.hidden.push({problemHash:digest(p),cost:execution.cost,grade:checked,
   withheldFromKimi:true,ledgerDigest:execution.evidence.ledgerDigest});persist();
 }
 report.rootProof=sha({calls:report.api.map(x=>x.resultDigest??null),models:report.modelProposals,
  methods:report.comparisons,hidden:report.hidden,oracle:report.reference});
 report.status=valid.length?'passed':'model_invalid_deterministic_still_safe';
}catch(e){if(e.message!=='STOP'){report.status='runner_exception';report.exception=String(e?.message||e).slice(0,250)}}
finally{
 report.finishedAt=new Date().toISOString();persist();
 console.log('AAU_V9_SEARCH_RESULT='+JSON.stringify({status:report.status,
  calls:report.providerCalls,tokens:report.providerTokens,
  modelCosts:report.modelProposals.map(x=>x.publicCost),
  historicalCost:report.comparisons.historicalCost??null,
  v8Cost:report.comparisons.v8Local?.cost??null,
  v9BaselineCost:report.comparisons.v9BeamBaseline?.cost??null,
  v9AugmentedCost:report.comparisons.v9BeamCombined?.cost??null,
  exactOptimum:report.comparisons.certifiedExact?.cost??null,
  selectedCost:report.comparisons.selected?.cost??null,
  chosenMethod:report.comparisons.selected?.source??null,
  hiddenValid:report.hidden.filter(x=>x.grade.valid).length,
  hiddenCosts:report.hidden.map(x=>x.cost),hiddenOptima:report.hidden.map(x=>x.grade.optimum),
  rootProof:!!report.rootProof}));
 if(report.status!=='passed')process.exitCode=2;
}
