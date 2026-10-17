// AAU V7 — isolated, one-worker, no model-written timing logic.
// Kimi submits only a topological job order and eligible machine assignment.
// The trusted kernel computes all timing/cost; the separate verifier grades it.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {publicProblem,hiddenProblems,grade,evaluate,exactOracle,digest} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate,searchBestCandidate} from './kernel.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V7_LIVE!=='yes')throw Error('RESEARCH_ONLY_CI');
const apiKey=String(process.env.MOONSHOT_API_KEY||'').trim();
if(!apiKey)throw Error('MOONSHOT_KEY_MISSING');
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const report={experiment:'AAU_DETERMINISTIC_SCHEDULER_KERNEL_V7',mode:'isolated_serial',
 model:'kimi-k2.6',thinking:'disabled',workers:1,modelWritesCode:false,
 verifiedProblemHashes:[publicProblem,...hiddenProblems].map(digest),
 calls:[],modelCallCount:0,modelTokens:0,maxModelCalls:3,maxReportedTokens:19000,
 reserved:0,maxReserved:47000,autoRetries:false,
 state:'running',proposals:[],independentChecks:[],rootProof:null,
 notes:['Same scheduling benchmark family used in V6, not a new domain',
 'Kimi never executes or supplies its own timing code',
 'Hidden problem content, oracle and optimum never sent to model',
 'The kernel exact search is cross-checked against a separate exhaustive oracle',
 'Model proposal quality is not equated to global optimization']};
