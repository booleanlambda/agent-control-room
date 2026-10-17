// Continuation of ACTUAL failed model-authored solver from Actions run 39056004458.
// No re-solving first task. This is the same model's own prior bug, journaled and
// replayed from the immutable CI artifact with strict SHA256 provenance.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {publicProblem,hiddenProblems,grade,specification,hash} from './benchmark.mjs';
import {runIsolatedPython} from '../recursion-tree-v0/unseen-python-sandbox.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes'||process.env.AAU_RESUME_REAL_KIMI!=='yes')
 throw Error('RESEARCH_CI_ONLY');
const key=String(process.env.MOONSHOT_API_KEY||'').trim();
if(!key)throw Error('PROVIDER_SECRET_MISSING');
const sha=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const prior=JSON.parse(readFileSync(new URL('./previous-evidence/remediation-v2-evidence.json',import.meta.url),'utf8'));
if(prior.id!=='AAU_SERIAL_REMEDIATION_V2'||prior.state!=='baseline_not_solved')throw Error('WRONG_PREVIOUS_RUN_STATE');
if(prior.calls.length!==3||prior.modelCalls!==3)throw Error('WRONG_PREVIOUS_RUN_PROVENANCE');
const old=prior.nodes.find(n=>n.id==='R.003'&&n.kind==='model_authored_solver');
if(!old||old.state!=='rejected'||typeof old.data?.source!=='string'||sha(old.data.source)!==old.data.pythonSha)
 throw Error('PREVIOUS_SOURCE_HASH_MISMATCH');
if(prior.cases.publicHash!==hash(publicProblem)||prior.cases.hiddenHashes.some((x,i)=>x!==hash(hiddenProblems[i])))
 throw Error('TEST_MATERIAL_MISMATCH');
const original=old.data.source;
const priorReason=prior.baseline?.publicGrade?.reason;
if(priorReason!=='precedence_or_vehicle_violation')throw Error('UNEXPECTED_PREVIOUS_FAILURE');
const report={id:'AAU_SERIAL_COGNITIVE_RECOVERY_V2',sourceRunId:39056004458,
 model:'kimi-k2.6',thinking:'disabled',singleWorker:true,sequential:true,
 originalSourceSha:sha(original),originalPublicFailure:priorReason,
 originalModelCalls:3,originalProviderTokens:prior.providerTokens,
 additionalModelCalls:0,additionalTokens:0,maxAdditionalCalls:5,maxAdditionalReportedTokens:32000,
 reservationCeiling:70000,reserved:0,state:'running',responses:[],nodes:[],rootProof:null};
