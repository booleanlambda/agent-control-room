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
import {fetch as scopedFetch,Agent} from 'undici';
import {transportTimeoutPolicy,makeScopedUndiciAgent} from '../aau-provider-transport/transport-policy.mjs';
import {makePublicFeedback} from './public-failure-feedback.mjs';
import {classifyThinkingExhaustion,proposedExhaustionRoute} from './remediation-exhaustion-route.mjs';
import {focusedPatchDecision} from './early-focused-progress.mjs';
import {budgetReservation,createRepairTree,takeRepairNode,addChildRepairNodes,treeSummary,GLOBAL_PROVIDER_TOKEN_BUDGET,RECURSION_DEPTH_LIMIT} from './progress-budget-tree.mjs';
import {selectValidModelOwnedNodes} from './model-node-validation.mjs';
import {makeForensicLedger,auditEvent,attachModelDecision,resolveModelDecision,MODEL_FORENSICS_INSTRUCTIONS} from './decision-forensics.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_REAL_WORLD_DEBUG!=='yes')throw Error('RESEARCH_ONLY');
const digest=x=>createHash('sha256').update(String(x)).digest('hex');
const run=randomUUID(),base=readFileSync(new URL('./legacy-model-source.txt',import.meta.url),'utf8');
const report={experiment:'REAL_AAU_V28_ORIGINAL_PROVIDER_DIAGNOSTIC_INCIDENT',
 run,source:'booleanlambda/agent-control-room@experiment/kimi-32k-exhaustion-decompose-v28',
 sourceBlobSha:'649f8af2247cc9fa69cd6360397f89838e5fa43a',
 originalCodeSha256:digest(base),status:'running',model:'kimi-k2.6',
 problemType:'actual AAU provider/manual-hold provenance loss',
 planGeneratedByModel:false,noGoldPatchProvided:true,noSyntheticFaultInjection:true,
 proofModelIndependent:true,maxCalls:null,computeBudgetTokens:GLOBAL_PROVIDER_TOKEN_BUDGET,
 modelCalls:[],decisions:[],tests:[],forensics:makeForensicLedger(),
 architecture:'progress-driven recursive OFF nodes, independent public verifier, budget-governed ON',
 modelOwnedEarlyTasks:[],focusedNodeResults:[],earlyOffNodesRun:0,
 repairTree:{pending:0,visited:0,depthOfNextNode:null,uniqueTasks:0},
 unresolvedNodes:[],stopReason:null,
 continuedAfterConfirmedExhaustion:false,continuationCalls:0,
 success:false,candidateSha256:null,nonReplayableCalls:true,
 thinkingExhaustion:null,proposedDecomposition:null};