const filepath='kernel-v7-evidence.json';const save=()=>writeFileSync(filepath,JSON.stringify(report,null,2)+'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let lastCall=0;
const SYSTEM='You control a scheduling agent. You are not allowed to calculate, supply or guess numeric scheduling timestamps. You can only choose job order and machine assignments. Return exactly one JSON object with {"action":"propose","strategy":"...","jobs":[{"id":"J0","machine":"M0"},...]}, every job exactly once in order (predecessors before dependent job), assigned to an eligible machine. Do not include start, finish, costs or invented execution results. You may use the provided public task specification and problem, but hidden inputs are unavailable.';
async function ask(label,payload,cap){
 if(report.modelCallCount>=report.maxModelCalls||report.modelTokens>=report.maxReportedTokens){report.state='budget_exhausted';save();return null;}
 const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(payload)}];
 const reservation=Math.ceil(JSON.stringify(messages).length/2)+cap;
 if(report.reserved+reservation>report.maxReserved){report.state='reservation_exhausted';save();return null;}
 await sleep(Math.max(0,lastCall+23000-Date.now()));lastCall=Date.now();
 const entry={label,status:'sent_or_uncertain',startedAt:new Date().toISOString(),reservation,maxOutputTokens:cap};
 report.calls.push(entry);report.modelCallCount++;report.reserved+=reservation;save();
 const controller=new AbortController(),alarm=setTimeout(()=>controller.abort(),175000);
 try{
  const response=await fetch('https://api.moonshot.ai/v1/chat/completions',{
   method:'POST',signal:controller.signal,redirect:'manual',
   headers:{authorization:'Bearer '+apiKey,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0.45,
    response_format:{type:'json_object'},max_tokens:2200,stream:false,messages})});
  const packet=await response.json().catch(()=>({}));entry.http=response.status;
  const tokens=packet?.usage?.total_tokens;
  if(Number.isSafeInteger(tokens)&&tokens>=0){report.modelTokens+=tokens;entry.reportedTokens=tokens;}
  const choice=packet?.choices?.[0];entry.finish=choice?.finish_reason??null;
  if(!response.ok){entry.status='provider_rejected';entry.reason=response.status===429?'rate_limit_or_concurrency':'http_'+response.status;report.state='manual_hold';save();return null;}
  if(entry.finish!=='stop'||choice?.message?.reasoning_content){entry.status='incomplete';report.state='manual_hold';save();return null;}
  let result;try{result=JSON.parse(choice?.message?.content??'')}catch{entry.status='invalid_json';report.state='manual_hold';save();return null;}
  if(!result||result.action!=='propose'||!Array.isArray(result.jobs)){entry.status='bad_contract';report.state='manual_hold';save();return null;}
  entry.status='journaled';entry.answerDigest=hash(result);entry.answer=result;save();return result;
 }catch(e){entry.status='transport_uncertain';entry.reason=e?.name==='AbortError'?'client_timeout':'transport';report.state='manual_hold';save();return null;}
 finally{clearTimeout(alarm)}
}
const failure=label=>{report.state=label;save();throw Error('STOP');};
const certified=(problem,result)=>{
 const check=evaluate(problem,{schedule:result.schedule,cost:result.cost});
 if(!check.ok||check.cost!==result.cost)return {valid:false,reason:check.reason??'cost_mismatch'};
 // independent grade also compares exact optimum and penalizes suboptimal feasible schedules.
 const g=grade(problem,{schedule:result.schedule,cost:result.cost});
 return {valid:check.ok&&check.cost===result.cost,optimal:g.passed,reason:g.reason,
  observedCost:check.cost,certifiedOptimum:g.optimum??null,optimalityGap:g.optimum===undefined?null:check.cost-g.optimum};
};
try{
 // Validate kernel via exact independent oracle BEFORE any paid call.
 for(const p of [publicProblem,...hiddenProblems]){
  const optimum=exactOracle(p);
  const candidate=searchBestCandidate(p);
  if(!candidate.ok||candidate.cost!==optimum.cost)failure('kernel_oracle_mismatch');
  const chk=certified(p,candidate);
  if(!chk.valid||!chk.optimal)failure('independent_kernel_certification_failed');
  report.independentChecks.push({problemHash:digest(p),optimum:optimum.cost,
   kernelCost:candidate.cost,independentlyCertified:true,ledgerDigest:candidate.evidence.ledgerDigest});
  save();
 }
 const spec={task:'Choose assignment and topological processing order of all public jobs. The deterministic runtime will automatically insert legal setup times, releases, parent finish times, maintenance shifts and activation fees. Do not invent clocks.',
  machines:publicProblem.machines.map(m=>({id:m.id,types:m.types,initialType:m.initialType})),
  jobs:publicProblem.jobs.map(j=>({id:j.id,type:j.type,parents:j.parents})),
  output:'One JSON object action propose, strategy and jobs array containing id and machine only'};
 const first=await ask('candidate_1',{task:spec,publicInput:publicProblem,instruction:'Select a sensible order and eligible machine assignment for the scheduling task. You may reason about objectives, but return no timestamps or costs.'},2200);
 if(!first)throw Error('STOP');
 let proposal={jobs:first.jobs},result=scheduleCandidate(publicProblem,proposal);
 report.proposals.push({attempt:1,modelStrategy:first.strategy??null,proposal,publicResult:result});save();
 if(!result.ok){
  const second=await ask('public_constraint_repair',{task:spec,publicInput:publicProblem,
   priorProposal:proposal,deterministicPublicFailure:{reason:result.reason,detail:result.detail},
   instruction:'Your assignment/order was rejected. Reorder or reassign as needed; submit a complete corrected jobs list only. No timing fields.'},2200);
  if(!second)throw Error('STOP');
  proposal={jobs:second.jobs};result=scheduleCandidate(publicProblem,proposal);
  report.proposals.push({attempt:2,modelStrategy:second.strategy??null,proposal,publicResult:result});save();
 }
 if(!result.ok)failure('public_candidate_rejected_after_revision');
 const publicCheck=certified(publicProblem,result);
 if(!publicCheck.valid)failure('independent_public_verifier_rejected_kernel');
 // Same assignment/order is re-evaluated on hidden varying timings. This tests
 // kernel generality, NOT whether model knows hidden conditions or global optima.
 const hidden=[];
 for(const p of hiddenProblems){
  const executed=scheduleCandidate(p,proposal);
  const verdict=executed.ok?certified(p,executed):{valid:false,reason:executed.reason};
  hidden.push({problemHash:digest(p),kernel:executed,verdict});
  if(!verdict.valid)failure('hidden_kernel_or_verifier_mismatch');
 }
 report.finalProposal=proposal;
 report.finalPublic={kernel:result,verdict:publicCheck};
 report.finalHidden=hidden;save();
 const nodes=[
  {id:'R',parent:null,kind:'agent_assignment',proof:hash(proposal)},
  {id:'R.001',parent:'R',kind:'trusted_kernel_execution',proof:hash({public:result.evidence,hidden:hidden.map(x=>x.kernel.evidence)})},
  {id:'R.002',parent:'R.001',kind:'independent_verification',proof:hash({public:publicCheck,hidden:hidden.map(x=>x.verdict)})}
 ];
 report.nodes=nodes;
 report.rootProof=hash({nodes,oracleCrossChecks:report.independentChecks,modelAnswers:report.calls.map(x=>x.answerDigest??null)});
 report.state='passed';save();
}catch(e){if(e.message!=='STOP'){report.state='runtime_failure';report.error=String(e?.message||e).slice(0,250)}}
finally{
 report.finishedAt=new Date().toISOString();save();
 console.log('AAU_V7_KERNEL_RESULT='+JSON.stringify({state:report.state,calls:report.modelCallCount,tokens:report.modelTokens,
  acceptedModelProposal:!!report.finalProposal,kernelOracleCases:report.independentChecks.filter(x=>x.independentlyCertified).length,
  independentPublicVerified:!!report.finalPublic?.verdict?.valid,
  modelPublicOptimal:report.finalPublic?.verdict?.optimal??null,
  modelPublicCost:report.finalPublic?.verdict?.observedCost??null,
  publicOptimum:report.finalPublic?.verdict?.certifiedOptimum??null,
  hiddenIndependentFeasible:report.finalHidden?.filter(x=>x.verdict.valid).length??0,
  hiddenTotal:hiddenProblems.length,
  hiddenOptimal:report.finalHidden?.filter(x=>x.verdict.optimal).length??0,
  rootProof:!!report.rootProof}));
 if(report.state!=='passed')process.exitCode=2;
}
