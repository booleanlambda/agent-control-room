import {writeFileSync} from 'node:fs';
import {preflightCase,FAULTS} from './unfamiliar-fault-cases.mjs';
import {TASKS,grade} from './unseen-python-benchmarks.mjs';
import {runIsolatedPython} from './unseen-python-sandbox.mjs';
const mode=process.argv[2]||'preflight';
const file='unfamiliar-fault-live-results.json';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes')
 throw Error('CI_SANDBOX_ONLY');
if(mode!=='preflight'&&mode!=='live')throw Error('UNKNOWN_MODE');
const live=mode==='live';
if(live&&process.env.AAU_UNFAMILIAR_REAL_KIMI!=='yes')
 throw Error('LIVE_NOT_AUTHORIZED');
const key=String(process.env.MOONSHOT_API_KEY||'').trim();
if(live&&!key)throw Error('PROVIDER_CREDENTIAL_MISSING');
if(!live&&(key||process.env.AAU_UNFAMILIAR_REAL_KIMI))
 throw Error('UNPAID_PREFLIGHT_MUST_HAVE_NO_KEY');
const report={experiment:'AAU_KIMI_UNFAMILIAR_FAILURE_GENERALIZATION_V1',
 kind:'injected_controlled_faults_not_natural_kimi_errors',
 model:live?'kimi-k2.6':'none_fixture_only',
 thinking:live?'disabled':'not_applicable',
 liveModelCalls:0,providerReportedTokens:0,
 perCaseModelCallCeiling:2,globalModelCallCeiling:6,
 cases:[],overallState:'running',
 noAutoRetryAfterUncertainResponse:true};
