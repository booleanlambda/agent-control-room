import test from 'node:test';
import assert from 'node:assert/strict';
import {batchAdmission,decideBatchRecovery,verifyBatchRows}
 from './batch-admission-recovery.mjs';

test('real Moonshot account 200 files 403 batches fails closed',()=>{
  assert.deepEqual(batchAdmission({filesReadHttp:200,batchesReadHttp:403}),
    {admit:false,reason:'batch_permission_denied'});
});
test('real batch JSONL file upload 403 fails closed',()=>{
  assert.equal(batchAdmission({filesReadHttp:200,batchesReadHttp:200,fileUploadHttp:403}).admit,false);
});
test('unknown batch entitlement may not infer access from synchronous model success',()=>{
  assert.equal(batchAdmission({filesReadHttp:200,batchesReadHttp:404}).admit,false);
});
test('known read-only access does not assert batch creation entitlement',()=>{
  const x=batchAdmission({filesReadHttp:200,batchesReadHttp:200});
  assert.equal(x.admit,true);assert.match(x.caveat,/can still fail/);
});
test('pre-dispatch work can be created once, without any batch ID',()=>{
  assert.equal(decideBatchRecovery({status:'prepared',creationAttempts:0}).action,'submit_once');
});
test('crash after batch create request but before checkpoint is manual hold',()=>{
  const r=decideBatchRecovery({status:'batch_create_in_flight',creationAttempts:1,batch_id:null});
  assert.equal(r.action,'manual_hold');assert.equal(r.disallowDuplicateCreation,true);
});
test('persisted batch ID can be reattached after process restart via GET',()=>{
  assert.deepEqual(decideBatchRecovery({status:'in_progress',creationAttempts:1,batch_id:'batch-123'}),
    {action:'retrieve_status',reason:'durable_batch_id_exists',batchId:'batch-123'});
});
test('completed batch output may be fetched without new creation',()=>{
  assert.equal(decideBatchRecovery({status:'completed',creationAttempts:1,
    batch_id:'batch-123',output_file_id:'file-456'}).action,'download_output_once');
});
test('missing ID after successful-looking creation never triggers duplicate POST',()=>{
  assert.equal(decideBatchRecovery({status:'created',creationAttempts:1}).action,'manual_hold');
});
const expected={E01:'budget',E02:'provider'};
const item=(id,label,finish='stop',thinking='')=>({custom_id:id,response:{
  status_code:200,body:{choices:[{finish_reason:finish,
  message:{content:label,reasoning_content:thinking}}]}}});
test('independent completed leaf rows accepted despite reversed order',()=>{
  const x=verifyBatchRows([item('E02','provider'),item('E01','budget')],expected);
  assert.deepEqual(x,{ok:true,acceptedRows:2});
});
test('duplicate or missing custom_id prevents lossless tree coverage',()=>{
  assert.equal(verifyBatchRows([item('E01','budget'),item('E01','budget')],expected).ok,false);
  assert.equal(verifyBatchRows([item('E01','budget')],expected).ok,false);
});
test('provider error, truncation and wrong oracle label reject batch proof',()=>{
  assert.equal(verifyBatchRows([item('E01','provider'),item('E02','provider')],expected).ok,false);
  assert.equal(verifyBatchRows([item('E01','budget','length'),item('E02','provider')],expected).ok,false);
});
test('batch thinking violation cannot be silently certified',()=>{
  assert.equal(verifyBatchRows([item('E01','budget','stop','internal'),item('E02','provider')],expected).ok,false);
});
