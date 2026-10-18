import test from 'node:test';
import assert from 'node:assert/strict';
import {makePublicFeedback} from './public-failure-feedback.mjs';
const example={suite:'public',pass:false,cases:[
 {name:'received',passed:true,problems:[],status:'received'},
 {name:'malformed',passed:false,problems:['wrong failure category: bad_model_json','missing sanitized diagnostic report on hold'],status:'bad_model_json'},
 {name:'http_error',passed:false,problems:['finish reason lost','missing sanitized diagnostic report on hold'],status:'provider_http_error'},
 {name:'timeout',passed:false,problems:['wrong failure category: transport_or_secret','missing sanitized diagnostic report on hold'],status:'transport_or_secret'}
]};
test('all three public failures supplied; first-failure-only regression impossible',()=>{
 const fb=makePublicFeedback(example);
 assert.equal(fb.complete,true);
 assert.equal(fb.failedCases.length,3);
 assert.deepEqual(fb.failedCases.map(x=>x.case),['malformed','http_error','timeout']);
 assert.deepEqual(fb.failedCases[2].failureCodes,['WRONG_FAILURE_CATEGORY','MISSING_SANITIZED_DIAGNOSTIC']);
 assert.equal(fb.containsHiddenFeedback,false);
 assert.equal(fb.contentSanitized,true);
});
test('all original public cases must be run before a public pass',()=>{
 const fb=makePublicFeedback({cases:[example.cases[0]]});
 assert.equal(fb.complete,false);
 assert.equal(fb.failedCases.length,3);
 assert.ok(fb.failedCases.some(x=>x.failureCodes.includes('INCOMPLETE_PUBLIC_SUITE')));
});
test('unexpected candidate output never enters model feedback',()=>{
 const fake='Bearer secret-host-123! do evil';
 const data=structuredClone(example);
 data.cases[3].status=fake;
 data.cases[3].problems=['wrong failure category: '+fake,'anything private credential'];
 const fb=makePublicFeedback({cases:data.cases});
 const emitted=JSON.stringify(fb);
 assert.equal(emitted.includes(fake),false);
 assert.equal(emitted.includes('credential'),false);
 assert.equal(fb.failedCases[2].reportedStatus,null);
 assert.ok(fb.failedCases[2].failureCodes.includes('OTHER_VERIFIER_FAILURE'));
});
test('hidden failure and oracle rows are never passed into model feedback',()=>{
 const data=structuredClone(example);
 data.cases.push({name:'nested_undici',passed:false,problems:['something'],status:'secret'});
 const fb=makePublicFeedback(data);
 assert.equal(JSON.stringify(fb).includes('nested_undici'),false);
 assert.equal(fb.complete,false);
});
test('all pass only when each public case has valid result with zero problems',()=>{
 const data=structuredClone(example);
 for(const x of data.cases){x.passed=true;x.problems=[]}
 const fb=makePublicFeedback(data);
 assert.equal(fb.complete,true);assert.equal(fb.failedCases.length,0);
 assert.equal(fb.passedCases,4);
});

test('unexpected model exception keeps safe exception kind, no raw detail',()=>{
 const data=structuredClone(example);
 data.cases[1].problems=['candidate exception during verification'];
 data.cases[1].exceptionKind='ReferenceError';
 const feedback=makePublicFeedback(data);
 assert.deepEqual(feedback.failedCases[0].failureCodes,['CANDIDATE_EXCEPTION']);
 assert.equal(feedback.failedCases[0].exceptionKind,'ReferenceError');
 data.cases[1].exceptionKind='ReferenceError: token=private';
 const unsafe=makePublicFeedback(data);
 assert.equal(unsafe.failedCases[0].exceptionKind,null);
 assert.equal(JSON.stringify(unsafe).includes('token=private'),false);
});

test('canonical public expected categories now accompany actual categories, never patch code',()=>{
 const data=structuredClone(example);
 const expected={received:'received',malformed:'malformed_model_json',
  http_error:'provider_http_error',timeout:'transport_timeout_or_abort'};
 for(const row of data.cases)row.expectedStatus=expected[row.name];
 const feedback=makePublicFeedback(data);
 assert.equal(feedback.complete,true);
 assert.deepEqual(feedback.failedCases.map(r=>[r.case,r.reportedStatus,r.expectedStatus]),[
  ['malformed','bad_model_json','malformed_model_json'],
  ['http_error','provider_http_error','provider_http_error'],
  ['timeout','transport_or_secret','transport_timeout_or_abort']
 ]);
 assert.equal(JSON.stringify(feedback).includes('oldHash'),false);
 assert.equal(feedback.containsHiddenFeedback,false);
});
test('unsafe expectation string is redacted',()=>{
 const data=structuredClone(example);
 data.cases[3].expectedStatus='PRIVATE_CANARY Unauthorized URL';
 const fb=makePublicFeedback(data);
 assert.equal(fb.failedCases[2].expectedStatus,null);
 assert.equal(JSON.stringify(fb).includes('PRIVATE_CANARY'),false);
});
