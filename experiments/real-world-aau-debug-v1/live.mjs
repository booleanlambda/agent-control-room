// Real-world AAU V28 incident replay. No synthetic bugs or preselected reasoning tree.
// Kimi independently diagnoses and patches frozen historical code. Independent
// verifier executes candidate in isolated no-network Docker, no provider secrets.
import {readFileSync,writeFileSync,mkdtempSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseModelOwnedPlan,normalizeModelOwnedPatches,safeStructureSummary} from './output-normalizer.mjs';
import {inspectThinkingOnFinalJson} from '../kimi-recursion-v24/thinking-on-json-syntax.mjs';
import {inspectV28TransportFailure} from '../kimi-recursion-v24/provider-response-diagnostics.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_REAL_WORLD_DEBUG!=='yes')throw Error('RESEARCH_ONLY');
const digest=x=>createHash('sha256').update(String(x)).digest('hex');
const run=randomUUID(),base=readFileSync(new URL('./legacy-model-source.txt',import.meta.url),'utf8');
const report={experiment:'REAL_AAU_V28_ORIGINAL_PROVIDER_DIAGNOSTIC_INCIDENT',
 run,source:'booleanlambda/agent-control-room@experiment/kimi-32k-exhaustion-decompose-v28',
 sourceBlobSha:'649f8af2247cc9fa69cd6360397f89838e5fa43a',
 originalCodeSha256:digest(base),status:'running',model:'kimi-k2.6',
 problemType:'actual AAU provider/manual-hold provenance loss',
 planGeneratedByModel:false,noGoldPatchProvided:true,noSyntheticFaultInjection:true,
 proofModelIndependent:true,maxCalls:3,modelCalls:[],decisions:[],tests:[],
 success:false,candidateSha256:null,nonReplayableCalls:true};
