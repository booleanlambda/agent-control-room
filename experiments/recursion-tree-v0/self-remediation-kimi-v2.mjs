// Authorized new inference campaign. Never resumes or resubmits the ambiguous
// request from old run 39023455258. Each NEW phase is a unique one-shot POST.
// Checkpoint before network; on ambiguity, no retries. Production isolated.
import {readFileSync,writeFileSync,existsSync,openSync,fsyncSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import {simulateResponse} from './self-remediation-v2-fixtures.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {TASKS,check,grade,oracle} from './unseen-python-benchmarks.mjs';
import {runIsolatedPython} from './unseen-python-sandbox.mjs';

const ACTION=process.argv[2];
const CHECKPOINT='self-remediation-v2-checkpoint.json';
const REPORT='self-remediation-v2-report.json';
const PRIOR='unseen-python-kimi-report.json';
const KEY=String(process.env.MOONSHOT_API_KEY||'').trim();
const FIXTURE=String(process.env.AAU_REMEDIATION_V2_FIXTURE||'');
const mockRun=Boolean(FIXTURE);
const FIXTURES=['success','bad_witness','weak_tests','truncated','transport_unknown'];
const task=TASKS.find(x=>x.id==='assignment');
const hash=x=>createHash('sha256').update(String(x||'')).digest('hex');
const save=x=>{
 // Atomic checkpoint + fsync: a crashed worker cannot create a half-JSON
 // reply journal that would otherwise trick a new worker into re-sending.
 const tmp=CHECKPOINT+'.'+randomUUID()+'.tmp';
 let fd;
 try{
  fd=openSync(tmp,'wx',0o600);
  writeFileSync(fd,JSON.stringify(x,null,2)+'\n');
  fsyncSync(fd);closeSync(fd);fd=undefined;
  renameSync(tmp,CHECKPOINT);
  const dirfd=openSync('.','r');
  try{fsyncSync(dirfd)}finally{closeSync(dirfd)}
 }finally{
  if(fd!==undefined)closeSync(fd);
  try{unlinkSync(tmp)}catch{}
 }
};
const load=()=>JSON.parse(readFileSync(CHECKPOINT,'utf8'));
const summarize=e=>String(e?.message||e||'unknown').slice(0,155);
const MAX_CALLS=7,MAX_TOKENS=39000;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes')
 throw Error('DISPOSABLE_CI_REQUIRED');
if(mockRun){
 if(!FIXTURES.includes(FIXTURE)||KEY||process.env.AAU_REMEDIATION_V2_AUTHORIZED==='yes'||
    process.env.AAU_NO_PROVIDER_NETWORK!=='yes')
  throw Error('SIMULATOR_MUST_HAVE_NO_CREDENTIALS_OR_LIVE_AUTH');
 globalThis.fetch=async()=>{throw Error('FIXTURE_MODE_NETWORK_FORBIDDEN')};
}else if(process.env.AAU_REMEDIATION_V2_AUTHORIZED!=='yes')
 throw Error('PAID_INFERENCE_NOT_AUTHORIZED');
const variations=()=>{
 const original=task.public;
 const edit=(name,fn)=>{const p=structuredClone(original);fn(p);return {name,input:p}};
 return [{name:'sealed_heldout',input:task.hidden},
 edit('cost_shift',p=>{p.costs[2]=[9,13,6];p.costs[5]=[8,10,5]}),
 edit('activation_shift',p=>{p.activation=[12,7,9]}),
 edit('zero_switch_penalty',p=>{p.switchPenalty=0}),
 edit('shift_capacity',p=>{p.capacities=[10,9,9]}),
 edit('reordered_jobs',p=>{p.sizes.reverse();p.costs.reverse();p.allowed.reverse();})];
};
async function seed(){
 if(existsSync(CHECKPOINT))throw Error('EXPERIMENT_CHECKPOINT_ALREADY_EXISTS');
 const old=JSON.parse(readFileSync(PRIOR,'utf8'));
 if(old.experiment!=='AAU_KIMI_K26_SELF_AUTHORED_PYTHON_UNSEEN_V1'||
 old.model!=='kimi-k2.6')throw Error('ORIGINAL_ARTIFACT_INTEGRITY');
 const suite=old.suites.find(s=>s.id==='assignment');
 if(!suite||suite.passes||suite.submissions.length!==2)
  throw Error('FAILED_SOURCE_NOT_PRESENT');
 const last=suite.submissions[1];
 if(hash(last.code)!==last.codeDigest||
 hash(last.code)!=='320681db4e573366aa28df9bfe9924f89bdcf1e7f64d2753bdbbe7258b58ac7b')
  throw Error('SOURCE_HASH_CHANGED');
 const first=await runIsolatedPython(last.code,task.public);
 if(!first.ok||first.result?.cost!==90||
 first.result?.assignment?.join(',')!=='2,2,2,2,2,2,2'||
 check(task.id,task.public,first.result).ok)
  throw Error('BASELINE_FAILURE_NOT_REPRODUCED');
 const cp={
  experiment:'AAU_KIMI_K26_SELF_REMEDIATION_V2_NEW_AUTHORIZED_REQUESTS',
  batchNonce:randomUUID(),sourceRun:38994095805,priorAmbiguousRun:39023455258,
  status:'ready',phase:'diagnose',originalHash:last.codeDigest,
  originalCode:last.code,originalBadOutput:first.result,
  latestCode:last.code,latestTests:null,phaseHistory:[],assessments:[],
  callsAttempted:0,providerReportedTokens:0,maxCalls:MAX_CALLS,maxTokens:MAX_TOKENS,
  feedback:'Original Kimi-generated DP returned optimal numeric cost 90, but an invalid [2,2,2,2,2,2,2] assignment violating machine capacity. Earlier attempted source repair did not preserve parent traceback. Investigate before a fresh code revision.',
  diagnosis:null,publicObservation:null,lastAssessment:null,
  liveInferencesFromOldRunRetried:0,
  simulation:mockRun,scenario:mockRun?FIXTURE:null,
 };
 if(process.env.AAU_REPAIR_START_WITH_V3==='yes'){
  // Opt-in alternative for the NEXT separately authorized trial:
  // start from the LAST genuine Kimi-generated crashing program, not from
  // the original cost-only bug. No human-written source is substituted.
  const prior=JSON.parse(readFileSync('prior-v3/self-remediation-v2-checkpoint.json','utf8'));
  const knownHash='8ac998fcba84990297a65e6c34cdaf81c8e4d1943a19d25e047e32cd54d11b4d';
  if(prior.status!=='exhausted'||prior.sourceRun!==38994095805||
   hash(prior.latestCode)!==knownHash||
   prior.phaseHistory?.filter(x=>x.phase==='repair').length!==2)
   throw Error('PREVIOUS_LIVE_FAILURE_PROVENANCE_INVALID');
  const crashed=await runIsolatedPython(prior.latestCode,task.public);
  if(crashed.ok||crashed.error!=='python_exit_1'||
     !String(crashed.stderr||'').includes('Traceback'))
   throw Error('PREVIOUS_LIVE_FAILURE_DID_NOT_REPRODUCE');
  cp.latestCode=prior.latestCode;
  cp.phase='repair';
  cp.diagnosis={diagnosis:String(prior.phaseHistory.at(-1).summary||'').slice(0,900),
   hypothesis:'Use actual public interpreter error and verify each predecessor chain in a complete executable repair.'};
  cp.feedback=JSON.stringify({source:'genuine_prior_kimi_generated_code',
   sourceRun:39025542225,failedSourceHash:knownHash,
   publicError:crashed.error,
   pythonStderr:String(crashed.stderr).slice(0,1600),
   note:'The code crashes on the known public input. Repair the entire Python program. Do not make claims about withheld cases.'}).slice(0,2500);
  cp.seedProvenance={mode:'direct_repair_with_real_stderr',
   sourceRun:39025542225,sourceHash:knownHash,
   actualPublicCrashReproduced:true,
   stdoutWasAccepted:false};
 }
 save(cp);
 console.log('REMEDIATION_V2_SEED='+JSON.stringify({verifiedHash:cp.originalHash,
  exactOriginalFailureReproduced:true,phase:cp.phase,oldUncertainCallResubmitted:false}));
}
function systemPrompt(phase){
 const common='You are Kimi K2.6 with thinking disabled. Autonomously repair YOUR OWN previously failed factory assignment Python algorithm. Solve generically for changed inputs, not just provided example. Python program reads JSON stdin and prints exactly one JSON object. No external libraries. No answers, patches, or optimum schedule are provided. This is a new explicitly authorized research attempt. Return ONE strict JSON object; concise, no markdown.';
 if(phase==='diagnose')return common+'\nAction: {"action":"diagnose","diagnosis":"specific defect","hypothesis":"testable correction"}. Analyze parent pointer, DP layer, assignment witness and objective consistency. Do not generate code in this stage. Keep <350 words.';
 if(phase==='repair')return common+'\nAction: {"action":"repair","python":"full Python 3 source","explanation":"brief"}. Include imports/input/output. Minimize cost exactly with activation costs, ordered switch penalties, capacity and allowed constraints. Reconstruct a feasible assignment, not only the correct optimum cost. Prefer concise complete code (<4500 output tokens). Do not write tests here. Avoid any answer hardcoding.';
 if(phase==='tests')return common+'\nAction: {"action":"tests","python":"full Python 3 verifier script","explanation":"brief"}. The test script reads {"input":factory_instance,"output":candidate_output} and outputs {"passed":true or false}. Independently verify every assignment index and eligibility, capacity loads, exact recomputed cost (job prices plus once-per-used-machine activation plus each switching fee) and proper list length. It MUST reject original cost-90 all-machine-2 invalid witness and accept any genuinely correct repaired feasible witness. Not a hardcoded expected assignment. Keep short.';
 throw Error('UNSUPPORTED_PHASE');
}
function userPrompt(cp){
 const common={specification:task.specification,public:task.public,
  previousDefect:cp.feedback,priorHypothesis:cp.diagnosis,
  history:cp.phaseHistory.slice(-3).map(x=>({phase:x.phase,summary:x.summary,
    codeHash:x.codeHash,publicPassed:x.publicPassed}))};
 if(cp.phase==='diagnose')return {...common,failedSource:cp.latestCode,
  originalBadOutput:cp.originalBadOutput};
 if(cp.phase==='repair')return {...common,failedSource:cp.latestCode,
  reminder:'Author your own entire repaired source; full code not diff.'};
 return {...common,repairedSource:cp.latestCode,
  publicObservation:cp.publicObservation,originalBadOutput:cp.originalBadOutput};
}
async function callMoonshot(cp){
 if(!KEY)throw Error('MOONSHOT_SECRET_MISSING');
 const ctl=new AbortController(),clock=setTimeout(()=>ctl.abort(),175000);
 const phase=cp.phase,started=Date.now(),outputLimit=
  phase==='diagnose'?2200:phase==='repair'?5200:3200;
 let http=null,usage=null,finish=null,received=false;
 try{
  const r=await fetch('https://api.moonshot.ai/v1/chat/completions',{
   method:'POST',signal:ctl.signal,redirect:'manual',
   headers:{authorization:'Bearer '+KEY,'content-type':'application/json'},
   body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},
    temperature:0.6,stream:false,response_format:{type:'json_object'},
    max_tokens:outputLimit,
    messages:[{role:'system',content:systemPrompt(phase)},
      {role:'user',content:JSON.stringify(userPrompt(cp))}]})});
  http=r.status;
  const packet=await r.json().catch(()=>({}));
  usage=packet?.usage?.total_tokens??null;
  finish=packet?.choices?.[0]?.finish_reason??null;
  if(!r.ok)throw Error('provider_http_'+http);
  if(finish!=='stop')throw Error('model_incomplete_'+String(finish));
  if(packet?.choices?.[0]?.message?.reasoning_content)
   throw Error('thinking_off_not_honored');
  const raw=packet?.choices?.[0]?.message?.content;
  if(typeof raw!=='string'||!raw.trim())throw Error('empty_model_output');
  const answer=JSON.parse(raw);
  if(!answer||Array.isArray(answer)||typeof answer!=='object')
   throw Error('non_object_model_output');
  received=true;
  return {answer,usage:Math.max(0,Number(usage)||0),http,finish,elapsedMs:Date.now()-started};
 }catch(e){
  throw Object.assign(new Error(summarize(e)),{telemetry:{http,usage,finish,
   elapsedMs:Date.now()-started,received}});
 }finally{clearTimeout(clock);}
}
async function assess(cp){
 const code=cp.latestCode,tests=cp.latestTests;
 const pub=await runIsolatedPython(code,task.public);
 const p=pub.ok?grade(task.id,task.public,pub.result):
  {passed:false,observed:{ok:false,reason:pub.error}};
 const other=[];
 for(const {name,input} of variations()){
  const out=await runIsolatedPython(code,input);
  const g=out.ok?grade(task.id,input,out.result):
   {passed:false,observed:{ok:false,reason:out.error}};
  other.push({name,pass:Boolean(g.passed),feasible:Boolean(g.observed?.ok),
   returnedCost:out.result?.cost??null,oracleCost:oracle(task.id,input).cost,
   error:out.error||null});
 }
 const trial=typeof tests==='string'&&tests.length>=80&&tests.length<=12000;
 let good=null,bad=null,mutant=null;
 if(trial){
  good=await runIsolatedPython(tests,{input:task.public,output:pub.result??null});
  bad=await runIsolatedPython(tests,{input:task.public,output:cp.originalBadOutput});
  if(pub.ok&&Array.isArray(pub.result?.assignment)){
    mutant=await runIsolatedPython(tests,{input:task.public,
     output:{cost:pub.result.cost+1,assignment:pub.result.assignment}});
  }
 }
 const checks={
  acceptsCorrect:Boolean(good?.ok&&good.result?.passed===true),
  rejectsOld:Boolean(bad?.ok&&bad.result?.passed===false),
  rejectsCostTamper:Boolean(mutant?.ok&&mutant.result?.passed===false),
 };
 const record={public:{executed:pub.ok,result:pub.ok?pub.result:null,
    error:pub.error||null,
    pythonStderr:pub.ok?null:String(pub.stderr||'').slice(0,1400),
    feasible:Boolean(p.observed?.ok),
    correctObjective:pub.ok?pub.result?.cost===oracle(task.id,task.public).cost:false,
    pass:Boolean(p.passed),failureReason:p.observed?.reason||null},
  hiddenChecks:other,tests:checks,
  success:Boolean(p.passed&&other.every(x=>x.pass)&&Object.values(checks).every(Boolean))};
 cp.assessments.push(record);
 cp.lastAssessment=record;
 cp.feedback=JSON.stringify({visibleOutput:record.public.result,
  publicPass:record.public.pass,publicFailure:record.public.failureReason,
  modelTests:checks,hiddenResults:'withheld',
  next:'Repair the root cause, not just the objective number.'}).slice(0,1600);
 cp.publicObservation=record.public.result;
 cp.phase=record.success?'done':'diagnose';
 cp.status=record.success?'passed':'ready';
 return record;
}
async function apply(cp){
 if(cp.status!=='answer_journaled'||!cp.pending)
  throw Error('NO_JOURNALED_RESPONSE');
 const {phase,answer,meta}=cp.pending;
 const action=String(answer.action||'').toLowerCase();
 const entry={phase,action,usage:meta.usage,http:meta.http,
  elapsedMs:meta.elapsedMs,summary:String(answer.diagnosis||answer.explanation||'').slice(0,650),
  codeHash:null,publicPassed:null};
 if(action!==phase){
  cp.feedback='Wrong action received: '+action+' expected '+phase;
  cp.phase=phase;cp.status='ready';
 }else if(phase==='diagnose'){
  cp.diagnosis={diagnosis:String(answer.diagnosis||'').slice(0,1100),
   hypothesis:String(answer.hypothesis||'').slice(0,1100)};
  cp.phase='repair';cp.status='ready';
 }else if(phase==='repair'){
  const code=String(answer.python||'');
  entry.codeHash=hash(code);
  cp.latestCode=code;
  // Public validation is not the final acceptance gate; hidden remains sealed.
  const e=await runIsolatedPython(code,task.public);
  // Do not waste a model-authored test phase on Python that has already
  // crashed, or on an infeasible/suboptimal public witness. Return only
  // PUBLIC execution evidence, including bounded stderr traceback.
  const verified=e.ok?grade(task.id,task.public,e.result):
   {passed:false,observed:{ok:false,reason:e.error}};
  const publicPass=Boolean(verified.passed);
  cp.publicObservation=e.ok?e.result:null;
  entry.publicPassed=publicPass;
  cp.feedback=JSON.stringify({publicExecution:e.ok,
    publicOutput:e.ok?e.result:null,
    publicFeasible:verified.observed?.ok===true,
    publicExactOptimal:publicPass,
    publicError:e.error||null,
    pythonStderr:e.ok?null:String(e.stderr||'').slice(0,1400),
    diagnostic:verified.observed?.reason||null,
    hiddenNotDisclosed:true,
    next:publicPass?'Write independent property tests.':
      'Use the Python stderr to diagnose the execution error, then repair the full source.'}).slice(0,2500);
  cp.phase=publicPass?'tests':'diagnose';cp.status='ready';
 }else if(phase==='tests'){
  cp.latestTests=String(answer.python||'');
  entry.codeHash=hash(cp.latestTests);
  const a=await assess(cp);
  entry.publicPassed=a.public.pass;
 }
 cp.phaseHistory.push(entry);
 cp.pending=null;
 if(cp.callsAttempted>=MAX_CALLS&&cp.status==='ready')cp.status='exhausted';
 if(cp.providerReportedTokens>=MAX_TOKENS&&cp.status==='ready')cp.status='exhausted';
 save(cp);
 console.log('REMEDIATION_V2_PHASE='+JSON.stringify({attempt:cp.callsAttempted,
  phase,action,status:cp.status,nextPhase:cp.phase,
  tokens:cp.providerReportedTokens,publicPassed:entry.publicPassed,
  heldOutPass:cp.lastAssessment?.hiddenChecks?.every(x=>x.pass)||false,
  authoredTests:cp.lastAssessment?.tests||null}));
}
async function oneCycle(){
 const cp=load();
 if(cp.status==='answer_journaled'){await apply(cp);return;}
 if(['passed','manual_hold','exhausted','stopped'].includes(cp.status)){
  console.log('REMEDIATION_V2_NOOP='+cp.status);return;
 }
 if(cp.status!=='ready')throw Error('AMBIGUOUS_STAGE_NOT_RESUBMITTED');
 if(cp.callsAttempted>=MAX_CALLS||cp.providerReportedTokens>=MAX_TOKENS){
  cp.status='exhausted';save(cp);return;
 }
 cp.callsAttempted++;
 cp.status='request_in_flight';cp.requestNonce=randomUUID();
 save(cp); // durable intent BEFORE paid API request
 let response;
 try{response=mockRun?simulateResponse(cp.phase,FIXTURE):await callMoonshot(cp);}
 catch(e){
  const telemetry=e.telemetry||null;
  // A successful HTTP response with finish_reason=length is NOT usable
  // cognitive output, but its provider-reported tokens are still consumed.
  // Preserve known usage without double-counting an unreceived result.
  const knownUsage=Number(telemetry?.usage);
  if(Number.isSafeInteger(knownUsage)&&knownUsage>0)
   cp.providerReportedTokens+=knownUsage;
  cp.status='manual_hold';cp.uncertainFailure=summarize(e);
  cp.transportTelemetry=telemetry;save(cp);
  console.log('REMEDIATION_V2_MANUAL_HOLD='+JSON.stringify({phase:cp.phase,
   attempt:cp.callsAttempted,failure:cp.uncertainFailure,
   accountedProviderTokens:cp.providerReportedTokens,telemetry:cp.transportTelemetry}));
  return;
 }
 cp.providerReportedTokens+=response.usage;
 // Negative fixture replays the exact original broken Kimi source. It
 // must fail witness certification even though its objective is optimal.
 if(mockRun&&FIXTURE==='bad_witness'&&cp.phase==='repair')
  response.answer.python=cp.originalCode;
 cp.pending={phase:cp.phase,answer:response.answer,
  meta:{usage:response.usage,http:response.http,elapsedMs:response.elapsedMs}};
 cp.status='answer_journaled';save(cp);
 if(mockRun&&process.env.AAU_FIXTURE_STOP_AFTER_JOURNAL==='yes'){
  console.log('REMEDIATION_FIXTURE_CRASH_BOUNDARY='+cp.phase);
  return;
 }
 await apply(cp);
}
function finish(){
 const cp=load(),success=cp.status==='passed';
 const report={experiment:cp.experiment,sourceRun:cp.sourceRun,
  oldAmbiguousRequestRetried:false,oldProviderBillingUnknown:true,
  simulation:mockRun,scenario:mockRun?FIXTURE:null,
  newBillableAttempts:mockRun?0:cp.callsAttempted,
  // Only journaled synthetic answers count as completed; artificial
  // budget claims and incomplete provider responses do not.
  syntheticResponseCount:mockRun?cp.phaseHistory.length:0,
  providerReportedTokens:mockRun?0:cp.providerReportedTokens,
  simulatedTokenUnits:mockRun?cp.providerReportedTokens:0,
  model:mockRun?'synthetic_fixture_no_model':'kimi-k2.6',
  thinking:mockRun?'not_applicable':'disabled',status:cp.status,success,
  baselineFailedSourceHash:cp.originalHash,originalBadOutput:cp.originalBadOutput,
  phaseHistory:cp.phaseHistory,latestCode:cp.latestCode,
  modelWrittenTests:cp.latestTests,assessments:cp.assessments,
  visiblePassed:cp.lastAssessment?.public?.pass||false,
  allSixHiddenPassed:cp.lastAssessment?.hiddenChecks?.every(x=>x.pass)||false,
  ownTests:cp.lastAssessment?.tests||null,
  diagnostics:cp.diagnosis,transportTelemetry:cp.transportTelemetry||null,
  limitations:'One task family, small held-out set; cannot prove universal self-remediation.'};
 writeFileSync(REPORT,JSON.stringify(report,null,2)+'\n');
 console.log('REMEDIATION_V2_FINAL='+JSON.stringify({
  status:cp.status,success,attempts:cp.callsAttempted,
  tokens:cp.providerReportedTokens,simulated:mockRun,
  phases:cp.phaseHistory.map(x=>x.phase),
  publicPassed:report.visiblePassed,allSixHiddenPassed:report.allSixHiddenPassed,
  selfTests:report.ownTests}));
 if(!success)process.exitCode=2;
}
if(ACTION==='seed')await seed();
else if(ACTION==='cycle')await oneCycle();
else if(ACTION==='finish')finish();
else throw Error('UNKNOWN_ACTION');