const evidenceFile='recovery-v2-evidence.json';
const save=()=>writeFileSync(evidenceFile,JSON.stringify(report,null,2)+'\n');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let previousTime=0;
function node(id,parent,kind,state,data){
 if(parent&&!report.nodes.some(x=>x.id===parent&&x.state==='accepted'))throw Error('INVALID_PARENT');
 if(report.nodes.some(x=>x.id===id))throw Error('DUPLICATE_NODE');
 const entry={id,parent,kind,state,data,hash:sha({id,parent,kind,state,data})};report.nodes.push(entry);save();
 return entry;
}
const system='You are continuing YOUR OWN failed Python solver from a prior isolated execution. The original source is exact and the independent public validator rejected it. Your job is to independently diagnose, repair, and prove a reusable exact solver. You are not shown held-out cases. Return ONLY one compact valid JSON object with no Markdown. Do not invent tool results.';
async function query(stage,data,maxTokens){
 if(report.additionalModelCalls>=report.maxAdditionalCalls||report.additionalTokens>=report.maxAdditionalReportedTokens){report.state='budget_exhausted';save();return null;}
 const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify(data)}];
 const reserve=Math.ceil(JSON.stringify(messages).length/2)+maxTokens;
 if(report.reserved+reserve>report.reservationCeiling){report.state='reservation_exhausted';save();return null;}
 const delay=Math.max(0,previousTime+23000-Date.now());if(delay)await wait(delay);previousTime=Date.now();
 const record={stage,status:'provider_call_sent_or_uncertain',at:new Date().toISOString(),reserve,maxTokens};
 report.responses.push(record);report.additionalModelCalls++;report.reserved+=reserve;save();
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),175000);
 try{
  const response=await fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',redirect:'manual',signal:ctrl.signal,
   headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0.6,max_tokens:maxTokens,
    response_format:{type:'json_object'},stream:false,messages})});
  const pkg=await response.json().catch(()=>({}));
  record.http=response.status;
  const tokens=pkg?.usage?.total_tokens;
  if(Number.isSafeInteger(tokens)&&tokens>=0){report.additionalTokens+=tokens;record.providerReportedTokens=tokens;}
  const choice=pkg?.choices?.[0];record.finish=choice?.finish_reason??null;
  if(!response.ok){record.status='provider_rejection';record.reason=response.status===429?'rate_or_account_concurrency':'http_'+response.status;report.state='manual_hold';save();return null;}
  if(record.finish!=='stop'||choice?.message?.reasoning_content){record.status='incomplete';report.state='manual_hold';save();return null;}
  let result;try{result=JSON.parse(choice?.message?.content??'')}catch{record.status='invalid_json';report.state='manual_hold';save();return null;}
  if(!result||typeof result!=='object'||Array.isArray(result)){record.status='invalid_response_shape';report.state='manual_hold';save();return null;}
  record.status='journaled';record.responseSha=sha(choice.message.content);record.result=result;save();return result;
 }catch(e){record.status='uncertain_response';record.errorKind=e?.name==='AbortError'?'timeout':'transport';report.state='manual_hold';save();return null}
 finally{clearTimeout(timer)}
}
function ensure(test,state){if(!test){report.state=state;save();throw Error('HALT')}}
async function validate(source,problem){
 const execution=await runIsolatedPython(source,problem);
 const gradeResult=execution.ok?grade(problem,execution.result):{passed:false,reason:execution.error};
 return {execution,grade:gradeResult};
}
const observed=check=>({completed:check.execution.ok,publicOutput:check.execution.result??null,
 publicError:check.execution.error??null,publicStderr:String(check.execution.stderr||'').slice(0,900),
 verificationReason:check.grade.reason,actualCost:check.grade.actualCost??null});
