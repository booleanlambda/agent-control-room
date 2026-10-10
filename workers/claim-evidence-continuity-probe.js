// Deterministic contract regression; completely synthetic fixture based on
// the shape of the QDA601-M10-U2 failure. No live agent data or model calls.
import { strict as assert } from 'node:assert';
import { reconcileEvidenceClaims } from './claim-evidence-continuity.js';
import { claimEvidenceContractForRequirement, projectDeclaredSynthesisInputs } from './claim-evidence-contracts.js';
import { normalizeDeclaredEvidenceSourceRows, selectDeclaredEvidenceSourceChildren } from './claim-evidence-source-adapter.js';
import { projectDeclaredVerifiedChecks } from './claim-evidence-check-transport.js';

const hash=n=>String(n).padStart(64,String(n));
const contract=claimEvidenceContractForRequirement(
  {qda_601_context:{next_unit:{unit_code:'QDA601-M10-U2'}}},
  {requirement_text:'Derive the financial model for the 12-month trajectory of Monthly Recurring Revenue (MRR) and Gross Profit',
   source_ref:'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M10-U2'});
const verify={deterministic_math_verified:true,deterministic_math_verification:{ok:true,all_match:true}};
const rows=Array.from({length:12},(_,i)=>{
  const month=i+1;
  const mrr=(6200+month*199.1)*255;
  return {month,mrr,gross_profit:mrr*0.72};
});
const children=[
  {node_path:'R.1',node_status:'completed',result_hash:hash(1),
    decision_payload:verify,result_artifact:JSON.stringify({status:'COMPLETE',
      artifact:{calculation:rows.slice(0,6),units:{mrr:'USD/month',gross_profit:'USD/month'}}})},
  {node_path:'R.2',node_status:'completed',result_hash:hash(2),
    decision_payload:verify,result_artifact:JSON.stringify({status:'COMPLETE',
      artifact:{calculation:rows.slice(6),units:{mrr:'USD/month',gross_profit:'USD/month'}}})},
];
export function probeClaimEvidenceContinuity(){
  let checks=0;const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;};
  assert.ok(contract);
  const pruned=projectDeclaredSynthesisInputs(
    {qda_601_context:{next_unit:{unit_code:'QDA601-M10-U2'}}},
    {source_ref:'R.002.002.001.001',
     requirement_text:"Derive the 12-month MRR and Gross Profit table; preserve exercise_pack_ref 'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M10-U2'"},
    {inputs:{monthly_arpa:255,gross_margin:0.72,paying_account_trajectory_ref:'R.002.001',
      paying_accounts:6200,cac:950,opening_cash:5200000},calculation:[{month:1,mrr:1632765}]},
    {monthly_arpa:255,gross_margin:0.72,paying_accounts:6200,cac:950}
  );
  eq(pruned?.inputs,{monthly_arpa:255,gross_margin:0.72,
    paying_account_trajectory_ref:'R.002.001'},'declared parent inputs remove irrelevant baseline');
  eq(pruned?.calculation,[{month:1,mrr:1632765}],'input projection does not alter calculations');
  eq(projectDeclaredSynthesisInputs({qda_601_context:{next_unit:{unit_code:'QDA601-M3-U1'}}},
    {requirement_text:'12-month MRR and Gross Profit',source_ref:'none'},
    {inputs:{paying_accounts:6200}}),null,'unrelated task inputs are never projected');
  const actualParent=claimEvidenceContractForRequirement(
    {qda_601_context:{next_unit:{unit_code:'QDA601-M10-U2'}}},
    {source_ref:'R.002.002.001.001',
      requirement_text:"Derive the financial model for the 12-month trajectory of Monthly Recurring Revenue (MRR) and Gross Profit for Problem 2 of QDA601-M10-U2. Preserve exercise_pack_ref as 'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M10-U2'."});
  eq(actualParent?.contract_id,contract.contract_id,
    'real AAU node source_ref plus exercise-pack requirement activates contract');
  eq(claimEvidenceContractForRequirement(
    {qda_601_context:{next_unit:{unit_code:'QDA601-M10-U2'}}},
    {source_ref:'R.002.002.001.001',requirement_text:'12-month MRR and Gross Profit without authoritative pack reference'}),null,
    'generic title without authoritative pack reference cannot activate mapping');
  // Incident type A: model writes only four boundary rows; eight months missing.
  const boundary={inputs:{monthly_arpa:255,gross_margin:0.72},
    formula_or_model:{mrr:'paying_accounts*monthly_arpa'},
    unrelated_agent_judgment:'Do not touch my semantic conclusion',
    calculation:[rows[0],rows[5],rows[6],rows[11]]};
  const partial=reconcileEvidenceClaims({contract,children,candidate:boundary});
  eq(partial.status,'PATCHED','missing-month rows are deterministically assembled');
  eq(partial.artifact.calculation,rows,'12 months are exactly copied from verified children');
  eq(partial.findings.filter(x=>x.kind==='MISSING_CLAIM').length,16,'eight missing months times two claims');
  eq(partial.artifact.unrelated_agent_judgment,boundary.unrelated_agent_judgment,'semantic text is unchanged');
  eq(partial.artifact.formula_or_model,boundary.formula_or_model,'formula is unchanged');
  eq(partial.artifact.inputs,boundary.inputs,'inputs remain unchanged');
  eq(boundary.calculation.length,4,'input artifact immutable');
  const repeated=reconcileEvidenceClaims({contract,children,candidate:partial.artifact});
  eq(repeated.status,'VERIFIED','patched artifact passes the same contract on replay');
  eq(repeated.findings.length,0,'replay has no original contradictions');
  eq(repeated.artifact_hash_after,partial.artifact_hash_after,'replay hash stable');
  // Incident type B: full row set but eight months contain invented estimates.
  const drift=[...rows].map(r=>(r.month>=2&&r.month<=5)||(r.month>=8&&r.month<=11)
    ?{...r,mrr:r.mrr+1234,gross_profit:r.gross_profit-999}:r);
  const result=reconcileEvidenceClaims({contract,children,candidate:{calculation:drift}});
  eq(result.status,'PATCHED','transcription drift repaired');
  eq(result.findings.filter(x=>x.kind==='TRANSCRIPTION_DRIFT').length,16,'eight months with two incorrect fields');
  eq(result.artifact.calculation,rows,'all 12 months exact after patch');
  eq(result.findings.every(x=>x.fingerprint?.length===64),true,'stable contradiction fingerprint');
  // A completed, provenance-accepted SPLIT result is a verified source
  // under the same contract used by the academic runtime and renewal guard.
  const acceptedSplit={...children[1],decision_type:'SPLIT',decision_payload:{
    synthesis_outcome:'COMPLETE',
    synthesis_provenance_review:{status:'ACCEPT'},
  }};
  const mixed=reconcileEvidenceClaims({
    contract,children:[children[0],acceptedSplit],candidate:boundary,
  });
  eq(mixed.status,'PATCHED','accepted SPLIT source and ATOMIC source reconcile');
  eq(mixed.artifact.calculation,rows,'mixed verified lineage copies all 12 rows');
  const rejectedSplit={...acceptedSplit,decision_payload:{
    synthesis_outcome:'COMPLETE',
    synthesis_provenance_review:{status:'REVISE'},
  }};
  eq(reconcileEvidenceClaims({
    contract,children:[children[0],rejectedSplit],candidate:boundary,
  }).reason,'child_not_verified','rejected SPLIT source cannot be transferred');
  // Source trust and conflict handling.
  const unverified={...children[0],decision_payload:{deterministic_math_verified:false}};
  eq(reconcileEvidenceClaims({contract,children:[unverified,children[1]],candidate:boundary}).status,
     'UNRESOLVED','unverified child never transferred');
  eq(reconcileEvidenceClaims({contract,children:[children[0]],candidate:boundary}).reason,
     'verified_child_coverage_incomplete','partial evidence does not fill missing months');
  const conflicting={...children[1],node_path:'R.3',result_hash:hash(3),
    result_artifact:JSON.stringify({artifact:{calculation:[
      {...rows[0],mrr:rows[0].mrr+1},...rows.slice(6)]}})};
  eq(reconcileEvidenceClaims({contract,children:[...children,conflicting],candidate:boundary}).status,
     'EVIDENCE_CONFLICT','different verified value cannot be chosen silently');
  eq(reconcileEvidenceClaims({contract,children,candidate:{
      calculation:[rows[0],rows[0]]}}).reason,
     'unexpected_or_duplicate_parent_row','duplicate destination rows are not silently discarded');
  eq(reconcileEvidenceClaims({contract,children,candidate:{calculation:'not-an-array'}}).status,
     'UNRESOLVED','invalid schema cannot be reinterpreted');
  const duplicateSource={...children[0],result_artifact:JSON.stringify({artifact:{calculation:[
    rows[0],rows[0],...rows.slice(1,6)]}})};
  eq(reconcileEvidenceClaims({contract,children:[duplicateSource,children[1]],candidate:boundary}).reason,
     'invalid_or_duplicate_child_row','ambiguous child row not transferred');
  const unitConflict={...children[1],result_artifact:JSON.stringify({
    artifact:{calculation:rows.slice(6),units:{mrr:'EUR/month',gross_profit:'EUR/month'}}
  })};
  eq(reconcileEvidenceClaims({contract,children:[children[0],unitConflict],candidate:boundary}).reason,
    'verified_source_units_conflict','unit disagreement cannot be silently transferred');
  // Production incident: parent has one accepted SPLIT calculation child and
  // one completed ATOMIC verification-only child with no calculation array.
  const parentPath='R.002.002.001.001';
  const parentContract=claimEvidenceContractForRequirement(
    {qda_601_context:{next_unit:{unit_code:'QDA601-M10-U2'}}},
    {requirement_text:'Calculate the 12-month trajectory of Monthly Recurring Revenue (MRR) and Gross Profit for Problem 2 of QDA601-M10-U2. Preserve exercise_pack_ref as curriculum/qda601-exercise-packs-v0.1.json#QDA601-M10-U2'});
  eq(parentContract?.source_child_ordinals,[1],
    'parent with separate checks branch explicitly names calculation child');
  eq(contract.source_child_ordinals,null,
    'financial model with six-month sources must include both children');
  const calculationChild={...children[0],node_path:parentPath+'.001',
    decision_type:'SPLIT',decision_payload:{synthesis_outcome:'COMPLETE',
      synthesis_provenance_review:{status:'ACCEPT'}},
    result_artifact:JSON.stringify({artifact:{calculation:rows,units:'USD'}})};
  const checksChild={...children[1],node_path:parentPath+'.002',
    decision_type:'ATOMIC',
    result_artifact:JSON.stringify({artifact:{python_checks:[{label:'mrr_m1',claimed_result:rows[0].mrr}]}})};
  const sourceChecks=rows.flatMap(row=>[
    {label:parentPath+'.002:mrr_m'+row.month,expression:String(row.mrr),claimed_result:row.mrr},
    {label:parentPath+'.002:gp_m'+row.month,expression:String(row.gross_profit),claimed_result:row.gross_profit},
  ]);
  const fullChecksChild={...checksChild,
    result_artifact:JSON.stringify({artifact:JSON.stringify({python_checks:sourceChecks})})};
  const verifiedChecks=projectDeclaredVerifiedChecks({
    contract:parentContract,parentPath,
    children:[calculationChild,fullChecksChild],
    candidate:{calculation:[],interpretation:'Agent-owned analytic conclusion'},
    expectedRows:rows,
  });
  eq(verifiedChecks.status,'PATCHED','24 authoritative checks materialized exactly once');
  eq(verifiedChecks.artifact.python_checks,sourceChecks,'preserves complete original check labels and order');
  eq(verifiedChecks.artifact.interpretation,'Agent-owned analytic conclusion','semantic conclusions untouched by checks transport');
  eq(verifiedChecks.sources[0].result_hash,fullChecksChild.result_hash,'independent check source hash preserved');
  const badCheck={...fullChecksChild,
    result_artifact:JSON.stringify({artifact:{python_checks:[
      {...sourceChecks[0],label:sourceChecks[0].label+':duplicate'},
      ...sourceChecks.slice(1)
    ]}})};
  eq(projectDeclaredVerifiedChecks({contract:parentContract,parentPath,
    children:[calculationChild,badCheck],candidate:{},expectedRows:rows}).reason,
    'checks_source_label_mismatch','corrupted label rejected rather than normalized');
  const duplicatedCheck={...fullChecksChild,result_artifact:JSON.stringify({
    artifact:{python_checks:[sourceChecks[0],sourceChecks[0],...sourceChecks.slice(2)]}})};
  eq(projectDeclaredVerifiedChecks({contract:parentContract,parentPath,
    children:[calculationChild,duplicatedCheck],candidate:{},expectedRows:rows}).reason,
    'verified_checks_schema_invalid','duplicated check label rejected');
  const inconsistentChecks={...fullChecksChild,result_artifact:JSON.stringify({
    artifact:{python_checks:[{...sourceChecks[0],claimed_result:sourceChecks[0].claimed_result+10},
      ...sourceChecks.slice(1)]}})};
  eq(projectDeclaredVerifiedChecks({contract:parentContract,parentPath,
    children:[calculationChild,inconsistentChecks],candidate:{},expectedRows:rows}).status,
    'EVIDENCE_CONFLICT','mismatched independent check is not silently corrected');
  eq(projectDeclaredVerifiedChecks({contract,parentPath,
    children:[calculationChild,fullChecksChild],candidate:{},expectedRows:rows}).status,
    'NOT_APPLICABLE','financial-model child does not inherit parent checks contract');
  const selected=selectDeclaredEvidenceSourceChildren([calculationChild,checksChild],parentContract,parentPath);
  eq(selected.length,1,'only the declared calculation source child is selected');
  eq(selected[0].node_path,calculationChild.node_path,'source path is exact');
  const incident=reconcileEvidenceClaims({contract,
    children:normalizeDeclaredEvidenceSourceRows(selected,parentContract),candidate:{calculation:[]}});
  eq(incident.status,'PATCHED','verified months transfer without treating check-only child as a schema error');
  eq(incident.artifact.calculation,rows,'12 preserved verified rows from split child');
  eq(incident.source_manifest[0].result_hash,calculationChild.result_hash,'source hash preserved');
  eq(selectDeclaredEvidenceSourceChildren([checksChild],parentContract,parentPath).length,0,
    'missing calculation source cannot be replaced with check-only source');
  eq(selectDeclaredEvidenceSourceChildren([calculationChild,checksChild],parentContract,parentPath+'.999').length,0,
    'wrong parent path cannot authorize evidence transfer');
  const nestedKeyedSources=children.map(c=>{
    const inner=JSON.parse(c.result_artifact).artifact;
    const keyed=Object.fromEntries(inner.calculation.map(row=>[
      'month_'+row.month,{mrr:row.mrr,gross_profit:row.gross_profit}
    ]));
    return {...c,result_artifact:JSON.stringify({
      artifact:JSON.stringify({...inner,calculation:keyed,units:'USD'})
    })};
  });
  const mappedKeyed=normalizeDeclaredEvidenceSourceRows(nestedKeyedSources,contract);
  const keyedResult=reconcileEvidenceClaims({
    contract,children:mappedKeyed,candidate:{calculation:[]}
  });
  eq(keyedResult.status,'PATCHED','real nested keyed-month source layout transfers');
  eq(keyedResult.artifact.calculation,rows,'verified keyed object exactly reproduces all months');
  eq(mappedKeyed[0].result_hash,nestedKeyedSources[0].result_hash,
    'adapting source representation preserves immutable result hash');
  eq(nestedKeyedSources[0].result_artifact.includes('month_1'),true,
    'read-only adapter does not modify source artifact');
  const malformedKeyed={...nestedKeyedSources[0],
    result_artifact:JSON.stringify({artifact:{calculation:{
      month_1:{mrr:1,gross_profit:1},month_99:{mrr:2,gross_profit:2}
    }}})};
  eq(normalizeDeclaredEvidenceSourceRows([malformedKeyed],contract)[0].result_artifact,
    malformedKeyed.result_artifact,'unknown period does not get silently mapped');
  const newVersion={...children[1],result_hash:hash(44)};
  const newResult=reconcileEvidenceClaims({contract,children:[children[0],newVersion],candidate:boundary});
  eq(newResult.patch_id!==partial.patch_id,true,'source evidence version changes patch identity');
  // Transport failures are not claim contradictions and never passed to this engine.
  eq(claimEvidenceContractForRequirement({qda_601_context:{next_unit:{unit_code:'QDA601-M3-U1'}}},
    {requirement_text:'12-month trajectory of MRR and Gross Profit',source_ref:'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M3-U1'}),null,
    'different assignment does not receive M10 schema');
  return {ok:true,checks,synthetic:true,provider_calls:0,agent_wakes:0,
    contract:'claim_evidence_continuity_regression_v0_1'};
}
