// Exact evidence-check transport for the declared QDA M10-U2 parent.
// A checks-only child is NOT an alternative source of calculation rows.
// Source math, labels, and hashes remain immutable; the producer is never
// silently replaced with an inferred or model-generated check.
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null;
const unwrap=raw=>{
  try{
    let data=typeof raw==='string'?JSON.parse(raw):raw;
    for(let depth=0;depth<4;depth++){
      const nested=object(data)?.artifact;
      if(nested===undefined||nested===null)break;
      const next=typeof nested==='string'?JSON.parse(nested):nested;
      if(!object(next))break;
      data=next;
    }
    return object(data);
  }catch{return null;}
};
export function projectDeclaredVerifiedChecks({
  contract,parentPath,children=[],candidate,expectedRows=[]
}={}){
  if(contract?.contract_id!=='qda601_m10_u2_problem2_verified_calculation_with_checks_v0_2')
    return {status:'NOT_APPLICABLE',reason:'checks_projection_not_declared'};
  const checksPath=String(parentPath||'')+'.002';
  const matches=(Array.isArray(children)?children:[]).filter(c=>c?.node_path===checksPath);
  if(matches.length!==1)return {status:'UNRESOLVED',reason:'verified_checks_child_missing_or_ambiguous'};
  const child=matches[0],d=object(child.decision_payload)||{};
  const verification=object(d.deterministic_math_verification)||{};
  if(String(child.node_status||child.status).toLowerCase()!=='completed'
     ||String(child.decision_type).toUpperCase()!=='ATOMIC'
     ||d.deterministic_math_verified!==true
     ||verification.ok!==true||verification.all_match!==true
     ||typeof child.result_hash!=='string'||child.result_hash.length<32)
    return {status:'UNRESOLVED',reason:'verified_checks_child_not_authoritative'};
  const body=unwrap(child.result_artifact);
  const checks=body?.python_checks;
  if(!Array.isArray(checks)||checks.length!==24)
    return {status:'UNRESOLVED',reason:'checks_source_cardinality_invalid'};
  if(!Array.isArray(expectedRows)||expectedRows.length!==12)
    return {status:'UNRESOLVED',reason:'verified_calculation_coverage_missing'};
  const months=new Map();
  for(const row of expectedRows){
    if(!object(row)||!Number.isInteger(row.month)||months.has(row.month)
       ||row.month<1||row.month>12
       ||!Number.isFinite(row.mrr)||!Number.isFinite(row.gross_profit))
      return {status:'UNRESOLVED',reason:'verified_calculation_row_invalid'};
    months.set(row.month,row);
  }
  if(months.size!==12)return {status:'UNRESOLVED',reason:'verified_calculation_coverage_missing'};
  const seen=new Set();
  for(const check of checks){
    if(!object(check)||typeof check.label!=='string'
       ||typeof check.expression!=='string'||!check.expression.trim()
       ||!Number.isFinite(check.claimed_result)||seen.has(check.label))
      return {status:'UNRESOLVED',reason:'verified_checks_schema_invalid'};
    const prefix=checksPath+':';
    if(!check.label.startsWith(prefix))
      return {status:'UNRESOLVED',reason:'checks_source_label_mismatch'};
    const label=check.label.slice(prefix.length);
    const matched=/^(mrr|gp)_m(1[0-2]|[1-9])$/.exec(label);
    if(!matched)return {status:'UNRESOLVED',reason:'checks_source_label_mismatch'};
    const row=months.get(Number(matched[2]));
    const expected=matched[1]==='mrr'?row?.mrr:row?.gross_profit;
    if(!Number.isFinite(expected)||Math.abs(check.claimed_result-expected)>0.005)
      return {status:'EVIDENCE_CONFLICT',reason:'checks_disagree_with_verified_calculation',label:check.label};
    seen.add(check.label);
  }
  const labels=Array.from({length:12},(_,i)=>i+1)
    .flatMap(i=>[checksPath+':mrr_m'+i,checksPath+':gp_m'+i]);
  if(labels.some(label=>!seen.has(label)))
    return {status:'UNRESOLVED',reason:'checks_source_coverage_incomplete'};
  const current=object(candidate);
  if(!current)return {status:'UNRESOLVED',reason:'candidate_not_object'};
  return {
    status:'PATCHED',
    artifact:{...current,python_checks:checks.map(check=>({...check})),
      runtime_verified_descendant_materialization:{
        contract:'qda_declared_verified_checks_transport_v0_1',
        source:'completed_verified_atomic_checks_child',
        materialized_node_path:parentPath,
        descendants:[{node_path:child.node_path,result_hash:child.result_hash,check_count:24}],
        preserved_source_labels:true,
        verified_calculation_claim_count:24,
      }},
    check_count:24,
    sources:[{node_path:child.node_path,result_hash:child.result_hash,check_count:24}],
  };
}
