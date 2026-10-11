// Deterministic QDA601-M10-U2 output-obligation comparison.
// Owned outputs are extracted ONLY from the task's opening imperative clause.
// Dependencies, submission boilerplate, and input references never confer ownership.
// Unknown metric identities stay on the unmodified legacy lexical validator.
const QDA_UNIT=/\bQDA601-M10-U2\b/i;
const VERBS=/^\s*(?:calculate|compute|derive|project|determine|produce|model|estimate)\b/i;
const METRICS=Object.freeze([
  ['ending_cash_balance',/\b(?:ending\s+cash\s+balance|end(?:ing)?\s+cash\s+balance|cash\s+balance|closing\s+cash\s+balance)\b/i],
  ['net_burn',/\b(?:monthly\s+net\s+cash\s+burn(?:\s+rate)?|net\s+cash\s+burn(?:\s+rate)?|net\s+burn(?:\s+rate)?|monthly\s+cash\s+burn(?:\s+rate)?|cash\s+burn(?:\s+rate)?)\b/i],
  ['total_opex',/\b(?:total\s+operating\s+expenses?|total\s+opex|total\s+operating\s+costs?)\b/i],
  ['acquisition_spend',/\b(?:acquisition\s+spend|customer\s+acquisition\s+spend)\b/i],
  ['gross_profit',/\b(?:gross\s+profit)\b/i],
  ['paying_accounts',/\b(?:paying\s+accounts?|paying\s+customers?)\b/i],
  ['new_accounts',/\b(?:new\s+accounts?|new\s+customer\s+accounts?)\b/i],
]);
function sourceText(v){return String(v?.requirement||v?.requirement_text||'').trim()}
function titleOutputClause(requirement){
  if(!VERBS.test(requirement))return null;
  // Restrict extraction to the initial output statement. A downstream metric
  // after "using/derived from/utilizing" is an INPUT, not an owned output.
  const firstSentence=requirement.split(/\.\s+(?=[A-Z])|;\s+/)[0]||'';
  const output=firstSentence.split(
    /\b(?:using|utilizing|based\s+on|derived\s+from|given|taking\s+as\s+input|consuming|with\s+inputs?\s+from)\b/i
  )[0].split(/\b(?:for\s+Problem\s+\d+|of\s+Problem\s+\d+)\b/i)[0];
  return output.trim()||null;
}
function ownedPeriods(clause){
  const normalized=clause.replace(/[–—]/g,'-');
  const range=normalized.match(/\bmonths?\s+(\d+)\s*(?:-|to|through)\s*(?:months?\s+)?(\d+)\b/i);
  if(range){
    const a=Number(range[1]),b=Number(range[2]);
    if(a<1||b<a||b>120)return null;
    return Array.from({length:b-a+1},(_,i)=>a+i);
  }
  const one=normalized.match(/\bmonth\s+(\d+)\b/i);
  if(one)return Number(one[1])>0&&Number(one[1])<=120?[Number(one[1])]:null;
  const duration=normalized.match(/\b(\d{1,2})\s*-\s*months?\s+(?:trajectory|projection|series|schedule)\b/i);
  if(duration){
    const n=Number(duration[1]);
    return n>=1&&n<=120?Array.from({length:n},(_,i)=>i+1):null;
  }
  return null;
}
function ownedScenario(clause){
  const normalized=clause.toLowerCase();
  const scenario=normalized.match(/\b(?:scenario|case)\s*[:=]?\s*(base(?:\s+case)?|stress(?:\s+case)?|bear(?:\s+case)?|bull(?:\s+case)?)\b|\b(base(?:\s+case)?|stress(?:\s+case)?|bear(?:\s+case)?|bull(?:\s+case)?)\s+(?:scenario|case)\b/i);
  if(!scenario)return null;
  const s=(scenario[1]||scenario[2]||'').split(' ')[0];
  return ['base','stress','bear','bull'].includes(s)?s:null;
}
export function qdaFinancialOutputScopeV1(child){
  const requirement=sourceText(child);
  if(!QDA_UNIT.test(requirement))return null;
  const clause=titleOutputClause(requirement);
  if(!clause)return null;
  const metricClause=clause.replace(/[-–—_]+/g,' ');
  const metrics=METRICS.filter(([_,pattern])=>pattern.test(metricClause)).map(([id])=>id);
  if(!metrics.length)return null;
  // A declaration alone is not trusted. It must agree with this closed,
  // source-text-only metric registry. Do not infer outputs from the dependency.
  const declared=child?.declared_output_scope;
  if(declared&&Array.isArray(declared.metrics)){
    const canonicalDeclared=[...new Set(declared.metrics.map(String))].sort();
    if(canonicalDeclared.join('|')!==[...metrics].sort().join('|'))return null;
  }
  return {
    contract:'qda_financial_output_scope_v0_1',
    metrics:metrics.sort(),
    periods:ownedPeriods(clause),
    scenario:ownedScenario(clause),
    output_clause:clause,
  };
}
function intersect(a,b){return a.some(x=>b.includes(x))}
export function compareQdaOutputObligationsV1(candidate,sibling){
  const a=qdaFinancialOutputScopeV1(candidate);
  const b=qdaFinancialOutputScopeV1(sibling);
  if(!a||!b)return {verdict:'unknown',reason:'unresolved_output_identity',candidate_scope:a,sibling_scope:b};
  if(!intersect(a.metrics,b.metrics))
    return {verdict:'disjoint',reason:'distinct_canonical_output_metrics',candidate_scope:a,sibling_scope:b};
  if(a.periods&&b.periods&&!intersect(a.periods,b.periods))
    return {verdict:'disjoint',reason:'disjoint_owned_month_slices',candidate_scope:a,sibling_scope:b};
  if(a.scenario&&b.scenario&&a.scenario!==b.scenario)
    return {verdict:'disjoint',reason:'distinct_canonical_scenarios',candidate_scope:a,sibling_scope:b};
  return {verdict:'overlap',reason:'canonical_output_scope_intersection',candidate_scope:a,sibling_scope:b};
}

export function qdaSiblingOverlapGateV1({
  output_scope=null,
  similarity=0,
  explicit_instance_disjoint=false,
  explicit_partition_disjoint=false,
  canonical_instance_disjoint=false,
  structured_scope_disjoint=false,
}={}){
  const verdict=output_scope?.verdict||'unknown';
  if(verdict==='overlap')return {reject:true,basis:'canonical_output_scope'};
  if(verdict==='disjoint')return {reject:false,basis:'canonical_disjoint_output_scope'};
  // Byte-equivalent to the prior fallback: no threshold or exception change.
  const reject=Number(similarity)>=0.78
    &&!explicit_instance_disjoint
    &&!explicit_partition_disjoint
    &&!canonical_instance_disjoint
    &&!structured_scope_disjoint;
  return {reject,basis:reject?'legacy_lexical_overlap':'legacy_lexical_allowed'};
}
