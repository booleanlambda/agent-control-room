// V23: one thinking-off Kimi, one serial RabbitMQ cognitive thread,
// durable Neon checkpoints/outbox, independent verification, bounded LOCAL patch
// remediation. No custom algorithm is supplied to Kimi or used by runtime.
import amqp from 'amqplib';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {runIsolatedPython} from '../recursion-tree-v0/unseen-python-sandbox.mjs';
import {specification,publicProblem,hiddenProblems,grade,exactOracle,assessPublic,sha} from './benchmark.mjs';
import {createLedger} from './ledger.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V23_RESEARCH!=='yes'||
 process.env.AAU_PYTHON_SANDBOX!=='yes')throw Error('ISOLATED_RESEARCH_CI_ONLY');
const digest=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const run=randomUUID(),queue='aau.research.v23.'+run.replaceAll('-','');
const report={experiment:'V23_SINGLE_THREAD_CHEAP_KIMI_COGNITIVE_ARCHITECTURE',
 model:'kimi-k2.6',thinking:'disabled',singleActiveModelCall:true,workerCount:1,
 objective:'compare thinking-off direct baseline with architected decomposition, general-purpose code, verification, localized remediation and synthesis',
 taskFamily:'dependency_constrained_control_selection_NOT_SCHEDULING',
 status:'running',runId:run,benchmarkHash:sha(publicProblem),
 hiddenHashes:hiddenProblems.map(sha),baseline:null,architecture:null,
 reportsActualProviderTokens:true,providerCalls:0,providerTokens:0,
 capCalls:7,capTokens:31000,maxTwoRepairs:2,
 messagePublishes:0,messageAcknowledgments:0,dbVerified:false,
 modelAuthoredMethod:true,solverWasHardcoded:false,
 caveats:['One synthetic problem family, one initial benchmark, two withheld input variants; not a statistical superiority claim',
 'One active model call at a time, but model requests are separate prompts with durable context, not one uninterrupted transformer context',
 'The independent exact oracle is used only for assessment, not passed to Kimi or the generated solver',
 'The only execution tool exposed to Kimi is general Python with standard library in an isolated offline Docker container',
 'Queued phases serialize cognition; RabbitMQ is not used for worker concurrency',
 'Automatic retry of ambiguous potentially billed calls is prohibited']};
