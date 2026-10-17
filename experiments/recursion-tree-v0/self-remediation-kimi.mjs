// Genuine persistent Kimi K2.6 self-remediation experiment.
// A separate OS process executes EACH remediation step; saved checkpoints
// are the only inter-process memory. Start from the model's actual FAILED
// Python artifact from GitHub Actions run 38994095805, not a rewritten seed.
// No production services; model-generated code is executed in disposable
// Docker without network, root, host credentials or writable root mount.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TASKS,check,grade,oracle} from './unseen-python-benchmarks.mjs';
import {runIsolatedPython} from './unseen-python-sandbox.mjs';

const mode=process.argv[2];
const CHECKPOINT='self-remediation-checkpoint.json';
const REPORT='self-remediation-report.json';
const PREVIOUS='unseen-python-kimi-report.json';
const KEY=String(process.env.MOONSHOT_API_KEY||'').trim();
const task=TASKS.find(x=>x.id==='assignment');
const sha=x=>createHash('sha256').update(String(x||'')).digest('hex');
const save=x=>writeFileSync(CHECKPOINT,JSON.stringify(x,null,2)+'\n');
const load=()=>JSON.parse(readFileSync(CHECKPOINT,'utf8'));
const summaryError=x=>String(x?.message||x||'error').slice(0,170);
const maybeInt=x=>Number.isFinite(x)?x:null;
const maximumCycles=7,tokenLimit=42000;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes')
  throw Error('EXPERIMENT_CI_GUARD');
