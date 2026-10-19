// Regression fixtures transcribed exclusively from GitHub Actions artifacts:
// PR92 run 39149626818: HTTP 200 length, completion_tokens 32768/32768.
// PR93 run 39151588412: HTTP 200 stop, completion_tokens 18442/32768.
// Source: provider receipts only; no private reasoning or raw final response.
import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeExhaustionContinuation,MAX_RESEARCH_CALLS} from './fallback-continuation.mjs';
import {classifyThinkingExhaustion,proposedExhaustionRoute} from './remediation-exhaustion-route.mjs';
const sharedCalls=[
 {stage:'discover_and_decompose',thinking:'disabled',status:'accepted'},
 {stage:'implement_model_generated_plan',thinking:'disabled',status:'accepted'},
 {stage:'remediate_failed_public_test',thinking:'enabled',status:'thinking_budget_exhausted'}
];
const norm=(finishReason,completionTokens)=>({
 stage:'remediate_failed_public_test',thinking:'enabled',providerHttpStatus:200,
 finishReason,completionCeiling:32768,completionTokens
});
test('replay PR92 actual completed 32K receipt: authorize two new 4K OFF stages',()=>{
 const receipt=norm('length',32768);
 const category=classifyThinkingExhaustion({thinking:true,httpOk:true,
  finishReason:receipt.finishReason,
  completionTokens:receipt.completionTokens,completionCeiling:receipt.completionCeiling});
 assert.equal(category,'THINKING_BUDGET_EXHAUSTED');
 const r=authorizeExhaustionContinuation({modelCalls:sharedCalls,thinkingReceipt:receipt});
 assert.equal(r.authorized,true);
 assert.equal(r.nextStage,'decompose_remaining_public_failures');
 assert.equal(r.outputTokenCeiling,4096);
 assert.equal(r.continuationCallsRemaining,2);
 assert.equal(MAX_RESEARCH_CALLS,5);
 const legacy=proposedExhaustionRoute({usedCalls:3,maxCalls:5,confirmed:true});
 assert.equal(legacy.modelCallPermittedInCurrentTrial,true);
 assert.equal(legacy.nextThinkingMode,'disabled');
 assert.equal(legacy.paidReplayAuthorized,false);
});
test('replay PR93 actual completed stop at 18442: deny fallback',()=>{
 const receipt=norm('stop',18442);
 assert.equal(classifyThinkingExhaustion({thinking:true,httpOk:true,
  finishReason:receipt.finishReason,completionTokens:receipt.completionTokens,
  completionCeiling:receipt.completionCeiling}),null);
 const r=authorizeExhaustionContinuation({modelCalls:sharedCalls,thinkingReceipt:receipt});
 assert.equal(r.authorized,false);
 assert.equal(r.continuationCallsRemaining,0);
});
