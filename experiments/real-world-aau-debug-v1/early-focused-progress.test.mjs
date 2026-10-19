import test from 'node:test';
import assert from 'node:assert/strict';
import {focusedPatchDecision,validateNodeOrder,EARLY_REPAIR_MAX_CALLS,FOCUSED_OFF_NODES} from './early-focused-progress.mjs';
const receipts=(p=['received'],counts=[0,2,3,3])=>({
 suite:'public',cases:['received','malformed','http_error','timeout'].map((name,i)=>({
 name,passed:p.includes(name),problems:Array.from({length:counts[i]},(_,k)=>'problem_'+k)
 }))
});
test('two cheap nodes with six-call overall budget',()=>{
 assert.equal(EARLY_REPAIR_MAX_CALLS,6);assert.equal(FOCUSED_OFF_NODES,2);
});
test('one more passing case accepted, without losing previous pass',()=>{
 const old=receipts();
 const good=receipts(['received','malformed'],[0,0,3,3]);
 const result=focusedPatchDecision(old,good);
 assert.equal(result.accept,true);
 assert.equal(result.currentPassed,2);
});
test('partial failure reduction counts as local progress, even before full case passes',()=>{
 const old=receipts(),partial=receipts(['received'],[0,1,3,3]);
 assert.equal(focusedPatchDecision(old,partial).accept,true);
});
test('a regression in received case is never accepted even if other cases improve',()=>{
 const before=receipts(),after=receipts(['malformed'],[2,0,0,0]);
 const result=focusedPatchDecision(before,after);
 assert.equal(result.reason,'PUBLIC_REGRESSION');
 assert.equal(result.accept,false);
});
test('no improvement, missing case or malformed runner receipt cannot count',()=>{
 const before=receipts();
 assert.equal(focusedPatchDecision(before,receipts()).accept,false);
 assert.equal(focusedPatchDecision(before,{suite:'public',cases:before.cases.slice(0,3)}).accept,false);
 assert.equal(focusedPatchDecision(before,{suite:'public',cases:before.cases.map(x=>({...x,problems:null}))}).accept,false);
});
test('only explicit model-owned focused independent nodes accepted',()=>{
 const good=[{id:1,issue:'Preserve diagnostic receipts',acceptance:'One durable report on every hold'},
 {id:2,issue:'Differentiate transport failures',acceptance:'Timeout has its own category'}];
 assert.equal(validateNodeOrder(good),true);
 assert.equal(validateNodeOrder([good[0]]),false);
 assert.equal(validateNodeOrder([good[0],good[0]]),false);
});