const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let nextCall=0;
async function query(messages,record){
 // One HTTP POST per authorized attempt. Never reissue on transient errors.
 const delay=Math.max(0,nextCall-Date.now());
 if(delay)await wait(delay);
 nextCall=Date.now()+23000; // <=3 RPM
 record.apiAttempts++;
 report.liveModelCalls++;
 save(); // journal potentially billable attempt before dispatch
 const controller=new AbortController(),start=Date.now();
 const timeout=setTimeout(()=>controller.abort(),175000);
 let usage=null,http=null,finish=null;
 try{
  const response=await fetch('https://api.moonshot.ai/v1/chat/completions',{
   method:'POST',signal:controller.signal,redirect:'manual',
   headers:{authorization:'Bearer '+key,'content-type':'application/json',
    accept:'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},
    temperature:0.6,max_tokens:7600,response_format:{type:'json_object'},
    stream:false,messages})});
  http=response.status;
  const packet=await response.json().catch(()=>({}));
  usage=packet?.usage?.total_tokens??null;
  if(Number.isSafeInteger(Number(usage))&&usage!==null&&Number(usage)>=0)
   report.providerReportedTokens+=Number(usage);
  finish=packet?.choices?.[0]?.finish_reason??null;
  if(!response.ok){
   const errorInfo=packet?.error||{};
   const safeType=String(errorInfo.type||errorInfo.code||'unknown').slice(0,60);
   const safeMessage=String(errorInfo.message||'').slice(0,150);
   throw Error('provider_http_'+http+'_'+safeType+':'+safeMessage);
  }
  if(finish!=='stop')throw Error('incomplete_'+String(finish));
  if(packet?.choices?.[0]?.message?.reasoning_content)
   throw Error('unexpected_thinking_output');
  const text=packet?.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim())throw Error('missing_content');
  const output=JSON.parse(text);
  if(!output||typeof output!=='object'||Array.isArray(output))
   throw Error('bad_json_object');
  record.api.push({status:http,finish,reportedTokens:usage,
   elapsedMs:Date.now()-start,ok:true});
  save();
  return output;
 }catch(error){
  record.api.push({status:http,finish,reportedTokens:usage,
   elapsedMs:Date.now()-start,error:String(error?.message||error).slice(0,180)});
  record.status='manual_hold';
  record.failureReason='provider_response_uncertain_or_incomplete';
  save();
  return null;
 }finally{clearTimeout(timeout);}
}
try{
 for(const fault of FAULTS){
  const task=TASKS.find(x=>x.id===fault.id);
  const verified=await preflightCase(fault.id);
  const record={caseId:fault.id,
   sourceKind:'actual_previous_Kimi_authored_solver_with_controlled_injected_fault',
   sourceSha:verified.evidence.originalHash,
   corruptedSha:verified.evidence.faultyHash,
   // Internal fault description NEVER sent in prompts to the model.
   groundTruthInjection:verified.evidence,
   failedPublicBehavior:verified.observable,
   status:'preflight_pass',apiAttempts:0,api:[],repairs:[],pass:false};
  report.cases.push(record);save();
  if(!live){
   console.log('UNFAMILIAR_FAULT_PREFLIGHT='+JSON.stringify({
    caseId:fault.id,failureKind:verified.observable.failureKind,
    cleanBaselinePass:true,faultedPublicFails:true}));
   continue;
  }
  let current=verified.corruptedSource;
  let publicFailure=verified.observable;
  for(let i=0;i<2;i++){
   if(report.liveModelCalls>=6||report.providerReportedTokens>=42000){
    record.status='budget_exhausted';break;
   }
   const prompt=[
    {role:'system',content:
     'You are an autonomous Python debugging agent using kimi-k2.6. '+
     'This code was previously written by an AI agent, but now fails its specified task. '+
     'Find the defect YOURSELF from the executable code and observed public behavior; '+
     'no diagnosis, fault location, patch, target optimum or correct code will be supplied. '+
     'Fix root cause in a GENERAL, exact algorithm, not a hardcoded public answer. '+
     'You may replace the whole implementation. Python standard library only. '+
     'Input is exactly one task-specific JSON object on stdin. '+
     'Output exactly one JSON object matching the stated contract. '+
     'Your code will be evaluated on different hidden inputs. '+
     'You have at most two code submissions for this problem. '+
     'Return ONLY one compact JSON object: '+
     '{"action":"repair","diagnosis":"your fault hypothesis in <=100 words",'+
     '"python":"ENTIRE EXECUTABLE PYTHON 3 SOURCE"}. '+
     'Do not invent tool results. Do not include Markdown fences.'},
    {role:'user',content:JSON.stringify({
     specification:task.specification,
     publicInput:task.public,
     failingPythonSource:current,
     observedPublicRun:publicFailure,
     previousAttempt:i+1,
     constraint:'Unknown defect and hidden inputs. Verify soundness mathematically.'})},
   ];
   const answer=await query(prompt,record);
   if(answer===null)break;
   if(answer.action!=='repair'||typeof answer.python!=='string'){
    record.status='invalid_model_action';
    record.failureReason='response_without_executable_repair';
    save();break;
   }
   const code=answer.python;
   const runPublic=await runIsolatedPython(code,task.public);
   const publicGrade=runPublic.ok?grade(task.id,task.public,runPublic.result):null;
   const runHidden=await runIsolatedPython(code,task.hidden);
   const hiddenGrade=runHidden.ok?grade(task.id,task.hidden,runHidden.result):null;
   const publicPass=Boolean(publicGrade?.passed);
   const hiddenPass=Boolean(hiddenGrade?.passed);
   const entry={round:i+1,diagnosis:String(answer.diagnosis||'').slice(0,700),
    pythonSource:code,publicExecuted:runPublic.ok,publicResult:runPublic.result??null,
    publicPass,publicError:runPublic.error??null,
    publicStderr:runPublic.stderr??null,
    hiddenPass,hiddenResultForAudit:runHidden.result??null,
    hiddenRuntimeError:runHidden.error??null};
   record.repairs.push(entry);
   console.log('UNFAMILIAR_REPAIR='+JSON.stringify({
    caseId:fault.id,attempt:i+1,publicPass,hiddenPass,
    publicError:entry.publicError,modelCalls:report.liveModelCalls,
    providerTokens:report.providerReportedTokens}));
   if(publicPass&&hiddenPass){record.status='passed';record.pass=true;save();break;}
   // No hidden grader details or expected optimum provided to the model.
   publicFailure={runCompleted:runPublic.ok,publicOutput:runPublic.result??null,
    failureKind:runPublic.ok?'invalid_or_suboptimal_public_result':runPublic.error,
    observedValidation:publicGrade?.observed??null,
    executionStderr:String(runPublic.stderr||'').slice(0,1300)};
   record.status=i===1?'failed_after_two_repairs':'retry_allowed';
   current=code;save();
  }
  if(record.status==='manual_hold'){
   report.overallState='manual_hold';break;
  }
 }
} catch(e){
 report.overallState='runner_exception';
 report.runnerError=String(e?.stack||e).slice(0,1200);
}finally{
 if(report.overallState==='running'){
  report.overallState=live?
    report.cases.length===3&&report.cases.every(x=>x.pass)?'passed':'failed':
    report.cases.length===3?'preflight_passed':'preflight_failed';
 }
 save();
 console.log('UNFAMILIAR_REPAIR_FINAL='+JSON.stringify({
  state:report.overallState,live,modelCalls:report.liveModelCalls,
  providerTokens:report.providerReportedTokens,
  cases:report.cases.map(x=>({id:x.caseId,status:x.status,
    passed:x.pass,codeAttempts:x.repairs.length,
    publicPass:x.repairs.at(-1)?.publicPass??false,
    hiddenPass:x.repairs.at(-1)?.hiddenPass??false}))}));
 if(!['passed','preflight_passed'].includes(report.overallState))
   process.exitCode=2;
}
