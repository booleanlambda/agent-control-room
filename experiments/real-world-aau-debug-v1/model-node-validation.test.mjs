import test from 'node:test';
import assert from 'node:assert/strict';
import {selectValidModelOwnedNodes} from './model-node-validation.mjs';
const good={issue:'Preserve provider diagnostic provenance',acceptance:'Record one sanitized receipt before hold'};
test('one malformed model node does not erase two independently valid siblings',()=>{
 const result=selectValidModelOwnedNodes({tasks:[
  good,
  {issue:'Malformed JSON category',acceptance:'Use expected category without leaking sensitive details'},
  {issue:'short',acceptance:'too short'},
  {issue:'Transport status normalization',acceptance:'Match observed public error category'}
 ]});
 assert.equal(result.sourceCount,4);
 assert.equal(result.tasks.length,3);
 assert.equal(result.rejectedCount,1);
 assert.equal(result.rejectionCounts.EMPTY_OR_OVERSIZED_NODE_TEXT,1);
 assert.equal(result.tasks[0].issue,good.issue);
});
test('no model-authored acceptance criterion means task dropped, never invented',()=>{
 const result=selectValidModelOwnedNodes({tasks:[
  good,{issue:'Transport handling',acceptance:''},
  {issue:'HTTP error contract',acceptance:'Preserve public expected HTTP category'}
 ]});
 assert.equal(result.tasks.length,2);
 assert.equal(result.rejectedCount,1);
 assert.equal(JSON.stringify(result.tasks).includes('Transport handling'),false);
});
test('duplicate task does not create self-remediation loop',()=>{
 const result=selectValidModelOwnedNodes({tasks:[good,
  {issue:good.issue,acceptance:'Some different acceptance'},
  {issue:'Timeout verification',acceptance:'Use bounded sanitized transport metadata'}]});
 assert.equal(result.tasks.length,2);
 assert.equal(result.rejectionCounts.DUPLICATE_NODE_ISSUE,1);
});
test('insufficient valid nodes or unknown response shape cannot enter tree',()=>{
 assert.equal(selectValidModelOwnedNodes({tasks:[good]}).reason,'INVALID_MODEL_NODE_CONTAINER');
 assert.equal(selectValidModelOwnedNodes({workstreams:[good,good]}).tasks.length,0);
 assert.equal(selectValidModelOwnedNodes({tasks:[{issue:'no',acceptance:'no'},{issue:'bad',acceptance:'bad'}]}).reason,'INSUFFICIENT_VALID_MODEL_NODES');
});
test('larger tasks are preserved verbatim when within upper-bound and arrays joined only if explicitly authored',()=>{
 const long='A'.repeat(650),raw={tasks:[
  {issue:long,acceptance:'Expected sanitization'},
  {issue:'Provider timeout',acceptance:['Preserve deadline receipt','Do not retry unsafe sent calls']}
 ]};
 const result=selectValidModelOwnedNodes(raw);
 assert.equal(result.tasks.length,2);
 assert.equal(result.tasks[0].issue,long);
 assert.equal(result.tasks[1].acceptance,'Preserve deadline receipt; Do not retry unsafe sent calls');
});
