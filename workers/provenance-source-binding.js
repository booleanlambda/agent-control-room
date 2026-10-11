// Provenance manifest binding is infrastructure, not agent-authored reasoning.
// A hash identifies an exact child node; an equally valid nested hash cannot replace it.
const hashOk=value=>/^[a-f0-9]{64}$/i.test(String(value||''));
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
export function directChildProvenanceManifest(parentPath,children=[]){
  const prefix=String(parentPath||'')+'.';
  const seen=new Set(),out=[];
  for(const child of Array.isArray(children)?children:[]){
    const path=String(child?.node_path||'');
    if(!path.startsWith(prefix)||!/^[0-9]{3}$/.test(path.slice(prefix.length)))continue;
    if(seen.has(path))return []; // ambiguous evidence: never select by order
    seen.add(path);
    if(String(child?.node_status||child?.status||'').toLowerCase()!=='completed'
      ||!hashOk(child?.result_hash))continue;
    out.push({node_path:path,result_hash:String(child.result_hash).toLowerCase(),
      decision_type:String(child?.decision_type||'').toUpperCase(),status:'completed'});
  }
  return out.sort((a,b)=>a.node_path.localeCompare(b.node_path));
}
export function boundProvenanceRevisionGuidance(parentPath,children,guidance){
  const original=String(guidance||'');
  const manifest=directChildProvenanceManifest(parentPath,children);
  const checkSource=manifest.find(v=>v.node_path===String(parentPath)+'.002');
  // Scope to the known exact QDA manifest reference, not ordinary semantic revisions.
  if(!checkSource
    ||!original.includes('runtime_verified_descendant_materialization')
    ||!original.includes('result_hash'))
    return {guidance:original,stale:false,manifest};
  const citedHashes=original.match(/\b[a-f0-9]{64}\b/gi)||[];
  if(citedHashes.some(v=>v.toLowerCase()!==checkSource.result_hash)){
    return {guidance:'',stale:true,manifest,
      reason:'stale_direct_child_hash_revision_guidance',
      expected_source_path:checkSource.node_path,
      expected_source_hash:checkSource.result_hash};
  }
  return {guidance:original,stale:false,manifest};
}
export function auditDeclaredProvenanceManifest(parentPath,children,artifact){
  const data=obj(artifact);
  const meta=obj(data.runtime_verified_descendant_materialization);
  if(meta.contract!=='qda_declared_verified_checks_transport_v0_1')
    return {status:'NOT_APPLICABLE'};
  const manifest=directChildProvenanceManifest(parentPath,children);
  const source=manifest.find(v=>v.node_path===String(parentPath)+'.002');
  if(!source)return {status:'UNRESOLVED',reason:'exact_verified_direct_checks_child_missing'};
  const records=Array.isArray(meta.descendants)?meta.descendants:[];
  if(records.length!==1||String(records[0]?.node_path)!==source.node_path
    ||String(records[0]?.result_hash).toLowerCase()!==source.result_hash)
    return {status:'EVIDENCE_CONFLICT',reason:'declared_direct_checks_child_manifest_mismatch',
      expected_source_path:source.node_path,expected_source_hash:source.result_hash};
  return {status:'VERIFIED',source_path:source.node_path,source_hash:source.result_hash};
}
export function dismissFalseDirectChildHashRejection(parentPath,children,artifact,review){
  const candidate=obj(review);
  if(String(candidate.status||'').toUpperCase()!=='REVISE')return candidate;
  const checked=auditDeclaredProvenanceManifest(parentPath,children,artifact);
  if(checked.status!=='VERIFIED')return candidate;
  const issues=Array.isArray(candidate.issues)?candidate.issues:[];
  if(issues.length===0 || !issues.every(issue=>{
    const v=String(issue||'');
    return v.includes('runtime_verified_descendant_materialization')
      &&v.includes('result_hash');
  }))return candidate;
  const guidance=boundProvenanceRevisionGuidance(
    parentPath,children,String(candidate.revision_guidance||''));
  if(!guidance.stale)return candidate;
  return {...candidate,status:'ACCEPT',issues:[],
    reason:'Exact direct-child evidence manifest is verified; reviewer proposed a non-authoritative nested source hash.',
    revision_guidance:'',
    deterministic_guard:'exact_direct_child_provenance_hash_v0_1',
    model_review_overruled_only_for_false_hash_binding:true,
    source_path:checked.source_path,source_hash:checked.source_hash};
}
