// Fail-closed contract for opaque external LLM transports.
// No model SDK, environment access, or production dependencies.
export const VERIFIED_CAPABILITIES=Object.freeze({
  'moonshot-chat':Object.freeze({resultLookupGuaranteed:false,
    submissionIdempotencyGuaranteed:false,scope:'v1/chat/completions'}),
  'nvidia-nim-chat':Object.freeze({resultLookupGuaranteed:false,
    submissionIdempotencyGuaranteed:false,scope:'v1/chat/completions'}),
});
const safe=x=>typeof x==='string'&&x.length>0&&x.length<=256;
export function recoveryPolicy({provider,state,requestId,lookupResult=null,
  signedProviderGuarantee=false}={}){
  const cap=VERIFIED_CAPABILITIES[provider];
  if(!cap)return {action:'manual_hold',reason:'provider_not_verified'};
  if(state==='accepted')return {action:'no_op',reason:'already_accepted'};
  if(state==='journaled')return {action:'commit_existing_journal',reason:'reply_is_durable'};
  if(state==='prepared_not_sent')return {action:'dispatch_once',reason:'no_request_dispatched'};
  if(!['sent','uncertain','manual_hold'].includes(state))
    return {action:'manual_hold',reason:'invalid_request_state'};
  if(!safe(requestId))return {action:'manual_hold',reason:'request_id_required'};
  if(signedProviderGuarantee&&cap.resultLookupGuaranteed&&
    lookupResult?.complete===true&&lookupResult.requestId===requestId&&
    safe(lookupResult.digest)&&lookupResult.verified===true)
    return {action:'journal_recovered_result',reason:'verified_provider_retrieval'};
  // An HTTP 200 containing a response with some other ID, a 404 or 405, a
  // trace header, and the fact that POST bodies are similar do NOT certify
  // deduplication. Do not retry until explicit operator authorization.
  return {action:'manual_hold',reason:'unresolved_external_execution',
    operatorReviewRequired:true,refundNotAssumed:true};
}
export function allowNewInferenceAfterFailure({provider,state,operatorAuthorization,
  remainingAttempts,remainingBudget}={}){
  const cap=VERIFIED_CAPABILITIES[provider];
  if(!cap)return {allowed:false,reason:'provider_not_verified'};
  if(state==='prepared_not_sent')return {allowed:true,reason:'initial_send_only'};
  if(state!=='manual_hold')return {allowed:false,reason:'reconcile_first'};
  if(operatorAuthorization!==true)return {allowed:false,reason:'requires_explicit_operator'};
  if(!Number.isSafeInteger(remainingAttempts)||remainingAttempts<1)
    return {allowed:false,reason:'retry_ceiling'};
  if(!Number.isFinite(remainingBudget)||remainingBudget<=0)
    return {allowed:false,reason:'compute_budget_exhausted'};
  return {allowed:true,reason:'operator_authorized_new_paid_request',
    note:'must debit new budget; previous call may have been billed'};
}