function variations(){
 const x=structuredClone(task.public);
 const make=(name,edit)=>{const p=structuredClone(x);edit(p);return {name,input:p}};
 return [
  {name:'hidden_heldout',input:task.hidden},
  make('cost_shift',p=>{p.costs[2]=[9,13,6];p.costs[5]=[8,10,5]}),
  make('activation_shift',p=>{p.activation=[12,7,9]}),
  make('zero_switch_penalty',p=>{p.switchPenalty=0}),
  make('shift_capacity',p=>{p.capacities=[10,9,9]}),
  make('reordered_jobs',p=>{p.sizes.reverse();p.costs.reverse();p.allowed.reverse()}),
 ];
}
async function runCandidate(code,tests,priorBad){
 const pub=await runIsolatedPython(code,task.public);
 const publicGrade=pub.ok?grade(task.id,task.public,pub.result):
  {passed:false,observed:{ok:false,reason:pub.error},expected:null};
 const comparison=[];
 for(const item of variations()){
  const r=await runIsolatedPython(code,item.input);
  const g=r.ok?grade(task.id,item.input,r.result):{passed:false,observed:{reason:r.error}};
  comparison.push({name:item.name,passed:g.passed,
    returnedCost:maybeInt(r.result?.cost),oracleCost:oracle(task.id,item.input).cost,
    witnessFeasible:g.observed?.ok===true,error:r.error||null});
 }
 const selfTest=typeof tests==='string'&&tests.length>=80&&tests.length<=7500;
 let good=null,bad=null;
 if(selfTest){
  good=await runIsolatedPython(tests,{input:task.public,
    output:pub.result||null});
  bad=await runIsolatedPython(tests,{input:task.public,
    output:priorBad});
 }
 const testsGood=good?.ok&&good.result?.passed===true;
 const detectsOldFailure=bad?.ok&&bad.result?.passed===false;
 const allVariants=comparison.every(r=>r.passed);
 return {public:{
     executed:pub.ok,output:pub.ok?pub.result:null,
     error:pub.ok?null:pub.error,
     feasible:publicGrade.observed?.ok===true,
     exactCost:pub.ok?maybeInt(pub.result?.cost):null,
     passed:publicGrade.passed,
     diagnostic:publicGrade.observed?.reason||null},
   selfTests:{supplied:selfTest,passesNew:Boolean(testsGood),
     catchesOriginalFailure:Boolean(detectsOldFailure),
     newExecution:good?.ok?good.result:good?.error||null,
     oldExecution:bad?.ok?bad.result:bad?.error||null},
   heldOut:{passedAll:allVariants,count:comparison.length,
     // For audit only; this field is NEVER sent back to the model.
     checks:comparison},
   passed:Boolean(publicGrade.passed&&allVariants&&testsGood&&detectsOldFailure)};
}
async function seed(){
 if(existsSync(CHECKPOINT))throw Error('DO_NOT_OVERWRITE_EXISTING_REMEDIATION');
 if(!existsSync(PREVIOUS))throw Error('PRIOR_LIVE_KIMI_ARTIFACT_MISSING');
 const old=JSON.parse(readFileSync(PREVIOUS,'utf8'));
 if(old.experiment!=='AAU_KIMI_K26_SELF_AUTHORED_PYTHON_UNSEEN_V1'||
    old.model!=='kimi-k2.6')throw Error('WRONG_ORIGINAL_LIVE_EXPERIMENT');
 const failed=old.suites.find(s=>s.id==='assignment');
 if(!failed||failed.passes||failed.codeAttempts!==2||
    failed.submissions.length!==2)throw Error('EXPECTED_FAILED_KIMI_SEED_MISSING');
 const code=failed.submissions.at(-1).code;
 const bad=failed.submissions.at(-1).publicRun?.result;
 if(!code||!bad||bad.cost!==90||bad.assignment?.length!==7||
    failed.submissions.at(-1).codeDigest!==sha(code))
   throw Error('ORIGINAL_SEED_INTEGRITY_FAILED');
 const initial=await runIsolatedPython(code,task.public);
 if(!initial.ok||initial.result.cost!==90||check(task.id,task.public,initial.result).ok)
   throw Error('FAILURE_NOT_REPRODUCED');
 const cp={
  experiment:'AAU_SELF_REMEDIATION_PERSISTED_KIMI_K26_V1',
  status:'remediating',sourceActionsRun:38994095805,originModel:'kimi-k2.6',
  originalCodeHash:sha(code),originalCode:code,originalBadOutput:bad,
  lastCode:code,lastTests:null,cycles:[],tokens:0,
  maxCycles:maximumCycles,tokenLimit,
  foundError:{publicCost:90,publicAssignment:bad.assignment,
    witness:'infeasible',observedValidator:'machine_capacity',
    priorRepairAttempts:2,priorLastError:failed.failure},
  currentFailureFeedback:'Correct numerical cost 90, but the returned assignment [2,2,2,2,2,2,2] violates machine 2 capacity. Your prior code-only fix did not repair the witness. Diagnose and repair using general code with provable state-aware reconstruction. Do not assume the optimum cost proves the witness.',
  createdAt:new Date().toISOString(),
 };
 save(cp);
 console.log('SELF_REMEDIATION_SEED='+JSON.stringify({originalCodeHash:sha(code),
  reproducedOutput:initial.result,priorRepairAttempts:2,status:cp.status}));
}
async function request(c,cp){
 if(!KEY)throw Error('MOONSHOT_KEY_MISSING');
 if(cp.cycles.length>=maximumCycles||cp.tokens>=tokenLimit)
   throw Error('BOUNDED_REMEDIATION_EXHAUSTED');
 const messages=[
  {role:'system',content:`You are Kimi K2.6 resuming YOUR OWN genuinely
failed factory-assignment algorithm. Your work and failures are preserved
across independent process restarts. The runtime does not provide code
patches. You are the agent responsible for diagnosing and repairing your
OWN flawed code, verifying the mathematical witness and preserving correct
functionality. You may choose a different exact algorithm, but derive
and implement it yourself. Think before proposing each change.

Output one STRICT JSON object:
{"action":"repair","diagnosis":"...","hypothesis":"...","python":"entire executable Python 3 solver","self_tests":"entire executable Python 3 property checker"}
or
{"action":"diagnose","diagnosis":"...","hypothesis":"..."}
or
{"action":"stop","reason":"..."}

Your Python solver reads ONE JSON factory problem from stdin and prints one
JSON object {"cost":integer,"assignment":[machine-index per job]}.
The self_tests script reads {"input":factory_object,"output":solver_output}
from stdin, independently checks ALL output assignments and returns one
JSON object {"passed":boolean}. It MUST return passed=false for the
original bad all-machine-2 output and passed=true for your repaired
feasible output. Use real computations: machine eligibility, capacities,
assignment price, activation fee once per used machine, switch charges,
cost consistency and full witness length, not a hardcoded sample response.
The trusted runtime separately checks global optimality and runs the
same solver on unknown inputs; their contents and results are never
shown to you. You are only told public feedback. No predefined optimal
assignment and no engine solver is given to you.

This is an ongoing bounded, evidence-driven self-remediation loop.
Every accepted response is saved durably, then submitted code is executed
in an isolated Python 3.12 container without network/secrets. There
are at most seven independent model calls; avoid verbosity. Write
complete executable source, no diffs, no markdown. A failure should
lead to a new, explicit hypothesis supported by observed results.
Do not fabricate tests or correctness.`},
  {role:'user',content:JSON.stringify({
    problem:task.specification,publicInstance:task.public,
    priorSource:cp.lastCode,
    originalBadOutput:cp.originalBadOutput,
    observedFailure:cp.currentFailureFeedback,
    priorRepairCycles:cp.cycles.map(x=>({
      cycle:x.cycle,diagnosis:x.diagnosis,hypothesis:x.hypothesis,
      sourceHash:x.codeHash,public:x.assessment?.public,
      selfTests:x.assessment?.selfTests
    })).slice(-5),
    instructions:'Continue the diagnosis. Make a targeted, verifiable repair; if it regresses, correct the new defect rather than declaring success.'})},
 ];
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),95000);
 const started=Date.now();
 let status=null,finish=null,usage=0;
 try{
  const r=await fetch('https://api.moonshot.ai/v1/chat/completions',{
    method:'POST',headers:{authorization:'Bearer '+KEY,
      'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({model:'kimi-k2.6',thinking:{type:'disabled'},
      temperature:0.6,stream:false,response_format:{type:'json_object'},
      max_tokens:6500,messages}),signal:ctl.signal,redirect:'manual'});
  status=r.status;
  const body=await r.json().catch(()=>({}));
  usage=Number(body.usage?.total_tokens)||0;
  finish=body.choices?.[0]?.finish_reason||null;
  if(!r.ok)throw Error('provider_http_'+status);
  if(finish!=='stop')throw Error('incomplete_response_'+finish);
  if(body.choices[0]?.message?.reasoning_content)
    throw Error('unexpected_thinking_content');
  const raw=body.choices[0]?.message?.content;
  if(typeof raw!=='string')throw Error('empty_content');
  const result=JSON.parse(raw);
  if(!result||typeof result!=='object'||Array.isArray(result))
    throw Error('not_json_object');
  return {answer:result,usage,status,finish,elapsedMs:Date.now()-started};
 }finally{clearTimeout(timer)}
}
async function cycle(){
 const cp=load();
 if(cp.status==='passed'||cp.status==='stopped'||cp.status==='manual_hold'||
    cp.status==='exhausted'){
   console.log('SELF_REMEDIATION_NOOP='+cp.status);return;
 }
 if(cp.status!=='remediating')throw Error('UNSAFE_RESUME_UNCERTAIN_LIVE_REQUEST');
 if(cp.cycles.length>=maximumCycles||cp.tokens>=tokenLimit){
  cp.status='exhausted';save(cp);return;
 }
 const number=cp.cycles.length+1;
 cp.status='request_in_flight';cp.requestCycle=number;save(cp);
 let reply;
 try{reply=await request(null,cp)}
 catch(e){
  // The remote provider may have completed and billed us; do NOT send a
  // second copy of an uncertain request. Preserve manual hold.
  cp.status='manual_hold';cp.holdReason=summaryError(e);
  save(cp);console.log('SELF_REMEDIATION_HELD='+JSON.stringify({
    cycle:number,reason:cp.holdReason}));return;
 }
 cp.tokens+=reply.usage;
 const answer=reply.answer,action=String(answer.action||'').toLowerCase();
 const entry={cycle:number,action,diagnosis:String(answer.diagnosis||'').slice(0,1200),
  hypothesis:String(answer.hypothesis||'').slice(0,1200),modelTokens:reply.usage,
  http:reply.status,finish:reply.finish,modelLatencyMs:reply.elapsedMs,
  codeHash:null,code:null,selfTestsSource:null,assessment:null};
 // Journal the returned answer BEFORE running Python. If execution crashes,
 // the next separate process sees the accepted answer and may reconcile.
 cp.pendingAnswer={...entry,code:String(answer.python||''),
   selfTestsSource:String(answer.self_tests||'')};
 cp.status='answer_journaled';save(cp);
 if(action==='repair'){
  const code=cp.pendingAnswer.code,tests=cp.pendingAnswer.selfTestsSource;
  entry.codeHash=sha(code);entry.code=code;entry.selfTestsSource=tests;
  const assessment=await runCandidate(code,tests,cp.originalBadOutput);
  entry.assessment=assessment;
  cp.lastCode=code;cp.lastTests=tests;
  cp.currentFailureFeedback=assessment.public.executed?
    JSON.stringify({candidate:assessment.public.output,
      feasible:assessment.public.feasible,publicPassed:assessment.public.passed,
      diagnostic:assessment.public.diagnostic,
      selfTests:assessment.selfTests,
      note:'Hidden tests were independently run but their details are sealed.'}).slice(0,1600):
    'Python execution failed: '+assessment.public.error+
      '. Fix source or executor assumptions; hidden details remain sealed.';
  if(assessment.passed)cp.status='passed';
  else cp.status='remediating';
 }else if(action==='diagnose'){
  cp.currentFailureFeedback='Diagnostic hypothesis recorded: '+entry.hypothesis+
   '. Supply executable repaired Python and property checks next.';
  cp.status='remediating';
 }else if(action==='stop'){
  cp.status='stopped';cp.stopReason=String(answer.reason||'model_declined').slice(0,600);
 }else{
  cp.currentFailureFeedback='Invalid action; must diagnose, repair, or stop.';
  cp.status='remediating';
 }
 cp.cycles.push(entry);cp.pendingAnswer=null;cp.requestCycle=null;
 if(cp.cycles.length>=maximumCycles&&cp.status==='remediating')
  cp.status='exhausted';
 save(cp);
 console.log('SELF_REMEDIATION_CYCLE='+JSON.stringify({
  cycle:number,status:cp.status,action,tokenTotal:cp.tokens,
  diagnosis:entry.diagnosis.slice(0,140),
  publicPass:entry.assessment?.public?.passed||false,
  hiddenPass:entry.assessment?.heldOut?.passedAll||false,
  selfTests:entry.assessment?.selfTests}));
}
function finalize(){
 const cp=load(),last=cp.cycles.at(-1),passed=cp.status==='passed';
 const summary={experiment:cp.experiment,fromRun:cp.sourceActionsRun,
  model:cp.originModel,thinking:'disabled',
  status:cp.status,success:passed,originalCodeHash:cp.originalCodeHash,
  seedReproduced:true,
  countCycles:cp.cycles.length,modelCalls:cp.cycles.length+
    (cp.status==='manual_hold'?1:0),reportedTokens:cp.tokens,
  maxCycles:cp.maxCycles,
  recoveredAcrossIndependentProcesses:true,
  originalFailure:cp.foundError,
  finalPublicPassed:last?.assessment?.public?.passed||false,
  finalHeldOutPassed:last?.assessment?.heldOut?.passedAll||false,
  modelCreatedTestsDetectOriginalFailure:last?.assessment?.selfTests?.catchesOriginalFailure||false,
  modelCreatedTestsAcceptRepair:last?.assessment?.selfTests?.passesNew||false,
  cycles:cp.cycles,manualHold:cp.holdReason||null,
  conclusion:passed?
    'Model-authored repair passed public + six hidden variants and original-failure unit tests':
    'No validated autonomous remediation under the allocated run limits'};
 writeFileSync(REPORT,JSON.stringify(summary,null,2)+'\n');
 console.log('SELF_REMEDIATION_FINAL='+JSON.stringify({
  status:cp.status,success:passed,cycles:cp.cycles.length,
  modelTokens:cp.tokens,publicPass:summary.finalPublicPassed,
  heldOutPass:summary.finalHeldOutPassed,
  testsDetectRegression:summary.modelCreatedTestsDetectOriginalFailure,
  testsAcceptRepair:summary.modelCreatedTestsAcceptRepair}));
 if(!passed)process.exitCode=2;
}
if(mode==='seed')await seed();
else if(mode==='cycle')await cycle();
else if(mode==='finalize')finalize();
else throw Error('UNKNOWN_STAGE');