const save=()=>writeFileSync('real-world-debug-evidence.json',JSON.stringify(report,null,2)+'\n');
const audit=fields=>{const entry=auditEvent(report.forensics,fields);save();return entry};
const summarizePlan=tasks=>tasks.map(t=>({id:t.id,issueSha256:digest(t.issue),acceptanceSha256:digest(t.acceptance)}));
const currentDecision=()=>report.modelCalls.at(-1)?.forensicDecisionId??null;
const system='You are Kimi K2.6, acting as a software engineer. Your job is to independently diagnose and fix a REAL historical code defect, not a synthetic exercise. Produce exactly one JSON object, no markdown. Analyze constraints yourself, choose your own decomposition; avoid inventing observed outcomes. Do not request or expose hidden tests. Do not change thinking-mode policy or auto-retry ambiguous paid provider calls. '+MODEL_FORENSICS_INSTRUCTIONS;
// Deliberately no hard numeric maximum on model calls; global compute is finite.
let totalTokens=0;
async function callModel(label,payload,thinking=false){
 const max_tokens=thinking?32768:4096;
 const body={model:'kimi-k2.6',thinking:{type:thinking?'enabled':'disabled'},
  temperature:thinking?1:0.6,response_format:{type:'json_object'},max_tokens,stream:false,
  messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}]};
 const reservation=budgetReservation({requestBody:JSON.stringify(body),thinking,
  reportedTokens:report.modelCalls.map(x=>x.usage)});
 if(!reservation.permitted){
  report.stopReason=reservation.reason;save();
  throw Error('GLOBAL_COMPUTE_BUDGET_EXHAUSTED');
 }
 const receipt={stage:label,thinking:thinking?'enabled':'disabled',
  budgetReservation:reservation.reservation,remainingTokenBudgetBefore:reservation.remainingBefore,
  completionCeiling:max_tokens,requestSha256:digest(JSON.stringify(body)),
  status:'sent_or_uncertain',usage:null,finishReason:null,
  completionTokens:null,reasoningTokens:null,rawFinalContentStored:false,
  elapsedMs:null,httpHeadersReceived:false,requestDeadlineFired:false,
  rawReasoningStored:false,finalJsonDiagnostic:null,
  clientTimeoutPolicy:thinking?transportTimeoutPolicy(true):null,
  scopedUndiciUsed:thinking};
 report.modelCalls.push(receipt);save();
 // Use an explicit per-call Undici dispatcher ONLY for thinking-ON.
 // Its headers/body deadlines are beyond the existing 720s application abort;
 // thinking-OFF preserves its original global-fetch path and 175s deadline.
 const scopedAgent=thinking?makeScopedUndiciAgent(Agent,true):null;
 const controller=new AbortController();
 const requestStartedAt=Date.now();
 let headersReceived=false,requestDeadlineFired=false;
 const timer=setTimeout(()=>{
  requestDeadlineFired=true;controller.abort();
 },thinking?720000:175000);
 try{
  const key=String(process.env.MOONSHOT_API_KEY||'').trim();
  if(!key)throw Error('RESEARCH_API_KEY_MISSING');
  const providerFetch=thinking?scopedFetch:fetch;
  const res=await providerFetch('https://api.moonshot.ai/v1/chat/completions',{
   method:'POST',redirect:'manual',signal:controller.signal,
   headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify(body),...(scopedAgent?{dispatcher:scopedAgent}:{})});
  headersReceived=true;
  const j=await res.json().catch(()=>null);
  receipt.httpHeadersReceived=headersReceived;
  receipt.httpStatus=res.status;
  const choice=j?.choices?.[0];
  receipt.finishReason=choice?.finish_reason??null;
  receipt.usage=Number.isSafeInteger(j?.usage?.total_tokens)?j.usage.total_tokens:null;
  if(receipt.usage!==null)totalTokens+=receipt.usage;
  else if(res.ok){
   receipt.status='provider_usage_missing_manual_hold';
   throw Error('MODEL_REQUEST_MANUAL_HOLD');
  }
  receipt.completionTokens=Number.isSafeInteger(j?.usage?.completion_tokens)?j.usage.completion_tokens:null;
  receipt.reasoningTokens=Number.isSafeInteger(j?.usage?.completion_tokens_details?.reasoning_tokens)?
   j.usage.completion_tokens_details.reasoning_tokens:null;
  if(!res.ok){receipt.status='provider_http_error';throw Error('MODEL_REQUEST_MANUAL_HOLD')}
  const exhaustionClass=classifyThinkingExhaustion({
   thinking,httpOk:res.ok,finishReason:receipt.finishReason,
   completionTokens:receipt.completionTokens,completionCeiling:max_tokens});
  if(exhaustionClass==='THINKING_BUDGET_EXHAUSTED'){
   receipt.status='thinking_budget_exhausted';
   report.thinkingExhaustion={stage:label,thinking:'enabled',providerHttpStatus:res.status,
    finishReason:receipt.finishReason,
    usage:receipt.usage,completionTokens:receipt.completionTokens,
    reasoningTokens:receipt.reasoningTokens,completionCeiling:max_tokens};
   report.proposedDecomposition={
    nextStage:'decompose_failed_node_with_thinking_off',
    nextThinkingMode:'disabled',nextCompletionCeiling:4096,
    computeAvailabilityCheckedBeforeNextRequest:true,
    paidReplayAuthorized:false};
   throw Error('THINKING_BUDGET_EXHAUSTED');
  }
  if(receipt.finishReason!=='stop'){
   receipt.status=exhaustionClass==='OUTPUT_TRUNCATED_UNCONFIRMED'?
    'output_truncated_unconfirmed':'incomplete_response';
   throw Error('MODEL_REQUEST_MANUAL_HOLD');
  }
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
  save();
  if(e?.message==='THINKING_BUDGET_EXHAUSTED')throw e;
  throw Error('MODEL_REQUEST_MANUAL_HOLD');
 }finally{
  clearTimeout(timer);
  // Terminate any open connections in this single-use scoped dispatcher.
  if(scopedAgent)await scopedAgent.destroy();
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
 const publicFeedback=suite==='public'?makePublicFeedback({cases:rows.filter(x=>x.case)}):null;
 const requiredCases=suite==='public'?4:4;
 const observedCases=rows.filter(x=>x.case);
 const allCasesExecuted=observedCases.length===requiredCases&&
  new Set(observedCases.map(x=>x.case)).size===requiredCases;
 const receipt={suite,pass:p.status===0&&allCasesExecuted&&
  observedCases.every(x=>x.passed===true),exitCode:p.status??null,
  allCasesExecuted,
  cases:rows.filter(x=>x.case).map(x=>({name:x.case,passed:x.passed,
   problems:x.problems,status:x.reportedStatus,
   expectedStatus:suite==='public'?x.expectedStatus??null:null,
   exceptionKind:x.exceptionKind??null})),
  candidateSha256:digest(candidate),runnerErrored:!!p.error,stderrPresent:!!p.stderr};
 report.tests.push(receipt);save();
 return {receipt,publicFeedback};
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
  // Kimi chooses root subproblems; no deterministic patch or hidden tests.
  const rootResponse=await callModel('decompose_public_failure_tree',{
   incident:'The original V28 AAU provider-diagnostics code still fails the public executable tests. Decompose every independent unsolved failure into testable repair nodes before patching. Only the model chooses the decomposition.',
   originalSource:base,currentCandidate:candidate.code,
   currentCandidateSha256:digest(candidate.code),
   previousPlan:plan,publicFailures:check.publicFeedback,
   requirement:'Return 2 to 6 distinct tasks as JSON {tasks:[{issue,acceptance},...]}. Ground tasks in the actual failed public assertions, including expected and observed status categories, sanitized diagnostic report requirements, no data leakage, and ledger invariants. Do not claim the public suite is incomplete when complete. No code or hidden test cases.'
  },false);
  const rootSelection=selectValidModelOwnedNodes(rootResponse);
  report.rootNodeValidation={sourceCount:rootSelection.sourceCount,
   rejectedCount:rootSelection.rejectedCount,
   rejectionCounts:rootSelection.rejectionCounts??{},reason:rootSelection.reason};
  if(rootSelection.tasks.length<2)throw Error('INSUFFICIENT_VALID_MODEL_NODES');
  const rootTasks=rootSelection.tasks;
  const tree=createRepairTree(rootTasks);
  report.modelOwnedEarlyTasks=rootTasks;
  report.decisions.push({phase:'public_failure_tree',tasks:rootTasks});
  report.repairTree=treeSummary(tree);save();
  // Iterate the model-defined tree until the actual public oracle accepts,
  // no nodes remain, or the finite compute budget prevents another call.
  // There is no two-node truncation and no hard model-call-count threshold.
  while(tree.queue.length>0&&!check.receipt.pass){
   const node=takeRepairNode(tree);
   report.repairTree=treeSummary(tree);save();
   const initialPublic=check;
   let patchAccepted=false,patchRejection='NOT_ATTEMPTED';
   try{
    const answer=await callModel('repair_tree_node_'+node.id,{
     incident:'One narrow child node in the original V28 provider-diagnostic software repair. Fix this node only, based on independent public proof.',
     currentCandidate:candidate.code,currentCandidateSha256:digest(candidate.code),
     node:{id:node.id,depth:node.depth,issue:node.issue,acceptance:node.acceptance},
     publicFailures:check.publicFeedback,
     instruction:'Return JSON {replacements:[{old:EXACT UNIQUE SOURCE SPAN in currentCandidate,replacement:NEW SOURCE},...],diagnosis:string}. Only model-authored edits, at most 3 spans. Preserve all earlier passing cases. Do not edit tests, expose private errors, or replay paid requests.'
    },false);
    report.earlyOffNodesRun+=1;
    const edits=normalizeModelOwnedPatches(answer);
    if(edits.length>3)throw Error('FOCUSED_PATCH_TOO_MANY_EDITS');
    const trial=applyModelPatch(candidate.code,answer);
    const trialCheck=runPublicVerification(trial.code,'public');
    const verdict=focusedPatchDecision(initialPublic.receipt,trialCheck.receipt);
    patchRejection=verdict.reason;
    patchAccepted=verdict.accept;
    report.focusedNodeResults.push({
     node:node.id,depth:node.depth,accepted:verdict.accept,reason:verdict.reason,
     previousCandidateSha256:digest(candidate.code),
     trialCandidateSha256:digest(trial.code),
     beforePublicPassed:verdict.previousPassed??null,
     afterPublicPassed:verdict.currentPassed??null,
     beforeProblemCount:verdict.previousProblems??null,
     afterProblemCount:verdict.currentProblems??null});
    if(verdict.accept){candidate=trial;check=trialCheck;}
   }catch(error){
    // A failed source-span validation is a *local* cognitive error, not an
    // uncertain provider call; continue only for allowlisted local failures.
    const safe=String(error?.message);
    if(!['MODEL_PATCH_BAD_SPAN','MODEL_PATCH_NOT_EXACTLY_ONE_SPAN',
         'MODEL_PATCH_NOOP','MODEL_PATCH_TOO_LONG','MODEL_PATCH_NO_CHANGE',
         'MODEL_PATCH_COUNT_INVALID','FOCUSED_PATCH_TOO_MANY_EDITS',
         'MODEL_OUTPUT_AMBIGUOUS_CONTAINERS'].includes(safe))throw error;
    patchRejection='MODEL_AUTHORED_PATCH_INVALID';
   }
   report.decisions.push({phase:'repair_tree_node',node:node.id,depth:node.depth,
    accepted:patchAccepted,reason:patchRejection});
   report.repairTree=treeSummary(tree);save();
   if(!patchAccepted&&!check.receipt.pass&&node.depth<RECURSION_DEPTH_LIMIT){
    const childResponse=await callModel('split_failed_tree_node_'+node.id,{
     incident:'Model-authored focused node did not produce measurable independent public-test progress. Decompose the precise unresolved node into 2 to 3 smaller independently verifiable subtasks, with thinking OFF.',
     parentNode:{id:node.id,depth:node.depth,issue:node.issue,acceptance:node.acceptance},
     publicFailures:check.publicFeedback,
     currentCandidate:candidate.code,
     rejectionCategory:patchRejection,
     instruction:'Return JSON tasks:[{issue,acceptance},...] with 2 to 3 different smaller tasks, each grounded in current public failures. Do not repeat the parent/sibling task, do not invent test results and do not write code.'
    },false);
    const childSelection=selectValidModelOwnedNodes(childResponse,{maxTasks:3});
    const added=addChildRepairNodes(tree,node,childSelection.tasks);
    report.decisions.push({phase:'validate_model_child_decomposition',node:node.id,
     sourceCount:childSelection.sourceCount,rejectedCount:childSelection.rejectedCount,
     rejectionCounts:childSelection.rejectionCounts??{},reason:childSelection.reason});
    report.decisions.push({phase:'subdivide_failed_node',node:node.id,
     depth:node.depth,added:added.added,reason:added.reason});
    report.repairTree=treeSummary(tree);save();
   }else if(!patchAccepted&&!check.receipt.pass){
    report.unresolvedNodes.push({id:node.id,depth:node.depth,
     reason:patchRejection});
   }
  }
  // Thinking ON is reserved for remaining public failures *after*
  // exhaustive traversable OFF nodes, if the same compute budget still
  // permits its full 32K completion reservation.
  if(!check.receipt.pass){
   const fix=await callModel('on_residual_after_off_tree',{
    incident:'Kimi has independently traversed the budget-allowed OFF repair tree. Fix remaining real public AAU diagnostic violations without regressing the accepted response.',
    originalSource:base,currentCandidate:candidate.code,
    publicFailures:check.publicFeedback,
    treeSummary:treeSummary(tree),
    unresolvedNodes:report.unresolvedNodes,
    instruction:'Return one JSON object with only model-authored exact unique source-span replacements and optional diagnosis. Obey public expected status categories, retain sanitized per-call finish/token/category receipt, never persist private model errors or introduce paid-call retries.'
   },true);
   const repaired=applyModelPatch(candidate.code,fix);
   const verified=runPublicVerification(repaired.code,'public');
   const verdict=focusedPatchDecision(check.receipt,verified.receipt);
   report.decisions.push({phase:'thinking_on_after_tree',
    accepted:verdict.accept,reason:verdict.reason,spans:repaired.spans});
   if(verdict.accept){candidate=repaired;check=verified;}
  }
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
 report.status=e?.message==='THINKING_BUDGET_EXHAUSTED'?
  'thinking_budget_exhausted_decomposition_pending':'blocked';
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
