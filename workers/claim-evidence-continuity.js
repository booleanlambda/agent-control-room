// Claim–evidence continuity: pure, deterministic, schema-declared projection.
// This module NEVER infers field equivalence by matching names in prose.
// It NEVER changes child evidence, agent interpretation, or semantic conclusions.
import { createHash } from 'node:crypto';

const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:null;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const canonicalNumber=v=>typeof v==='number'&&Number.isFinite(v);
const parseObject=v=>{
  if(object(v))return v;
  if(typeof v!=='string')return null;
  try{return object(JSON.parse(v));}catch{return null;}
};
const unwrap=v=>{
  let o=parseObject(v);
  for(let i=0;i<3&&o;i++){
    const next=parseObject(o.artifact);
    if(!next)break;
    o=next;
  }
  return o;
};
const actualStatus=c=>String(c?.node_status||c?.status||'').toLowerCase();
const verifiedSource=c=>{
  const d=object(c?.decision_payload)||{};
  const proof=object(d.deterministic_math_verification)||{};
  return actualStatus(c)==='completed'
    &&d.deterministic_math_verified===true
    &&proof.ok===true
    &&proof.all_match===true
    &&typeof c.result_hash==='string'&&c.result_hash.length>=32;
};
const validId=(v,expected)=>Number.isInteger(v)&&expected.includes(v);
const issue=(kind,claimId,expected,actual,sources=[],note='')=>({
  kind,claim_id:claimId,expected,actual,
  source_refs:sources.map(s=>({node_path:s.node_path,result_hash:s.result_hash})),
  note,
  fingerprint:hash({kind,claim_id:claimId,expected,actual,
    source_hashes:sources.map(s=>s.result_hash).sort()}),
});

export function declaredArrayProjectionContract({
  contractId,collection,identityField,fields,expectedIds,units={},expectedSourceRef=null
}={}){
  const ids=Array.isArray(expectedIds)?expectedIds:[];
  const names=Array.isArray(fields)?fields:[];
  if(!contractId||!collection||!identityField
    ||!names.length||!ids.length||new Set(ids).size!==ids.length
    ||!ids.every(Number.isInteger)||!names.every(x=>typeof x==='string'&&x))return null;
  return Object.freeze({
    contract:'claim_evidence_array_projection_v0_1',
    contract_id:contractId,collection,identity_field:identityField,
    fields:[...new Set(names)],expected_ids:[...ids],units,
    expected_source_ref:expectedSourceRef,
  });
}

