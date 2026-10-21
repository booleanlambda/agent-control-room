// AAU SILAS v0.2: deterministic, OFFLINE, read-only replay of PostgreSQL
// result_artifact envelopes and actual safe-python math checks.
// This module neither runs a wake nor updates any record. It cannot complete
// agent-authored semantic requirements; it returns a partial projection.
import {createHash} from 'node:crypto';
import {artifactHash,assembleVerifiedProjection} from './experimental-controller.js';
import {verifyPythonMathChecksChunked} from '../python-math.js';

const PARENT='R.002.003.002';
const HEADERS=Object.freeze([
  {path:PARENT+'.001',field:'net_burn',expectedCheckCount:48,expectedMonths:12},
  {path:PARENT+'.002',field:'ending_cash',expectedCheckCount:36,expectedMonths:12}
]);
const hashBytes=s=>createHash('sha256').update(s,'utf8').digest('hex');
const obj=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
function parse(value){
  if(typeof value==='string'){
    try{return JSON.parse(value)}catch{return null}
  }
  return value;
}
function digestPayload(node){
  // Digest exact envelope bytes as exported by the authoritative store. Canonical
  // JSON normalization is deliberately NOT used for the tamper-evidence pin.
  if(typeof node.result_artifact!=='string')return null;
  return hashBytes(node.result_artifact);
}
export function unwrapStoredArtifact(record) {
  const outer=parse(record?.result_artifact);
  const inner=parse(outer?.artifact);
  if(!obj(outer)||!obj(inner))
    return {ok:false,code:'ENVELOPE_OR_INNER_ARTIFACT_INVALID'};
  return {ok:true,envelope:outer,artifact:inner};
}
function trustedCognitionReceipt(record) {
  const decision=parse(record?.decision_payload);
  // This is a *secondary* attestation from the authoritative persisted node;
  // standalone math is run again before creating a replay receipt.
  // These metadata bits alone are not sufficient to establish verification.
  return obj(decision)
    && decision.deterministic_math_verified===true
    && decision.deterministic_math_verification?.ok===true
    && decision.deterministic_math_verification?.all_match===true;
}
export function replayPersistedSilasParent({records,sourceManifest,contract}={}) {
  const errors=[], audited=[];
  if(!Array.isArray(records)||!obj(sourceManifest)||!obj(contract)) {
    return {status:'BLOCKED',reason:'INCOMPLETE_SNAPSHOT_INPUT'};
  }
  if(records.length!==2) return {status:'BLOCKED',reason:'UNEXPECTED_CHILD_COUNT'};
  if(contract.parentPath!==PARENT || contract.exercise_pack_ref!==
      'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M10-U2' ||
      contract.openingCash!==5_200_000)
    return {status:'BLOCKED',reason:'CONTRACT_NOT_AUTHORITATIVE'};
  const children=[],receipts={};
  for(const spec of HEADERS){
    const record=records.find(x=>x.node_path===spec.path);
    const pin=sourceManifest[spec.path];
    if(!record||!obj(pin)||record.status!=='completed' ||
       typeof record.result_hash!=='string' || record.result_hash!==pin.result_hash) {
      errors.push('NODE_PATH_STATUS_OR_RESULT_HASH_MISMATCH:'+spec.path);continue;
    }
    const digest=digestPayload(record);
    if(!digest||digest!==pin.envelope_sha256) {
      errors.push('ENVELOPE_DIGEST_NOT_PINNED:'+spec.path);continue;
    }
    const unwrapped=unwrapStoredArtifact(record);
    if(!unwrapped.ok){errors.push(unwrapped.code+':'+spec.path);continue;}
    const item=unwrapped.artifact;
    if(item.exercise_pack_ref!==contract.exercise_pack_ref){
      errors.push('EXERCISE_PACK_REF_MISMATCH:'+spec.path);continue;
    }
    if(!trustedCognitionReceipt(record)){
      errors.push('MISSING_DURABLE_MATH_ATTESTATION:'+spec.path);continue;
    }
    if(!Array.isArray(item.python_checks)||item.python_checks.length!==spec.expectedCheckCount){
      errors.push('CHECK_CARDINALITY_INVALID:'+spec.path);continue;
    }
    // Use existing sandboxed Python verifier, chunked to obey the 64-check limit.
    // Verify original checks BEFORE namespacing them in the parent projection.
    const verified=verifyPythonMathChecksChunked(item.python_checks,{
      absoluteTolerance:0.005,relativeTolerance:0,
    });
    audited.push({node_path:spec.path,check_count:item.python_checks.length,
      batch_count:verified.batch_count,all_match:verified.all_match,
      all_valid:verified.all_valid});
    if(verified.ok!==true||verified.all_match!==true||
       verified.all_valid!==true||verified.check_count!==spec.expectedCheckCount){
      errors.push('INDEPENDENT_PYTHON_CHECK_FAILURE:'+spec.path);continue;
    }
    // A successful expression alone is not evidence that it verifies a value
    // in the published calculation. Require an explicit check label for each
    // of the 12 authoritative month/field cells, and compare claimed_result
    // to the actual presented cell value. Unknown mappings fail closed.
    const claimErrors=[];
    for(let i=0;i<spec.expectedMonths;i++){
      const row=item.calculation?.[i];
      const tag='calculation['+i+'].'+spec.field;
      const matches=item.python_checks.filter(check=>
        typeof check?.label==='string' &&
        (check.label===tag || check.label.startsWith(tag+' :: ')));
      if(matches.length!==1 || !row || row.month!==i+1 ||
         !Number.isFinite(row[spec.field]) ||
         !Number.isFinite(matches[0]?.claimed_result) ||
         Math.abs(matches[0].claimed_result-row[spec.field])>0.005) {
        claimErrors.push(tag);
      }
    }
    if(claimErrors.length){
      errors.push('CHECK_TO_CALC_BINDING_UNRESOLVED:'+spec.path);
      audited.push({node_path:spec.path,missing_or_invalid_bindings:claimErrors});
      continue;
    }
    children.push({node_path:record.node_path,status:record.status,
      result_hash:record.result_hash,artifact:item});
    receipts[spec.path]={
      source:'trusted_deterministic_verifier',
      verification_status:'VERIFIED',
      artifact_sha256:artifactHash(item),
      result_hash:record.result_hash,
      verified_check_count:item.python_checks.length,
      verified_check_sha256:artifactHash(item.python_checks),
    };
  }
  if(errors.length) return {status:'BLOCKED',reason:'SOURCE_OR_MATH_VERIFICATION_FAILED',
    errors,audited,live_node_completed:false,model_calls:0};

  const projected=assembleVerifiedProjection({
    parentPath:PARENT,
    contract:{
      requiredChildren:HEADERS,
      openingCash:contract.openingCash,
      // Explicitly NEVER claim the parent is complete until interpretation,
      // audit/provenance and exact parent-schema obligations are discharged.
      semanticRequirements:[
        'parent_interpretation', 'parent_sanity_check',
        'parent_self_audit', 'parent_provenance',
        'full_qda_parent_schema_validation'
      ]
    },
    children,trustedReceipts:receipts
  });
  if(projected.status!=='PROJECTION_READY')return {
    ...projected,model_calls:0,live_node_completed:false,audited
  };
  return {...projected,status:'VERIFIED_NUMERIC_PROJECTION_ONLY',
    audited,source_snapshot_hash:hashBytes(records
      .map(x=>x.node_path+':'+sourceManifest[x.node_path].envelope_sha256).sort().join('\n')),
    mandatory_next_action:'COMPLETE_SEMANTIC_AND_PROVENANCE_OBLIGATIONS',
    numeric_projection_requires_reasoning_rollover:false,
    live_node_completed:false,model_calls:0};
}
