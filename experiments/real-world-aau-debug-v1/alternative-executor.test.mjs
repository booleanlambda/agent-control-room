import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAlternativeExecutor} from './alternative-executor.mjs';
import {makeForensicLedger,attachModelDecision,auditEvent} from './decision-forensics.mjs';
import {focusedPatchDecision} from './early-focused-progress.mjs';
import {inspectForensicsReport} from './forensics-trace-check.mjs';

const sha=s=>createHash('sha256').update(String(s)).digest('hex');
const names=['received','malformed','http_error','timeout'];
const makeReceipt=n=>({suite:'public',pass:n===4,allCasesExecuted:true,
 candidateSha256:null,cases:names.map((name,i)=>({name,passed:i<n,problems:i<n?[]:['PUBLIC_FAILURE']}))});
const plan=()=>({branches:[
 {approach:'Correct malformed response label at the JSON boundary.',
  hypothesis:'The response parsing catch maps the wrong diagnostic category.',
  acceptance:'Malformed JSON must receive the exact public canonical category.'},
 {approach:'Preserve provider HTTP metadata through the broad exception catch.',
  hypothesis:'The catch discards HTTP status and token usage evidence.',
  acceptance:'HTTP rejection must retain its sanitized provider receipt fields.'},
 {approach:'Separate the transport exception classification and timeout path.',
  hypothesis:'The timeout path conflates transport rejection with provider HTTP errors.',
  acceptance:'Timeout errors must use the public transport category without leakage.'}
]});
const declaredReason={
 choice:'Select this branch based on the latest public verification result.',
 rationale:'The unchanged independent public oracle reports unresolved diagnostic failures.',
 evidence:[{sourceId:'public_verifier',caseId:'malformed',observation:'A public diagnostic category is still not passing.'}],
 alternatives:[{option:'Change the public acceptance expected category.',
  rejection:'Changing independent acceptance would conceal the original software defect.'}],
 expectedOutcome:'The next independent public verification will determine whether the change made progress.',
 uncertainty:'The other public failure cases may remain unresolved after this attempt.'
};
function fixture({scores=[1,1,4],invalid=[],badProposal=false,failStage=null}={}){
 const report={modelCalls:[],branchGroups:[],tests:[],forensics:makeForensicLedger()};
 const calls=[],seenCode=[],original=makeReceipt(1);
 const audit=entry=>auditEvent(report.forensics,entry);
 const callModel=async(stage)=>{
  calls.push(stage);
  if(stage===failStage)throw Error('MODEL_REQUEST_MANUAL_HOLD');
  const ans=stage.startsWith('propose_')?
   (badProposal?{branches:plan().branches.slice(0,2)}:plan()):
   {replacements:[{old:'const original = true;',replacement:'const original = false;'}],
    tag:stage.split('_').at(-1)};
  ans.decisionForensics=structuredClone(declaredReason);
  audit({kind:'PROVIDER_CALL_PREPARED',stage});
  const attachment=attachModelDecision(report.forensics,ans,{stage,requestHash:sha(stage+'-request'),
   responseHash:sha(stage+'-response')});
  assert.equal(attachment.ok,true);
  report.modelCalls.push({stage,status:'accepted',forensicDecisionId:attachment.id});
  audit({kind:'MODEL_DECISION_RECORDED',stage,decisionId:attachment.id});
  audit({kind:'PROVIDER_CALL_SETTLED',stage,decisionId:attachment.id});
  return ans;
 };
 const executor=createAlternativeExecutor({
  report,callModel,currentDecision:()=>report.modelCalls.at(-1)?.forensicDecisionId??null,
  digest:sha,resolveModelDecision:(id,value)=>{
   const d=report.forensics.modelDecisions.find(x=>x.id===id);
   assert.ok(d);d.outcome=value.outcome;d.independentlyVerified=value.verified===true;
  },audit,save:()=>{},
  normalizeModelOwnedPatches:answer=>answer.replacements,
  applyModelPatch:(src,answer)=>{
   if(invalid.includes(answer.tag))throw Error('MODEL_PATCH_NOOP');
   return {code:src+'|'+answer.tag,spans:[]};
  },
  runPublicVerification:(code,suite)=>{
   assert.equal(suite,'public');seenCode.push(code);
   const marker=code.split('|').at(-1),index=Number(marker)-1;
   const receipt=makeReceipt(scores[index]??1);
   receipt.candidateSha256=sha(code);report.tests.push(receipt);
   const decisionId=report.modelCalls.at(-1).forensicDecisionId;
   for(const row of receipt.cases)
    audit({kind:row.passed?'CASE_TEST_PASSED':'CASE_TEST_FAILED',stage:'verify_public',
     caseId:row.name,decisionId,candidateSha256:receipt.candidateSha256});
   audit({kind:'VERIFICATION_SUITE_COMPLETED',stage:'verify_public',
    decisionId,candidateSha256:receipt.candidateSha256,
    verification:{verdict:receipt.pass?'PASS':'FAIL',suite:'public',casesExecuted:4,
     casesPassed:receipt.cases.filter(x=>x.passed).length}});
   return {receipt,publicFeedback:{summary:'public failures only'}};
  },focusedPatchDecision
 });
 return {report,calls,seenCode,executor,candidate:{code:'baseline'},check:{
  receipt:original,publicFeedback:{summary:'public failures only'}}};
}
const finishAndAudit=f=>{
 f.report.forensics.events.length&&
  auditEvent(f.report.forensics,{kind:'EXECUTION_FINISHED',stage:'execution_final'});
 return inspectForensicsReport(f.report);
};
test('failed alternative 1, regressed alternative 2, accepted alternative 3; each is independently verified',async()=>{
 const f=fixture({scores:[1,0,4]});
 const result=await f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'});
 assert.equal(result.check.receipt.pass,true);
 assert.deepEqual(f.seenCode,['baseline|1','baseline|2','baseline|3']);
 assert.deepEqual(result.group.summary.attempts.map(x=>x.verdict),['NO_PROGRESS','REGRESSION','PASS']);
 assert.equal(result.candidate.code,'baseline|3');
 assert.equal(f.report.modelCalls.length,4);
 assert.deepEqual(finishAndAudit(f).issues,[]);
});
test('partial progress is checkpointed and the next alternative starts from the improved code',async()=>{
 const f=fixture({scores:[2,4,1]});
 const result=await f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'});
 assert.deepEqual(f.seenCode,['baseline|1','baseline|1|2']);
 assert.equal(result.candidate.code,'baseline|1|2');
 assert.equal(result.group.summary.settledCount,2);
 assert.equal(f.report.forensics.events.filter(x=>x.kind==='ALTERNATIVE_SKIPPED').length,1);
 assert.deepEqual(finishAndAudit(f).issues,[]);
});
test('all three failures exhaust alternatives without accepting code',async()=>{
 const f=fixture({scores:[1,1,1]});
 const result=await f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'});
 assert.equal(result.candidate.code,'baseline');
 assert.equal(result.group.summary.settledCount,3);
 assert.deepEqual(finishAndAudit(f).issues,[]);
});
test('invalid patch is rejected locally and the next alternative still executes',async()=>{
 const f=fixture({scores:[1,4,1],invalid:['1']});
 const result=await f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'});
 assert.equal(result.candidate.code,'baseline|2');
 assert.deepEqual(f.seenCode,['baseline|2']);
 assert.equal(result.group.summary.attempts[0].verdict,'INVALID_PATCH');
 assert.deepEqual(finishAndAudit(f).issues,[]);
});
test('two choices are rejected, rather than fabricating a third branch',async()=>{
 const f=fixture({badProposal:true});
 await assert.rejects(f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'}),
  /MODEL_ALTERNATIVES_INVALID/);
 assert.deepEqual(f.seenCode,[]);
 assert.equal(f.report.branchGroups.length,0);
});
test('ambiguous provider failure blocks the branch, without replay or skipping to next branch',async()=>{
 const f=fixture({failStage:'alternative_patch_1_2',scores:[1,4,1]});
 await assert.rejects(f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'}),
  /MODEL_REQUEST_MANUAL_HOLD/);
 assert.deepEqual(f.calls,['propose_alternatives_1','alternative_patch_1_1','alternative_patch_1_2']);
 assert.equal(f.report.branchGroups[0].status,'BLOCKED');
 assert.deepEqual(finishAndAudit(f).issues,[]);
});
test('independent auditor detects a deleted branch result and cannot be fooled by completion claim',async()=>{
 const f=fixture({scores:[1,1,1]});
 await f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'});
 f.report.branchGroups[0].summary.attempts.pop();
 assert.ok(inspectForensicsReport(f.report).issues.includes('ALTERNATIVE_ORDER_OR_COVERAGE_INVALID'));
});


test('model-authored branch descriptions are sealed into forensic event chain',async()=>{
 const f=fixture({scores:[1,1,1]});
 await f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'});
 assert.deepEqual(finishAndAudit(f).issues,[]);
 f.report.branchGroups[0].summary.branches[0].hypothesis='Different unverified explanation inserted after execution.';
 assert.ok(inspectForensicsReport(f.report).issues.includes('ALTERNATIVE_PROPOSAL_HASH_MISMATCH'));
});
test('even updating branch-local hashes cannot bypass sealed proposal event',async()=>{
 const f=fixture({scores:[1,1,1]});
 await f.executor({candidate:f.candidate,check:f.check,triggerStage:'initial_patch'});
 const b=f.report.branchGroups[0].summary.branches[0];
 b.hypothesis='A replaced model-authored branch hypothesis lacking its original provenance.';
 b.hypothesisSha256=sha(b.hypothesis);
 assert.ok(inspectForensicsReport(f.report).issues.includes('ALTERNATIVE_PROPOSAL_HASH_MISMATCH'));
});
