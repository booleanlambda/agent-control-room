import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyThinkingExhaustion,proposedExhaustionRoute} from './remediation-exhaustion-route.mjs';
test('actual Kimi 32768 length is definite exhaustion, not invalid JSON',()=>{
 assert.equal(classifyThinkingExhaustion({thinking:true,httpOk:true,finishReason:'length',
   completionTokens:32768,completionCeiling:32768}),'THINKING_BUDGET_EXHAUSTED');
});
test('thinking OFF length and malformed thinking ON stop cannot enter exhaustion route',()=>{
 const common={httpOk:true,completionTokens:32768,completionCeiling:32768};
 assert.equal(classifyThinkingExhaustion({...common,thinking:false,finishReason:'length'}),null);
 assert.equal(classifyThinkingExhaustion({...common,thinking:true,finishReason:'stop'}),null);
 assert.equal(classifyThinkingExhaustion({...common,thinking:true,httpOk:false,finishReason:'length'}),null);
});
test('length without a matching token ceiling is not confirmed',()=>{
 assert.equal(classifyThinkingExhaustion({thinking:true,httpOk:true,finishReason:'length',
  completionTokens:29211,completionCeiling:32768}),'OUTPUT_TRUNCATED_UNCONFIRMED');
});
test('three paid calls used means no fourth paid call without authorization',()=>{
 const r=proposedExhaustionRoute({usedCalls:3,maxCalls:3,confirmed:true});
 assert.equal(r.nextThinkingMode,'disabled');
 assert.equal(r.nextCompletionCeiling,4096);
 assert.equal(r.blockReason,'RESEARCH_CALL_CAP_REACHED');
 assert.equal(r.modelCallPermittedInCurrentTrial,false);
 assert.equal(r.paidReplayAuthorized,false);
});
test('remaining budget is a future new decomposition, never an implicit retry',()=>{
 const r=proposedExhaustionRoute({usedCalls:2,maxCalls:3,confirmed:true});
 assert.equal(r.modelCallPermittedInCurrentTrial,true);
 assert.equal(r.paidReplayAuthorized,false);
 assert.equal(proposedExhaustionRoute({usedCalls:3,maxCalls:3,confirmed:false}),null);
});