// A schema mapping is explicitly supplied by the task contract. A missing
// source field is NOT guessed from another apparent or similarly named field.
export function reconcileEvidenceClaims({contract,children=[],candidate,transfer=true}={}){
  if(!contract||contract.contract!=='claim_evidence_array_projection_v0_1')
    return {status:'NOT_APPLICABLE',reason:'no_declared_projection_contract'};
  const src=Array.isArray(children)?children:[];
  const body=unwrap(candidate);
  if(!body)return {status:'UNRESOLVED',reason:'parent_artifact_not_object',findings:[]};
  const expected=contract.expected_ids,fields=contract.fields;
  const projected=new Map(),findings=[];
  const sourceManifest=[];
  if(src.length<1)return {status:'UNRESOLVED',reason:'no_verified_child_sources',findings:[]};
  for(const child of src){
    if(!verifiedSource(child))
      return {status:'UNRESOLVED',reason:'child_not_verified',node_path:child.node_path,findings:[]};
    const data=unwrap(child.result_artifact);
    const rows=data?.[contract.collection];
    if(!Array.isArray(rows))
      return {status:'UNRESOLVED',reason:'child_calculation_schema_unmapped',node_path:child.node_path,findings:[]};
    const units=object(data.units);
    for(const field of fields){
      if(units&&Object.hasOwn(units,field)
        &&contract.units?.[field]!=null&&units[field]!==contract.units[field]){
        return {status:'UNRESOLVED',reason:'source_unit_mismatch',
          node_path:child.node_path,field,expected_unit:contract.units[field],
          actual_unit:units[field],findings:[]};
      }
    }
    const seenLocal=new Set();
    for(const row of rows){
      const id=object(row)?.[contract.identity_field];
      if(!validId(id,expected)||seenLocal.has(id))
        return {status:'UNRESOLVED',reason:'invalid_or_duplicate_child_row',
          node_path:child.node_path,row_id:id??null,findings:[]};
      seenLocal.add(id);
      for(const field of fields){
        const value=row[field];
        if(!canonicalNumber(value))
          return {status:'UNRESOLVED',reason:'non_numeric_verified_claim',
            node_path:child.node_path,row_id:id,field,findings:[]};
      }
      const prior=projected.get(id);
      const proof={node_path:child.node_path,result_hash:child.result_hash};
      if(prior){
        for(const field of fields){
          if(!Object.is(prior.row[field],row[field])){
            findings.push(issue('EVIDENCE_CONFLICT',
              `${contract.collection}[${contract.identity_field}=${id}].${field}`,
              prior.row[field],row[field],[prior.proof,proof],
              'Two verified sources claim incompatible values for the same mapped field.'));
          }
        }
      }else projected.set(id,{row,proof});
    }
    sourceManifest.push({node_path:child.node_path,result_hash:child.result_hash,
      row_ids:[...seenLocal].sort((a,b)=>a-b),
      units:data.units===undefined?null:JSON.stringify(data.units)});
  }
  if(findings.some(x=>x.kind==='EVIDENCE_CONFLICT'))
    return {status:'EVIDENCE_CONFLICT',reason:'incompatible_verified_children',
      findings,source_manifest:sourceManifest,contract_id:contract.contract_id};
  const missing=expected.filter(id=>!projected.has(id));
  if(missing.length)return {
    status:'UNRESOLVED',reason:'verified_child_coverage_incomplete',
    findings:missing.map(id=>issue('EVIDENCE_COVERAGE_MISSING',
      `${contract.collection}[${contract.identity_field}=${id}]`,
      'verified_child_row',null,[])),
    source_manifest:sourceManifest,contract_id:contract.contract_id};
  const priorRows=body[contract.collection];
  if(priorRows!==undefined&&!Array.isArray(priorRows))
    return {status:'UNRESOLVED',reason:'candidate_array_schema_invalid',
      contract_id:contract.contract_id,findings:[]};
  const candidateRows=Array.isArray(priorRows)?priorRows:[];
  const candidates=new Map();
  for(const row of candidateRows){
    const id=object(row)?.[contract.identity_field];
    if(!validId(id,expected)||candidates.has(id))
      return {status:'UNRESOLVED',reason:'unexpected_or_duplicate_parent_row',
        row_id:id??null,contract_id:contract.contract_id,findings:[]};
    candidates.set(id,row);
  }
  const nextRows=[];
  for(const id of expected){
    const {row:source,proof}=projected.get(id);
    const prior=candidates.get(id);
    const next={...(prior||{}),[contract.identity_field]:id};
    for(const field of fields){
      const claimId=`${contract.collection}[${contract.identity_field}=${id}].${field}`;
      const before=prior?.[field];
      if(before===undefined){
        findings.push(issue('MISSING_CLAIM',claimId,source[field],null,[proof]));
      }else if(!Object.is(before,source[field])){
        findings.push(issue('TRANSCRIPTION_DRIFT',claimId,source[field],before,[proof]));
      }
      next[field]=transfer?source[field]:before;
    }
    nextRows.push(next);
  }
  const changed=findings.length>0;
  const result=transfer?{...body,[contract.collection]:nextRows}:body;
  // These are explicit source-mapped projection claims; no model-generated
  // semantic field, input assumption, or formula was modified.
  const projection={
    status:changed?(transfer?'PATCHED':'REVISE'):'VERIFIED',
    contract_id:contract.contract_id,contract_hash:hash(contract),
    source_manifest:sourceManifest,
    findings,changed_claim_count:findings.length,
    patch_id:hash({contract:contract.contract_id,source_manifest:sourceManifest,
      findings:findings.map(f=>f.fingerprint)}),
    artifact_hash_before:hash(body),artifact_hash_after:hash(result),
    artifact:result,
    transfer_performed:changed&&transfer,
    deterministic:true,semantic_decision_unchanged:true,
  };
  if(transfer){
    // Fail closed if the patch does not eliminate EVERY original discrepancy.
    const check=reconcileEvidenceClaims({contract,children:src,candidate:result,transfer:false});
    if(check.status!=='VERIFIED')
      return {status:'UNRESOLVED',reason:'post_patch_projection_verification_failed',
        findings:check.findings||[],contract_id:contract.contract_id};
  }
  return projection;
}
