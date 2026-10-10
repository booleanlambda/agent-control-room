// Normalize ONLY schema-declared source representations for exact evidence
// transfer. This is a read-only adapter: original child artifacts and hashes
// remain unchanged. Any unknown/ambiguous row is left for the verifier.
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:null;
const unwrap=raw=>{
  try{
    let d=typeof raw==='string'?JSON.parse(raw):raw;
    for(let i=0;i<3;i++){
      const next=obj(d)?.artifact;
      if(!next)break;
      d=typeof next==='string'?JSON.parse(next):next;
    }
    return obj(d);
  }catch{return null;}
};
// Selection is based on an explicit contract and exact direct-child paths,
// never field names, prose, or an inferred similarity between artifacts.
// A missing or ambiguous declared source fails closed; no evidence is guessed.
export function selectDeclaredEvidenceSourceChildren(children,contract,parentNodePath){
  const source=Array.isArray(children)?children:[];
  const ordinals=contract?.source_child_ordinals;
  if(ordinals==null)return source;
  if(!Array.isArray(ordinals)||!ordinals.length||!parentNodePath)return [];
  const selected=[];
  for(const ordinal of ordinals){
    const path=String(parentNodePath)+'.'+String(ordinal).padStart(3,'0');
    const matching=source.filter(child=>child?.node_path===path);
    if(matching.length!==1)return [];
    selected.push(matching[0]);
  }
  return selected;
}

export function normalizeDeclaredEvidenceSourceRows(children,contract){
  if(contract?.contract_id!=='qda601_m10_u2_problem2_mrr_gp_12_month_projection_v0_1')
    return children;
  return (Array.isArray(children)?children:[]).map(child=>{
    const artifact=unwrap(child?.result_artifact);
    const calc=artifact?.calculation;
    if(!obj(calc))return child;
    const rows=[];
    for(const [key,v] of Object.entries(calc)){
      const m=/^month_([1-9][0-9]*)$/.exec(key);
      const month=m?Number(m[1]):NaN;
      if(!Number.isSafeInteger(month)||month<1||month>12||!obj(v))
        return child;
      rows.push({...v,month});
    }
    // Transport wrapper only. Verification remains bound to the immutable
    // original result_hash in the untouched source row.
    return {...child,result_artifact:JSON.stringify({
      artifact:{...artifact,calculation:rows}
    })};
  });
}
