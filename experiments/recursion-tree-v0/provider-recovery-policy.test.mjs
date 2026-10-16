import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryPolicy,allowNewInferenceAfterFailure,VERIFIED_CAPABILITIES}
  from './provider-recovery-policy.mjs';

for(const provider of ['moonshot-chat','nvidia-nim-chat']){
  test(provider+' starts with no unproven idempotency/retrieval guarantees',()=>{
    assert.equal(VERIFIED_CAPABILITIES[provider].resultLookupGuaranteed,false);
    assert.equal(VERIFIED_CAPABILITIES[provider].submissionIdempotencyGuaranteed,false);
  });
  test(provider+' allows first dispatch only before evidence of transmission',()=>{
    assert.equal(recoveryPolicy({provider,state:'prepared_not_sent'}).action,'dispatch_once');
    assert.equal(recoveryPolicy({provider,state:'accepted'}).action,'no_op');
    assert.equal(recoveryPolicy({provider,state:'journaled'}).action,'commit_existing_journal');
  });
  test(provider+' never resends a sent or uncertain completion automatically',()=>{
    for(const state of ['sent','uncertain','manual_hold']){
      const r=recoveryPolicy({provider,state,requestId:'trace-id-123'});
      assert.equal(r.action,'manual_hold');
      assert.equal(r.operatorReviewRequired,true);
    }
  });
  test(provider+' trace id, fake lookup or 404 is insufficient even with optimistic flag',()=>{
    for(const lookupResult of [{status:404},{complete:true,requestId:'wrong',verified:true,digest:'abcd'},
      {complete:true,requestId:'trace-id-123',verified:true,digest:'abcd'}]){
      assert.equal(recoveryPolicy({provider,state:'sent',requestId:'trace-id-123',
        signedProviderGuarantee:true,lookupResult}).action,'manual_hold');
    }
  });
  test(provider+' any new potentially billable request requires operator and budget',()=>{
    const state='manual_hold';
    const args={provider,state,remainingAttempts:1,remainingBudget:800};
    assert.equal(allowNewInferenceAfterFailure(args).allowed,false);
    assert.equal(allowNewInferenceAfterFailure({...args,operatorAuthorization:true}).allowed,true);
    assert.equal(allowNewInferenceAfterFailure({...args,operatorAuthorization:true,remainingAttempts:0}).allowed,false);
    assert.equal(allowNewInferenceAfterFailure({...args,operatorAuthorization:true,remainingBudget:0}).allowed,false);
  });
}
test('unknown provider, missing request ID or unexpected state also fail closed',()=>{
  assert.equal(recoveryPolicy({provider:'unknown',state:'sent',requestId:'some-id'}).action,'manual_hold');
  assert.equal(recoveryPolicy({provider:'moonshot-chat',state:'sent'}).reason,'request_id_required');
  assert.equal(recoveryPolicy({provider:'moonshot-chat',state:'mystery',requestId:'some-id'}).reason,'invalid_request_state');
});
