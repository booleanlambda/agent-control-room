// Fail-closed batch admission/resume contract. Models an external batch
// create/lookup boundary. DOES NOT assume that a batch ID can be reconstructed
// if the create response was lost before durable storage.
export function batchAdmission({filesReadHttp,batchesReadHttp,fileUploadHttp=null}={}){
  if(filesReadHttp===401||batchesReadHttp===401)return {admit:false,reason:'unauthorized'};
  if(batchesReadHttp===403||fileUploadHttp===403)return {admit:false,reason:'batch_permission_denied'};
  if(batchesReadHttp!==200)return {admit:false,reason:'batch_capability_unverified'};
  if(filesReadHttp!==200)return {admit:false,reason:'file_capability_unverified'};
  return {admit:true,reason:'read_only_capability_probe_passed',
    caveat:'upload and creation can still fail; never auto-resubmit after ambiguous creation'};
}
export function decideBatchRecovery(state){
  if(!state||typeof state!=='object')return {action:'manual_hold',reason:'missing_checkpoint'};
  if(state.status==='completed'&&typeof state.output_file_id==='string'&&state.output_file_id)
    return {action:'download_output_once',reason:'completed_by_provider'};
  if(typeof state.batch_id==='string'&&state.batch_id&&
      Number(state.creationAttempts)===1){
    return {action:'retrieve_status',reason:'durable_batch_id_exists',batchId:state.batch_id};
  }
  if(state.status==='prepared'&&state.creationAttempts===0)
    return {action:'submit_once',reason:'provably_not_dispatched'};
  return {action:'manual_hold',reason:'batch_creation_or_upload_uncertain',
    disallowDuplicateCreation:true};
}
export function verifyBatchRows(rows,expected){
  if(!Array.isArray(rows)||!expected||typeof expected!=='object')
    return {ok:false,reason:'invalid_batch_result'};
  const ids=Object.keys(expected),seen=new Set();
  if(rows.length!==ids.length)return {ok:false,reason:'incomplete_result_set'};
  for(const r of rows){
    if(!r||!Object.hasOwn(expected,r.custom_id)||seen.has(r.custom_id))
      return {ok:false,reason:'duplicate_or_unknown_custom_id'};
    seen.add(r.custom_id);
    if(r.response?.status_code!==200||
      r.response?.body?.choices?.[0]?.finish_reason!=='stop')
      return {ok:false,reason:'unaccepted_provider_response'};
    if(r.response.body.choices[0].message?.reasoning_content)
      return {ok:false,reason:'thinking_mode_not_disabled'};
    if(String(r.response.body.choices[0].message?.content||'').trim().toLowerCase()
      !==expected[r.custom_id])return {ok:false,reason:'oracle_mismatch'};
  }
  return {ok:true,acceptedRows:rows.length};
}
