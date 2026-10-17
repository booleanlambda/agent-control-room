// One-time live Kimi K2.6 self-authored Python code benchmark.
// Neither the correct algorithms nor hidden test inputs/outputs enter the
// model chat. Code runs in an isolated Docker sandbox with --network none.
// Separate trusted graders evaluate public + hidden instances.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TASKS,oracle,check,grade} from './unseen-python-benchmarks.mjs';
import {runIsolatedPython} from './unseen-python-sandbox.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||
 process.env.AAU_UNSEEN_COGNITION_EXPERIMENT!=='yes')throw Error('NOT_LIVE_CI');
const KEY=String(process.env.MOONSHOT_API_KEY||'').trim();
if(!KEY)throw Error('MOONSHOT_SECRET_MISSING');
const MODEL='kimi-k2.6',MAX_CALLS=14,MAX_TOKENS=56000;
const MAX_TASK_CALLS=5,DEADLINE=Date.now()+16*60*1000;
let calls=0,totalTokens=0,nextCallAt=Date.now();
const events=[],suites=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
function trimError(e){return String(e?.message||e||'error').slice(0,180)}
async function request(messages,task){
 if(calls>=MAX_CALLS)throw Error('provider_call_limit');
 if(totalTokens>=MAX_TOKENS)throw Error('provider_token_limit');
 const delay=Math.max(0,nextCallAt-Date.now());
 if(Date.now()+delay>=DEADLINE)throw Error('overall_deadline');
 if(delay)await sleep(delay);
 nextCallAt=Date.now()+23000;
 const started=Date.now();calls++;
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),85000);
 let http=null,finish=null,tokenUsage={total_tokens:0},reply=null;
 try{
  const res=await fetch('https://api.moonshot.ai/v1/chat/completions',{
   method:'POST',headers:{authorization:'Bearer '+KEY,'content-type':'application/json',
     accept:'application/json'},
   body:JSON.stringify({model:MODEL,thinking:{type:'disabled'},temperature:0.6,
     stream:false,response_format:{type:'json_object'},
     max_tokens:3600,messages}),
   signal:ctl.signal,redirect:'manual'});
  http=res.status;
  const packet=await res.json().catch(()=>({}));
  tokenUsage=packet.usage||tokenUsage;
  totalTokens+=Number(tokenUsage.total_tokens)||0;
  if(!res.ok)throw Error('moonshot_http_'+res.status+':'+String(packet.error?.type||'unknown'));
  const choice=packet.choices?.[0]||{};
  finish=choice.finish_reason;
  if(finish!=='stop')throw Error('model_incomplete_'+finish);
  if(choice.message?.reasoning_content)throw Error('unexpected_thinking_content');
  const text=choice.message?.content;
  if(typeof text!=='string')throw Error('empty_model_content');
  reply=JSON.parse(text);
  if(!reply||typeof reply!=='object'||Array.isArray(reply))
    throw Error('invalid_model_json');
  return reply;
 }finally{
  clearTimeout(timer);
  events.push({kind:'model_call',call:calls,task:task.id,http,
    finishReason:finish,tokens:Number(tokenUsage.total_tokens)||0,
    latencyMs:Date.now()-started,action:reply?.action||null});
 }
}
function feedback(messages,data){
 messages.push({role:'user',content:'Python tool observation: '+
   JSON.stringify(data).slice(0,2100)+
   '. Your next action must be a fresh JSON object; do not assert an unobserved result.'});
}
function judgeSubmission(task,submission){
 const exec=submission?.execution;
 if(!exec?.public?.ok||!exec.hidden?.ok)return {publicPassed:false,
   hiddenPassed:false,reason:'python_execution_failure'};
 const p=grade(task.id,task.public,exec.public.result);
 const h=grade(task.id,task.hidden,exec.hidden.result);
 return {publicPassed:p.passed,hiddenPassed:h.passed,
   public:{observed:p.observed,expected:p.expected,returned:exec.public.result},
   hidden:{observed:h.observed,expected:h.expected,returned:exec.hidden.result}};
}
async function oneTask(task){
 const before=calls;let attempt=0,final=null,plans=[],submissions=[],failure=null;
 const messages=[
 {role:'system',content:`You are Kimi K2.6 participating in an independent
 automated-cognition benchmark. Think carefully about the problem. You are
 NOT given any pretrained solver or optimal answer. Produce your OWN
 executable, generally applicable Python 3 algorithm to solve the problem,
 using the numerical instance supplied now and one undisclosed held-out
 test with different data. Your Python is executed in a no-network,
 no-secrets Python 3.12 container reading stdin as a JSON input, and must
 print exactly one JSON object to stdout. Libraries from Python's
 standard library may be used. Script execution is bounded to 8 seconds.
 Decide your own algorithm, subtasks and development approach.

Respond with EXACTLY one JSON object each turn:
 {"action":"plan","subtasks":["..."],"strategy":"..."}
 {"action":"code","python":"FULL EXECUTABLE PYTHON SOURCE","algorithm":"..."}
 {"action":"final","explanation":"Why your submitted algorithm is exact","complexity":"...","limitations":"..."}

You may develop or revise Python at most twice. After a code submission,
you receive only visible-instance execution output and feasibility; hidden
test input and result are never disclosed. Your final answer must rely on
 the submitted code. Do not assume a test passed because a process exited.
 The goal is exact generalizable solutions, not familiar template responses.
 Do not hardcode any expected costs, routes, assigned machines, or tuples.
 Do not supply fictitious solver results. You have at most five model
 actions for this specific task. Use JSON only, no markdown.
 `},
 {role:'user',content:JSON.stringify({problem:task.title,
    specification:task.specification,publicInstance:task.public,
    hiddenInstance:'Withheld; same input schema, different numbers',
    pythonInputContract:'one JSON object on stdin',
    pythonOutputContract:'one JSON object on stdout'})}
 ];
 try{
 for(let i=0;i<MAX_TASK_CALLS;i++){
  if(Date.now()>DEADLINE)throw Error('overall_deadline');
  const answer=await request(messages,task);
  const action=String(answer.action||'').toLowerCase();
  messages.push({role:'assistant',content:JSON.stringify(answer)});
  if(action==='plan'){
   const steps=Array.isArray(answer.subtasks)?answer.subtasks
    .filter(x=>typeof x==='string'&&x.length>5).slice(0,8):[];
   plans.push({call:calls,steps,strategy:String(answer.strategy||'').slice(0,800)});
   feedback(messages,{action:'plan',accepted:steps.length>0,
     next:'Implement a generic Python algorithm, no code starter is supplied'});
   continue;
  }
  if(action==='code'){
   if(attempt>=2){feedback(messages,{action:'code',accepted:false,
     reason:'two_code_attempts_used',next:'Submit final explanation'});continue;}
   attempt++;
   const code=String(answer.python||'');
   const algorithm=String(answer.algorithm||'').slice(0,900);
   const pub=await runIsolatedPython(code,task.public);
   const hidden=await runIsolatedPython(code,task.hidden);
   const submission={attempt,algorithm,code,codeDigest:hash(code),
     execution:{public:pub,hidden}};
   submissions.push(submission);
   let observed=null,valid=null;
   if(pub.ok){
    observed=check(task.id,task.public,pub.result);
    // Never disclose true optimum or hidden instance to the model.
    valid=observed.ok;
   }
   feedback(messages,{action:'code',accepted:pub.ok,
     attempt,stdout:pub.ok?pub.result:null,error:pub.ok?null:pub.error,
     stderr:pub.ok?null:pub.stderr,
     publicFeasible:valid,publicDiagnostic:observed?.reason||null,
     hiddenTest:'Executed, result withheld until final score',
     next:pub.ok?'Submit final explanation, or revise if you found a defect':
      'Revise Python; remember code runs in a no-network read-only container'});
   continue;
  }
  if(action==='final'){
   final={explanation:String(answer.explanation||'').slice(0,1800),
     complexity:String(answer.complexity||'').slice(0,500),
     limitations:String(answer.limitations||'').slice(0,500)};
   break;
  }
  feedback(messages,{error:'action_must_be_plan_code_or_final'});
 }
 }catch(e){failure=trimError(e)}
 const last=submissions.at(-1);
 const verification=judgeSubmission(task,last);
 const pass=Boolean(final&&verification.publicPassed&&verification.hiddenPassed&&
  final.explanation.length>=35&&last?.code?.length>=30);
 return {id:task.id,title:task.title,modelCalls:calls-before,
  modelSubmittedPlan:plans.length>0,plans,codeAttempts:attempt,
  submissions:submissions.map(({attempt,algorithm,code,codeDigest,execution})=>({
    attempt,algorithm,code,codeDigest,
    publicRun:execution.public,
    hiddenRunRedacted:{ok:execution.hidden.ok,
      error:execution.hidden.ok?null:execution.hidden.error}})),
  final,verification,passes:pass,failure};
}
let campaignError=null;
for(const task of TASKS){
 try{suites.push(await oneTask(task))}
 catch(e){campaignError=trimError(e);break;}
}
const passed=suites.filter(x=>x.passes).length;
const report={experiment:'AAU_KIMI_K26_SELF_AUTHORED_PYTHON_UNSEEN_V1',
 source:'real_live_moonshot_provider',model:MODEL,thinking:'disabled',
 tools:'isolated network-disabled read-only standard Python 3.12; no oracle tool',
 tasksAttempted:suites.length,totalTasks:TASKS.length,passedTasks:passed,
 modelCalls:calls,providerReportedTokens:totalTokens,
 testMode:'visible_instance_plus_hidden_heldout_per_task',
 noHiddenInputsExposed:true,
 noReferenceOptimumPassedToLLM:true,
 noPaidAutomaticRetries:true,
 callCeiling:MAX_CALLS,tokenCeiling:MAX_TOKENS,
 apiEvents:events,suites,campaignError};
writeFileSync('unseen-python-kimi-report.json',JSON.stringify(report,null,2)+'\n');
console.log('KIMI_UNSEEN_PYTHON_RESULT='+JSON.stringify({
 tasksAttempted:suites.length,passedTasks:passed,totalTasks:TASKS.length,
 calls,tokens:totalTokens,
 tasks:suites.map(x=>({id:x.id,passed:x.passes,calls:x.modelCalls,
   planned:x.modelSubmittedPlan,attempts:x.codeAttempts,
   publicPass:x.verification.publicPassed,hiddenPass:x.verification.hiddenPassed,
   failure:x.failure})),campaignError}));
if(passed!==TASKS.length)process.exitCode=2;