const save=()=>writeFileSync('real-world-debug-evidence.json',JSON.stringify(report,null,2)+'\n');
const system='You are Kimi K2.6, acting as a software engineer. Your job is to independently diagnose and fix a REAL historical code defect, not a synthetic exercise. Produce exactly one JSON object, no markdown. Analyze constraints yourself, choose your own decomposition; avoid inventing observed outcomes. Do not request or expose hidden tests. Do not change thinking-mode policy or auto-retry ambiguous paid provider calls.';
const MAX_CALLS=3;
let totalTokens=0;
async function callModel(label,payload,thinking=false){
 if(report.modelCalls.length>=MAX_CALLS||totalTokens>=75000)throw Error('RESEARCH_MODEL_CAP_REACHED');
 const max_tokens=thinking?32768:4096;
 const body={model:'kimi-k2.6',thinking:{type:thinking?'enabled':'disabled'},
  temperature:thinking?1:0.6,response_format:{type:'json_object'},max_tokens,stream:false,
  messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}]};
 const receipt={stage:label,thinking:thinking?'enabled':'disabled',
  completionCeiling:max_tokens,requestSha256:digest(JSON.stringify(body)),
  status:'sent_or_uncertain',usage:null,finishReason:null,
  completionTokens:null,reasoningTokens:null,rawFinalContentStored:false,
  elapsedMs:null,httpHeadersReceived:false,requestDeadlineFired:false,
  rawReasoningStored:false,finalJsonDiagnostic:null};
 report.modelCalls.push(receipt);save();
 const controller=new AbortController();
 const requestStartedAt=Date.now();
 let headersReceived=false,requestDeadlineFired=false;
 const timer=setTimeout(()=>{
  requestDeadlineFired=true;controller.abort();
 },thinking?720000:175000);
 try{
  const key=String(process.env.MOONSHOT_API_KEY||'').trim();
  if(!key)throw Error('RESEARCH_API_KEY_MISSING');
  const res=await fetch('https://api.moonshot.ai/v1/chat/completions',{
   method:'POST',redirect:'manual',signal:controller.signal,
   headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify(body)});
  headersReceived=true;
  const j=await res.json().catch(()=>null);
  receipt.httpHeadersReceived=headersReceived;
  receipt.httpStatus=res.status;
  const choice=j?.choices?.[0];
  receipt.finishReason=choice?.finish_reason??null;
  receipt.usage=Number.isSafeInteger(j?.usage?.total_tokens)?j.usage.total_tokens:null;
  if(receipt.usage!==null)totalTokens+=receipt.usage;
  receipt.completionTokens=Number.isSafeInteger(j?.usage?.completion_tokens)?j.usage.completion_tokens:null;
  receipt.reasoningTokens=Number.isSafeInteger(j?.usage?.completion_tokens_details?.reasoning_tokens)?
   j.usage.completion_tokens_details.reasoning_tokens:null;
  if(!res.ok){receipt.status='provider_http_error';throw Error('MODEL_REQUEST_MANUAL_HOLD')}
  if(receipt.finishReason!=='stop'){receipt.status='incomplete_response';throw Error('MODEL_REQUEST_MANUAL_HOLD')}
  const text=choice?.message?.content;
  if(typeof text!=='string'||!text.trim()){receipt.status='empty_response';throw Error('MODEL_REQUEST_MANUAL_HOLD')}
  // Thinking ON can return valid JSON wrapped in a complete Markdown JSON fence.
  // Recover only that exact wrapper or a leading BOM; no reasoning text, patch
  // synthesis, speculative JSON repair or second provider request is involved.
  let answer;
  if(thinking){
   const parsed=inspectThinkingOnFinalJson(text);
   receipt.finalJsonDiagnostic=parsed.meta;
   if(parsed.meta.rawSyntax==='invalid'&&parsed.meta.recoveryResult!=='accepted'){
    receipt.status='malformed_json';throw Error('MODEL_REQUEST_MANUAL_HOLD');
   }
   answer=parsed.answer;
  }else{
   try{answer=JSON.parse(text)}catch{receipt.status='malformed_json';throw Error('MODEL_REQUEST_MANUAL_HOLD')}
  }
  if(!answer||Array.isArray(answer)||typeof answer!=='object'){
   receipt.status='invalid_shape';throw Error('MODEL_REQUEST_MANUAL_HOLD')
  }
  receipt.status='accepted';receipt.contentSha256=digest(text);
  // Retain safe SHAPE METADATA to diagnose contract drift; no raw content.
  receipt.responseStructure=safeStructureSummary(answer);
  save();return answer;
 }catch(e){
  if(receipt.status==='sent_or_uncertain'){
   const transport=inspectV28TransportFailure(e,{
    elapsedMs:Date.now()-requestStartedAt,
    httpHeadersReceived:headersReceived,requestDeadlineFired
   });
   receipt.status=transport.category==='TRANSPORT_TIMEOUT_OR_ABORT'?
    'transport_timeout_or_abort':'transport_or_client_error';
   receipt.transportDiagnostic=transport;
  }
  save();throw Error('MODEL_REQUEST_MANUAL_HOLD');
 }finally{
  clearTimeout(timer);
  receipt.elapsedMs=Date.now()-requestStartedAt;
  receipt.httpHeadersReceived=headersReceived;
  receipt.requestDeadlineFired=requestDeadlineFired;
  save();
 }
}
function applyModelPatch(src,answer){
 // Kimi thinking-OFF output is validated semantically after normalization.
 // Only field names/containers are adapted; exact source spans remain model-authored.
 const replacements=normalizeModelOwnedPatches(answer);
 let candidate=src,spans=[];
 for(const [i,r] of replacements.entries()){
  if(typeof r?.old!=='string'||r.old.length<12||typeof r?.replacement!=='string'||
     r.replacement.length>6500)throw Error('MODEL_PATCH_BAD_SPAN');
  if(candidate.split(r.old).length!==2)throw Error('MODEL_PATCH_NOT_EXACTLY_ONE_SPAN');
  if(r.old===r.replacement)throw Error('MODEL_PATCH_NOOP');
  candidate=candidate.replace(r.old,r.replacement);
  spans.push({step:i,oldHash:digest(r.old),newHash:digest(r.replacement)});
 }
 if(candidate.length>12500)throw Error('MODEL_PATCH_TOO_LONG');
 if(candidate===src)throw Error('MODEL_PATCH_NO_CHANGE');
 return {code:candidate,spans};
}
function runPublicVerification(candidate,suite='public'){
 const dir=mkdtempSync(path.join(tmpdir(),'aau-realbug-'));
 const candidatePath=path.join(dir,'candidate.js');
 writeFileSync(candidatePath,candidate,'utf8');
 const verifyPath=path.resolve('verify-candidate.mjs');
 const args=['run','--rm','--network','none','--read-only','--pids-limit','64',
  '--memory','256m','--cpus','1','--security-opt','no-new-privileges',
  '--cap-drop','ALL','--user','65534:65534',
  '-v',candidatePath+':/work/candidate.js:ro','-v',verifyPath+':/work/verify-candidate.mjs:ro',
  '-w','/work','node:22-alpine','node','verify-candidate.mjs',suite,'candidate.js'];
 const p=spawnSync('docker',args,{encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
 const rows=(p.stdout||'').split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}});
 const failures=rows.filter(x=>x.case&&!x.passed);
 const summary=rows.find(x=>x.AAU_REAL_BUG_TEST_SUMMARY);
 const receipt={suite,pass:p.status===0,exitCode:p.status??null,
  cases:rows.filter(x=>x.case).map(x=>({name:x.case,passed:x.passed,problems:x.problems,status:x.reportedStatus})),
  candidateSha256:digest(candidate),runnerErrored:!!p.error,stderrPresent:!!p.stderr};
 report.tests.push(receipt);save();
 return {receipt,firstFailure:failures[0]??null};
}
try{
 const plan=parseModelOwnedPlan(await callModel('discover_and_decompose',{
  incident:'Real V28 provider-response diagnostic was lost when a broad catch overwrote per-call provider token receipt, finish reason and exact rejection category before MODEL_REQUEST_MANUAL_HOLD.',
  provenance:'Historical source in frozen file; no gold patch available',
  task:'Inspect code. Identify at least 2 distinct causal subproblems and independent acceptance criteria. Choose the decomposition yourself (2 to 5 tasks). Return {tasks:[{issue,acceptance},...]}. Do not propose code in this stage.',
  originalSource:base
 }));
 report.planGeneratedByModel=true;report.decisions.push({phase:'plan',tasks:plan});save();
 const proposal=await callModel('implement_model_generated_plan',{
  incident:'Fix the real documented provider receipt loss without changing model thinking policy, provider retry policy, stage sequencing or business logic. Only modify the supplied frozen function.',
  originalSource:base,modelGeneratedPlan:plan,
  interface:'Return JSON {replacements:[{old:EXACT UNIQUE ORIGINAL SOURCE SPAN, replacement:NEW SOURCE TEXT},...],diagnosis:string}. Apply changes to originalSource in order. No changes to tests. Target up to 7 local replacements. Existing db.finishCall(run,stage,attempt,status,tokens,finish,responseHash) writes one receipt; report may accept providerCallDiagnostics array. Preserve provider usage on rejection and never use a second finishCall after a failed ledger write. Distinguish malformed JSON, HTTP failure, incomplete stop/length response, transport/timeout. One valid repair_ stage + length still returns THINKING_EXHAUSTED. No raw provider error messages or secrets in reports.',
  publicAcceptance:['One presend journal, no automatic paid retry','accepted responses still return normal JSON','true ON length is still special','rejected provider response retains finish/tokens/category','manual hold for non-length failures','no duplicate ledger writes on storage failures']
 });
 let candidate=applyModelPatch(base,proposal);
 report.decisions.push({phase:'implementation',spans:candidate.spans,diagnosis:typeof proposal.diagnosis==='string'?proposal.diagnosis.slice(0,650):null});
 let check=runPublicVerification(candidate.code,'public');
 if(!check.receipt.pass){
  const fix=await callModel('remediate_failed_public_test',{
   incident:'Real V28 diagnostic code bug; previous implementation failed an independent PUBLIC verifier. Repair your own candidate, preserving all earlier contracts. No gold answer or hidden tests are available.',
   originalSource:base,currentCandidate:candidate.code,
   currentCandidateSha256:digest(candidate.code),
   modelGeneratedPlan:plan,publicFailure:check.firstFailure??{category:'VERIFIER_OR_PATCH_ERROR'},
   instruction:'Return JSON {replacements:[{old:EXACT UNIQUE STRING from currentCandidate,replacement:NEW SOURCE},...],diagnosis:string}, only scoped patches. Never auto retry provider requests.'
  },true);
  candidate=applyModelPatch(candidate.code,fix);
  report.decisions.push({phase:'remediation',spans:candidate.spans,
   diagnosis:typeof fix.diagnosis==='string'?fix.diagnosis.slice(0,650):null});
  check=runPublicVerification(candidate.code,'public');
 }
 if(!check.receipt.pass){
  report.status='failed_public_verification';
 }else{
  const hidden=runPublicVerification(candidate.code,'hidden');
  report.status=hidden.receipt.pass?'passed':'failed_hidden_verification';
  report.success=hidden.receipt.pass;
 }
 report.candidateSha256=digest(candidate.code);
}catch(e){
 report.status='blocked';
 report.errorCategory=/^[A-Z0-9_]+$/.test(String(e.message))?e.message:'REDACTED_FAILURE';
}finally{
 report.providerTokens=totalTokens;
 save();
 console.log('AAU_REAL_WORLD_FINAL='+JSON.stringify({
  status:report.status,success:report.success,modelCalls:report.modelCalls.length,
  modelGeneratedPlan:report.planGeneratedByModel,providerTokens:totalTokens,
  tests:report.tests.map(x=>({suite:x.suite,pass:x.pass,cases:x.cases.length})),
  candidateSha256:report.candidateSha256,errorCategory:report.errorCategory??null
 }));
 if(!report.success)process.exitCode=2;
}