try{
 const priorCheck=await validate(original,publicProblem);
 ensure(!priorCheck.grade.passed&&priorCheck.grade.reason===priorReason,'failure_not_reproduced');
 node('R',null,'resume_original_failed_mission','accepted',{sourceRun:39056004458,sha:sha(original),problemHash:hash(publicProblem),priorFailure:priorReason});
 node('R.001','R','reproduced_public_failure','accepted',{previousSourceSha:sha(original),publicFailure:observed(priorCheck)});
 const diagnose=await query('diagnosis',{request:'Your previous model-authored solver failed an independent verification on the public scenario. Read your full original code and observed failure. Identify precise logical root cause, provide testable diagnosis and correct approach. Do NOT write code yet. Return {"action":"diagnose","rootCause":"...","faultLocation":"...","repairPlan":"..."}. Hidden data are withheld.',specification,publicInput:publicProblem,ownFailedPython:original,observedPublicFailure:observed(priorCheck)},1700);
 ensure(diagnose&&diagnose.action==='diagnose'&&typeof diagnose.rootCause==='string'&&typeof diagnose.repairPlan==='string','diagnosis_invalid');
 node('R.002','R.001','self_diagnosis','accepted',{diagnose});
 let source=original,check=priorCheck,repair=null,accepted=false;
 for(let k=1;k<=2;k++){
  const answer=await query('repair_attempt_'+k,{request:'Return a COMPLETE corrected general Python3 solver, not a patch fragment. Read one JSON stdin and print exactly one JSON object with optimal valid routes and cost. Repair the root cause from your diagnosis, not merely this sample. Return {"action":"repair","python":"ENTIRE executable Python source","explanation":"..."}. A separate independent hidden grader will test unseen data.',specification,publicInput:publicProblem,failingPython:source,
   modelAuthoredDiagnosis:diagnose,observedPublicFailure:observed(check),attempt:k},7200);
  ensure(answer&&answer.action==='repair'&&typeof answer.python==='string','repair_response_invalid');
  source=answer.python;check=await validate(source,publicProblem);
  const hidden=[];
  if(check.grade.passed){
   for(const p of hiddenProblems){
    const v=await validate(source,p);
    hidden.push({inputHash:hash(p),pass:Boolean(v.grade.passed),reason:v.grade.reason,
      actualCost:v.grade.actualCost??null,optimalCost:v.grade.optimalCost??null,answer:v.execution.result??null});
   }
  }
  const pass=check.grade.passed&&hidden.length===hiddenProblems.length&&hidden.every(x=>x.pass);
  repair={attempt:k,sourceSha:sha(source),source,publicGrade:check.grade,hidden};
  report.lastRepair=repair;save();
  node('R.003.'+k,'R.002','model_repair_candidate',pass?'accepted':'rejected',
   {attempt:k,sourceSha:sha(source),source,publicGrade:check.grade,hidden: hidden.map(x=>({hash:x.inputHash,pass:x.pass,reason:x.reason}))});
  if(pass){accepted=true;break}
  if(check.grade.passed){report.state='hidden_failure_no_leak';save();throw Error('HALT')}
 }
 ensure(accepted,'repair_failed_twice');
 const finish=await query('synthesis',{request:'Conclude your own recovered research problem: describe root cause, structural invariants, code correction, and independent external verification. Return {"action":"finish","summary":"...","invariants":["..."],"limitations":"..."}. Do not assert that you personally saw or ran hidden problems.',ownRootDiagnosis:diagnose,sourceVerification:{publicPass:true,hiddenPassCount:2},repairedSourceSha:repair.sourceSha},1500);
 ensure(finish&&finish.action==='finish'&&Array.isArray(finish.invariants)&&finish.invariants.length>=2,'synthesis_invalid');
 node('R.final','R','bottom_up_verified_synthesis','accepted',{finish,sourceSha:repair.sourceSha,gradePublic:repair.publicGrade,
  hiddenHashProofs:repair.hidden.map(x=>({inputHash:x.inputHash,pass:x.pass}))});
 report.state='passed';report.rootProof=sha({sourceRun:report.sourceRunId,
  earlierSource:report.originalSourceSha,nodes:report.nodes.map(x=>({id:x.id,parent:x.parent,state:x.state,hash:x.hash})),
  hidden:repair.hidden.map(x=>({hash:x.inputHash,pass:x.pass})),providerResponses:report.responses.map(x=>x.responseSha??null)});
}catch(e){if(e.message!=='HALT'){report.state='runtime_exception';report.failure=String(e?.message||e).slice(0,250)}}
finally{
 report.finishedAt=new Date().toISOString();save();
 console.log('AAU_ORGANIC_SELF_REPAIR_RESULT='+JSON.stringify({state:report.state,
  previousModelCalls:report.originalModelCalls,additionalModelCalls:report.additionalModelCalls,
  previousTokens:report.originalProviderTokens,additionalTokens:report.additionalTokens,
  failedSourceReproduced:report.nodes.some(n=>n.id==='R.001'),
  diagnosisComplete:report.nodes.some(n=>n.id==='R.002'),
  repairAccepted:report.nodes.some(n=>n.kind==='model_repair_candidate'&&n.state==='accepted'),
  publicPass:report.lastRepair?.publicGrade?.passed??false,
  hiddenPasses:report.lastRepair?.hidden?.filter(x=>x.pass).length??0,
  hiddenCount:hiddenProblems.length,rootProof:!!report.rootProof}));
 if(report.state!=='passed')process.exitCode=2;
}
