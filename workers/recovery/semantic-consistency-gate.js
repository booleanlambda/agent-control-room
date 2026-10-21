// Experimental AAU Semantic Consistency Gate v0.1.
// A PASS proves only exact deterministic, evidence-bound statements, NOT free-form
// semantic correctness or completion of an agent's parent task. No provider calls.
const record = x => x!==null && typeof x==='object' && !Array.isArray(x);
const finite = Number.isFinite;
const tolerance=0.005;
const ids=['cash_at_month_12','cash_change_from_opening','cash_monotonicity','net_burn_at_month_12'];
const cashField='ending_cash_balance';
const dir=d=>d>tolerance?'increase':d< -tolerance?'decrease':'unchanged';
export const SEMANTIC_GATE_VERSION='aau.semantic_consistency.v0.1';

function derive(projection,openingCash){
  const rows=projection?.artifact?.calculation;
  if(projection?.status!=='PROJECTION_READY'||!Array.isArray(rows)||rows.length!==12||!finite(openingCash))
    return {ok:false,reason:'TRUSTED_PROJECTION_OR_OPENING_CASH_MISSING'};
  const sources=projection.artifact.source_manifest;
  if(!Array.isArray(sources)||sources.length!==2||!sources.every(x=>
      record(x)&&typeof x.path==='string'&&typeof x.result_hash==='string'&&x.result_hash))
    return {ok:false,reason:'PROJECTION_PROVENANCE_MISSING'};
  const hashes=new Map(sources.map(x=>[x.path,x.result_hash]));
  if(hashes.size!==2||!hashes.has('R.002.003.002.001')||
      !hashes.has('R.002.003.002.002'))
    return {ok:false,reason:'UNEXPECTED_PROJECTION_PROVENANCE'};
  let balance=openingCash;const movements=[];
  for(let i=0;i<12;i++){
    const row=rows[i];
    if(!record(row)||row.month!==i+1||!finite(row.net_burn)||
        !finite(row[cashField]))
      return {ok:false,reason:'MONTHLY_CALCULATION_INVALID',month:i+1};
    const before=balance;balance-=row.net_burn;
    if(Math.abs(balance-row[cashField])>0.011)
      return {ok:false,reason:'CASH_ARITHMETIC_CONFLICT',month:i+1};
    movements.push(dir(row[cashField]-before));
  }
  const monotonicity=movements.every(x=>x==='increase')?'increasing':
    movements.every(x=>x==='decrease')?'decreasing':
    movements.every(x=>x==='unchanged')?'constant':'mixed';
  const delta=rows[11][cashField]-openingCash;
  return {ok:true,facts:{
    cash_at_month_12:rows[11][cashField],
    cash_change_from_opening:dir(delta),
    cash_monotonicity:monotonicity,
    net_burn_at_month_12:rows[11].net_burn,
    opening_cash:openingCash,cash_delta:delta,
    sources:sources.map(x=>({path:x.path,result_hash:x.result_hash}))
  }};
}

export function makeCanonicalSemanticCandidate({projection,openingCash}={}){
  const result=derive(projection,openingCash);
  if(!result.ok)return {status:'BLOCKED',reason:result.reason};
  const f=result.facts,m=n=>Number(n).toFixed(2);
  const article=f.cash_change_from_opening==='increase'?'an':'a';
  return {
    interpretation:'At month 12, ending cash is USD '+m(f.cash_at_month_12)+
      '; compared with opening cash of USD '+m(f.opening_cash)+
      ', this is '+article+' '+f.cash_change_from_opening+
      ' of USD '+m(Math.abs(f.cash_delta))+
      '. Monthly cash changes are '+f.cash_monotonicity+'.',
    sanity_check:'For all 12 months, ending cash equals opening cash minus cumulative net burn; this numeric consistency check does not establish correctness of the broader operating model.',
    semantic_claims:ids.map(id=>({id,value:f[id]})),
    source_manifest:f.sources.map(x=>({...x})),
    generation:'DETERMINISTIC_TEMPLATE_ONLY'
  };
}