const persist=()=>writeFileSync('single-thread-v23-evidence.json',JSON.stringify(report,null,2)+'\n');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const maxCalls=7,maxReportedTokens=31000;
const sys='You are Kimi K2.6 with thinking disabled solving a new task. Reply with exactly one JSON object and no Markdown. Respect every supplied constraint. Do not invent tests or tool results. Never assume access to hidden test inputs, answer keys or reference oracle. For code, use only Python 3 standard library: stdin one JSON object, stdout one JSON object. All code is untrusted until independent validation.';
let db,conn,ch,priorModelCallMs=0;
function safeError(e){const x=String(e?.message||e);return /^[A-Z0-9_]+$/.test(x)?x:'REDACTED_FAILURE'}
function addNode(state,phase,data){
 const nodes=state.nodes||[];
 const node={id:'R.'+String(nodes.length+1).padStart(3,'0'),phase,prev:nodes.at(-1)?.hash||null,hash:digest({phase,data,prev:nodes.at(-1)?.hash||null})};
 nodes.push(node);state.nodes=nodes;
 return node;
}
async function kimi(phase,state,instruction,payload,maxTokens,attempt=0){
 if(state.providerCalls>=maxCalls||state.providerTokens>=maxReportedTokens)
  throw Error('MODEL_BUDGET_EXHAUSTED');
 const messages=[{role:'system',content:sys},{role:'user',content:JSON.stringify({instruction,specification,publicInput:publicProblem,...payload})}];
 const body={model:'kimi-k2.6',thinking:{type:'disabled'},temperature:0.6,
  max_tokens:maxTokens,response_format:{type:'json_object'},stream:false,messages};
 const requestHash=digest(body);
 // Strictly journal potentially billable request BEFORE contacting provider.
 // If process exits, another worker cannot silently send a duplicate.
 await db.beginCall(run,phase,attempt,requestHash);
 state.providerCalls++;report.providerCalls++;
 priorModelCallMs=Math.max(priorModelCallMs,Date.now());
 const throttle=Math.max(0,priorModelCallMs+23000-Date.now());
 if(throttle)await delay(throttle);
 priorModelCallMs=Date.now();
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),175000);
 try{
  const key=String(process.env.MOONSHOT_API_KEY||'').trim();
  if(!key)throw Error('MOONSHOT_SECRET_MISSING');
  const response=await fetch('https://api.moonshot.ai/v1/chat/completions',{
   method:'POST',redirect:'manual',signal:c.signal,
   headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify(body)});
  const json=await response.json().catch(()=>({}));
  const tokens=json?.usage?.total_tokens;
  if(Number.isSafeInteger(tokens)&&tokens>=0){
   report.providerTokens+=tokens;state.providerTokens+=tokens;
  }
  const answer=json?.choices?.[0],finish=answer?.finish_reason;
  if(!response.ok||finish!=='stop'||answer?.message?.reasoning_content)
   throw Error('MODEL_INCOMPLETE_OR_REJECTED');
  let obj;
  try{obj=JSON.parse(answer.message.content||'')}catch{throw Error('MODEL_INVALID_JSON')}
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('MODEL_INVALID_SHAPE');
  await db.finishCall(run,phase,attempt,'received',tokens??null,finish,digest(answer.message.content));
  return obj;
 }catch(e){
  await db.finishCall(run,phase,attempt,'uncertain_or_rejected',null,null,null).catch(()=>{});
  throw Error('MODEL_CALL_MANUAL_HOLD');
 }finally{clearTimeout(timer)}
}
async function evaluateCode(code){
 if(typeof code!=='string'||code.length<10||code.length>10000)
  return {publicPass:false,publicFeedback:{reason:'model_source_missing_or_oversize'},hiddenStatus:'not_grading'};
 const exec=await runIsolatedPython(code,publicProblem,{timeoutMs:10000});
 if(!exec.ok)
  return {publicPass:false,publicFeedback:{reason:exec.error,stderr:String(exec.stderr||'').slice(0,700)},hiddenStatus:'not_grading'};
 const publicAssessment=assessPublic(publicProblem,exec.result);
 if(!publicAssessment.passed)
  return {publicPass:false,publicFeedback:publicAssessment,hiddenStatus:'not_grading'};
 const holdouts=[];
 for(const input of hiddenProblems){
  const checked=await runIsolatedPython(code,input,{timeoutMs:10000});
  const result=checked.ok?assessPublic(input,checked.result):{passed:false,reason:checked.error};
  holdouts.push({passed:result.passed,reason:result.reason,inputHash:sha(input)});
 }
 return {publicPass:true,publicFeedback:{reason:'verified_optimum',submittedCost:publicAssessment.submittedCost,
  selected:publicAssessment.selected},hiddenStatus:'graded_once',holdouts,
  success:holdouts.every(x=>x.passed)};
}
async function phase(what,state){
 const next=(nextPhase,event,status='running')=>({nextPhase,event,status,state});
 if(what==='baseline'){
  const raw=await kimi('baseline',state,
   'Solve this problem directly, without writing code or using a tool. Return {"selected":["A",...],"cost":int}. All constraints and optimality matter. You have one response.',{},1300);
  const result=assessPublic(publicProblem,raw);
  state.results.baseline={passed:result.passed,reason:result.reason,
   proposed:raw,oraclePublicCost:exactOracle(publicProblem).cost};
  report.baseline=state.results.baseline;addNode(state,'baseline',{publicPass:result.passed});
  return next('plan',{publicPass:result.passed});
 }
 if(what==='plan'){
  const obj=await kimi('plan',state,
   'Choose a GENERAL method and explicit invariants for solving arbitrary input variants. Do not solve by hardcoding the shown IDs or values. Return {"method":"...","invariants":["..."],"approach":"...","completionCriteria":"..."}.',{},1800);
  if(typeof obj.method!=='string'||!Array.isArray(obj.invariants)||obj.invariants.length<3)
   throw Error('INVALID_MODEL_PLAN');
  state.plan=obj;addNode(state,'plan',{method:obj.method,invariants:obj.invariants});
  return next('implement',{modelPlan:obj.method});
 }
 if(what==='implement'){
  const obj=await kimi('implement',state,
   'Author a COMPLETE reusable Python 3 program solving the input schema with standard library; NO task-specific hardcoded answers. Must handle general controls, dependencies, conflicts, minima/maxima, mandatory, anyOf, budget, exact cost and lexicographic tie-break. Use exhaustive enumeration or equivalent complete optimization within 16 controls. Return {"python":"FULL PYTHON SOURCE","explanation":"..."}. Keep code under 8500 chars.',
   {modelPlan:state.plan},5500);
  state.source=typeof obj.python==='string'?obj.python:'';
  addNode(state,'implement',{sourceHash:digest(state.source),length:state.source.length});
  return next('verify',{sourceHash:digest(state.source)});
 }
 if(what==='verify'){
  const check=await evaluateCode(state.source);
  state.lastCheck=check;state.verificationHistory??=[];
  state.verificationHistory.push({attempt:state.repairAttempts,check});
  addNode(state,'verify',{attempt:state.repairAttempts,publicPass:check.publicPass,
   publicReason:check.publicFeedback?.reason,hiddenStatus:check.hiddenStatus,
   hiddenPass:check.holdouts?.map(x=>x.passed)??null});
  if(check.publicPass&&check.success){
   state.results.architecture={passed:true,public:check.publicFeedback,
    hidden:check.holdouts,repairs:state.repairAttempts};
   return next('synthesize',{status:'verified_public_and_hidden'});
  }
  if(check.publicPass&&!check.success){
   state.results.architecture={passed:false,reason:'hidden_failure_no_leak'};
   return next(null,{reason:'hidden_failure_no_leak'},'failed');
  }
  if(state.repairAttempts>=2){
   state.results.architecture={passed:false,reason:'repair_budget_exhausted'};
   return next(null,{reason:'repair_budget_exhausted'},'failed');
  }
  return next(state.diagnosis?'repair':'diagnose',{reason:check.publicFeedback?.reason,repairs:state.repairAttempts});
 }
 if(what==='diagnose'){
  const obj=await kimi('diagnose',state,
   'Inspect your own previously generated Python and PUBLIC verifier failure. Identify a minimal LOCAL root cause, preserve other invariants. Do not return rewritten source. Return {"rootCause":"...","invariantAtRisk":"...","repairPlan":"..."}',
   {modelPlan:state.plan,originalPython:state.source,publicFailure:state.lastCheck.publicFeedback},2100);
  if(typeof obj.rootCause!=='string'||typeof obj.repairPlan!=='string')
   throw Error('MODEL_DIAGNOSIS_INVALID');
  state.diagnosis=obj;addNode(state,'diagnose',{cause:obj.rootCause});
  return next('repair',{cause:obj.rootCause});
 }
 if(what==='repair'){
  const attempt=state.repairAttempts+1;
  const obj=await kimi('repair',state,
   'Perform ONE LOCALIZED patch, NOT a whole-code rewrite. Return {"old":"EXACT UNIQUE SPAN copied from current Python","replacement":"NEW SPAN","explanation":"..."}. Correct the latest PUBLIC failure and retain every invariant. Choose one sufficiently large span to fix the root cause. No gold answers, no hidden data.',
   {modelPlan:state.plan,diagnosis:state.diagnosis,currentPython:state.source,
    publicFailure:state.lastCheck.publicFeedback,attempt,maxAttempts:2},3700,attempt);
  state.repairAttempts=attempt;
  const old=typeof obj.old==='string'?obj.old:'';
  const replacement=typeof obj.replacement==='string'?obj.replacement:'';
  const occurrences=old?state.source.split(old).length-1:0;
  let patchStatus='invalid_patch';
  if(occurrences===1&&replacement.length<10000&&old!==replacement){
   const revised=state.source.replace(old,replacement);
   if(revised.length<=10000){state.source=revised;patchStatus='applied';}
  }
  if(patchStatus!=='applied'){
   state.lastCheck={publicPass:false,publicFeedback:{reason:'patch_nonunique_or_invalid'}};
   addNode(state,'repair',{attempt,patchStatus});
   if(attempt>=2){state.results.architecture={passed:false,reason:'invalid_patch_budget_exhausted'};
    return next(null,{attempt,patchStatus},'failed');}
   return next('repair',{attempt,patchStatus});
  }
  addNode(state,'repair',{attempt,patchStatus,sourceHash:digest(state.source)});
  return next('verify',{attempt,patchStatus});
 }
 if(what==='synthesize'){
  const obj=await kimi('synthesize',state,
   'Synthesize the verified solution and method, explaining which parts were computed and independently checked. Do not claim that you saw hidden inputs or hidden answers. Return {"summary":"...","method":"...","limits":"..."}.',
   {method:state.plan?.method,publicVerification:state.lastCheck.publicFeedback,
    independentlyVerifiedHiddenCount:state.lastCheck.holdouts?.length,
    localizedRepairs:state.repairAttempts},1100);
  if(typeof obj.summary!=='string'||typeof obj.limits!=='string')
   throw Error('INVALID_SYNTHESIS');
  state.synthesis=obj;addNode(state,'synthesize',{responseHash:digest(obj)});
  return next(null,{rootProofHash:digest(state.nodes),verified:true},'passed');
 }
 throw Error('UNRECOGNIZED_COGNITIVE_PHASE');
}
async function publishPending(){
 const rows=await db.undelivered(run);
 for(const row of rows){
  ch.sendToQueue(queue,Buffer.from(JSON.stringify({run,seq:row.seq})),{
   persistent:true,contentType:'application/json',messageId:run+':'+row.seq});
  await ch.waitForConfirms();
  await db.published(row.id);
  report.messagePublishes++;
 }
}
let queueDeclared=false;
try{
 if(!process.env.AMQP_URL||!process.env.NEON_V19_DATABASE_URL||!process.env.MOONSHOT_API_KEY)
  throw Error('ISOLATED_RESEARCH_SECRETS_MISSING');
 db=createLedger(process.env.NEON_V19_DATABASE_URL);await db.verify();report.dbVerified=true;
 const raw=String(process.env.AMQP_URL).trim().replace(/^AMQP(?:_URL)?\s*=\s*/i,'').replace(/^["']|["']$/g,'');
 if(new URL(raw).protocol!=='amqps:')throw Error('AMQPS_REQUIRED');
 conn=await amqp.connect(raw,{timeout:12000});
 ch=await conn.createConfirmChannel();await ch.prefetch(1);
 await ch.assertQueue(queue,{durable:true,exclusive:false,autoDelete:false,arguments:{'x-expires':2400000}});
 queueDeclared=true;
 await db.init(run,report.benchmarkHash);
 let idle=0;
 for(let step=0;step<32;step++){
  await publishPending();
  const msg=await ch.get(queue,{noAck:false});
  if(!msg){
   idle++;if(idle>12)throw Error('NO_READY_COGNITIVE_EVENT');
   await delay(150);continue;
  }
  idle=0;
  const payload=JSON.parse(msg.content.toString('utf8'));
  if(payload.run!==run||!Number.isSafeInteger(payload.seq))
   throw Error('WRONG_SCOPED_MESSAGE');
  const before=await db.read(run);
  if(before.seq!==payload.seq||before.status!=='running'){
   ch.ack(msg);report.messageAcknowledgments++;continue;
  }
  const stepName=before.next_phase;
  let advanced;
  try{
   advanced=await phase(stepName,before.state);
  }catch(e){
   advanced={nextPhase:null,status:'manual_hold',state:before.state,
    event:{reason:safeError(e),stage:stepName}};
  }
  const out=await db.advance(run,before.seq,stepName,advanced.nextPhase,
   advanced.status,advanced.state,advanced.event);
  if(out!=='COMMITTED')throw Error('PHASE_COMMIT_RACE');
  ch.ack(msg);report.messageAcknowledgments++;
  report.status=advanced.status;
  persist();
  if(advanced.nextPhase===null)break;
 }
 const final=await db.read(run);
 report.status=final.status;
 report.phaseSequence=final.seq;
 report.nodes=final.state.nodes;
 report.providerCalls=final.state.providerCalls;
 report.providerTokens=final.state.providerTokens;
 report.baseline=final.state.results?.baseline;
 report.architecture=final.state.results?.architecture||null;
 report.finalSourceHash=final.state.source?digest(final.state.source):null;
 report.callLedger=await db.callLog(run);
 report.events=await db.events(run);
 report.rootDigest=digest({run,events:report.events,finalSourceHash:report.finalSourceHash});
 if(final.status==='passed'&&(!report.architecture?.passed||!report.architecture?.hidden?.every(x=>x.passed)))
  throw Error('FALSE_SUCCESS_GUARD');
 if(final.status==='running')throw Error('INCOMPLETE_COGNITIVE_RUN');
 if(queueDeclared){
  const check=await ch.checkQueue(queue);
  if(check.messageCount!==0)throw Error('QUEUE_NOT_DRAINED');
  await ch.deleteQueue(queue);queueDeclared=false;report.queueDeleted=true;
 }
}catch(e){
 report.error=safeError(e);
 if(report.status==='running'||report.status==='passed')report.status='failed';
}finally{
 try{if(ch)await ch.close()}catch{}
 try{if(conn)await conn.close()}catch{}
 try{if(db)await db.close()}catch{}
 persist();
 console.log('AAU_V23_FINAL='+JSON.stringify({status:report.status,model:report.model,
  thinking:report.thinking,providerCalls:report.providerCalls,providerTokens:report.providerTokens,
  baseline:report.baseline?.passed??null,architecture:report.architecture?.passed??null,
  repairs:report.architecture?.repairs??null,phases:report.phaseSequence??null,
  persisted:report.dbVerified,ack:report.messageAcknowledgments,clean:report.queueDeleted??false,
  error:report.error??null}));
 if(report.status!=='passed')process.exitCode=2;
}
