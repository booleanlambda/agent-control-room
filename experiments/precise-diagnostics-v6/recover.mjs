// Research-only: continued cognitive recovery of Kimi's ORIGINAL v5b model-authored
// executable, logically incorrect Python solver. No injected defect, no production state.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {publicProblem,hiddenProblems,specification,grade,digest} from './benchmark.mjs';
import {runIsolatedPython} from '../recursion-tree-v0/unseen-python-sandbox.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes'||process.env.AAU_V6_EXPLICIT_RUN!=='yes')throw Error('ISOLATED_CI_ONLY');
const key=String(process.env.MOONSHOT_API_KEY||'').trim();if(!key)throw Error('KEY_MISSING');
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const previous=JSON.parse(readFileSync(new URL('./previous-evidence/positive-logic-v5b-evidence.json',import.meta.url),'utf8'));
if(previous.experiment!=='AAU_POSITIVE_LOGICAL_SELF_REPAIR_V5B'||previous.state!=='completed_with_case_failures')
 throw Error('PREVIOUS_RUN_MISMATCH');
const case0=previous.cases?.find(x=>x.id==='maintenance_weighted_schedule_v5');
const candidate=case0?.nodes?.find(x=>x.id==='R.repair.2'&&x.kind==='model_authored_repair');
if(!candidate||candidate.status!=='rejected'||typeof candidate.data?.source!=='string'||
 hash(candidate.data.source)!==candidate.data.sourceSha)throw Error('PREVIOUS_SOURCE_PROVENANCE_FAILURE');
if(case0.publicHash!==digest(publicProblem)||case0.hiddenHashes.some((x,i)=>x!==digest(hiddenProblems[i])))
 throw Error('BENCHMARK_HASH_MISMATCH');
const priorCode=candidate.data.source;
const report={experiment:'AAU_PRECISE_DIAGNOSTIC_LOGIC_REPAIR_V6',sourceRunId:39059227910,
 sourceHash:hash(priorCode),scope:'single_worker_recovery_from_previous_saved_model_error',
 model:'kimi-k2.6',thinking:'disabled',providerCalls:0,providerTokens:0,callCeiling:4,
 reportedTokenCeiling:28000,quotaReservations:0,reservationCeiling:69000,
 originalClass:'executable_logical_wrong_answer',requests:[],nodes:[],status:'running',
 preflight:{sourceHash:hash(priorCode),publicInputHash:digest(publicProblem),hiddenHashes:hiddenProblems.map(digest)},
 hidden:null,rootDigest:null,noAutomaticProviderRetry:true,
 caveats:['One new isolated workflow using prior failed model-authored code as input; NOT a continuation of the original process',
 'Hidden grader results and hidden oracle never enter model prompts',
 'GitHub workflow serializes this lane but not all external uses of provider account']};