// Detect a small, deliberately conservative subset of obvious natural-language
// contradictions; ambiguous or unrecognized prose is UNRESOLVED, never PASS.
function proseContradictions(candidate,facts){
  const findings=[];
  for(const key of ['interpretation','sanity_check']){
    if(typeof candidate[key]!=='string')continue;
    const t=candidate[key].toLowerCase().replace(/\s+/g,' ').trim();
    if(/\b(?:not|never|no|if|would|might|could)\b/.test(t))continue;
    const metric=/(?:ending\s+cash|cash\s+balance|cash\s+position)/;
    const down=/(?:declin(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|fall(?:s|en|ing)?|fell|dropp?(?:ed|ing|s)?)/;
    const up=/(?:increas(?:e|es|ed|ing)|ris(?:e|es|ing)|rose|grew|grow(?:s|ing)?)/;
    const scope=/(?:by\s+month\s+12|at\s+month\s+12|overall|from\s+opening|compared\s+(?:with|to)\s+opening)/;
    const scoped=new RegExp(metric.source+'.{0,90}(?:'+scope.source+').{0,90}(?:'+down.source+'|'+up.source+')|'+metric.source+'.{0,90}(?:'+down.source+'|'+up.source+').{0,90}(?:'+scope.source+')');
    if(scoped.test(t)){
      const lower=down.test(t),higher=up.test(t);
      if(lower!==higher){
        const asserted=lower?'decrease':'increase';
        if(asserted!==facts.cash_change_from_opening)
          findings.push({code:'CONTRADICTS_CASH_DIRECTION',field:key,
            expected:facts.cash_change_from_opening,asserted});
      }
    }
    const everyMonth=new RegExp(metric.source+'.{0,80}(?:'+up.source+'|'+down.source+').{0,45}(?:every\\s+month|each\\s+month|throughout\\s+all\\s+12\\s+months)');
    if(everyMonth.test(t)&&facts.cash_monotonicity==='mixed')
      findings.push({code:'CONTRADICTS_MONTHLY_CASH_PATTERN',field:key,expected:'mixed'});
  }
  return findings;
}

export function verifySemanticConsistency({parentCandidate,verifiedProjection,openingCash=5200000}={}){
  const d=derive(verifiedProjection,openingCash);
  const base={contract:SEMANTIC_GATE_VERSION,model_calls:0,
    live_node_completed:false,verified_numeric_basis:d.ok===true};
  if(!d.ok)return {...base,status:'UNRESOLVED',reason:d.reason};
  if(!record(parentCandidate))return {...base,status:'UNRESOLVED',reason:'PARENT_CANDIDATE_MISSING'};
  const unused=Object.keys(parentCandidate).filter(k=>![
    'interpretation','sanity_check','semantic_claims','source_manifest','generation'].includes(k));
  if(unused.length)return {...base,status:'UNRESOLVED',reason:'UNREVIEWED_SEMANTIC_FIELDS',fields:unused};
  const f=d.facts,contradictions=proseContradictions(parentCandidate,f);
  if(contradictions.length)return {...base,status:'SEMANTIC_MISMATCH',findings:contradictions};
  if(!Array.isArray(parentCandidate.semantic_claims))
    return {...base,status:'UNRESOLVED',reason:'STRUCTURED_CLAIMS_REQUIRED'};
  const seen=new Set(),issues=[];
  for(const claim of parentCandidate.semantic_claims){
    if(!record(claim)||typeof claim.id!=='string'||!ids.includes(claim.id)){
      issues.push({code:'UNKNOWN_CLAIM',claim:claim?.id??null});continue;
    }
    if(seen.has(claim.id)){issues.push({code:'DUPLICATE_CLAIM',claim:claim.id});continue;}
    seen.add(claim.id);
    if(Object.keys(claim).some(k=>k!=='id'&&k!=='value')){
      issues.push({code:'UNDECLARED_CLAIM_ATTRIBUTE',claim:claim.id});continue;
    }
    const expected=f[claim.id];
    const same=typeof expected==='number'?
      typeof claim.value==='number'&&finite(claim.value)&&Math.abs(expected-claim.value)<=tolerance:
      typeof claim.value==='string'&&claim.value===expected;
    if(!same)issues.push({code:'CLAIM_CONTRADICTS_VERIFIED_RESULT',
      claim:claim.id,expected,actual:claim.value});
  }
  if(issues.some(x=>x.code==='CLAIM_CONTRADICTS_VERIFIED_RESULT'))
    return {...base,status:'SEMANTIC_MISMATCH',findings:issues};
  if(issues.length)return {...base,status:'UNRESOLVED',reason:'UNSUPPORTED_CLAIMS',findings:issues};
  const missing=ids.filter(id=>!seen.has(id));
  if(missing.length)return {...base,status:'UNRESOLVED',reason:'REQUIRED_CLAIMS_MISSING',missing};
  const sources=parentCandidate.source_manifest;
  if(!Array.isArray(sources)||sources.length!==2||
      new Set(sources.map(x=>x?.path)).size!==2||
      sources.some(x=>!record(x)||!f.sources.some(v=>
        v.path===x.path&&v.result_hash===x.result_hash)))
    return {...base,status:'UNRESOLVED',reason:'PARENT_PROVENANCE_UNVERIFIED'};
  const canonical=makeCanonicalSemanticCandidate({
    projection:verifiedProjection,openingCash});
  if(parentCandidate.generation!=='DETERMINISTIC_TEMPLATE_ONLY'||
      parentCandidate.interpretation!==canonical.interpretation||
      parentCandidate.sanity_check!==canonical.sanity_check)
    return {...base,status:'UNRESOLVED',
      reason:'FREE_FORM_SEMANTIC_TEXT_REQUIRES_AUTHORED_VERIFICATION'};
  return {...base,status:'PASS',reason:'CANONICAL_VERIFIED_NUMERIC_SEMANTICS_ONLY',
    verified_claims:ids,source_manifest:f.sources,
    remaining_obligations:['parent_self_audit','task_scope_completeness',
      'original_verifier_provenance','full_qda_parent_schema_validation']};
}
