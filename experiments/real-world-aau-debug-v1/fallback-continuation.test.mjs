import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeExhaustionContinuation,validateContinuationStage,MAX_RESEARCH_CALLS,OFF_BUDGET} from './fallback-continuation.mjs';
const previous=[
 {stage:'discover_and_decompose',thinking:'disabled',status:'accepted'},
 {stage:'implement_model_generated_plan',thinking:'disabled',status:'accepted'},
 {stage:'remediate_failed_public_test',thinking:'enabled',status:'thinking_budget_exhausted'}
];
const exhausted={stage:'remediate_failed_public_test',thinking:'enabled',providerHttpStatus:200,
 finishReason:'length',completionCeiling:32768,completionTokens:32768};
test('original three calls + confirmed ON exhaustion authorize exactly two new OFF calls',()=>{
 const next=authorizeExhaustionContinuation({modelCalls:previous,thinkingReceipt:exhausted});
 assert.equal(next.authorized,true);assert.equal(next.mode,'disabled');
 assert.equal(next.outputTokenCeiling,4096);assert.equal(next.continuationCallsRemaining,2);
 assert.equal(MAX_RESEARCH_CALLS,5);assert.equal(OFF_BUDGET,4096);
 assert.equal(next.mayResendPriorRequest,false);
 assert.equal(next.containsHiddenCases,false);
 assert.equal(validateContinuationStage(next,'decompose_remaining_public_failures'),true);
 assert.equal(validateContinuationStage(next,'implement_decomposed_public_remediation'),true);
 assert.equal(validateContinuationStage(next,'remediate_failed_public_test'),false);
});
test('not authorized for timeout, HTTP error, malformed stop, length with partial output, thinking OFF',()=>{
 for(const d of [
  {...exhausted,providerHttpStatus:null},{...exhausted,providerHttpStatus:503},
  {...exhausted,finishReason:'stop'},{...exhausted,completionTokens:19000},
  {...exhausted,thinking:'disabled'},{...exhausted,completionCeiling:4096},
  {...exhausted,stage:'implement_model_generated_plan'}
 ]){
  assert.equal(authorizeExhaustionContinuation({modelCalls:previous,thinkingReceipt:d}).authorized,false);
 }
});
test('not authorized for duplicate, out-of-order, exhausted or arbitrary calls',()=>{
 for(const calls of [
  previous.slice(0,2),
  [...previous,...previous.slice(0,2)],
  [previous[1],previous[0],previous[2]],
  [previous[0],previous[1],{stage:'repair_1'}]
 ]){
  assert.equal(authorizeExhaustionContinuation({modelCalls:calls,thinkingReceipt:exhausted}).authorized,false);
 }
});
test('no fallback if response body/finish details were not received',()=>{
 const next=authorizeExhaustionContinuation({modelCalls:previous,thinkingReceipt:null});
 assert.equal(next.authorized,false);
 assert.equal(next.continuationCallsRemaining,0);
 assert.equal(next.mayResendPriorRequest,false);
});
