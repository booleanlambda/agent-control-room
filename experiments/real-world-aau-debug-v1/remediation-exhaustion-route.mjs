// Separate confirmed thinking completion exhaustion from JSON defects,
// provider HTTP failures, transport timeouts, and non-thinking truncation.
// A future OFF decomposition is a *new* call, not a replay of an uncertain one.
export const OFF_DECOMPOSITION_TOKENS=4096;
export function classifyThinkingExhaustion({thinking,httpOk,finishReason,completionTokens,completionCeiling}){
 if(thinking!==true||httpOk!==true||finishReason!=='length')return null;
 if(Number.isSafeInteger(completionTokens)&&
    completionTokens===completionCeiling&&completionCeiling===32768)
  return 'THINKING_BUDGET_EXHAUSTED';
 return 'OUTPUT_TRUNCATED_UNCONFIRMED';
}
export function proposedExhaustionRoute({usedCalls,maxCalls,confirmed}){
 if(confirmed!==true)return null;
 const callBudgetRemaining=Number.isSafeInteger(usedCalls)&&Number.isSafeInteger(maxCalls)?
  Math.max(0,maxCalls-usedCalls):0;
 return Object.freeze({
  cause:'CONFIRMED_THINKING_BUDGET_EXHAUSTED',
  nextStage:'decompose_remaining_public_failures',
  nextThinkingMode:'disabled',
  nextCompletionCeiling:OFF_DECOMPOSITION_TOKENS,
  modelCallPermittedInCurrentTrial:callBudgetRemaining>0,
  blockReason:callBudgetRemaining===0?'RESEARCH_CALL_CAP_REACHED':null,
  paidReplayAuthorized:false
 });
}
