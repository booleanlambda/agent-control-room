// Authenticated live Kimi diagnosis-and-repair benchmark on two unrelated,
// previously unseen broken Python programs. Fault locations are never told.
// Code is executed only in disposable Docker without network or credentials.
// Hidden inputs and independent verifier outputs never enter model messages.
import {writeFileSync,readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {CASES,expected,gradeResult} from './unseen-failure-fixtures.mjs';
import {runIsolatedPython} from './unseen-python-sandbox.mjs';
const MODE=process.argv[2];
if(!['preflight','live'].includes(MODE))throw Error('MODE_REQUIRED');
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes')
 throw Error('ONLY_DISPOSABLE_CI');
if(MODE==='preflight'&&process.env.MOONSHOT_API_KEY)
 throw Error('NO_KEY_PERMITTED_DURING_STATIC_PREFLIGHT');
if(MODE==='live'&&process.env.AAU_UNFAMILIAR_FAILURE_LIVE!=='yes')
 throw Error('NOT_AUTHORIZED_NEW_LIVE_CAMPAIGN');
const key=String(process.env.MOONSHOT_API_KEY||'').trim();
if(MODE==='live'&&!key)throw Error('PROVIDER_CREDENTIAL_MISSING');
const MAX_TOTAL_CALLS=10,MAX_TASK_CALLS=5,MAX_TOKENS=52000;
const filename='unseen-failure-kimi-report.json';
const sha=x=>createHash('sha256').update(String(x)).digest('hex');
const state={experiment:'AAU_KIMI_UNFAMILIAR_FAILURE_SELF_REPAIR_V1',
 mode:MODE,model:MODE==='live'?'kimi-k2.6':null,
 thinking:MODE==='live'?'disabled':null,
 genuineProviderCalls:0,providerReportedTokens:0,
 maxTotalCalls:MAX_TOTAL_CALLS,maxPerTask:MAX_TASK_CALLS,
 noRetryOnUnknownRequest:true,
 tasks:[],providerTrace:[],campaignStatus:'started'};
function persist(){writeFileSync(filename,JSON.stringify(state,null,2)+'\n')}
let nextProviderAt=Date.now();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
persist();
function short(e){return String(e?.message||e||'unknown').slice(0,160)}
async function inference(messages,caseId,stage){
 if(state.genuineProviderCalls>=MAX_TOTAL_CALLS)throw Error('global_call_ceiling');
 if(state.providerReportedTokens>=MAX_TOKENS)throw Error('global_token_ceiling');
 const pause=Math.max(0,nextProviderAt-Date.now());
 if(pause)await sleep(pause);
 nextProviderAt=Date.now()+24000; // Moonshot account 3 RPM pacing
 const requestId=randomUUID();
 state.providerTrace.push({requestId,caseId,stage,status:'request_in_flight',
  startedAt:new Date().toISOString()});
 state.genuineProviderCalls++;
 persist(); // a crash cannot transparently repeat potentially billable POST
 const timer=new AbortController(),clock=setTimeout(()=>timer.abort(),155000);
 const latest=state.providerTrace.at(-1);
 let usage=null;
 try{
  const response=await fetch('https://api.moonshot.ai/v1/chat/completions',{
   method:'POST',signal:timer.signal,redirect:'manual',
   headers:{authorization:'Bearer '+key,'content-type':'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},
    stream:false,temperature:0.6,response_format:{type:'json_object'},
    max_tokens:stage==='tests'?3700:stage==='diagnose'?2400:5200,messages})});
  latest.http=response.status;
  const p=await response.json().catch(()=>({}));
  usage=Number.isSafeInteger(p.usage?.total_tokens)?p.usage.total_tokens:null;
  if(usage!==null)state.providerReportedTokens+=usage;
  latest.usage=usage;latest.finish=p.choices?.[0]?.finish_reason||null;
  if(!response.ok){
    latest.providerErrorType=String(p?.error?.type||'').slice(0,90);
    latest.providerErrorCode=String(p?.error?.code||'').slice(0,90);
    latest.providerErrorMessage=String(p?.error?.message||'').slice(0,180);
    throw Error('provider_http_'+response.status);
  }
  if(latest.finish!=='stop')throw Error('incomplete_'+latest.finish);
  if(p.choices?.[0]?.message?.reasoning_content)throw Error('thinking_off_not_honored');
  const content=p.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim())throw Error('empty_provider_message');
  const responseJson=JSON.parse(content);
  if(!responseJson||Array.isArray(responseJson)||typeof responseJson!=='object')
   throw Error('malformed_json_object');
  latest.status='complete';latest.action=responseJson.action||null;
  latest.endedAt=new Date().toISOString();
  persist();
  return responseJson;
 }catch(e){
  latest.status='manual_hold';latest.error=short(e);
  latest.endedAt=new Date().toISOString();
  persist(); // unknown remote billing => no retry or additional inferred work
  throw Object.assign(Error('PROVIDER_UNCERTAIN_'+short(e)),{providerUncertain:true});
 }finally{clearTimeout(clock)}
}
function mutate(id,result){
 if(id==='routing'){
  const badPath={...result,path:[0,Math.max(...result.path)+1],charges:[0,0]};
  return [{...result,cost:result.cost+1},badPath];
 }
 return [{...result,score:result.score+1},
  {...result,triple:[0,0,0]}];
}
async function examine(testCase,source,{hidden=false}={}){
 const input=hidden?null:testCase.public;
 if(hidden)throw Error('DO_NOT_EXPOSE_HIDDEN_INPUT');
 const ex=await runIsolatedPython(source,input);
 const grade=ex.ok?gradeResult(testCase.id,input,ex.result):
  {passed:false,observed:{ok:false,reason:ex.error}};
 return {run:ex,pass:Boolean(grade.passed),observed:grade.observed,
  reference:expected(testCase.id,input)};
}
async function hiddenChecks(c,source){
 const checks=[];
 for(const h of c.hidden){
  const r=await runIsolatedPython(source,h.input);
  const grade=r.ok?gradeResult(c.id,h.input,r.result):
   {passed:false,observed:{ok:false,reason:r.error}};
  checks.push({label:h.label,passed:Boolean(grade.passed),
   actualOutput:r.ok?r.result:null,
   error:r.error||null,expected:expected(c.id,h.input)});
 }
 return checks;
}
async function verifySelfTests(c,source,tests){
 const observed=await runIsolatedPython(source,c.public);
 if(!observed.ok||!gradeResult(c.id,c.public,observed.result).passed)
  return {passes:false,reason:'solver_uncertified'};
 const bads=mutate(c.id,observed.result);
 const inputs=[observed.result,...bads];
 const responses=[];
 for(const candidate of inputs){
  const result=await runIsolatedPython(tests,{input:c.public,output:candidate});
  responses.push({ran:result.ok,passed:result.ok?result.result?.passed:null,
    error:result.error||null});
 }
 return {passes:responses[0].passed===true&&responses.slice(1).every(x=>x.passed===false),
  acceptsCorrect:responses[0].passed===true,
  rejectsCostTamper:responses[1].passed===false,
  rejectsInvalidWitness:responses[2].passed===false,
  responses};
}
function context(c,baseline,events){
 const latest=events.at(-1);
 return {
  domain:c.category,
  contract:c.specification,
  publicInput:c.public,
  originalSource:c.seed,
  observedBaseline:baseline.run.ok?baseline.run.result:
    {error:baseline.run.error,stderr:baseline.run.stderr},
  publicTestResult:{passed:baseline.pass,
   // This is a conventional public-test expected output, not a diagnosis:
   expected:baseline.reference},
  recentFeedback:latest?.feedback||null,
  candidateSource:latest?.source||null,
  reminder:'The validator does not reveal the defective component. Source, diagnosis and fixes must be your own. Hidden instances and all their results are withheld.'};
}
async function one(c){
 const t={id:c.id,domain:c.category,originalSourceHash:sha(c.seed),
  modelActions:[],codeAttempts:0,finalCode:null,finalCodeHash:null,
  selfTestCode:null,pass:false,stopReason:null};
 state.tasks.push(t);persist();
 const baseline=await examine(c,c.seed);
 t.baseline={run:baseline.run,pass:baseline.pass,
  reference:baseline.reference,observed:baseline.observed};
 if(baseline.pass)throw Error('BUGGY_PROGRAM_DID_NOT_FAIL_'+c.id);
 let repaired=null,hidden=null,tests=null,previous=[],msgs=[
  {role:'system',content:'You are diagnosing an unfamiliar, defective Python program. You are given its source, problem specification and failing PUBLIC test only. You are NOT told which line or subsystem is defective. Investigate, form your own hypothesis, and write corrected GENERAL source. The same code will be independently graded on withheld inputs. Choose one response action each turn: {"action":"diagnose","hypothesis":"short explanation"} or {"action":"repair","diagnosis":"what you determined","python":"FULL corrected Python code"} or {"action":"tests","python":"FULL executable property/verification test"} or {"action":"stop","reason":"..."}. For tests, read {"input":problem_json,"output":solver_output} from stdin and print {"passed":boolean}; check witness constraints and score, not just hardcoded values. The model may choose the order, though the runtime accepts tests only after a public correct repair. Return JSON only, concise. Do NOT claim a hidden result was observed. If a Python error occurs, use public traceback feedback. Never use the hidden answer or invent evidence.'},
  {role:'user',content:JSON.stringify(context(c,baseline,[]))}];
 const max=MAX_TASK_CALLS;
 for(let step=0;step<max;step++){
  if(state.genuineProviderCalls>=MAX_TOTAL_CALLS)break;
  const lastStatus=state.providerTrace.at(-1)?.status;
  if(lastStatus==='manual_hold')break;
  const actionStage=step===0?'repair':repaired?'tests':'repair';
  let answer;
  try{answer=await inference(msgs,c.id,actionStage)}
  catch(e){t.stopReason=short(e);t.status='manual_hold';persist();return t}
  const action=String(answer.action||'').toLowerCase();
  const note={step:step+1,action,diagnosis:String(answer.diagnosis||answer.hypothesis||'').slice(0,1000)};
  t.modelActions.push(note);persist();
  msgs.push({role:'assistant',content:JSON.stringify(answer)});
  if(action==='stop'){t.stopReason=String(answer.reason||'model stopped').slice(0,250);break}
  if(action==='diagnose'){
   msgs.push({role:'user',content:'Hypothesis saved. Submit fully executable corrected Python code when you are ready. No fault location will be provided.'});
   continue;
  }
  if(action==='repair'){
   if(repaired){
    msgs.push({role:'user',content:'The solver is already independently verified on the PUBLIC case and is frozen. Submit only a repaired general verifier using action tests.'});
    continue;
   }
   const source=String(answer.python||'');
   t.codeAttempts++;note.sourceHash=sha(source);note.source=source;
   if(source.length<30||source.length>12000){
    note.feedback={problem:'code_size_bounds'};
    msgs.push({role:'user',content:JSON.stringify({publicFeedback:note.feedback})});persist();continue;
   }
   const observed=await examine(c,source);
   note.feedback={publicExecuted:observed.run.ok,
    publicResult:observed.run.ok?observed.run.result:null,
    publicPassed:observed.pass,
    publicError:observed.run.error||null,
    publicStderr:observed.run.stderr||null,
    publicReference:observed.reference};
   if(observed.pass){
    repaired=source;t.finalCode=source;t.finalCodeHash=sha(source);
    hidden=await hiddenChecks(c,source);
    // Hidden feedback is NOT sent to the model.
    t.hiddenChecks=hidden;
   }
   msgs.push({role:'user',content:JSON.stringify({
    observedPublicTest:note.feedback,
    next:repaired?'Your PUBLIC program passed. Provide independently written generic Python verification tests.':'It did not pass. Diagnose or rewrite the general algorithm. The hidden inputs remain sealed.'})});
   persist();continue;
  }
  if(action==='tests'){
   if(!repaired){
    msgs.push({role:'user',content:'First produce an executable publicly correct repair. No test phase accepted for a broken public algorithm.'});continue;
   }
   const source=String(answer.python||'');note.selfTestHash=sha(source);
   note.selfTestSource=source;
   const v=await verifySelfTests(c,repaired,source);
   tests=source;note.feedback=v;
   t.selfTestCode=source;t.selfTestVerification=v;
   t.pass=v.passes&&hidden.every(h=>h.passed);
   if(t.pass){t.status='passed';persist();return t}
   msgs.push({role:'user',content:JSON.stringify({
    publicSelfTestFeedback:v,
    next:'The repaired source is already verified on the public test and will not be changed. Correct only the verifier script; no hidden result will be shown.'})});
   persist();continue;
  }
  msgs.push({role:'user',content:'Invalid action. Choose diagnose, repair, tests or stop.'});
 }
 t.status=t.pass?'passed':t.stopReason?'stopped':'budget_exhausted';
 persist();return t;
}
if(MODE==='preflight'){
 for(const c of CASES){
  const b=await examine(c,c.seed);
  if(b.pass)throw Error('BASELINE_NOT_FAILING_'+c.id);
  const hidden=c.hidden.map(h=>({label:h.label,ref:expected(c.id,h.input)}));
  console.log('UNKNOWN_FAILURE_PREFLIGHT='+JSON.stringify({
   task:c.id,defectiveSeedReproduced:true,baselineOutput:b.run.result,
   baselineError:b.run.error||null,
   referencePublic:b.reference,hiddenOracleFeasible:hidden.every(h=>h.ref),
   hiddenCases:hidden.length}));
 }
 state.campaignStatus='preflight_ok';persist();
}else{
 for(const c of CASES){
  if(state.providerTrace.some(p=>p.status==='manual_hold'))break;
  await one(c);
 }
 state.campaignStatus=state.providerTrace.some(p=>p.status==='manual_hold')?
  'manual_hold':state.tasks.every(t=>t.pass)?'passed':'partial_or_failed';
 persist();
 console.log('UNKNOWN_FAILURE_LIVE_RESULT='+JSON.stringify({
  campaign:state.campaignStatus,
  calls:state.genuineProviderCalls,tokens:state.providerReportedTokens,
  tasks:state.tasks.map(t=>({id:t.id,actions:t.modelActions.map(a=>a.action),
   repairs:t.codeAttempts,publicRepaired:Boolean(t.finalCode),
   hiddenPass:t.hiddenChecks?.every(x=>x.passed)??false,
   testPass:t.selfTestVerification?.passes??false,fullPass:t.pass,
   stop:t.stopReason||null}))}));
 if(state.campaignStatus!=='passed')process.exitCode=2;
}