const fname='precise-recovery-v6-evidence.json';
const save=()=>writeFileSync(fname,JSON.stringify(report,null,2)+'\n');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let previousCallAt=0;
const SYSTEM='You are autonomously repairing YOUR OWN previously model-authored executable but logically incorrect exact Python solver. Diagnose the specific failure using independently computed PUBLIC constraints. Do not fabricate results or hardcode test instances. Do not assume hidden examples or oracle answers. Respond exactly one valid JSON object, no Markdown; all code must be full executable Python 3, under 10000 characters.';
function acceptNode(id,parent,type,data){
 if(parent&&!report.nodes.find(n=>n.id===parent&&n.accepted))throw Error('INVALID_PARENT');
 if(report.nodes.some(n=>n.id===id))throw Error('DUPLICATE_NODE');
 const n={id,parent,type,accepted:true,data,hash:hash({id,parent,type,data})};report.nodes.push(n);save();return n;
}
async function query(label,question,cap){
 if(report.providerCalls>=report.callCeiling||report.providerTokens>=report.reportedTokenCeiling){report.status='budget_exhausted';save();return null;}
 const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(question)}];
 const reserved=Math.ceil(JSON.stringify(messages).length/2)+cap;
 if(report.quotaReservations+reserved>report.reservationCeiling){report.status='reservation_exhausted';save();return null;}
 await wait(Math.max(0,previousCallAt+23000-Date.now()));previousCallAt=Date.now();
 const record={stage:label,started:new Date().toISOString(),reserved,maxTokens:cap,status:'attempt_journaled'};
 report.requests.push(record);report.providerCalls++;report.quotaReservations+=reserved;save();
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),175000);
 try{
  const resp=await fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',redirect:'manual',signal:c.signal,
   headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0.6,max_tokens:cap,
    response_format:{type:'json_object'},stream:false,messages})});
  const data=await resp.json().catch(()=>({}));record.http=resp.status;
  const usage=data?.usage?.total_tokens;
  if(Number.isSafeInteger(usage)&&usage>=0){report.providerTokens+=usage;record.providerTokens=usage;}
  const choice=data?.choices?.[0];record.finish=choice?.finish_reason??null;
  if(!resp.ok){record.status='provider_rejected';record.reason=resp.status===429?'rate_or_concurrency':'http_'+resp.status;report.status='manual_hold';save();return null;}
  if(record.finish!=='stop'||choice?.message?.reasoning_content){record.status='incomplete';report.status='manual_hold';save();return null;}
  let response;try{response=JSON.parse(choice?.message?.content??'')}catch{record.status='invalid_json';report.status='manual_hold';save();return null;}
  if(!response||typeof response!=='object'||Array.isArray(response)){record.status='invalid_shape';report.status='manual_hold';save();return null;}
  record.status='journaled';record.responseDigest=hash(choice.message.content);record.response=response;save();return response;
 }catch(e){record.status='uncertain';record.errorKind=e?.name==='AbortError'?'timeout':'transport';report.status='manual_hold';save();return null}
 finally{clearTimeout(timer)}
}
async function execute(src,input){
 const exec=await runIsolatedPython(src,input);
 return {exec,grade:exec.ok?grade(input,exec.result):{passed:false,reason:exec.error}};
}
function detailPublic(v){
 // DO NOT pass hidden inputs, hidden optimum, oracle solution, or reference algorithms.
 return {ran:v.exec.ok,observed:v.exec.result??null,runError:v.exec.error??null,
  stderr:String(v.exec.stderr||'').slice(0,1100),
  reason:v.grade.reason,publicViolation:v.grade.failure??null,
  observedCost:v.grade.actual??null};
}
const must=(x,error)=>{if(!x){report.status=error;save();throw Error('STOP')}};
try{
 const previousFailure=await execute(priorCode,publicProblem);
 must(previousFailure.exec.ok,'prior_code_not_executable');
 must(!previousFailure.grade.passed&&previousFailure.grade.reason==='release_dependency_or_setup',
  'original_failure_not_reproducible');
 must(previousFailure.grade.failure?.jobId&&
  Number.isSafeInteger(previousFailure.grade.failure?.requiredPredecessorFinish),
  'precise_diagnostic_unavailable');
 report.originalPublicDiagnosis=detailPublic(previousFailure);save();
 acceptNode('R',null,'prior_model_authored_failed_solver',{sourceSha:report.sourceHash,fromRun:report.sourceRunId});
 acceptNode('R.001','R','verified_precise_public_counterexample',{feedback:detailPublic(previousFailure)});
 const response=await query('model_diagnosis',{instruction:'This is YOUR OWN previous fully executable Python solver. It produced a complete JSON answer but violated an exact public constraint. Examine the original Python and the verifier detail including jobId, actualStart, parent finish, machine ready and setup; identify the ROOT LOGICAL CAUSE in algorithm state or transitions. Return {"action":"diagnose","rootCause":"...","invariants":["..."],"repairPlan":"..."}. No new code yet.',specification,publicInput:publicProblem,previousPython:priorCode,precisePublicFailure:detailPublic(previousFailure)},2100);
 must(response&&response.action==='diagnose'&&typeof response.rootCause==='string'&&Array.isArray(response.invariants),'model_diagnosis_invalid');
 acceptNode('R.002','R.001','model_authored_diagnosis',{diagnosis:response});
 let src=priorCode,verification=previousFailure,passed=false,hidden=null;
 for(let k=1;k<=2;k++){
  const answer=await query('repair_'+k,{instruction:'Repair your OWN exact scheduling algorithm, not the public output. Output {"action":"repair","python":"FULL PYTHON 3 EXECUTABLE SOURCE","explanation":"..."}. Source under 9000 characters; do not include comments or test suites. Correct jobs ready according to PREDECESSOR FINISH times; machine setup and maintenance must be correct. Re-evaluate recurrence carefully. Solution must generalize to unseen input. Read one JSON stdin; output one JSON stdout.',specification,publicInput:publicProblem,faultyPython:src,originalModelDiagnosis:response,observedPublicFailure:detailPublic(verification),attempt:k,maxAttempts:2},8500);
  must(answer&&answer.action==='repair'&&typeof answer.python==='string','repair_response_invalid');
  src=answer.python;
  verification=await execute(src,publicProblem);
  const att={attempt:k,sourceSha:hash(src),source:src,public:detailPublic(verification),
   publicPassed:verification.grade.passed};
  report.attempts??=[];report.attempts.push(att);save();
  if(!verification.grade.passed)continue;
  hidden=[];
  for(const p of hiddenProblems){
   const h=await execute(src,p);
   hidden.push({inputHash:digest(p),passed:!!h.grade.passed,gradeReason:h.grade.reason,
    actualCost:h.grade.actual??null,optimalCost:h.grade.optimum??null,
    output:h.exec.result??null});
  }
  report.hidden=hidden;save();
  if(!hidden.every(x=>x.passed)){report.status='hidden_failure_no_leak';save();throw Error('STOP');}
  acceptNode('R.003','R.002','model_repaired_and_independently_verified',{
   attempt:k,sourceSha:hash(src),publicPassed:true,hiddenResults:hidden.map(x=>({hash:x.inputHash,passed:x.passed}))});
  passed=true;break;
 }
 must(passed,'repair_failed_within_two_attempts');
 const s=await query('synthesize',{instruction:'Return {"action":"finish","summary":"...","invariants":["..."],"limits":"..."}. Synthesize original executable logic defect, your model-authored diagnosis and independently verified correction. Do not claim access to hidden test inputs or correct answers.',previousSourceSha:report.sourceHash,repairedSourceSha:hash(src),publicPass:true,hiddenCount:2,modelDiagnosis:response},1300);
 must(s&&s.action==='finish'&&Array.isArray(s.invariants)&&s.invariants.length>=2,'synthesis_failed');
 acceptNode('R.final','R','certified_synthesis',{synthesis:s,hiddenCount:2});
 report.rootDigest=hash({sourceRun:report.sourceRunId,sourceSha:report.sourceHash,
  verifiedNodes:report.nodes.map(x=>({id:x.id,parent:x.parent,hash:x.hash})),
  hidden:report.hidden.map(x=>({inputHash:x.inputHash,pass:x.passed})),
  modelResponses:report.requests.map(x=>x.responseDigest??null)});
 report.status='passed';
}catch(e){if(e.message!=='STOP'){report.status='runner_exception';report.exception=String(e?.message||e).slice(0,200)}}
finally{
 report.finishedAt=new Date().toISOString();save();
 console.log('AAU_PRECISE_DIAG_V6_FINAL='+JSON.stringify({status:report.status,
  sourceRun:report.sourceRunId,providerCalls:report.providerCalls,providerTokens:report.providerTokens,
  originalExecutable:!!report.originalPublicDiagnosis?.ran,
  originalFailure:report.originalPublicDiagnosis?.reason??null,
  offendingJob:report.originalPublicDiagnosis?.publicViolation?.jobId??null,
  attemptedRepairs:report.attempts?.length??0,publicPassed:report.attempts?.at(-1)?.publicPassed??false,
  hiddenPassed:report.hidden?.filter(x=>x.passed).length??0,hiddenCases:hiddenProblems.length,
  diagnosisAuthored:report.nodes.some(x=>x.id==='R.002'),rootCertified:!!report.rootDigest}));
 if(report.status!=='passed')process.exitCode=2;
}
