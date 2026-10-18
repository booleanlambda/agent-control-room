// Bounded continuation of a COMPLETED Kimi thinking-ON length response.
// This is a new 4K OFF decomposition, not a resend of an ambiguous call.
export const MAX_RESEARCH_CALLS=5;
export const OFF_BUDGET=4096;
export const REQUIRED_PRIOR_STAGES=Object.freeze([
 'discover_and_decompose',
 'implement_model_generated_plan',
 'remediate_failed_public_test'
]);
const isValidStage=x=>typeof x==='string'&&/^[a-z0-9_]{2,80}$/.test(x);
export function authorizeExhaustionContinuation({modelCalls,thinkingReceipt}={}){
 const stages=Array.isArray(modelCalls)?modelCalls.map(x=>x?.stage):[];
 const priorComplete=REQUIRED_PRIOR_STAGES.every((stage,i)=>stages[i]===stage);
 const ready=priorComplete&&stages.length===3&&
   modelCalls[0]?.status==='accepted'&&modelCalls[1]?.status==='accepted'&&
   modelCalls[2]?.status==='thinking_budget_exhausted'&&
   thinkingReceipt?.stage==='remediate_failed_public_test'&&
   thinkingReceipt?.completionCeiling===32768&&
   thinkingReceipt?.completionTokens===32768&&
   thinkingReceipt?.finishReason==='length'&&
   thinkingReceipt?.providerHttpStatus===200&&
   thinkingReceipt?.thinking==='enabled';
 return Object.freeze({
  authorized:ready,
  nextStage:ready?'decompose_remaining_public_failures':null,
  mode:ready?'disabled':null,
  outputTokenCeiling:ready?OFF_BUDGET:null,
  continuationCallsRemaining:ready?MAX_RESEARCH_CALLS-stages.length:0,
  mayResendPriorRequest:false,
  containsHiddenCases:false,
  reason:ready?'CONFIRMED_COMPLETED_ON_EXHAUSTION':'NOT_CONFIRMED_OR_INCORRECT_ROUTE'
 });
}
export function validateContinuationStage(route,requestedStage){
 return route?.authorized===true&&isValidStage(requestedStage)&&
  ['decompose_remaining_public_failures','implement_decomposed_public_remediation'].includes(requestedStage);
}
