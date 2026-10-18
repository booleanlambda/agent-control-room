import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAlternativeBranches,selectNextAlternative,settleAlternative,alternativeSummary}
 from './alternative-branches.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const h=n=>sha('candidate-snapshot-'+n);
const plan=()=>({branches:[
 {approach:'Correct the malformed response classification.',
  hypothesis:'The JSON catch loses the canonical classification.',
  acceptance:'Malformed public case reports the canonical category.'},
 {approach:'Preserve HTTP response and finish diagnostics.',
  hypothesis:'Broad outer exception wrapping loses provider metadata.',
  acceptance:'HTTP public case retains sanitized response metadata.'},
 {approach:'Handle timeout separately from provider HTTP rejection.',
  hypothesis:'Transport errors are conflated with provider failures.',
  acceptance:'Timeout public case retains sanitized transport evidence.'}
]});
test('exactly three distinct model-authored approaches, immutable order and hashed summary',()=>{
 const state=createAlternativeBranches(plan(),h(0));
 assert.equal(alternativeSummary(state).proposed,3);
 assert.equal(alternativeSummary(state).attempts.length,0);
 assert.equal(alternativeSummary(state).branches.length,3);
 assert.equal(alternativeSummary(state).branches[0].approach,'Correct the malformed response classification.');
 assert.equal(alternativeSummary(state).branches[0].hypothesis,'The JSON catch loses the canonical classification.');
 assert.equal(selectNextAlternative(state).id,1);
 assert.throws(()=>selectNextAlternative(state),/ALTERNATIVE_STILL_ACTIVE/);
 assert.equal(settleAlternative(state,{id:1,verdict:'NO_PROGRESS',decisionId:'decision_4',
  sourceSha256:h(0),trialSha256:h(1),beforePassed:1,afterPassed:1}).tryNext,true);
 assert.equal(selectNextAlternative(state).id,2);
 assert.equal(settleAlternative(state,{id:2,verdict:'REGRESSION',decisionId:'decision_5',
  sourceSha256:h(0),trialSha256:h(2),beforePassed:1,afterPassed:0}).tryNext,true);
 assert.equal(selectNextAlternative(state).id,3);
 assert.equal(settleAlternative(state,{id:3,verdict:'PASS',decisionId:'decision_6',
  sourceSha256:h(0),trialSha256:h(3),beforePassed:1,afterPassed:4}).tryNext,false);
 assert.equal(selectNextAlternative(state),null);
 assert.deepEqual(state.records.map(x=>x.verdict),['NO_PROGRESS','REGRESSION','PASS']);
 assert.equal(alternativeSummary(state).remaining,0);
});
test('partial progress preserves checkpoint but still continues for unresolved public cases',()=>{
 const state=createAlternativeBranches(plan(),h(0));
 const a=selectNextAlternative(state);
 const outcome=settleAlternative(state,{id:a.id,verdict:'PROGRESS',decisionId:'decision_2',
  sourceSha256:h(0),trialSha256:h(1),beforePassed:1,afterPassed:2});
 assert.equal(outcome.record.accepted,true);
 assert.equal(outcome.tryNext,true);
 assert.equal(selectNextAlternative(state).id,2);
});
test('last rejected branch exhausts exactly three; no fabricated fourth',()=>{
 const state=createAlternativeBranches(plan(),h(0));
 for(let id=1;id<=3;id++){
  assert.equal(selectNextAlternative(state).id,id);
  const r=settleAlternative(state,{id,verdict:'INVALID_PATCH',sourceSha256:h(0)});
  assert.equal(r.tryNext,id<3);
 }
 assert.equal(selectNextAlternative(state),null);
 assert.equal(alternativeSummary(state).attempts.length,3);
});
test('reject missing, duplicated or unsafe model proposals rather than synthesizing branches',()=>{
 const answer=plan();
 assert.throws(()=>createAlternativeBranches({branches:answer.branches.slice(0,2)},h(0)),/THREE_ALTERNATIVES_REQUIRED/);
 assert.throws(()=>createAlternativeBranches({branches:[...answer.branches,answer.branches[0]]},h(0)),/THREE_ALTERNATIVES_REQUIRED/);
 const duplicate=plan();duplicate.branches[1].approach=duplicate.branches[0].approach;
 assert.throws(()=>createAlternativeBranches(duplicate,h(0)),/ALTERNATIVE_APPROACH_DUPLICATED/);
 const missing=plan();missing.branches[1].hypothesis='';
 assert.throws(()=>createAlternativeBranches(missing,h(0)),/ALTERNATIVE_NODE_INVALID/);
 const unsafe=plan();unsafe.branches[2].hypothesis='Expose bearer abcdefghijklmnopqrstuvwxyz secret';
 assert.throws(()=>createAlternativeBranches(unsafe,h(0)),/ALTERNATIVE_NODE_INVALID/);
 assert.throws(()=>createAlternativeBranches(plan(),'invalid-hash'),/ALTERNATIVE_BASELINE_HASH_INVALID/);
});
test('refuse out-of-order outcomes and bad candidate proofs',()=>{
 const state=createAlternativeBranches(plan(),h(0));
 selectNextAlternative(state);
 assert.throws(()=>settleAlternative(state,{id:2,verdict:'NO_PROGRESS',sourceSha256:h(0),trialSha256:h(2)}),/ALTERNATIVE_ORDER_INVALID/);
 assert.throws(()=>settleAlternative(state,{id:1,verdict:'PASS',sourceSha256:'wrong',trialSha256:h(2)}),/ALTERNATIVE_CANDIDATE_HASH_INVALID/);
 assert.equal(state.records.length,0);
});
