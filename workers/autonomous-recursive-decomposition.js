import {
  resolveModelRuntimeContract,
  modelInputBudgetTokens,
} from './model-runtime-profiles.js';
import {
  SEMANTIC_RUNTIME_CONTRACT,
  semanticRuntimeConfig,
  modelCallCostUnits,
  semanticBranchBudget,
  semanticChildCapacity,
  repeatedStructuralFailureLocked,
  durableSiblingInspection,
  retryableModelTransportError,
  autonomousEvidenceWindowDecision,
  evidenceCeilingRequiresAgentResolution,
  mergeInheritedDependencyResults,
  THRESHOLD_EVIDENCE_POLICY,
  MAX_MODEL_TRANSPORT_ATTEMPTS,
  pathDepth,
} from './semantic-runtime-controls.js';
import { verifyPythonMathChecks } from './python-math.js';
import { runPythonStatisticalAnalyses } from './python-quant.js';

// AAU autonomous recursive decomposition v0.1
// The bound agent authors decomposition. Runtime only persists/routes/checkpoints.

const MAX_ATOMIC_EXECUTION_FAILURES=1;
// Semantic work is bounded by the conserved assignment-epoch budget.
// The 16-level path ceiling is only a storage geometry emergency brake.
const MAX_CHILDREN_PER_NODE=16;
const MAX_CONTEXT_RESEARCH_ROUNDS=24;
const MAX_CONTEXT_STAGNANT_ROUNDS=2;
const MAX_CONTEXT_UNCHANGED_GAP_ROUNDS=3;
const MAX_CONTEXT_REPEAT_REQUEST_ROUNDS=1;
const MAX_CONTEXT_ACTIVE_ELAPSED_MS=90*60*1000;
const MAX_CONTEXT_UNIQUE_SOURCES=1000;
// Renewable evidence windows are intentionally much smaller than lifetime caps.
// The runtime may grant another window only when marginal evidence acquisition is
// productive and the conserved semantic budget still protects completion.
const EVIDENCE_WINDOW_MAX_CONTEXT_ROUNDS=2;
const EVIDENCE_WINDOW_MAX_NEW_SOURCES=40;
const EVIDENCE_WINDOW_MAX_ACTIVE_ELAPSED_MS=10*60*1000;
const MAX_AUTONOMOUS_EVIDENCE_WINDOW_RENEWALS=6;
const MAX_CONTEXT_REQUESTS_PER_ROUND=8;
const MAX_CONTEXT_VALUE_BYTES=12000;
const MAX_PERSISTED_CONTEXT_BYTES=262144;
const MAX_NODE_RPC_BODY_BYTES=220000;
const MIN_NODE_CONTEXT_BYTES=32000;
const MAX_PINNED_EVIDENCE_ITEMS_IN_COGNITION=16;
const MAX_PINNED_EVIDENCE_EXCERPT_CHARS=12000;
const MAX_SELF_REMEDIATION_ATTEMPTS=2;
const CHILD_FORMULATION_DEEP_TOKENS=7000;
const ATOMIC_EXECUTION_DEEP_TOKENS=7000;
const ATOMIC_RECONCILIATION_DEEP_TOKENS=9000;
const SYNTHESIS_MERGE_DEEP_TOKENS=6000;
const SYNTHESIS_FINAL_DEEP_TOKENS=7000;
const CHILD_PROVENANCE_REVIEW_DEEP_TOKENS=8000;
const SYNTHESIS_PROVENANCE_REVIEW_DEEP_TOKENS=12000;
const SELF_REMEDIATION_REPAIR_TYPES=[
  'INVALIDATE_DISCOVERY_CHECKPOINT',
  'REFRESH_SIBLING_EVIDENCE',
];

const asObject=(v)=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const asArray=(v)=>Array.isArray(v)?v:[];

function text(v){return String(v??'').trim();}
function bytes(v){try{return Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v));}catch{return 0;}}
function clip(s,n){const v=String(s??'');return v.length<=n?v:v.slice(0,n);}
function safeJson(v){try{return JSON.stringify(v);}catch{return '{}';}}

const QDA_STATISTICAL_UNIT_CODES=new Set([
  'QDA601-M4-U1',
  'QDA601-M4-U2',
  'QDA601-M4-U3',
  'QDA601-M9-U3',
]);
function qdaStatisticalAtomicRequirement(packet,node){
  const requirement=text(node?.requirement_text);
  const unitCode=text(packet?.qda_601_context?.next_unit?.unit_code).toUpperCase();
  if(QDA_STATISTICAL_UNIT_CODES.has(unitCode))return true;
  if(!/QDA601/i.test(requirement))return false;
  return /(descriptive statistic|distribution|confidence interval|sampling|regression|correlation|association|bootstrap|monte carlo|simulation|p-value|t-statistic|variance|standard deviation)/i.test(requirement);
}
function qdaQuantitativeAtomicRequirement(packet,node){
  if(qdaStatisticalAtomicRequirement(packet,node))return false;
  const requirement=text(node?.requirement_text);
  if(!/QDA601/i.test(requirement))return false;
  return /(calculate|compute|compound|discount|retention|churn|present value|future value|\bPV\b|\bFV\b|\bNPV\b|rate|ratio|revenue|cost|margin|probab|scenario|optimization)/i.test(requirement);
}
function quantitativeArtifactBody(artifact){
  let parsed=artifact;
  if(typeof artifact==='string'){
    try{parsed=JSON.parse(artifact);}catch{return {};}
  }
  const obj=asObject(parsed);
  // QDA atomic completions may legitimately wrap the structured answer in a
  // problem_response envelope. Verification must inspect the answer body, not
  // mistake envelope shape for missing Python evidence.
  for(const key of ['problem_response','response']){
    const nested=asObject(obj[key]);
    if(Object.keys(nested).length)return nested;
  }
  return obj;
}
function pythonChecksFromArtifact(artifact){
  const obj=quantitativeArtifactBody(artifact);
  return asArray(obj.python_checks).filter(v=>v&&typeof v==='object'&&!Array.isArray(v));
}
function atomicMaterialCalculationCount(artifact){
  const obj=quantitativeArtifactBody(artifact);
  const calculation=asObject(obj.calculation);
  if(calculation&&typeof calculation==='object'&&!Array.isArray(calculation)){
    const count=Object.values(calculation).filter(value=>value!==null&&value!==undefined&&text(value)!=='').length;
    return Math.max(1,count);
  }
  return 1;
}
function deterministicMathVerification(packet,node,artifact){
  if(!qdaQuantitativeAtomicRequirement(packet,node))return {required:false,ok:true,all_match:true,check_count:0,results:[]};
  const checks=pythonChecksFromArtifact(artifact);
  const requiredChecks=atomicMaterialCalculationCount(artifact);
  if(!checks.length)return {
    required:true,ok:false,all_match:false,check_count:0,results:[],
    required_check_count:requiredChecks,error:'python_checks_required'
  };
  if(checks.length<requiredChecks)return {
    required:true,ok:false,all_match:false,check_count:checks.length,results:[],
    required_check_count:requiredChecks,
    error:'python_checks_insufficient_material_coverage:required='+requiredChecks+';received='+checks.length
  };
  return {
    required:true,
    required_check_count:requiredChecks,
    ...verifyPythonMathChecks(checks,{absoluteTolerance:0.005,relativeTolerance:1e-9})
  };
}

function completedAtomicDeterministicRevalidation(packet,node){
  if(text(node?.decision_type).toUpperCase()!=='ATOMIC' || text(node?.node_status||node?.status).toLowerCase()!=='completed'){
    return {required:false,verification:null};
  }
  const parts=resultParts(node?.result_artifact);
  const verification=deterministicMathVerification(packet,node,parts.artifact);
  return {
    required:verification.required===true && (verification.ok!==true || verification.all_match!==true),
    verification,
  };
}

function pythonAnalysesFromArtifact(artifact){
  const obj=quantitativeArtifactBody(artifact);
  return asArray(obj.python_analyses).filter(v=>v&&typeof v==='object'&&!Array.isArray(v));
}
function deterministicStatisticalVerification(packet,node,artifact){
  if(!qdaStatisticalAtomicRequirement(packet,node)){
    return {required:false,ok:true,all_claims_match:true,analysis_count:0,analyses:[]};
  }
  const analyses=pythonAnalysesFromArtifact(artifact);
  if(!analyses.length){
    return {
      required:true,ok:false,all_claims_match:false,analysis_count:0,analyses:[],
      error:'python_statistical_analyses_required'
    };
  }
  return {required:true,...runPythonStatisticalAnalyses(analyses,{timeoutMs:12000})};
}
function artifactText(v){
  if(v===null||v===undefined)return '';
  if(typeof v==='string')return v.trim();
  if(typeof v==='object')return safeJson(v);
  return String(v).trim();
}
function reconciliationReplacementQuality(proposedArtifact,candidateArtifact){
  const proposed=artifactText(proposedArtifact);
  const candidate=artifactText(candidateArtifact);
  const proposedBytes=bytes(proposed);
  const candidateBytes=bytes(candidate);
  if(!candidate)return {
    acceptable:false,reason:'empty_reconciliation_artifact',proposed_bytes:proposedBytes,candidate_bytes:0
  };
  if(proposedBytes<1600)return {
    acceptable:true,reason:'small_proposed_artifact',proposed_bytes:proposedBytes,candidate_bytes:candidateBytes
  };
  const minimumBytes=Math.max(900,Math.floor(proposedBytes*0.55));
  return {
    acceptable:candidateBytes>=minimumBytes,
    reason:candidateBytes>=minimumBytes?'complete_replacement_size_ok':'materially_abbreviated_replacement',
    proposed_bytes:proposedBytes,candidate_bytes:candidateBytes,minimum_bytes:minimumBytes,
  };
}

function companionNormalizedArtifact(payload){
  const src=asObject(payload);
  const raw=src?.artifact;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
  const normalized={...raw};
  for(const key of ['python_checks','python_analyses']){
    if((!Array.isArray(normalized[key])||normalized[key].length===0)
       &&Array.isArray(src[key])&&src[key].length){
      normalized[key]=src[key];
    }
  }
  return normalized;
}
function canonicalizeHashValue(v){
  if(Array.isArray(v))return v.map(canonicalizeHashValue);
  if(v&&typeof v==='object'){
    const out={};
    for(const key of Object.keys(v).sort())out[key]=canonicalizeHashValue(v[key]);
    return out;
  }
  return v;
}
function semanticContextIdentity(rawPayload){
  const src=asObject(rawPayload);
  const local={};
  for(const key of Object.keys(src).sort()){
    if(key==='research_source_catalog'
      ||key==='completed_sibling_results'
      ||key==='inherited_completed_sibling_results'
      ||/^external_research_round_\d+$/.test(key)
      ||key.startsWith('_model_context_')
      ||key.startsWith('_context_'))continue;
    local[key]=canonicalizeHashValue(src[key]);
  }
  const catalog=asArray(src.research_source_catalog)
    .map(raw=>{
      const v=asObject(raw);
      return {
        source_id:text(v.source_id)||null,
        url:text(v.url)||null,
        sha256:text(v.sha256)||null,
        fetch_status:text(v.fetch_status)||null,
      };
    })
    .sort((a,b)=>{
      const ka=[a.url,a.source_id,a.sha256].filter(Boolean).join('|');
      const kb=[b.url,b.source_id,b.sha256].filter(Boolean).join('|');
      return ka.localeCompare(kb);
    });
  return canonicalizeHashValue({local_context:local,research_source_catalog:catalog});
}
function estimatedTokens(v,contract){
  const chars=typeof v==='string'?v.length:safeJson(v).length;
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  return Math.ceil(chars/charsPerToken)+32;
}
function compactResearchCatalogForModel(rows,mode='full'){
  return asArray(rows).map(raw=>{
    const v=asObject(raw);
    if(mode==='minimal'){
      return {
        source_id:v.source_id||null,
        url:v.url||null,
        sha256:v.sha256||null,
        fetch_status:v.fetch_status||null,
      };
    }
    return {
      source_id:v.source_id||null,
      ordinal:v.ordinal||null,
      query:clip(v.query,300)||null,
      title:clip(v.title,500)||null,
      publisher:clip(v.publisher,240)||null,
      url:v.url||null,
      published_at:v.published_at||null,
      coverage:v.coverage||null,
      fetch_status:v.fetch_status||null,
      sha256:v.sha256||null,
      excerpt_chars_shared:Number(v.excerpt_chars_shared||0),
      receipt_persisted:Boolean(v.receipt_persisted??v.full_receipt_persisted),
      full_text_persisted:Boolean(v.full_text_persisted),
      full_receipt_persisted:Boolean(v.full_receipt_persisted),
    };
  });
}
function compactResearchRoundForModel(raw,maxTokens,contract){
  const round=asObject(raw);
  const base={
    status:round.status||null,
    audit_batch_id:round.audit_batch_id||null,
    requested_queries:asArray(round.requested_queries).map(v=>clip(text(v),500)).slice(0,8),
    requested_urls:asArray(round.requested_urls).map(v=>clip(text(v),1000)).slice(0,8),
    handoff_policy:round.handoff_policy||null,
    evidence_rule:clip(round.evidence_rule,1200)||null,
  };
  const sources=asArray(round.sources);
  if(!sources.length)return base;
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  const metadataOnly=sources.map((rawSource,index)=>{
    const s=asObject(rawSource);
    return {
      source_id:s.source_id||null,
      ordinal:s.ordinal||index+1,
      title:clip(s.title,450)||null,
      publisher:clip(s.publisher,220)||null,
      url:s.url||null,
      coverage:s.coverage||null,
      fetch_status:s.fetch_status||null,
      sha256:s.sha256||null,
      excerpt_chars_shared:Number(s.excerpt_chars_shared||0),
      receipt_persisted:Boolean(s.receipt_persisted??s.full_receipt_persisted),
      full_text_persisted:Boolean(s.full_text_persisted),
      full_receipt_persisted:Boolean(s.full_receipt_persisted),
    };
  });
  const metadataTokens=estimatedTokens({...base,sources:metadataOnly},contract);
  if(metadataTokens>=maxTokens)return {...base,sources:metadataOnly};
  const remainingChars=Math.max(0,Math.floor((maxTokens-metadataTokens)*charsPerToken));
  const fetched=Math.max(1,sources.filter(s=>typeof s?.excerpt==='string'&&s.excerpt.length).length);
  const excerptCharsEach=Math.max(0,Math.min(6000,Math.floor(remainingChars/fetched)));
  return {
    ...base,
    sources:sources.map((rawSource,index)=>{
      const s=asObject(rawSource);
      const meta=metadataOnly[index];
      return {
        ...meta,
        excerpt:excerptCharsEach>0&&typeof s.excerpt==='string'
          ? clip(s.excerpt,excerptCharsEach)
          : null,
      };
    }),
  };
}
function compactPinnedEvidenceForModel(rows,maxTokens,contract){
  const items=asArray(rows);
  if(!items.length)return [];
  if(estimatedTokens(items,contract)<=maxTokens)return items;
  const metadata=items.map(v=>({
    evidence_id:v.evidence_id||null,
    source_key:v.source_key||null,
    source_id:v.source_id||null,
    url:v.url||null,
    title:clip(v.title,450)||null,
    publisher:clip(v.publisher,220)||null,
    sha256:v.sha256||null,
    fetch_status:v.fetch_status||null,
    coverage:v.coverage||null,
    audit_batch_id:v.audit_batch_id||null,
    durable_pinned:true,
  }));
  const metadataTokens=estimatedTokens(metadata,contract);
  if(metadataTokens>=maxTokens)return metadata;
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  const excerptCharsEach=Math.max(0,Math.min(
    MAX_PINNED_EVIDENCE_EXCERPT_CHARS,
    Math.floor((maxTokens-metadataTokens)*charsPerToken/Math.max(1,items.length))
  ));
  return items.map((v,i)=>({
    ...metadata[i],
    excerpt:excerptCharsEach>0?clip(v.excerpt,excerptCharsEach):null,
    excerpt_bytes:Number(v.excerpt_bytes||bytes(v.excerpt||'')),
  }));
}
function compactSiblingEvidenceForModel(rows,maxTokens,contract){
  const items=asArray(rows);
  if(!items.length)return [];
  if(estimatedTokens(items,contract)<=maxTokens)return items;
  const per=Math.max(300,Math.floor(maxTokens/Math.max(1,items.length)));
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  const perChars=Math.max(500,Math.floor(per*charsPerToken));
  return items.map(v=>({
    path:v.path||null,
    status:v.status||null,
    decision_type:v.decision_type||null,
    requirement:clip(v.requirement,Math.min(700,Math.floor(perChars*0.15))),
    artifact:clip(v.artifact,Math.max(250,Math.floor(perChars*0.58))),
    handoff_json:clip(v.handoff_json,Math.max(180,Math.floor(perChars*0.20))),
    result_hash:v.result_hash||null,
    evidence_scope:v.evidence_scope||null,
  }));
}
function boundContextForModel(payload,maxTokens,contract){
  const src=asObject(payload);
  const budget=Math.max(1000,Math.floor(Number(maxTokens)||1000));
  if(estimatedTokens(src,contract)<=budget){
    return {
      ...src,
      _model_context_budget:{
        version:'model_profile_token_context_v0_1',
        model_id:contract?.model_id||null,
        max_tokens:budget,
        estimated_tokens:estimatedTokens(src,contract),
        compacted:false,
      },
    };
  }
  const out={};
  const evicted=[];
  const researchRound=(key)=>{
    const match=String(key).match(/^external_research(?:_round_)?(\d+)$/);
    return match?Number(match[1]):0;
  };
  const fits=(candidate)=>estimatedTokens(candidate,contract)<=budget;

  const catalog=asArray(src.research_source_catalog);
  if(catalog.length){
    let compact=compactResearchCatalogForModel(catalog,'full');
    if(!fits({...out,research_source_catalog:compact}))
      compact=compactResearchCatalogForModel(catalog,'minimal');
    if(fits({...out,research_source_catalog:compact}))out.research_source_catalog=compact;
    else evicted.push({path:'research_source_catalog',reason:'model_token_budget',items:catalog.length});
  }

  for(const key of ['completed_sibling_results','inherited_completed_sibling_results']){
    if(!src[key])continue;
    const candidate={...out,[key]:src[key]};
    if(fits(candidate))out[key]=src[key];
    else evicted.push({path:key,reason:'model_token_budget'});
  }

  const researchEntries=Object.entries(src)
    .filter(([key])=>key.startsWith('external_research'))
    .sort((a,b)=>researchRound(b[0])-researchRound(a[0]));
  for(const [key,value] of researchEntries){
    const remaining=Math.max(600,budget-estimatedTokens(out,contract)-128);
    const compact=compactResearchRoundForModel(value,remaining,contract);
    if(fits({...out,[key]:compact}))out[key]=compact;
    else evicted.push({path:key,reason:'model_token_budget'});
  }

  const priorityExcluded=new Set([
    'research_source_catalog','completed_sibling_results','inherited_completed_sibling_results',
    ...researchEntries.map(([key])=>key),
    '_context_evicted','_context_budget','_model_context_budget'
  ]);
  const other=Object.entries(src).filter(([key])=>!priorityExcluded.has(key)).reverse();
  for(const [key,value] of other){
    if(fits({...out,[key]:value}))out[key]=value;
    else evicted.push({path:key,reason:'model_token_budget'});
  }

  out._model_context_evicted=evicted.slice(0,60);
  out._model_context_budget={
    version:'model_profile_token_context_v0_1',
    model_id:contract?.model_id||null,
    operational_context_limit_tokens:contract?.operational_context_limit_tokens||null,
    max_tokens:budget,
    estimated_tokens:estimatedTokens(out,contract),
    compacted:true,
    evicted_count:evicted.length,
    source_catalog_items:asArray(out.research_source_catalog).length,
  };
  return out;
}
function withoutDuplicatedSiblingContext(payload){
  const out={...asObject(payload)};
  delete out.completed_sibling_results;
  delete out.inherited_completed_sibling_results;
  return out;
}
function mergeResearchSourceCatalog(existing,incoming){
  const out=[];
  const byKey=new Map();
  for(const source of [...asArray(existing),...asArray(incoming)]){
    const item=asObject(source);
    const key=text(item.url)||text(item.source_id)||text(item.sha256)||text(item.title);
    if(!key)continue;
    if(byKey.has(key)){
      const idx=byKey.get(key);
      out[idx]={...out[idx],...item};
      continue;
    }
    byKey.set(key,out.length);
    out.push(item);
  }
  return out;
}
function catalogSourceIdFromRequest(raw){
  const request=text(raw);
  if(!request)return '';
  if(/^src_[a-z0-9]+$/i.test(request))return request;
  const parts=pathParts(request);
  if(parts.length>=2&&parts[0]==='research_source_catalog'&&/^src_[a-z0-9]+$/i.test(parts[1]))
    return parts[1];
  return '';
}
function resolveCatalogSourceRequests(requests,catalog){
  const bySourceId=new Map(
    asArray(catalog)
      .map(raw=>asObject(raw))
      .filter(v=>text(v.source_id))
      .map(v=>[text(v.source_id),v])
  );
  const resolved=[];
  const unresolved=[];
  for(const raw of asArray(requests)){
    const request=text(raw);
    if(!request)continue;
    const sourceId=catalogSourceIdFromRequest(request);
    const source=sourceId?bySourceId.get(sourceId):null;
    if(source&&/^https:\/\//i.test(text(source.url))){
      resolved.push({
        request_path:request,
        source_id:sourceId,
        url:text(source.url),
        sha256:text(source.sha256)||null,
        audit_batch_id:text(source.audit_batch_id)||null,
      });
    }else{
      unresolved.push(request);
    }
  }
  return {resolved,unresolved};
}
function normalizedUrl(v){
  const raw=text(v);
  if(!raw)return '';
  try{
    const u=new URL(raw);
    u.hash='';
    u.search='';
    return u.toString().replace(/\/$/,'').toLowerCase();
  }catch{
    return raw.replace(/\/$/,'').toLowerCase();
  }
}
function compactPinnedEvidence(rows){
  return asArray(rows)
    .filter(v=>v&&typeof v==='object')
    .slice(0,MAX_PINNED_EVIDENCE_ITEMS_IN_COGNITION)
    .map(v=>({
      evidence_id:v.evidence_id||null,
      source_key:v.source_key||v.source_id||v.url||null,
      source_id:v.source_id||null,
      url:v.url||null,
      title:v.title||null,
      publisher:v.publisher||null,
      sha256:v.sha256||null,
      fetch_status:v.fetch_status||null,
      coverage:v.coverage||null,
      audit_batch_id:v.audit_batch_id||null,
      excerpt:clip(v.excerpt,MAX_PINNED_EVIDENCE_EXCERPT_CHARS),
      excerpt_bytes:Number(v.excerpt_bytes||bytes(v.excerpt||'')),
      durable_pinned:true,
    }));
}
function normalizedSignal(values){
  return asArray(values).map(v=>normalizedRequirement(v)).filter(Boolean).sort().join(' | ');
}
function contextResourceView(state,contextPayload){
  const s=asObject(state);
  const activeElapsedMs=Math.max(0,Number(s.active_context_elapsed_ms||0));
  const contextRounds=Math.max(0,Number(s.context_rounds_attempted||0));
  const uniqueSources=Math.max(
    asArray(contextPayload?.research_source_catalog).length,
    Number(s.total_new_sources||0)
  );
  const windowRoundBaseline=Math.max(0,Number(s.evidence_window_round_baseline||0));
  const windowSourceBaseline=Math.max(0,Number(s.evidence_window_source_baseline||0));
  const windowElapsedBaseline=Math.max(0,Number(s.evidence_window_elapsed_baseline_ms||0));
  const windowRounds=Math.max(0,contextRounds-windowRoundBaseline);
  const windowSources=Math.max(0,uniqueSources-windowSourceBaseline);
  const windowElapsedMs=Math.max(0,activeElapsedMs-windowElapsedBaseline);

  const reasons=[];
  if(contextRounds>=MAX_CONTEXT_RESEARCH_ROUNDS)
    reasons.push('absolute_context_round_safety_ceiling');
  if(uniqueSources>=MAX_CONTEXT_UNIQUE_SOURCES)
    reasons.push('absolute_unique_source_safety_ceiling');
  if(activeElapsedMs>=MAX_CONTEXT_ACTIVE_ELAPSED_MS)
    reasons.push('absolute_context_elapsed_time_ceiling');
  if(Number(s.stagnant_rounds||0)>=MAX_CONTEXT_STAGNANT_ROUNDS)
    reasons.push('no_new_observations');
  if(Number(s.unchanged_gap_rounds||0)>=MAX_CONTEXT_UNCHANGED_GAP_ROUNDS)
    reasons.push('unresolved_gap_not_changing');
  if(Number(s.repeated_request_rounds||0)>=MAX_CONTEXT_REPEAT_REQUEST_ROUNDS)
    reasons.push('research_request_repeating');
  if(windowRounds>=EVIDENCE_WINDOW_MAX_CONTEXT_ROUNDS)
    reasons.push('evidence_window_round_ceiling');
  if(windowSources>=EVIDENCE_WINDOW_MAX_NEW_SOURCES)
    reasons.push('evidence_window_source_ceiling');
  if(windowElapsedMs>=EVIDENCE_WINDOW_MAX_ACTIVE_ELAPSED_MS)
    reasons.push('evidence_window_elapsed_ceiling');

  const renewableSet=new Set([
    'evidence_window_round_ceiling',
    'evidence_window_source_ceiling',
    'evidence_window_elapsed_ceiling',
  ]);
  return {
    available:reasons.length===0,
    exhausted:reasons.length>0,
    reasons,
    renewable_reasons:reasons.filter(v=>renewableSet.has(v)),
    hard_reasons:reasons.filter(v=>!renewableSet.has(v)),
    elapsed_ms:activeElapsedMs,
    active_context_elapsed_ms:activeElapsedMs,
    elapsed_accounting:'active_context_acquisition_only_v0_3_evidence_windows',
    unique_sources:uniqueSources,
    context_rounds_attempted:contextRounds,
    research_rounds_attempted:Number(s.research_rounds_attempted||0),
    local_context_rounds_attempted:Number(s.local_context_rounds_attempted||0),
    stagnant_rounds:Number(s.stagnant_rounds||0),
    unchanged_gap_rounds:Number(s.unchanged_gap_rounds||0),
    repeated_request_rounds:Number(s.repeated_request_rounds||0),
    evidence_window_no:Math.max(0,Number(s.evidence_window_no||0)),
    evidence_window_renewals:Math.max(0,Number(s.evidence_window_renewals||0)),
    evidence_window_round_baseline:windowRoundBaseline,
    evidence_window_source_baseline:windowSourceBaseline,
    evidence_window_elapsed_baseline_ms:windowElapsedBaseline,
    evidence_window_rounds_used:windowRounds,
    evidence_window_new_sources:windowSources,
    evidence_window_elapsed_ms:windowElapsedMs,
    evidence_window_limits:{
      context_rounds:EVIDENCE_WINDOW_MAX_CONTEXT_ROUNDS,
      new_sources:EVIDENCE_WINDOW_MAX_NEW_SOURCES,
      active_elapsed_ms:EVIDENCE_WINDOW_MAX_ACTIVE_ELAPSED_MS,
    },
    lifetime_limits:{
      context_rounds:MAX_CONTEXT_RESEARCH_ROUNDS,
      unique_sources:MAX_CONTEXT_UNIQUE_SOURCES,
      active_elapsed_ms:MAX_CONTEXT_ACTIVE_ELAPSED_MS,
    },
  };
}
function normalizedRequirement(v){
  return text(v).toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function requirementSimilarity(a,b){
  const aa=normalizedRequirement(a);
  const bb=normalizedRequirement(b);
  if(!aa||!bb)return 0;
  if(aa===bb)return 1;
  const aset=new Set(aa.split(' ').filter(Boolean));
  const bset=new Set(bb.split(' ').filter(Boolean));
  let overlap=0;
  for(const token of aset)if(bset.has(token))overlap++;
  return overlap/Math.max(1,new Set([...aset,...bset]).size);
}

function explicitRepeatedInstanceId(v){
  const source=normalizedRequirement([
    v?.requirement,
    v?.requirement_text,
    v?.completion_criterion,
    v?.scope_removed,
  ].filter(Boolean).join(' '));
  if(!source)return null;

  const numericPatterns=[
    /\bcandidate\s+(\d+)(?:\s+of\s+\d+)?\b/,
    /\bproposal\s+(\d+)(?:\s+of\s+\d+)?\b/,
    /\bordinal\s+(\d+)\b/,
    /\binstance\s+(\d+)(?:\s+of\s+\d+)?\b/,
    /\bitem\s+(\d+)(?:\s+of\s+\d+)?\b/,
  ];
  for(const pattern of numericPatterns){
    const match=source.match(pattern);
    if(match)return Number(match[1]);
  }

  const ordinalWords={
    first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,
  };
  const wordMatch=source.match(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(candidate|proposal|instance|item)\b/
  );
  return wordMatch?ordinalWords[wordMatch[1]]||null:null;
}

function explicitRepeatedInstancesDisjoint(a,b){
  const aa=explicitRepeatedInstanceId(a);
  const bb=explicitRepeatedInstanceId(b);
  return Number.isInteger(aa)&&Number.isInteger(bb)&&aa!==bb;
}

function candidateLedgerRows(suppliedContext){
  const wrapped=asObject(asObject(suppliedContext)?.expertise_candidate_ledger);
  const ledger=asObject(wrapped.value||wrapped);
  return asArray(ledger.candidates);
}

function canonicalCandidateIdentity(v,suppliedContext){
  const raw=[
    v?.proposal_id,
    v?.requirement,
    v?.requirement_text,
    v?.scope_removed,
    v?.completion_criterion,
    v?.reason,
  ].filter(Boolean).join(' ');
  const rawLower=String(raw).toLowerCase();
  const normalized=normalizedRequirement(raw);

  for(const row of candidateLedgerRows(suppliedContext)){
    const proposalId=text(row?.proposal_id).trim();
    const domain=text(row?.domain).trim();
    const domainNorm=normalizedRequirement(domain);
    if(proposalId&&rawLower.includes(proposalId.toLowerCase())){
      return {
        kind:'canonical_candidate',
        key:'proposal:'+proposalId.toLowerCase(),
        proposal_id:proposalId,
        domain:domain||null,
        candidate_ordinal:Number(row?.candidate_ordinal||0)||null,
        match_basis:'proposal_id',
      };
    }
    if(domainNorm&&normalized.includes(domainNorm)){
      return {
        kind:'canonical_candidate',
        key:proposalId
          ?'proposal:'+proposalId.toLowerCase()
          :'domain:'+domainNorm,
        proposal_id:proposalId||null,
        domain:domain||null,
        candidate_ordinal:Number(row?.candidate_ordinal||0)||null,
        match_basis:'exact_normalized_domain',
      };
    }
  }

  const explicitId=explicitRepeatedInstanceId(v);
  if(Number.isInteger(explicitId)){
    return {
      kind:'explicit_ordinal',
      key:'ordinal:'+explicitId,
      proposal_id:null,
      domain:null,
      candidate_ordinal:explicitId,
      match_basis:'explicit_repeated_instance',
    };
  }
  return null;
}

function canonicalRepeatedInstancesDisjoint(a,b,suppliedContext){
  const aa=canonicalCandidateIdentity(a,suppliedContext);
  const bb=canonicalCandidateIdentity(b,suppliedContext);
  return Boolean(aa?.key&&bb?.key&&aa.key!==bb.key);
}
function childConvergenceValidation(parentRequirement,childRequirement,scopeRemoved,completionCriterion){
  const failures=[];
  const scope=text(scopeRemoved);
  const criterion=text(completionCriterion);
  if(scope.length<12)failures.push('scope_removed_required');
  if(criterion.length<12)failures.push('completion_criterion_required');
  const parentNorm=normalizedRequirement(parentRequirement);
  const childNorm=normalizedRequirement(childRequirement);
  const similarity=requirementSimilarity(parentRequirement,childRequirement);
  if(parentNorm===childNorm)failures.push('child_exactly_restates_parent');
  if(similarity>=0.88 && childNorm.length>=Math.max(1,Math.floor(parentNorm.length*0.80)))
    failures.push('child_does_not_materially_reduce_scope');
  return {valid:failures.length===0,failures,similarity};
}
function boundContextPayload(payload,maxBytes=MAX_PERSISTED_CONTEXT_BYTES){
  const src=asObject(payload);
  const effectiveMaxBytes=Math.max(
    MIN_NODE_CONTEXT_BYTES,
    Math.min(MAX_PERSISTED_CONTEXT_BYTES,Math.floor(Number(maxBytes)||MAX_PERSISTED_CONTEXT_BYTES))
  );
  if(bytes(src)<=effectiveMaxBytes)return src;
  const entries=Object.entries(src);
  const out={};
  const evicted=[];
  const reserve=6000;
  const researchRound=(key)=>{
    const match=String(key).match(/^external_research_round_(\d+)$/);
    return match?Number(match[1]):0;
  };
  const priorityScore=(key)=>{
    if(key==='research_source_catalog')return 10000;
    if(key==='inherited_completed_sibling_results')return 9800;
    if(key==='completed_sibling_results')return 9500;
    if(key.startsWith('external_research'))return 7000+researchRound(key);
    return 0;
  };
  const tryAdd=(key,value)=>{
    const candidate={...out,[key]:value};
    if(bytes(candidate)<=effectiveMaxBytes-reserve){
      out[key]=value;
      return true;
    }
    evicted.push({path:key,bytes:bytes(value)});
    return false;
  };

  // The durable source catalog must degrade structurally, not disappear wholesale.
  // Full receipts remain in agent_web_research_batches; this index preserves exact
  // URLs/source identity across worker restarts.
  if(Array.isArray(src.research_source_catalog)&&src.research_source_catalog.length){
    let catalog=compactResearchCatalogForModel(src.research_source_catalog,'full');
    if(!tryAdd('research_source_catalog',catalog)){
      evicted.pop();
      catalog=compactResearchCatalogForModel(src.research_source_catalog,'minimal');
      if(!tryAdd('research_source_catalog',catalog)){
        evicted.pop();
        catalog=src.research_source_catalog.map(v=>({
          source_id:v?.source_id||null,
          url:v?.url||null,
        }));
        if(!tryAdd('research_source_catalog',catalog)){
          // This should only be reachable at extreme source counts/URL lengths.
          // Preserve a durable pointer rather than pretending no catalog existed.
          evicted.push({
            path:'research_source_catalog',
            bytes:bytes(src.research_source_catalog),
            reason:'durable_context_ceiling_even_after_minimal_compaction',
            source_count:src.research_source_catalog.length,
          });
        }
      }
    }
  }

  const prioritized=entries
    .filter(([key])=>key!=='research_source_catalog'&&priorityScore(key)>0)
    .sort((a,b)=>priorityScore(b[0])-priorityScore(a[0]));
  for(const [key,value] of prioritized)tryAdd(key,value);
  for(let i=entries.length-1;i>=0;i--){
    const [key,value]=entries[i];
    if(key==='research_source_catalog'||priorityScore(key)>0||Object.prototype.hasOwnProperty.call(out,key))continue;
    tryAdd(key,value);
  }
  out._context_evicted=evicted.slice(0,60);
  out._context_budget={
    max_bytes:effectiveMaxBytes,
    policy:'durable_context_independent_of_model_v0_1_compact_catalog_never_wholesale_drop',
    evicted_count:evicted.length,
    research_source_catalog_items:asArray(out.research_source_catalog).length,
  };
  while(bytes(out)>effectiveMaxBytes && out._context_evicted.length){
    out._context_evicted.pop();
  }
  return out;
}

function inheritedChildContext(parentPayload){
  const src=asObject(parentPayload);
  const promoted=mergeInheritedDependencyResults({
    inheritedCompletedSiblingResults:src.inherited_completed_sibling_results,
    completedSiblingResults:src.completed_sibling_results,
  });
  return boundContextPayload(
    promoted.length
      ?{
        inherited_completed_sibling_results:promoted,
        dependency_context_contract:'ancestor_dependency_propagation_v0_3',
      }
      :{}
  );
}

function pathParts(path){
  return String(path||'')
    .replace(/\[([^\]]+)\]/g,'.$1')
    .split('.')
    .map(v=>v.trim())
    .filter(Boolean);
}
function selectorKey(v){
  return String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,'');
}
function arraySelectorMatch(entry,selector){
  if(!entry||typeof entry!=='object')return false;
  const wanted=selectorKey(selector);
  if(!wanted)return false;
  const candidates=[
    entry.source_id,entry.publisher,entry.title,entry.search_title,entry.url,entry.sha256
  ].map(selectorKey).filter(Boolean);
  return candidates.some(value=>value===wanted||value.includes(wanted)||wanted.includes(value));
}
function getPath(root,path){
  const parts=pathParts(path);
  let cur=root;
  for(const part of parts){
    if(cur===null||cur===undefined||typeof cur!=='object')return {found:false,value:null};
    if(Array.isArray(cur)){
      if(/^[0-9]+$/.test(part)){
        const index=Number(part);
        if(index<0||index>=cur.length)return {found:false,value:null};
        cur=cur[index];
        continue;
      }
      const matched=cur.find(entry=>arraySelectorMatch(entry,part));
      if(matched===undefined)return {found:false,value:null};
      cur=matched;
      continue;
    }
    if(!(part in cur))return {found:false,value:null};
    cur=cur[part];
  }
  return {found:true,value:cur};
}

function indexObject(root,prefix='',depth=0,out=[]){
  if(!root||typeof root!=='object'||depth>2)return out;
  if(Array.isArray(root)){
    for(let i=0;i<Math.min(root.length,80)&&out.length<180;i++){
      const path=prefix?prefix+'.'+i:String(i);
      const value=root[i];
      out.push({path,kind:Array.isArray(value)?'array':typeof value,bytes:bytes(value)});
      if(value&&typeof value==='object'&&depth<2)indexObject(value,path,depth+1,out);
    }
    return out;
  }
  for(const key of Object.keys(root).sort()){
    if(out.length>=180)break;
    const path=prefix?prefix+'.'+key:key;
    const value=root[key];
    out.push({path,kind:Array.isArray(value)?'array':typeof value,bytes:bytes(value)});
    if(value&&typeof value==='object'&&depth<2)indexObject(value,path,depth+1,out);
  }
  return out;
}

function qda601HoldRequirement(packet){
  const qda=asObject(packet?.qda_601_context);
  if(qda.assigned!==true || qda.blocking_stage4!==true) return null;

  const status=text(qda.status);
  const next=asObject(qda.next_unit);

  if(status==='in_progress' && text(next.unit_code)){
    return {
      source_kind:'supplemental_training',
      source_ref:text(next.unit_code),
      requirement:[
        'QDA-601 is the authoritative lifecycle obligation while Stage 4 is suspended.',
        'Complete exactly the current QDA unit; do not perform, revise, select, or materialize Stage-4 expertise viability work.',
        'Current unit: '+text(next.unit_code)+' — '+text(next.title)+'.',
        text(next.learning_goal)?'Learning goal: '+text(next.learning_goal)+'.':'',
        text(next.assignment)?'Assignment: '+text(next.assignment)+'.':'',
        text(next.exercise_pack_ref)?'Exercise pack ref: '+text(next.exercise_pack_ref)+'.':'',
        next.exercise_pack?'AUTHORITATIVE EXERCISE PACK (solve these exact assigned problems; do not invent replacements): '+JSON.stringify(next.exercise_pack):'',
        next.exercise_pack?.external_research===false
          ? 'This exercise pack is self-contained AAU course data. External research is forbidden for this unit. NEED_CONTEXT is not justified by absence of outside sources or alternative problems; all required case inputs are supplied in the exercise pack.'
          : 'If genuinely current external evidence is required by this exercise pack, request bounded research for this same unit and return to it.',
        'Persist the completed work in this cognition as agent_file_output_v0_1 using filename '+text(next.filename)+'.',
        'The artifact must preserve exercise_pack_ref exactly, include problem_responses covering every assigned problem, satisfy qda_601_context.required_submission_fields, and include independent Pass A / Pass B self-audit.',
        'Never fall back to the suspended Stage-4 requirement.'
      ].filter(Boolean).join(' ')
    };
  }

  if(status==='coursework_complete_final_packaging_required'){
    return {
      source_kind:'supplemental_training',
      source_ref:'QDA601_FINAL_SUBMISSION',
      requirement:'QDA-601 coursework units are complete. Package the canonical QDA601_FINAL_SUBMISSION.json required by qda_601_context. Do not return to the suspended Stage-4 expertise requirement before independent QDA verification.'
    };
  }

  if(status==='coursework_complete_pending_independent_verification'){
    return {
      source_kind:'supplemental_training',
      source_ref:'QDA601_INDEPENDENT_VERIFICATION',
      requirement:'QDA-601 coursework is complete and awaiting independent verification. Preserve the completed artifacts and do not resume the suspended Stage-4 expertise requirement until the verifier records a pass.'
    };
  }

  return {
    source_kind:'supplemental_training',
    source_ref:'QDA601',
    requirement:'QDA-601 is the authoritative supplemental-training hold. Follow qda_601_context and do not resume the suspended Stage-4 expertise requirement.'
  };
}

function extractTriggerRequirement(packet){
  const admin=asObject(packet?.admin_chat_context?.current_admin_message);
  if(text(admin.content)){
    return {source_kind:'admin_message',source_ref:text(admin.message_id)||null,requirement:text(admin.content)};
  }
  const qdaRequirement=qda601HoldRequirement(packet);
  if(qdaRequirement) return qdaRequirement;
  const item=asObject(packet?.attention_arbiter_context?.current_attention_item);
  const payload=asObject(item.payload);
  const attn=text(payload.message)||text(payload.reason)||text(item.reason);
  if(attn){
    return {source_kind:'attention_item',source_ref:text(item.attention_item_id)||text(item.source_ref)||null,requirement:attn};
  }
  const trigger=asObject(packet?.intent_trigger);
  const intent=text(trigger.intent_reason)||text(trigger.reason);
  if(intent){
    return {source_kind:'agent_intent',source_ref:text(trigger.intent_id)||text(trigger.wake_intent_id)||null,requirement:intent};
  }
  const next=asObject(packet?.next_intent_context);
  if(text(next.intent_reason)){
    return {source_kind:'agent_intent',source_ref:text(next.intent_id)||null,requirement:text(next.intent_reason)};
  }
  const lifecycle=asObject(packet?.mandatory_lifecycle_context);
  if(text(lifecycle.stage_rule)){
    return {source_kind:'lifecycle_requirement',source_ref:text(lifecycle.current_stage)||text(lifecycle.stage)||null,requirement:text(lifecycle.stage_rule)};
  }
  const focus=text(packet?.state?.state_payload?.current_focus)||text(packet?.state?.current_focus);
  if(focus){
    return {source_kind:'agent_focus',source_ref:null,requirement:'Continue the agent-authored current focus: '+focus};
  }
  throw new Error('autonomous_decomposition_requirement_missing');
}

function contextIndex(packet){
  // Shallow index only. The agent recursively narrows oversized branches itself.
  if(!packet||typeof packet!=='object'||Array.isArray(packet))return [];
  return Object.keys(packet).sort().slice(0,80).map(key=>{
    const value=packet[key];
    return {
      path:key,
      kind:Array.isArray(value)?'array':typeof value,
      bytes:bytes(value),
      ...(Array.isArray(value)?{items:value.length}:{}),
      ...(value&&typeof value==='object'&&!Array.isArray(value)?{keys:Object.keys(value).length}:{})
    };
  });
}

function lifecycleStageContract(packet){
  const qda=asObject(packet?.qda_601_context);
  if(qda.assigned===true && qda.blocking_stage4===true){
    return {name:'',definition:null};
  }
  const lifecycle=asObject(packet?.mandatory_lifecycle_context);
  const name=text(lifecycle.stage_contract);
  const definition=asObject(lifecycle.stage_contract_definition);
  if(!name||!Object.keys(definition).length)return {name:'',definition:null};
  return {name,definition};
}

function lifecycleStageContractContext(packet){
  const lifecycle=asObject(packet?.mandatory_lifecycle_context);
  const resolved=lifecycleStageContract(packet);
  const out={};
  const qda=asObject(packet?.qda_601_context);
  if(qda.assigned===true && qda.blocking_stage4===true){
    out.qda_601_context={
      available:true,
      value:qda,
      source:'qda_601_context',
    };
    out.suspended_lifecycle_stage={
      available:true,
      value:{
        current_stage:text(lifecycle.current_stage)||null,
        current_stage_label:text(lifecycle.current_stage_label)||null,
        stage_contract:text(lifecycle.stage_contract)||null,
        suspension_reason:'qda_601_lifecycle_hold',
      },
      source:'mandatory_lifecycle_context',
    };
  }

  if(resolved.name&&resolved.definition){
    out[resolved.name]={
      available:true,
      value:resolved.definition,
      source:'mandatory_lifecycle_context.stage_contract_definition',
    };
  }

  const candidateMode=asObject(lifecycle.expertise_candidate_mode);
  if(Object.keys(candidateMode).length){
    out.expertise_candidate_mode={
      available:true,
      ...candidateMode,
      source:'mandatory_lifecycle_context.expertise_candidate_mode',
    };
  }

  const inheritance=asObject(lifecycle.cumulative_competency_inheritance);
  if(Object.keys(inheritance).length){
    out.cumulative_competency_inheritance={
      available:true,
      value:inheritance,
      source:'mandatory_lifecycle_context.cumulative_competency_inheritance',
    };

    const verifiedPrior=asObject(inheritance.verified_prior_learning);
    const masters=asObject(verifiedPrior.entrepreneurship_masters);
    if(Object.keys(masters).length){
      const courses=asArray(masters.courses).map(raw=>{
        const course=asObject(raw);
        return {
          course_code:text(course.course_code)||null,
          title:text(course.title)||null,
          category:text(course.category)||null,
          learning_objectives:asArray(course.learning_objectives).map(text).filter(Boolean),
        };
      });
      const verifiedCompetencies=courses.flatMap(course=>
        course.learning_objectives.map(objective=>({
          source_stage:'entrepreneurship_masters',
          course_code:course.course_code,
          course_title:course.title,
          category:course.category,
          competency:objective,
        }))
      );
      const capstone=asObject(masters.capstone);
      const verificationReport=asObject(masters.verification_report);
      const competencyLedger={
        contract:'verified_prior_learning_competency_ledger_v0_1',
        source_stage:'entrepreneurship_masters',
        status:text(masters.status)||null,
        course_count:courses.length,
        courses,
        verified_competencies:verifiedCompetencies,
        capstone:{
          status:text(capstone.status)||null,
          capstone_id:capstone.capstone_id||null,
          verified_transfer_principles:asArray(capstone.verified_transfer_principles).map(text).filter(Boolean),
        },
        verification:{
          certification_kind:verificationReport.certification_kind||null,
          operator_certification_override:Boolean(verificationReport.operator_certification_override),
          overall_score:Number(verificationReport.overall_score||0)||null,
          core_curriculum_passed:Boolean(verificationReport.core_curriculum_passed),
          capstone_passed:Boolean(verificationReport.capstone_passed),
          entrepreneurship_specialization_passed:Boolean(
            verificationReport.entrepreneurship_specialization_passed
          ),
          historical_integrity_status:verificationReport.historical_integrity_status||null,
          historical_integrity_hold_preserved:Boolean(
            verificationReport.historical_integrity_hold_preserved
          ),
        },
      };

      // Stable aliases make the verified prior-learning record directly
      // addressable by cognition/context requests. These are views of the
      // authoritative lifecycle packet, not synthetic competencies.
      out.entrepreneurship_masters={
        available:text(masters.status)==='verified_pass',
        status:text(masters.status)||null,
        verified_competencies_ledger:competencyLedger,
        courses,
        capstone:competencyLedger.capstone,
        verification:competencyLedger.verification,
        source:'mandatory_lifecycle_context.cumulative_competency_inheritance.verified_prior_learning.entrepreneurship_masters',
      };
      out.agent={
        competency_verification_records:{
          available:text(masters.status)==='verified_pass',
          source_stage:'entrepreneurship_masters',
          status:text(masters.status)||null,
          verified_competencies:verifiedCompetencies,
          capstone_transfer_principles:competencyLedger.capstone.verified_transfer_principles,
          verification:competencyLedger.verification,
          source:'mandatory_lifecycle_context.cumulative_competency_inheritance.verified_prior_learning.entrepreneurship_masters',
        },
      };
    }
  }

  return out;
}

const TERMINAL_SYNTHESIS_OWNERSHIP_VERSION='runtime_owned_terminal_synthesis_v0_2';
const STAGE_CONTRACT_MATERIALIZATION_VERSION='stage_contract_materialize_v0_1';

function stageContractForRequirement(packet,requirement,nodePath=null){
  const resolved=lifecycleStageContract(packet);
  if(!resolved.name||!resolved.definition)
    return {applies:false,name:'',definition:null,ownership_scope:null};
  const req=normalizedRequirement(requirement);
  const name=normalizedRequirement(resolved.name);
  const mentions=Boolean(req&&name&&req.includes(name));

  // Candidate-mode Stage 4 uses a coordinator root that references the proposal
  // contract as protocol. Only individual top-level candidate nodes own one
  // expertise_viability_proposal_v0_1 artifact.
  const candidateOwned=
    resolved.name==='expertise_viability_proposal_v0_1'
      ? /^R[.]\d{3}$/.test(text(nodePath))
      : true;

  const applies=
    resolved.name==='expertise_viability_proposal_v0_1'
      ? candidateOwned
      : Boolean(mentions&&candidateOwned);

  return {
    applies,
    name:resolved.name,
    definition:resolved.definition,
    ownership_scope:
      resolved.name==='expertise_viability_proposal_v0_1'
        ? 'top_level_candidate_node_by_lifecycle_position'
        : 'requirement_mentions_contract',
  };
}

function runtimeOwnedTerminalSynthesisChild(candidate){
  const requirement=normalizedRequirement(candidate?.requirement);
  if(!requirement)return false;
  // Terminal synthesis is a runtime phase. A decomposition child may gather or
  // validate evidence, but it must not exist solely to format/merge/submit it.
  return /^(synthesize|synthesise|format|submit|compile|merge|reconcile|assemble|convert)\b/.test(requirement);
}

function validateStageContractArtifact(contractDefinition,artifactText){
  const definition=asObject(contractDefinition);
  let artifact=null;
  try{artifact=JSON.parse(text(artifactText));}catch{return {valid:false,issues:['artifact_not_valid_json_object']};}
  if(!artifact||typeof artifact!=='object'||Array.isArray(artifact))
    return {valid:false,issues:['artifact_not_json_object']};

  const issues=[];
  const required=asArray(definition.required_fields).map(text).filter(Boolean);
  const fieldContract=asObject(definition.field_contract);
  for(const field of required){
    const value=artifact[field];
    if(value===undefined||value===null||value==='')
      issues.push('missing_required_field:'+field);
    const spec=fieldContract[field];
    if(typeof spec==='string'){
      const lower=spec.toLowerCase();
      if(lower.includes('nonempty string')&&text(value).length<1)
        issues.push('nonempty_string_required:'+field);
      if(lower.includes('nonempty array')&&(!Array.isArray(value)||!value.length))
        issues.push('nonempty_array_required:'+field);
      const minMatch=lower.match(/at least\s+(\d+)\s+characters/);
      if(minMatch&&text(value).length<Number(minMatch[1]))
        issues.push('minimum_length_'+minMatch[1]+':'+field);
    }else if(spec&&typeof spec==='object'){
      if(!value||typeof value!=='object'||Array.isArray(value)){
        issues.push('object_required:'+field);
        continue;
      }
      const nestedRequired=[...new Set([
        ...asArray(spec.required),
        ...asArray(spec.required_fields),
      ].map(text).filter(Boolean))];
      for(const sub of nestedRequired){
        const subValue=value[sub];
        if(subValue===undefined||subValue===null||subValue==='')
          issues.push('missing_required_field:'+field+'.'+sub);
        if(sub==='risks'&&(!Array.isArray(subValue)||!subValue.length))
          issues.push('nonempty_array_required:'+field+'.'+sub);
      }

      if(text(spec.required_source_stage)){
        const stages=asArray(value.source_stages).map(text).filter(Boolean);
        if(!stages.includes(text(spec.required_source_stage)))
          issues.push(
            'required_source_stage:'+field+'.'+text(spec.required_source_stage)
          );
      }

      const masteryDimensions=
        asArray(spec.entrepreneurship_mastery_application_required_dimensions)
          .map(text).filter(Boolean);
      if(masteryDimensions.length){
        const mastery=asObject(value.entrepreneurship_mastery_application);
        for(const dimension of masteryDimensions){
          const dimensionValue=mastery[dimension];
          if(
            dimensionValue===undefined
            ||dimensionValue===null
            ||(
              typeof dimensionValue==='string'
              &&text(dimensionValue).length<20
            )
          ) issues.push(
            'missing_required_field:'
            +field+'.entrepreneurship_mastery_application.'+dimension
          );
        }
      }

      if(field==='prior_learning_application'){
        if(asArray(value.competencies_applied).length<6)
          issues.push('prior_learning_application.competencies_applied:min_6_for_stage4');
        if(asArray(value.application_map).length<6)
          issues.push('prior_learning_application.application_map:min_6_for_stage4');
      }
    }
  }
  return {valid:issues.length===0,issues,artifact};
}

function resolveContext(packet,requests,localContext={}){
  const out={};
  const lifecycleContract=lifecycleStageContract(packet);
  for(const raw of asArray(requests).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND)){
    const path=text(raw);
    if(!path||Object.prototype.hasOwnProperty.call(out,path))continue;
    const localHit=getPath(localContext,path);
    let packetHit=localHit.found?localHit:getPath(packet,path);
    if(!packetHit.found&&lifecycleContract.name===path&&lifecycleContract.definition){
      packetHit={found:true,value:lifecycleContract.definition};
    }
    const hit=packetHit;
    if(!hit.found){
      out[path]={available:false};
      continue;
    }
    if(bytes(hit.value)>MAX_CONTEXT_VALUE_BYTES){
      let childIndex=[];
      if(Array.isArray(hit.value)){
        childIndex=hit.value.slice(0,80).map((v,i)=>({
          path:path+'.'+i,bytes:bytes(v),kind:Array.isArray(v)?'array':typeof v,
          ...(v&&typeof v==='object'&&v.source_id?{source_id:v.source_id,title:v.title||null,url:v.url||null}:{}),
        }));
      }else if(hit.value&&typeof hit.value==='object'){
        childIndex=Object.keys(hit.value).slice(0,120).map(k=>({
          path:path+'.'+k,bytes:bytes(hit.value[k]),kind:Array.isArray(hit.value[k])?'array':typeof hit.value[k]
        }));
      }
      out[path]={available:true,too_large:true,bytes:bytes(hit.value),children:childIndex};
      continue;
    }
    out[path]={available:true,value:hit.value};
  }
  return out;
}

function parentPathOf(nodePath){
  const i=String(nodePath||'').lastIndexOf('.');
  return i<0?null:String(nodePath).slice(0,i);
}

function resultParts(raw){
  if(!raw)return {artifact:'',handoff:{}};
  try{
    const parsed=JSON.parse(raw);
    return {
      artifact:artifactText(parsed.artifact)||artifactText(parsed.summary)||String(raw),
      handoff:asObject(parsed.handoff),
    };
  }catch{
    return {artifact:String(raw),handoff:{}};
  }
}

function compactCompletedSiblingResults(rows){
  return asArray(rows).slice(-6).map(row=>{
    const parts=resultParts(row?.result_artifact);
    return {
      path:row?.node_path||null,
      status:row?.node_status||row?.status||null,
      decision_type:row?.decision_type||null,
      requirement:clip(row?.requirement_text,700),
      artifact:clip(parts.artifact,3500),
      handoff_json:clip(safeJson(parts.handoff),1800),
      result_hash:row?.result_hash||null,
    };
  });
}
function authoritativeSiblingEvidence(contextPayload){
  const src=asObject(contextPayload);
  const merged=[
    ...asArray(src.inherited_completed_sibling_results).map(row=>({row,scope:'ancestor_dependency'})),
    ...asArray(src.completed_sibling_results).map(row=>({row,scope:'direct_sibling'})),
  ];
  const out=[];
  const byKey=new Map();
  for(const entry of merged){
    const row=asObject(entry.row);
    const key=text(row.path)||text(row.result_hash)||safeJson(row).slice(0,240);
    if(!key)continue;
    const normalized={
      path:row.path||null,
      status:row.status||null,
      decision_type:row.decision_type||null,
      requirement:clip(row.requirement,900),
      artifact:clip(row.artifact,5000),
      handoff_json:clip(row.handoff_json,2400),
      result_hash:row.result_hash||null,
      evidence_scope:entry.scope,
    };
    if(byKey.has(key)){
      out[byKey.get(key)]={...out[byKey.get(key)],...normalized};
      continue;
    }
    byKey.set(key,out.length);
    out.push(normalized);
  }
  if(out.length<=24)return out;
  const selected=[...out.slice(0,10),...out.slice(-14)];
  const bounded=[];
  const seen=new Set();
  for(const row of selected){
    const key=text(row.path)||text(row.result_hash)||safeJson(row).slice(0,240);
    if(!key||seen.has(key))continue;
    seen.add(key);
    bounded.push(row);
  }
  return bounded.slice(0,24);
}
function siblingEvidencePaths(rows){
  return asArray(rows)
    .filter(v=>text(v?.evidence_scope)!=='ancestor_dependency')
    .map(v=>text(v?.path))
    .filter(Boolean);
}
function compactRemediationEpisodes(rows){
  return asArray(rows).slice(-MAX_SELF_REMEDIATION_ATTEMPTS).map(raw=>{
    const row=asObject(raw);
    return {
      remediation_id:row.remediation_id||null,
      attempt_no:Number(row.attempt_no||0),
      status:row.status||null,
      observed_anomaly:clip(row.observed_anomaly,900),
      diagnosis:clip(row.diagnosis,1100),
      repair_type:row.repair_type||null,
      verification_criterion:clip(row.verification_criterion,900),
      verification_result:asObject(row.verification_result),
    };
  });
}
function remediationStateSnapshot(node,contextPayload,pinnedEvidence,siblingEvidence){
  const payload=asObject(node?.decision_payload);
  const discovery=asObject(payload.routing_discovery_checkpoint);
  return {
    node_status:node?.node_status||null,
    decision_type:node?.decision_type||null,
    requirement_hash:node?.requirement_hash||null,
    discovery:{
      decision:text(discovery.decision)||null,
      reason:clip(discovery.reason,1200)||null,
      context_fingerprint:text(discovery.context_fingerprint)||null,
      unresolved_gaps:asArray(discovery.unresolved_gaps).map(v=>clip(text(v),500)).slice(0,12),
    },
    context_resource_state:asObject(payload.context_resource_state),
    sibling_results:asArray(siblingEvidence).map(v=>({
      path:v.path||null,status:v.status||null,decision_type:v.decision_type||null,result_hash:v.result_hash||null
    })),
    pinned_evidence:asArray(pinnedEvidence).map(v=>({
      source_key:v.source_key||null,source_id:v.source_id||null,sha256:v.sha256||null,excerpt_bytes:v.excerpt_bytes||0
    })),
    context_evicted:asArray(contextPayload?._context_evicted).slice(0,16),
  };
}

function agentDiscoveryState(node){
  const payload=asObject(node?.decision_payload);
  return {
    authored_reason:text(payload.authored_reason)||null,
    scope_removed:text(payload.scope_removed)||null,
    completion_criterion:text(payload.completion_criterion)||null,
    prior_decision_reason:text(payload.reason)||null,
    source_kind:node?.source_kind||null,
    source_ref:node?.source_ref??null,
  };
}

export async function runAutonomousRequirementCognition({
  model,packet,modeInfo,agentId,intentExecutionId,
  rpc,sha256,completeJson,completeRouteJson=null,completeSerializeJson=null,researchContext=null,
}){
  const agentRuntimeContract=resolveModelRuntimeContract(model,'agent');
  const operationalOutputCeiling=Math.max(
    1,
    Math.min(
      Number(agentRuntimeContract.max_output_tokens)||8192,
      Number(agentRuntimeContract.operational_output_limit_tokens)
        ||Number(agentRuntimeContract.max_output_tokens)
        ||8192
    )
  );
  const stageOutputTokens=(requested)=>Math.max(
    1,
    Math.min(Math.floor(Number(requested)||1),operationalOutputCeiling)
  );
  const stageBudgets=Object.freeze({
    child_formulation:stageOutputTokens(CHILD_FORMULATION_DEEP_TOKENS),
    child_provenance_review:stageOutputTokens(CHILD_PROVENANCE_REVIEW_DEEP_TOKENS),
    atomic_execution:stageOutputTokens(ATOMIC_EXECUTION_DEEP_TOKENS),
    atomic_reconciliation:stageOutputTokens(ATOMIC_RECONCILIATION_DEEP_TOKENS),
    synthesis_merge:stageOutputTokens(SYNTHESIS_MERGE_DEEP_TOKENS),
    synthesis_final:stageOutputTokens(SYNTHESIS_FINAL_DEEP_TOKENS),
    synthesis_provenance_review:stageOutputTokens(SYNTHESIS_PROVENANCE_REVIEW_DEEP_TOKENS),
  });
  const rootReq=extractTriggerRequirement(packet);
  const assignmentKey='req:'+sha256({
    agent_id:agentId,
    source_kind:rootReq.source_kind,
    source_ref:rootReq.source_ref,
    requirement:rootReq.requirement,
  }).slice(0,48);
  const idx=contextIndex(packet);
  const counters={nodes:0,model_calls:0,context_requests:0};
  const semanticRuntime={...semanticRuntimeConfig(agentRuntimeContract)};

  async function semanticRuntimeRpc(action,args={}){
    return rpc('aau_bridge_cognition_assignment_runtime_v0_2',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_model:model,
      p_action:action,
      p_epoch_no:semanticRuntime.epoch_no,
      p_initial_budget_units:args.initialBudgetUnits??null,
      p_quantum_tokens:semanticRuntime.quantum_tokens,
      p_event_key:args.eventKey??null,
      p_event_kind:args.eventKind??null,
      p_event_fingerprint:args.eventFingerprint??null,
      p_cost_units:args.costUnits??0,
      p_node_path:args.nodePath??null,
      p_metadata:args.metadata??{},
    });
  }

  let semanticRuntimeSnapshot=await semanticRuntimeRpc('resolve');
  if(semanticRuntimeSnapshot?.status!=='ready')
    throw new Error('semantic_runtime_resolution_failed');
  if(semanticRuntimeSnapshot?.runtime_found===true){
    const resolvedEpoch=Number(semanticRuntimeSnapshot?.epoch_no);
    if(!Number.isInteger(resolvedEpoch)||resolvedEpoch<1)
      throw new Error('semantic_runtime_resolved_epoch_invalid');
    semanticRuntime.epoch_no=resolvedEpoch;
  }else{
    semanticRuntimeSnapshot=await semanticRuntimeRpc('init',{
      initialBudgetUnits:semanticRuntime.initial_budget_units,
      metadata:{
        contract:SEMANTIC_RUNTIME_CONTRACT,
        initial_budget_tokens:semanticRuntime.initial_budget_tokens,
        budget_quantum_tokens:semanticRuntime.quantum_tokens,
        budget_derivation:'model_operational_context_x8_or_explicit_override',
        model_operational_context_limit_tokens:
          agentRuntimeContract.operational_context_limit_tokens||null,
        source_wake_request_id:intentExecutionId,
      },
    });
    if(semanticRuntimeSnapshot?.status!=='ready')
      throw new Error('semantic_runtime_initialization_failed');
  }
  if(String(semanticRuntimeSnapshot?.runtime_status||'')==='budget_exhausted'){
    const error=new Error('semantic_runtime_terminal:budget_exhausted:'+assignmentKey);
    error.code='SEMANTIC_BUDGET_EXHAUSTED';
    error.semanticRuntime=semanticRuntimeSnapshot;
    throw error;
  }

  async function semanticRuntimeView(){
    const row=await semanticRuntimeRpc('get');
    if(row?.status!=='ready')throw new Error('semantic_runtime_state_unavailable');
    semanticRuntimeSnapshot=row;
    return row;
  }

  async function closeSemanticRuntime(status,metadata={}){
    const row=await semanticRuntimeRpc('close',{
      metadata:{status,...metadata},
    });
    if(row?.status!=='ready')throw new Error('semantic_runtime_close_failed');
    semanticRuntimeSnapshot=row;
    return row;
  }

  async function chargeSemanticRuntime({
    eventKind,materialKey,nodePath=null,costUnits,eventFingerprint=null,metadata={}
  }){
    const eventKey=eventKind+':'+sha256({
      assignment_key:assignmentKey,
      epoch_no:semanticRuntime.epoch_no,
      event_kind:eventKind,
      material_key:String(materialKey||''),
    }).slice(0,64);
    const fingerprint=eventFingerprint||sha256({
      assignment_key:assignmentKey,
      epoch_no:semanticRuntime.epoch_no,
      event_kind:eventKind,
      node_path:nodePath,
      material_key:String(materialKey||''),
      metadata,
    });
    const row=await semanticRuntimeRpc('charge',{
      eventKey,eventKind,eventFingerprint:fingerprint,
      costUnits:Math.max(1,Math.floor(Number(costUnits)||1)),
      nodePath,metadata,
    });
    if(row?.status!=='ready')throw new Error('semantic_runtime_charge_failed');
    semanticRuntimeSnapshot=row;
    if(row.available!==true){
      const error=new Error(
        'semantic_runtime_budget_exhausted:'
        +(nodePath||'assignment')
        +':remaining='+String(row.remaining_budget_units??0)
      );
      error.code='SEMANTIC_BUDGET_EXHAUSTED';
      error.semanticRuntime=row;
      error.semanticEvent={eventKind,materialKey,nodePath};
      throw error;
    }
    return row;
  }

  function agentModelContextView(rawPayload,pinnedEvidence,outputTokens){
    const safeInputTokens=modelInputBudgetTokens(agentRuntimeContract,outputTokens);
    const fixedReserveTokens=Math.max(2500,Math.min(16000,Math.floor(safeInputTokens*0.18)));
    const rawSibling=authoritativeSiblingEvidence(rawPayload);
    const siblingBudget=Math.max(700,Math.floor(safeInputTokens*0.12));
    const pinnedBudget=Math.max(700,Math.floor(safeInputTokens*0.22));
    const siblingEvidence=compactSiblingEvidenceForModel(
      rawSibling,siblingBudget,agentRuntimeContract
    );
    const pinned=compactPinnedEvidenceForModel(
      pinnedEvidence,pinnedBudget,agentRuntimeContract
    );
    const usedByEvidence=
      estimatedTokens(siblingEvidence,agentRuntimeContract)
      +estimatedTokens(pinned,agentRuntimeContract);
    const contextBudget=Math.max(
      1000,
      safeInputTokens-fixedReserveTokens-usedByEvidence
    );
    const bounded=boundContextForModel(
      withoutDuplicatedSiblingContext(rawPayload),
      contextBudget,
      agentRuntimeContract
    );
    const suppliedContext={
      ...bounded,
      ...(pinned.length?{pinned_research_evidence:pinned}:{}),
    };
    return {
      suppliedContext,
      siblingEvidence,
      safeInputTokens,
      fixedReserveTokens,
      contextBudget,
      estimatedSuppliedTokens:estimatedTokens(suppliedContext,agentRuntimeContract),
      estimatedSiblingTokens:estimatedTokens(siblingEvidence,agentRuntimeContract),
      estimatedPinnedTokens:estimatedTokens(pinned,agentRuntimeContract),
    };
  }

  function boundInMemoryContext(rawPayload,pinnedEvidence,outputTokens){
    const view=agentModelContextView(rawPayload,pinnedEvidence,outputTokens);
    return boundContextForModel(
      rawPayload,
      Math.max(1000,view.contextBudget+view.estimatedSiblingTokens),
      agentRuntimeContract
    );
  }

  function projectedModelCallEconomics(rawPayload,pinnedEvidence,outputTokens){
    const view=agentModelContextView(rawPayload,pinnedEvidence,outputTokens);
    const estimatedInputTokens=Math.max(
      1,
      Math.min(
        view.safeInputTokens,
        view.fixedReserveTokens
          +view.estimatedSuppliedTokens
          +view.estimatedSiblingTokens
      )
    );
    return Object.freeze({
      estimated_input_tokens:estimatedInputTokens,
      requested_output_tokens:outputTokens,
      cost_units:modelCallCostUnits({
        estimatedInputTokens,
        requestedOutputTokens:outputTokens,
        quantumTokens:semanticRuntime.quantum_tokens,
      }),
    });
  }

  function projectedBranchEconomics(rawPayload,pinnedEvidence){
    const childFormulation=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.child_formulation
    );
    const childProvenance=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.child_provenance_review
    );
    const childDiscovery=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,10000
    );
    const childResolution=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.atomic_execution
    );
    const terminalReconciliation=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.atomic_reconciliation
    );
    const terminalSynthesis=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.synthesis_final
    );
    const childSerializationUnits=modelCallCostUnits({
      estimatedInputTokens:2500,
      requestedOutputTokens:700,
      quantumTokens:semanticRuntime.quantum_tokens,
    });
    const budget=semanticBranchBudget({
      nodeCreateUnits:semanticRuntime.node_create_units,
      childFormulationUnits:childFormulation.cost_units,
      childProvenanceUnits:childProvenance.cost_units,
      childSerializationUnits,
      childDiscoveryUnits:childDiscovery.cost_units,
      childResolutionUnits:childResolution.cost_units,
      childTransitionUnits:3,
      terminalReconciliationUnits:terminalReconciliation.cost_units,
      terminalSynthesisUnits:terminalSynthesis.cost_units,
      safetyReserveUnits:semanticRuntime.safety_reserve_units,
    });
    return Object.freeze({
      ...budget,
      projected_calls:Object.freeze({
        child_formulation:childFormulation,
        child_provenance:childProvenance,
        child_discovery:childDiscovery,
        child_resolution:childResolution,
        terminal_reconciliation:terminalReconciliation,
        terminal_synthesis:terminalSynthesis,
        child_serialization:Object.freeze({
          estimated_input_tokens:2500,
          requested_output_tokens:700,
          cost_units:childSerializationUnits,
        }),
      }),
    });
  }

  function projectedEvidenceRoundEconomics(rawPayload,pinnedEvidence,branchEconomics){
    const discovery=projectedModelCallEconomics(rawPayload,pinnedEvidence,10000);
    const contextPlan=projectedModelCallEconomics(rawPayload,pinnedEvidence,2500);
    const routingSerializationUnits=modelCallCostUnits({
      estimatedInputTokens:2500,
      requestedOutputTokens:700,
      quantumTokens:semanticRuntime.quantum_tokens,
    });
    const projectedRoundUnits=
      semanticRuntime.context_acquire_units
      +discovery.cost_units
      +contextPlan.cost_units
      +routingSerializationUnits
      +3; // context transition + routing transition + checkpoint transition
    const completionReserveUnits=Math.max(
      semanticRuntime.safety_reserve_units,
      Number(branchEconomics?.completion_reserve_units||0)
    );
    return Object.freeze({
      contract:'autonomous_evidence_round_economics_v0_1',
      projected_round_units:projectedRoundUnits,
      completion_reserve_units:completionReserveUnits,
      discovery_units:discovery.cost_units,
      context_plan_units:contextPlan.cost_units,
      routing_serialization_units:routingSerializationUnits,
      context_acquisition_units:semanticRuntime.context_acquire_units,
      transition_units:3,
    });
  }

  async function loadExpertiseCandidateLedger(){
    const row=await rpc('aau_bridge_expertise_candidate_ledger_v0_1',{
      p_agent_id:agentId,
    });
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_candidate_ledger_lookup_failed');
    return row;
  }

  function expertiseCandidateLedgerContext(row){
    const ledger=asObject(row);
    if(text(ledger.candidate_mode)!=='four_viability_proposals_v0_1')return {};
    return {
      expertise_candidate_ledger:{
        available:true,
        source:'canonical_expertise_economic_proposals_current_cohort',
        value:{
          contract:text(ledger.contract)||'expertise_candidate_ledger_v0_1',
          candidate_mode:text(ledger.candidate_mode),
          candidate_cohort:Number(ledger.candidate_cohort||1),
          target_count:Number(ledger.target_count||4),
          submitted_count:Number(ledger.submitted_count||0),
          candidates:asArray(ledger.candidates).map(v=>({
            proposal_id:v?.proposal_id||null,
            domain:text(v?.domain)||null,
            status:text(v?.status)||null,
            candidate_ordinal:Number(v?.candidate_ordinal||0)||null,
            candidate_cohort:Number(v?.candidate_cohort||ledger.candidate_cohort||1),
            source_wake_request_id:v?.source_wake_request_id||null,
            created_at:v?.created_at||null,
          })),
        },
      },
    };
  }

  async function nodeRpc(action,args={}){
    const base={
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_node_path:args.nodePath||'R',
      p_model:model,
      p_action:action,
      p_parent_path:args.parentPath??null,
      p_ordinal:args.ordinal??0,
      p_requirement_text:args.requirement??null,
      p_source_kind:args.sourceKind??'requirement',
      p_source_ref:args.sourceRef??null,
      p_status:args.status??null,
      p_decision_type:args.decisionType??null,
      p_decision_payload:args.decisionPayload??{},
      p_result_artifact:args.resultArtifact??null,
    };
    const bridgeAndJsonReserve=8192;
    const nonContextBytes=bytes({p_bridge_token:'x'.repeat(256),...base,p_context_payload:{}});
    let contextAllowance=Math.max(
      MIN_NODE_CONTEXT_BYTES,
      Math.min(MAX_PERSISTED_CONTEXT_BYTES,MAX_NODE_RPC_BODY_BYTES-nonContextBytes-bridgeAndJsonReserve)
    );
    let boundedContext=boundContextPayload(args.contextPayload??{},contextAllowance);
    let envelope={...base,p_context_payload:boundedContext};
    let envelopeBytes=bytes({p_bridge_token:'x'.repeat(256),...envelope});
    if(envelopeBytes>MAX_NODE_RPC_BODY_BYTES){
      const excess=envelopeBytes-MAX_NODE_RPC_BODY_BYTES;
      contextAllowance=Math.max(
        MIN_NODE_CONTEXT_BYTES,
        contextAllowance-excess-bridgeAndJsonReserve
      );
      boundedContext=boundContextPayload(args.contextPayload??{},contextAllowance);
      envelope={...base,p_context_payload:boundedContext};
      envelopeBytes=bytes({p_bridge_token:'x'.repeat(256),...envelope});
    }
    if(envelopeBytes>MAX_NODE_RPC_BODY_BYTES){
      const error=new Error(
        'autonomous_decomposition_node_rpc_envelope_exceeded:'
        +(args.nodePath||'R')
        +':bytes='+envelopeBytes
        +':limit='+MAX_NODE_RPC_BODY_BYTES
      );
      error.code='COGNITION_NODE_RPC_ENVELOPE_EXCEEDED';
      error.envelopeBytes=envelopeBytes;
      error.maxEnvelopeBytes=MAX_NODE_RPC_BODY_BYTES;
      throw error;
    }
    if(bytes(asObject(args.contextPayload))>bytes(boundedContext)){
      console.log('AAU_AUTONOMOUS_NODE_CONTEXT_ENVELOPE_COMPACTED',JSON.stringify({
        node_path:args.nodePath||'R',
        action,
        original_context_bytes:bytes(asObject(args.contextPayload)),
        persisted_context_bytes:bytes(boundedContext),
        non_context_bytes:nonContextBytes,
        envelope_bytes:envelopeBytes,
        envelope_limit_bytes:MAX_NODE_RPC_BODY_BYTES,
      }));
    }
    return rpc('aau_bridge_cognition_requirement_node_v0_1',envelope);
  }

  async function saveNode(args){
    const transitionFingerprint=sha256({
      node_path:args.nodePath||'R',
      parent_path:args.parentPath??null,
      ordinal:args.ordinal??0,
      requirement:args.requirement??null,
      source_kind:args.sourceKind??'requirement',
      source_ref:args.sourceRef??null,
      status:args.status??null,
      decision_type:args.decisionType??null,
      decision_payload:args.decisionPayload??{},
      context_payload_hash:sha256(args.contextPayload??{}),
      result_artifact_hash:args.resultArtifact==null?null:sha256(String(args.resultArtifact)),
    });
    await chargeSemanticRuntime({
      eventKind:'semantic_transition',
      materialKey:(args.nodePath||'R')+':'+transitionFingerprint,
      nodePath:args.nodePath||'R',
      costUnits:1,
      eventFingerprint:transitionFingerprint,
      metadata:{
        status:args.status??null,
        decision_type:args.decisionType??null,
      },
    });
    const row=await nodeRpc('save',args);
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_checkpoint_save_failed:'+args.nodePath);
    return {
      ...row,
      parent_path:args.parentPath??null,
      source_kind:row.source_kind||args.sourceKind||'requirement',
      source_ref:row.source_ref??args.sourceRef??null,
    };
  }

  async function researchBatchRpc(action,nodePath,batchId=null){
    return rpc('aau_bridge_cognition_research_batches_v0_1',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_node_path:nodePath,
      p_action:action,
      p_batch_id:batchId,
    });
  }

  async function loadDurableResearchCatalog(nodePath){
    const row=await researchBatchRpc('list',nodePath,null);
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_research_batch_catalog_lookup_failed:'+nodePath);
    const merged=[];
    for(const batch of asArray(row.batches)){
      for(const source of asArray(batch?.sources)){
        const s=asObject(source);
        const identity=text(s.url)||text(s.sha256)||text(s.title);
        if(!identity)continue;
        merged.push({
          source_id:'src_'+sha256(identity).slice(0,12),
          query:s.query||null,
          title:s.title||null,
          url:s.url||null,
          published_at:s.published_at||null,
          coverage:s.coverage||null,
          fetch_status:s.fetch_status||null,
          sha256:s.sha256||null,
          audit_batch_id:batch.batch_id||null,
          receipt_persisted:true,
          full_text_persisted:false,
          full_receipt_persisted:true,
        });
      }
    }
    return mergeResearchSourceCatalog([],merged);
  }

  async function linkResearchBatch(nodePath,batchId){
    if(!batchId)return null;
    const row=await researchBatchRpc('link',nodePath,batchId);
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_research_batch_link_failed:'+nodePath);
    return row;
  }

  async function pinnedEvidenceRpc(action,nodePath,evidence=[]){
    return rpc('aau_bridge_cognition_pinned_research_v0_1',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_node_path:nodePath,
      p_model:model,
      p_action:action,
      p_evidence:Array.isArray(evidence)?evidence:[],
    });
  }

  async function loadPinnedEvidence(nodePath){
    const row=await pinnedEvidenceRpc('list',nodePath,[]);
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_pinned_evidence_lookup_failed:'+nodePath);
    return compactPinnedEvidence(row.evidence);
  }

  async function persistExplicitResearchEvidence(nodePath,researchUrls,researchObserved){
    if(!researchObserved)
      return {save:{status:'ready',inserted:0,extended:0,unchanged:0,restored_or_extended:0},evidence:await loadPinnedEvidence(nodePath)};

    const requestedUrlKeys=new Set(asArray(researchUrls).map(normalizedUrl).filter(Boolean));
    const fetchedSources=asArray(researchObserved.sources)
      .filter(source=>
        source?.fetch_status==='fetched_text'
        && typeof source?.excerpt==='string'
        && source.excerpt.length
        && /^https:\/\//i.test(text(source?.url))
      );

    // Explicit catalog/URL retrievals get first priority. Broad query research also
    // retains a bounded, query-diverse evidence set so durable source catalogs never
    // outlive the excerpts needed to interpret them after a restart.
    const selected=[];
    const selectedUrls=new Set();
    const addSource=(source)=>{
      const key=normalizedUrl(source?.url);
      if(!key||selectedUrls.has(key)||selected.length>=16)return false;
      selectedUrls.add(key);
      selected.push(source);
      return true;
    };

    for(const source of fetchedSources){
      if(requestedUrlKeys.has(normalizedUrl(source?.url)))addSource(source);
    }

    const perQuery=new Map();
    for(const source of fetchedSources){
      if(selected.length>=16)break;
      const query=text(source?.query)||'__unscoped__';
      const used=Number(perQuery.get(query)||0);
      if(used>=2)continue;
      if(addSource(source))perQuery.set(query,used+1);
    }
    for(const source of fetchedSources){
      if(selected.length>=16)break;
      addSource(source);
    }

    const pinCandidates=selected.map(source=>({
      source_key:source.source_id||source.url||source.sha256,
      source_id:source.source_id||null,
      url:source.url||null,
      title:source.title||null,
      publisher:source.publisher||null,
      sha256:source.sha256||null,
      fetch_status:source.fetch_status||null,
      coverage:source.coverage||null,
      excerpt:clip(source.excerpt,MAX_PINNED_EVIDENCE_EXCERPT_CHARS),
      audit_batch_id:researchObserved.audit_batch_id||null,
    }));
    if(!pinCandidates.length)
      return {save:{status:'ready',inserted:0,extended:0,unchanged:0,restored_or_extended:0},evidence:await loadPinnedEvidence(nodePath)};

    const save=await pinnedEvidenceRpc('save',nodePath,pinCandidates);
    if(save?.status!=='ready')
      throw new Error('autonomous_decomposition_pinned_evidence_save_failed:'+nodePath);
    const evidence=await loadPinnedEvidence(nodePath);
    console.log('AAU_AUTONOMOUS_PINNED_EVIDENCE',JSON.stringify({
      node_path:nodePath,
      requested_url_count:asArray(researchUrls).length,
      fetched_source_count:fetchedSources.length,
      durable_candidate_count:pinCandidates.length,
      inserted:Number(save.inserted||0),
      extended:Number(save.extended||0),
      unchanged:Number(save.unchanged||0),
      restored_or_extended:Number(save.restored_or_extended||0),
      pinned_items:evidence.length,
      persistence_policy:'explicit_urls_plus_query_diverse_v0_2',
    }));
    return {save,evidence};
  }

  async function getNode(nodePath){
    return nodeRpc('get',{nodePath});
  }

  async function children(nodePath){
    const row=await nodeRpc('children',{nodePath});
    return asArray(row?.children);
  }

  async function remediationRpc(action,nodePath,episode={}){
    return rpc('aau_bridge_cognition_remediation_v0_1',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_node_path:nodePath,
      p_model:model,
      p_action:action,
      p_episode:asObject(episode),
    });
  }

  async function loadRemediationEpisodes(nodePath){
    const row=await remediationRpc('list',nodePath,{});
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_remediation_lookup_failed:'+nodePath);
    return asArray(row.episodes);
  }

  async function cognitionStepRpc(action,stepKey,artifact=null,meta={}){
    return rpc('aau_bridge_cognition_step_checkpoint',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_step_key:stepKey,
      p_model:model,
      p_action:action,
      p_artifact:artifact,
      p_meta:asObject(meta),
    });
  }

  const DURABLE_CONTINUATION_CONTRACT='universal_durable_cognition_continuation_v0_1';

  function phaseCheckpointStepKey(nodePath,phase,semanticIdentity){
    return 'phase:'+sha256({
      contract:DURABLE_CONTINUATION_CONTRACT,
      node_path:nodePath,
      phase,
      semantic_identity:semanticIdentity,
      model,
    }).slice(0,56);
  }

  async function loadJsonPhaseCheckpoint(nodePath,phase,semanticIdentity){
    const stepKey=phaseCheckpointStepKey(nodePath,phase,semanticIdentity);
    const row=await cognitionStepRpc('get',stepKey,null,{});
    if(row?.status==='not_found')return {stepKey,row:null,parsed:null};
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_phase_checkpoint_lookup_failed:'+nodePath+':'+phase);
    let parsed=null;
    try{parsed=JSON.parse(String(row.artifact||''));}
    catch{
      throw new Error('autonomous_decomposition_phase_checkpoint_malformed:'+nodePath+':'+phase);
    }
    console.log('AAU_COGNITION_PHASE_CHECKPOINT_REUSED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:nodePath,
      phase,
      step_key:stepKey,
      checkpoint_id:row.step_checkpoint_id||null,
      contract:DURABLE_CONTINUATION_CONTRACT,
    }));
    return {stepKey,row,parsed:asObject(parsed)};
  }

  async function saveJsonPhaseCheckpoint(nodePath,phase,semanticIdentity,parsed,meta={}){
    const stepKey=phaseCheckpointStepKey(nodePath,phase,semanticIdentity);
    const artifact=JSON.stringify(asObject(parsed));
    const row=await cognitionStepRpc('save',stepKey,artifact,{
      contract:DURABLE_CONTINUATION_CONTRACT,
      node_path:nodePath,
      phase,
      semantic_identity:semanticIdentity,
      immutable_completed_phase:true,
      ...asObject(meta),
    });
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_phase_checkpoint_save_failed:'+nodePath+':'+phase);
    console.log('AAU_COGNITION_PHASE_CHECKPOINT_SAVED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:nodePath,
      phase,
      step_key:stepKey,
      checkpoint_id:row.step_checkpoint_id||null,
      contract:DURABLE_CONTINUATION_CONTRACT,
    }));
    return row;
  }

  function childProposalSiblingSignature(previous=[]){
    return sha256(asArray(previous).map(v=>({
      node_path:text(v?.node_path)||null,
      ordinal:Number(v?.ordinal||0),
      status:text(v?.status)||null,
      requirement:text(v?.requirement),
      scope_removed:text(v?.scope_removed)||null,
      completion_criterion:text(v?.completion_criterion)||null,
    })));
  }

  function childProposalStepKey(node,ordinal,previous=[]){
    const discovery=asObject(node?.decision_payload?.routing_discovery_checkpoint);
    return 'childprop:'+sha256({
      contract:'agent_authored_child_proposal_v0_3_remaining_scope',
      node_path:node.node_path,
      ordinal,
      requirement_hash:node.requirement_hash||sha256(node.requirement_text||''),
      discovery_fingerprint:text(discovery.context_fingerprint)||null,
      discovery_decision:text(discovery.decision)||null,
      prior_children_signature:childProposalSiblingSignature(previous),
    }).slice(0,56);
  }

  async function loadChildProposalCheckpoint(node,ordinal,previous=[]){
    const row=await cognitionStepRpc('get',childProposalStepKey(node,ordinal,previous),null,{});
    if(row?.status==='not_found')return null;
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_child_proposal_checkpoint_lookup_failed:'+node.node_path);
    let proposal=null;
    try{proposal=JSON.parse(String(row.artifact||''));}
    catch{throw new Error('autonomous_decomposition_child_proposal_checkpoint_malformed:'+node.node_path);}
    return {row,proposal:asObject(proposal)};
  }

  async function saveChildProposalCheckpoint(node,ordinal,proposal,previous=[]){
    const artifact=JSON.stringify(proposal);
    const row=await cognitionStepRpc('save',childProposalStepKey(node,ordinal,previous),artifact,{
      contract:'agent_authored_child_proposal_v0_3_remaining_scope',
      node_path:node.node_path,
      ordinal,
      discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
      prior_children_signature:childProposalSiblingSignature(previous),
      authored_by_bound_agent:true,
      deep_formulation:true,
      serialization_pending:true,
    });
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_child_proposal_checkpoint_save_failed:'+node.node_path);
    return row;
  }

  async function refreshedSiblingContext(node){
    const parentPath=node.parent_path??parentPathOf(node.node_path);
    if(!parentPath){
      return {
        contextPayload:asObject(node.context_payload),
        siblingEvidence:authoritativeSiblingEvidence(node.context_payload),
        refreshed:false,
      };
    }
    const siblings=(await children(parentPath))
      .filter(row=>row?.node_path!==node.node_path)
      .filter(row=>['completed','blocked'].includes(String(row?.status||row?.node_status||'')));
    const compact=compactCompletedSiblingResults(siblings);
    const contextPayload=boundContextPayload({
      ...(node.context_payload||{}),
      ...(compact.length?{completed_sibling_results:compact}:{}),
    });
    return {
      contextPayload,
      siblingEvidence:authoritativeSiblingEvidence(contextPayload),
      refreshed:true,
    };
  }

  function cleanedRemediationDecisionPayload(payload){
    const next={...asObject(payload)};
    for(const key of [
      'reason','requirement_interpretation','evidence_assessment','unresolved_gaps',
      'context_requests','research_queries','research_urls','routing_discovery_checkpoint',
      'routing_discovery_checkpointed','routing_discovery_checkpointed_at',
      'routing_discovery_reused','routing_commit_serialized',
      'blocked_by_bound_agent','block_reason','context_resource_at_block'
    ]) delete next[key];
    next.reconsider_decomposition=true;
    return next;
  }

  async function applyRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence}){
    const repairType=text(episode.repair_type).toUpperCase();
    if(!SELF_REMEDIATION_REPAIR_TYPES.includes(repairType))
      throw new Error('autonomous_decomposition_remediation_repair_not_allowed:'+node.node_path);

    let nextContext=asObject(contextPayload);
    let nextSiblingEvidence=asArray(siblingEvidence);
    if(repairType==='REFRESH_SIBLING_EVIDENCE'){
      const refreshed=await refreshedSiblingContext(node);
      nextContext=refreshed.contextPayload;
      nextSiblingEvidence=refreshed.siblingEvidence;
    }

    const nextPayload=cleanedRemediationDecisionPayload(node.decision_payload);
    nextPayload.self_remediation_in_progress={
      remediation_id:episode.remediation_id,
      attempt_no:Number(episode.attempt_no||0),
      repair_type:repairType,
      requested_by_bound_agent:true,
    };

    node=await saveNode({
      nodePath:node.node_path,
      parentPath:node.parent_path??parentPathOf(node.node_path),
      ordinal:node.ordinal||0,
      requirement:node.requirement_text,
      sourceKind:node.source_kind,
      sourceRef:node.source_ref,
      status:'pending',
      decisionType:'REMEDIATE',
      decisionPayload:nextPayload,
      contextPayload:nextContext,
      resultArtifact:node.result_artifact||null,
    });
    node.parent_path=node.parent_path??parentPathOf(node.node_path);

    const postState=remediationStateSnapshot(node,nextContext,pinnedEvidence,nextSiblingEvidence);
    await remediationRpc('update',node.node_path,{
      remediation_id:episode.remediation_id,
      status:'applied',
      post_state:postState,
    });

    return {node,contextPayload:nextContext,siblingEvidence:nextSiblingEvidence,postState};
  }

  async function verifyRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence,postState=null}){
    const effectivePostState=postState||remediationStateSnapshot(node,contextPayload,pinnedEvidence,siblingEvidence);
    await remediationRpc('update',node.node_path,{
      remediation_id:episode.remediation_id,
      status:'verifying',
      post_state:effectivePostState,
    });

    let verification=null;
    for(let attempt=1;attempt<=2;attempt++){
      try{
        const verificationResponse=await callJson([
          {role:'system',content:[
            'You are the bound autonomous agent verifying YOUR OWN cognitive self-remediation.',
            'You previously detected an anomaly, diagnosed it, chose a bounded repair, and stated a verification criterion.',
            'The runtime only applied the requested mechanical repair. It does not decide whether your diagnosis was correct or whether the repair worked.',
            'Compare the before state, after state, current durable evidence, and YOUR verification criterion.',
            'Return VERIFIED only if the criterion is actually satisfied. Otherwise return FAILED and identify what remains wrong.',
            'Return JSON only: {"status":"VERIFIED|FAILED","reason":"auditable verification","observed_after":"what changed or did not change","remaining_problem":"empty when verified"}.',
          ].join('\n')},
          {role:'user',content:safeJson({
            requirement:node.requirement_text,
            remediation_plan:{
              observed_anomaly:episode.observed_anomaly,
              prior_belief:episode.prior_belief,
              contradicting_evidence:asArray(episode.contradicting_evidence),
              diagnosis:episode.diagnosis,
              repair_type:episode.repair_type,
              repair_payload:asObject(episode.repair_payload),
              verification_criterion:episode.verification_criterion,
            },
            pre_state:asObject(episode.pre_state),
            post_state:effectivePostState,
            authoritative_completed_sibling_evidence:agentModelContextView(
              contextPayload,pinnedEvidence,2200
            ).siblingEvidence,
            pinned_research_evidence:compactPinnedEvidenceForModel(
              pinnedEvidence,
              Math.max(700,Math.floor(modelInputBudgetTokens(agentRuntimeContract,2200)*0.22)),
              agentRuntimeContract
            ),
            supplied_context:agentModelContextView(
              contextPayload,pinnedEvidence,2200
            ).suppliedContext,
          })},
        ],2200,'req_'+node.node_path.replaceAll('.','_')+'_self_remediation_verify_'+episode.attempt_no+'_'+attempt);

        const candidate=asObject(verificationResponse?.parsed);
        const status=text(candidate.status).toUpperCase();
        if(!['VERIFIED','FAILED'].includes(status)){
          if(attempt===2){
            verification={
              status:'FAILED',
              reason:'Self-remediation verification did not produce a valid VERIFIED or FAILED judgment.',
              observed_after:'',
              remaining_problem:'verification_output_invalid',
              agent_authored:false,
            };
            break;
          }
          continue;
        }
        verification={
          status,
          reason:clip(candidate.reason,2400),
          observed_after:clip(candidate.observed_after,2400),
          remaining_problem:clip(candidate.remaining_problem,2400),
          agent_authored:true,
        };
        break;
      }catch(error){
        const recoverable=error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT';
        if(!recoverable)throw error;
        if(attempt===2){
          verification={
            status:'FAILED',
            reason:'Self-remediation verification could not complete after bounded retry.',
            observed_after:'',
            remaining_problem:String(error?.rejectionReason||error?.code||'verification_incomplete'),
            agent_authored:false,
          };
          break;
        }
      }
    }

    if(!verification)throw new Error('autonomous_decomposition_remediation_verification_missing:'+node.node_path);

    await remediationRpc('update',node.node_path,{
      remediation_id:episode.remediation_id,
      status:verification.status==='VERIFIED'?'succeeded':'failed',
      post_state:effectivePostState,
      verification_result:verification,
    });

    const finalPayload=cleanedRemediationDecisionPayload(node.decision_payload);
    delete finalPayload.self_remediation_in_progress;
    finalPayload.last_self_remediation={
      remediation_id:episode.remediation_id,
      attempt_no:Number(episode.attempt_no||0),
      repair_type:episode.repair_type,
      status:verification.status,
      reason:clip(verification.reason,1600),
      verification_agent_authored:Boolean(verification.agent_authored),
      verified_by_bound_agent:verification.status==='VERIFIED'&&Boolean(verification.agent_authored),
    };
    finalPayload.self_remediation_attempts_used=Number(episode.attempt_no||0);
    finalPayload.reconsider_decomposition=true;

    node=await saveNode({
      nodePath:node.node_path,
      parentPath:node.parent_path??parentPathOf(node.node_path),
      ordinal:node.ordinal||0,
      requirement:node.requirement_text,
      sourceKind:node.source_kind,
      sourceRef:node.source_ref,
      status:'pending',
      decisionType:null,
      decisionPayload:finalPayload,
      contextPayload,
      resultArtifact:node.result_artifact||null,
    });
    node.parent_path=node.parent_path??parentPathOf(node.node_path);

    console.log('AAU_AUTONOMOUS_SELF_REMEDIATION',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      remediation_id:episode.remediation_id,
      attempt_no:Number(episode.attempt_no||0),
      repair_type:episode.repair_type,
      verification_status:verification.status,
    }));

    return {
      node,
      verified:verification.status==='VERIFIED',
      verification_status:verification.status,
      contextPayload,
      siblingEvidence,
    };
  }

  async function resumeSelfRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence}){
    let applied={node,contextPayload,siblingEvidence,postState:asObject(episode.post_state)};
    if(episode.status==='proposed'){
      applied=await applyRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence});
    }else if(!['applied','verifying'].includes(String(episode.status||''))){
      throw new Error('autonomous_decomposition_remediation_resume_status_invalid:'+node.node_path);
    }
    return verifyRemediationEpisode(applied.node,episode,{
      contextPayload:applied.contextPayload,
      pinnedEvidence,
      siblingEvidence:applied.siblingEvidence,
      postState:Object.keys(asObject(applied.postState)).length?applied.postState:null,
    });
  }

  async function executeSelfRemediation(node,discovery,{contextPayload,pinnedEvidence,siblingEvidence}){
    const history=await loadRemediationEpisodes(node.node_path);
    const attemptNo=history.length+1;
    if(attemptNo>MAX_SELF_REMEDIATION_ATTEMPTS)
      throw new Error('autonomous_decomposition_remediation_attempt_limit:'+node.node_path);

    const plan=asObject(discovery.remediation);
    const repairType=text(plan.repair_type).toUpperCase();
    if(!SELF_REMEDIATION_REPAIR_TYPES.includes(repairType))
      throw new Error('autonomous_decomposition_remediation_repair_not_allowed:'+node.node_path);
    if(text(plan.observed_anomaly).length<8
       || text(plan.prior_belief).length<3
       || text(plan.diagnosis).length<8
       || text(plan.verification_criterion).length<8)
      throw new Error('autonomous_decomposition_remediation_reasoning_incomplete:'+node.node_path);

    const runtimePreState=remediationStateSnapshot(node,contextPayload,pinnedEvidence,siblingEvidence);
    const preState={
      ...runtimePreState,
      agent_prior_cognitive_state:asObject(discovery.remediation_prior_state),
    };
    const created=await remediationRpc('create',node.node_path,{
      attempt_no:attemptNo,
      observed_anomaly:clip(plan.observed_anomaly,2400),
      prior_belief:clip(plan.prior_belief,2400),
      contradicting_evidence:asArray(plan.contradicting_evidence).slice(0,16),
      diagnosis:clip(plan.diagnosis,3000),
      repair_type:repairType,
      repair_payload:asObject(plan.repair_payload),
      verification_criterion:clip(plan.verification_criterion,2400),
      pre_state:preState,
    });
    if(created?.status!=='ready'||!created.remediation_id)
      throw new Error('autonomous_decomposition_remediation_create_failed:'+node.node_path);

    const episodes=await loadRemediationEpisodes(node.node_path);
    const episode=episodes.find(v=>v.remediation_id===created.remediation_id)
      || {
        remediation_id:created.remediation_id,
        attempt_no:attemptNo,
        status:'proposed',
        observed_anomaly:plan.observed_anomaly,
        prior_belief:plan.prior_belief,
        contradicting_evidence:asArray(plan.contradicting_evidence),
        diagnosis:plan.diagnosis,
        repair_type:repairType,
        repair_payload:asObject(plan.repair_payload),
        verification_criterion:plan.verification_criterion,
        pre_state:preState,
      };

    return resumeSelfRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence});
  }

  async function reserveModelCall(messages,maxTokens,phase,kind,attempt=1){
    const estimatedInput=estimatedTokens(messages,agentRuntimeContract);
    const fingerprint=sha256({kind,messages,max_tokens:maxTokens,model});
    const reservedUnits=modelCallCostUnits({
      estimatedInputTokens:estimatedInput,
      requestedOutputTokens:maxTokens,
      quantumTokens:semanticRuntime.quantum_tokens,
    });
    const eventKey='modelreserve:'+sha256({
      assignment_key:assignmentKey,epoch_no:semanticRuntime.epoch_no,
      phase,attempt,fingerprint,
    }).slice(0,64);
    const row=await rpc('aau_bridge_reserve_semantic_model_call_v0_1',{
      p_agent_id:agentId,p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,p_model:model,p_epoch_no:semanticRuntime.epoch_no,
      p_event_key:eventKey,p_event_fingerprint:fingerprint,p_reserved_units:reservedUnits,
      p_metadata:{phase,kind,transport_attempt:attempt,estimated_input_tokens:estimatedInput,requested_output_tokens:maxTokens},
    });
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_model_call_reservation_failed:'+phase);
    semanticRuntimeSnapshot=row;
    if(row.available!==true){
      const error=new Error('semantic_runtime_budget_exhausted:model_call:'+phase+':remaining='+String(row.remaining_budget_units??0));
      error.code='SEMANTIC_BUDGET_EXHAUSTED'; error.semanticRuntime=row;
      error.semanticEvent={eventKind:'model_call_reservation',materialKey:eventKey,nodePath:null};
      throw error;
    }
    return {reservationEventId:row.reservation_event_id,reservedUnits:Number(row.reserved_units||reservedUnits),estimatedInput,phase,kind,attempt};
  }

  function providerUsageSettlement(response,error,reservation){
    const usage=response?.result?.usage||response?.usage||error?.providerUsage||error?.usage||null;
    const explicitTotal=Number(usage?.total_tokens ?? error?.providerTotalTokens);
    const hasReportedTotal=Number.isFinite(explicitTotal)&&explicitTotal>=0;
    const providerStatus=response?200:(Number.isFinite(Number(error?.providerStatusCode))?Math.floor(Number(error.providerStatusCode)):(Number.isFinite(Number(error?.status))?Math.floor(Number(error.status)):null));
    if(hasReportedTotal){
      const actualUnits=explicitTotal>0?Math.max(1,Math.ceil(explicitTotal/semanticRuntime.quantum_tokens)):(providerStatus===200?1:0);
      return {settledUnits:Math.min(reservation.reservedUnits,actualUnits),providerStatus,providerTotalTokens:Math.floor(explicitTotal),reason:providerStatus===200?'provider_completed_actual_usage':'provider_error_reported_usage',settlementCapped:actualUnits>reservation.reservedUnits};
    }
    if(providerStatus!==null&&providerStatus>=400)
      return {settledUnits:0,providerStatus,providerTotalTokens:null,reason:'provider_http_error_no_reported_usage',settlementCapped:false};
    return {settledUnits:reservation.reservedUnits,providerStatus,providerTotalTokens:null,reason:'provider_usage_unknown_conservative_settlement',settlementCapped:false};
  }

  async function settleModelCall(reservation,{response=null,error=null}={}){
    const settlement=providerUsageSettlement(response,error,reservation);
    const row=await rpc('aau_bridge_settle_semantic_model_call_v0_1',{
      p_agent_id:agentId,p_assignment_key:assignmentKey,p_model:model,p_epoch_no:semanticRuntime.epoch_no,
      p_reservation_event_id:reservation.reservationEventId,p_settled_units:settlement.settledUnits,
      p_settlement_reason:settlement.reason,p_provider_status_code:settlement.providerStatus,
      p_provider_total_tokens:settlement.providerTotalTokens,
      p_metadata:{phase:reservation.phase,kind:reservation.kind,transport_attempt:reservation.attempt,estimated_input_tokens:reservation.estimatedInput,reserved_units:reservation.reservedUnits,settlement_capped_to_reservation:settlement.settlementCapped,error_code:error?String(error?.code||error?.cause?.code||'').slice(0,120):null,error_message:error?String(error?.message||error).slice(0,500):null},
    });
    if(row?.status!=='ready'){
      const e=new Error('autonomous_decomposition_model_call_settlement_failed:'+reservation.phase);
      e.code='COGNITION_RUNTIME_ACCOUNTING_FAULT'; throw e;
    }
    semanticRuntimeSnapshot=row;
    console.log('AAU_MODEL_CALL_SEMANTIC_SETTLEMENT',JSON.stringify({agent_id:agentId,intent_execution_id:intentExecutionId,phase:reservation.phase,reserved_units:reservation.reservedUnits,settled_units:Number(row.settled_units??settlement.settledUnits),refund_units:Number(row.refund_units||0),settlement_reason:settlement.reason,provider_status_code:settlement.providerStatus,provider_total_tokens:settlement.providerTotalTokens,idempotent:Boolean(row.idempotent)}));
    return row;
  }

  async function callWithChargedTransportRetry(fn,messages,maxTokens,phase,kind){
    let lastError=null;
    for(let attempt=1;attempt<=MAX_MODEL_TRANSPORT_ATTEMPTS;attempt++){
      const attemptPhase=attempt===1?phase:phase+'_transport_retry_'+attempt;
      const reservation=await reserveModelCall(messages,maxTokens,attemptPhase,kind,attempt);
      counters.model_calls++;
      try{
        const response=await fn(messages,maxTokens,attemptPhase);
        await settleModelCall(reservation,{response});
        return response;
      }catch(error){
        lastError=error;
        await settleModelCall(reservation,{error});
        if(!retryableModelTransportError(error)||attempt>=MAX_MODEL_TRANSPORT_ATTEMPTS)throw error;
        console.warn('AAU_MODEL_TRANSPORT_LOCAL_RETRY',JSON.stringify({agent_id:agentId,intent_execution_id:intentExecutionId,assignment_key:assignmentKey,phase,failed_attempt:attempt,next_attempt:attempt+1,error_name:String(error?.name||'Error'),error_code:String(error?.code||error?.cause?.code||''),error_message:String(error?.message||error).slice(0,300)}));
      }
    }
    throw lastError||new Error('model_transport_retry_exhausted');
  }

  async function callJson(messages,maxTokens,phase){
    return callWithChargedTransportRetry(completeJson,messages,maxTokens,phase,'deep_json');
  }

  async function callRoute(messages,maxTokens,phase){
    const fn=typeof completeRouteJson==='function'?completeRouteJson:completeJson;
    return callWithChargedTransportRetry(fn,messages,maxTokens,phase,'route_json');
  }

  async function callSerialize(messages,maxTokens,phase){
    const fn=typeof completeSerializeJson==='function'?completeSerializeJson
      :(typeof completeRouteJson==='function'?completeRouteJson:completeJson);
    return callWithChargedTransportRetry(fn,messages,maxTokens,phase,'serialize_json');
  }

  async function decide(node,{forceReconsider=false,branchDepth=0,singleChildRefinements=0}={}){
    const canonicalCandidateLedger=await loadExpertiseCandidateLedger();
    let contextPayload={
      ...asObject(node.context_payload),
      ...lifecycleStageContractContext(packet),
      ...expertiseCandidateLedgerContext(canonicalCandidateLedger),
    };
    let pinnedEvidence=await loadPinnedEvidence(node.node_path);
    const durableResearchCatalog=await loadDurableResearchCatalog(node.node_path);
    if(durableResearchCatalog.length){
      contextPayload={
        ...contextPayload,
        research_source_catalog:mergeResearchSourceCatalog(
          contextPayload.research_source_catalog,
          durableResearchCatalog
        ),
      };
    }
    contextPayload=boundInMemoryContext(contextPayload,pinnedEvidence,10000);
    const atomicExecutionFailures=Math.max(0,Number(node?.decision_payload?.atomic_execution_failures||0));
    const atomicUnavailable=atomicExecutionFailures>=MAX_ATOMIC_EXECUTION_FAILURES;
    const priorAtomicRejection=text(node?.decision_payload?.prior_atomic_rejection).toUpperCase();
    const atomicOverflowRecovery=
      atomicUnavailable && priorAtomicRejection==='TRUNCATED_RESPONSE';
    const normalizedBranchDepth=pathDepth(node.node_path);
    const storageDepthAvailable=Number.isFinite(normalizedBranchDepth)
      &&normalizedBranchDepth<semanticRuntime.hard_storage_path_depth;

    let contextState=asObject(node?.decision_payload?.context_resource_state);
    if(!['agent_visible_context_resource_v0_2','agent_visible_context_resource_v0_3_autonomous_evidence_windows'].includes(contextState.version)){
      const legacyRounds=Math.max(
        0,
        Number(contextState.context_rounds_attempted||0),
        Number(node?.decision_payload?.context_round??-1)+1,
        Object.keys(contextPayload).filter(key=>/^external_research_round_\d+$/.test(key)).length
      );
      const priorState=contextState;
      contextState={
        ...priorState,
        version:'agent_visible_context_resource_v0_2',
        started_at:text(priorState.started_at)||new Date().toISOString(),
        active_context_elapsed_ms:Math.max(0,Number(priorState.active_context_elapsed_ms||0)),
        elapsed_accounting:'active_context_acquisition_only_v0_2',
        elapsed_accounting_migrated_at:new Date().toISOString(),
        context_rounds_attempted:legacyRounds,
        research_rounds_attempted:Math.max(0,Number(priorState.research_rounds_attempted??legacyRounds)),
        local_context_rounds_attempted:Math.max(0,Number(priorState.local_context_rounds_attempted||0)),
        stagnant_rounds:Math.max(0,Number(priorState.stagnant_rounds||0)),
        unchanged_gap_rounds:Math.max(0,Number(priorState.unchanged_gap_rounds||0)),
        repeated_request_rounds:Math.max(0,Number(priorState.repeated_request_rounds||0)),
        total_new_sources:Math.max(0,Number(priorState.total_new_sources||0)),
        total_new_local_context_paths:Math.max(0,Number(priorState.total_new_local_context_paths||0)),
        total_restored_pinned_evidence:Math.max(0,Number(priorState.total_restored_pinned_evidence||0)),
        last_gap_signal:priorState.last_gap_signal||null,
        last_request_signal:priorState.last_request_signal||null,
      };
    }

    while(true){
      contextPayload=boundInMemoryContext(contextPayload,pinnedEvidence,10000);
      const discoveryContextView=agentModelContextView(contextPayload,pinnedEvidence,10000);
      const siblingEvidence=discoveryContextView.siblingEvidence;
      const cognitionContext=discoveryContextView.suppliedContext;
      const runtimeView=await semanticRuntimeView();
      const branchEconomics=projectedBranchEconomics(contextPayload,pinnedEvidence);
      const availableChildCapacity=semanticChildCapacity({
        remainingBudgetUnits:Number(runtimeView?.remaining_budget_units||0),
        nodeCreateUnits:semanticRuntime.node_create_units,
        safetyReserveUnits:semanticRuntime.safety_reserve_units,
        expectedChildLifecycleUnits:branchEconomics.expected_child_lifecycle_units,
        completionReserveUnits:branchEconomics.completion_reserve_units,
        maxChildren:MAX_CHILDREN_PER_NODE,
      });
      const splitAvailable=storageDepthAvailable&&availableChildCapacity>=1;
      const structuralBranchingAvailable=splitAvailable&&availableChildCapacity>=2;
      const singleRefinementAvailable=splitAvailable;
      const resourceView=contextResourceView(contextState,contextPayload);
      const remediationEpisodes=await loadRemediationEpisodes(node.node_path);
      const remediationAttemptsUsed=remediationEpisodes.length;
      const activeRemediation=[...remediationEpisodes].reverse()
        .find(v=>['proposed','applied','verifying'].includes(String(v?.status||'')));
      if(activeRemediation){
        const resumed=await resumeSelfRemediationEpisode(node,activeRemediation,{
          contextPayload,
          pinnedEvidence,
          siblingEvidence,
        });
        node=resumed.node;
        contextPayload=resumed.contextPayload;
        continue;
      }
      const priorCognitiveState=asObject(node?.decision_payload?.routing_discovery_checkpoint);
      const lastRemediation=asObject(node?.decision_payload?.last_self_remediation);
      const remediationAvailable=
        remediationAttemptsUsed<MAX_SELF_REMEDIATION_ATTEMPTS
        && (
          priorCognitiveState.version==='agent_deep_discovery_v0_1'
          || text(lastRemediation.status).toUpperCase()==='FAILED'
        );
      // Semantic routing and runtime admission are separate authorities.
      // Ordinarily the agent can still state NEED_CONTEXT even when the current
      // evidence window is temporarily exhausted. A HARD evidence ceiling is
      // different: the bounded acquisition strategy has converged (repeating /
      // no new observations / renewal limit), so control returns to the agent
      // to resolve the requirement from durable evidence rather than pausing
      // the whole lifecycle or repeating retrieval forever.
      const evidenceCeilingResolution=asObject(
        node?.decision_payload?.evidence_ceiling_resolution
      );
      const evidenceAcquisitionClosed=evidenceCeilingResolution.status==='ACTIVE';
      // A response that exhausts the atomic output bound twice is mechanical
      // evidence that the current execution unit is too large for bounded
      // completion. Do not dead-end on ATOMIC admission. Return semantic control
      // to the bound agent for agent-authored narrowing via SPLIT.
      const availableDecisions=atomicOverflowRecovery
        ? ['SPLIT']
        : [
            'ATOMIC',
            'SPLIT',
            ...(!evidenceAcquisitionClosed?['NEED_CONTEXT']:[]),
            'BLOCKED',
            ...(remediationAvailable?['REMEDIATE']:[]),
          ];
      if(atomicOverflowRecovery){
        console.warn('AAU_ATOMIC_TRUNCATION_DECOMPOSITION_REQUIRED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          atomic_execution_failures:atomicExecutionFailures,
          prior_atomic_rejection:priorAtomicRejection,
          policy:'bounded_overflow_requires_agent_authored_split_v0_1',
        }));
      }

      // Semantic checkpoint identity deliberately excludes remaining budget,
      // child capacity, wake attempt, and resource-exhaustion counters. A
      // failed attempt spending compute cannot invalidate the cognition it is
      // supposed to resume. Evidence/state changes still create a new identity.
      const contextFingerprint=sha256(safeJson(canonicalizeHashValue({
        contract:'semantic_discovery_fingerprint_v0_3_stable_evidence_identity',
        node_path:node.node_path,
        requirement:node.requirement_text,
        context_evidence:semanticContextIdentity(contextPayload),
        pinned_evidence_index:pinnedEvidence.map(v=>({
          source_key:v.source_key,source_id:v.source_id,url:v.url,sha256:v.sha256,excerpt_bytes:v.excerpt_bytes
        })).sort((a,b)=>String(a.url||a.source_id||a.source_key||'').localeCompare(String(b.url||b.source_id||b.source_key||''))),
        authoritative_sibling_results:siblingEvidence.map(v=>({
          path:v.path,status:v.status,decision_type:v.decision_type,result_hash:v.result_hash,
          evidence_scope:v.evidence_scope||null
        })).sort((a,b)=>String(a.path||'').localeCompare(String(b.path||''))),
        remediation_history:compactRemediationEpisodes(remediationEpisodes),
        child_authoring_failure_count:Number(node?.decision_payload?.child_authoring_failure_count||0),
        child_authoring_failure:asObject(node?.decision_payload?.child_authoring_failure),
        force_reconsider:Boolean(forceReconsider),
        evidence_acquisition_closed:evidenceAcquisitionClosed,
        evidence_ceiling_reason:evidenceCeilingResolution.reason||null,
        evidence_ceiling_resource_reasons:asArray(evidenceCeilingResolution.resource_reasons),
        atomic_execution_failures:atomicExecutionFailures,
        atomic_overflow_recovery:atomicOverflowRecovery,
        prior_atomic_rejection:priorAtomicRejection||null,
      })));

      const priorPayload=asObject(node.decision_payload);
      const priorDiscovery=asObject(priorPayload.routing_discovery_checkpoint);
      const priorDecision=text(priorDiscovery.decision).toUpperCase();
      const priorAdmission=asObject(priorPayload.routing_admission);
      const priorResource=asObject(priorDiscovery.context_resource_state);
      const priorDirectHashes=asArray(priorDiscovery.authoritative_sibling_result_hashes)
        .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)}))
        .sort((a,b)=>a.path.localeCompare(b.path));
      const priorDependencyHashes=asArray(priorDiscovery.authoritative_dependency_result_hashes)
        .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)}))
        .sort((a,b)=>a.path.localeCompare(b.path));
      const currentDirectHashes=siblingEvidence
        .filter(v=>text(v?.evidence_scope)!=='ancestor_dependency')
        .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)}))
        .sort((a,b)=>a.path.localeCompare(b.path));
      const currentDependencyHashes=siblingEvidence
        .filter(v=>text(v?.evidence_scope)==='ancestor_dependency')
        .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)}))
        .sort((a,b)=>a.path.localeCompare(b.path));
      const deferredAdmissionReplaySafe=
        priorAdmission.status==='DEFERRED'
        && priorAdmission.semantic_decision===priorDecision
        && priorDiscovery.version==='agent_deep_discovery_v0_1'
        && priorDiscovery.context_fingerprint===contextFingerprint
        && availableDecisions.includes(priorDecision)
        && !forceReconsider
        && Number(priorResource.unique_sources??-1)===Number(resourceView.unique_sources??-2)
        && Number(priorResource.context_rounds_attempted??-1)===Number(resourceView.context_rounds_attempted??-2)
        && Number(priorResource.active_context_elapsed_ms??-1)===Number(resourceView.active_context_elapsed_ms??-2)
        && safeJson(priorDirectHashes)===safeJson(currentDirectHashes)
        && safeJson(priorDependencyHashes)===safeJson(currentDependencyHashes);
      const reusableDiscovery=
        deferredAdmissionReplaySafe
        ||(
          priorDiscovery.version==='agent_deep_discovery_v0_1'
          && priorDiscovery.context_fingerprint===contextFingerprint
          && availableDecisions.includes(priorDecision)
        );

      let discovery=reusableDiscovery?priorDiscovery:null;

      if(!discovery){
        let siblingInspectionRetry=null;
        let siblingInspectionUnconfirmed=null;
        const durableDiscovery=await loadJsonPhaseCheckpoint(
          node.node_path,'DISCOVERY',contextFingerprint
        );
        for(let attempt=1;attempt<=2;attempt++){
          try{
            const response=durableDiscovery.parsed
              ? {parsed:durableDiscovery.parsed,checkpoint_reused:true}
              : await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent performing a DEEP DISCOVERY pass for ONE requirement.',
                'Thinking is enabled. This pass is where YOU determine what the requirement means and what action YOU intend to take.',
                'The runtime does not choose, reinterpret, decompose, repair, or declare the requirement blocked for you.',
                'Available decisions for this exact node: '+availableDecisions.join(', ')+'.',
                'CANONICAL STAGE-4 LEDGER: when supplied_context.expertise_candidate_ledger is available, it is the authoritative current-cohort record of already submitted candidate domains, ordinals, and progress. Use it for distinctness/progress checks. Do not reconstruct those facts from recent_activity, historical trees, or prior invalidated cohorts.',
                'CANONICAL PRIOR-LEARNING LEDGER: when supplied_context.entrepreneurship_masters or supplied_context.agent.competency_verification_records is available, it is the authoritative verified competency record for cumulative transfer. Use those records directly for prior_learning_application; do not ask for a separate competency ledger that already exists in supplied context.',
                remediationAvailable
                  ? 'REMEDIATE is available because you have a prior durable cognitive state and remaining remediation budget. Choose it only if YOU detect a contradiction, stale belief, or recoverable cognitive-state failure in your own prior reasoning. The runtime will not diagnose the anomaly for you.'
                  : 'REMEDIATE is mechanically unavailable because there is no eligible prior cognitive state or the remediation budget is exhausted.',
                'If you choose REMEDIATE, YOU must supply observed_anomaly, prior_belief, contradicting_evidence, diagnosis, repair_type, repair_payload, and verification_criterion. Allowed repair types are '+SELF_REMEDIATION_REPAIR_TYPES.join(', ')+'. INVALIDATE_DISCOVERY_CHECKPOINT supersedes your current discovery checkpoint and makes you reconsider. REFRESH_SIBLING_EVIDENCE mechanically reloads resolved siblings and also supersedes your current discovery checkpoint. Neither repair changes facts, conclusions, atomic-failure counts, or hard resource ceilings.',
                atomicOverflowRecovery
                  ? 'BOUNDED ATOMIC OVERFLOW RECOVERY: your prior bounded atomic execution exhausted the output limit twice and both partial responses were rejected. ATOMIC is mechanically unavailable for this node. Choose SPLIT and author one or more genuinely narrower child requirements that can each finish independently within the existing output bound. Preserve the original requirement; do not solve it by deleting scope, inflating token limits, or continuing truncated text.'
                  : atomicUnavailable
                    ? 'ATOMIC execution admission is mechanically unavailable for this node after a prior rejected bounded execution. Choose another available semantic action; do not repeat the rejected execution unchanged.'
                    : 'ATOMIC is semantically available if you judge the requirement genuinely bounded.',
                'RESOURCE ADVISORY ONLY: '+Number(runtimeView?.remaining_budget_units||0)+' units remain. Current execution admission can support '+availableChildCapacity+' child branch(es), priced at approximately '+branchEconomics.expected_child_lifecycle_units+' units each while protecting '+branchEconomics.completion_reserve_units+' units for completion. Do not change your semantic routing judgment merely to fit this resource snapshot; the runtime handles admission separately.',
                storageDepthAvailable
                  ? 'Tree depth is not the ordinary stopping rule. If SPLIT is semantically correct, choose SPLIT; runtime admission will separately determine how many children can be started now.'
                  : 'EMERGENCY STORAGE GUARD: this durable path reached '+semanticRuntime.hard_storage_path_depth+' levels. If SPLIT is still semantically correct, choose SPLIT anyway. The runtime will preserve the decision and defer execution rather than forcing a different substantive answer.',
                evidenceAcquisitionClosed
                  ? 'HARD EVIDENCE CEILING: bounded context acquisition for THIS node is now closed because prior retrieval converged without material new observations ('+asArray(evidenceCeilingResolution.resource_reasons).join(', ')+'). NEED_CONTEXT is mechanically unavailable in this reconsideration. You own the semantic resolution: choose ATOMIC if the requirement can be completed honestly from durable evidence while preserving unresolved criteria as UNKNOWN/hypotheses and using validation/kill criteria; choose SPLIT only when genuinely independent remaining work exists (never merely to reopen research); choose BLOCKED if you judge the requirement cannot honestly be completed under the established evidence boundary. Do not repeat retrieval requests.'
                  : resourceView.available
                    ? 'Context/research admission is currently available. Choose NEED_CONTEXT only when another retrieval or exact context lookup can materially reduce a stated gap.'
                    : 'CONTEXT RESOURCE CONSTRAINT: the current evidence window reports: '+resourceView.reasons.join(', ')+'. This does NOT make NEED_CONTEXT semantically false. If more evidence is genuinely required, choose NEED_CONTEXT. The runtime will autonomously test whether another bounded evidence window is economically admissible; only a true hard/economic stop is deferred.',
                evidenceAcquisitionClosed
                  ? 'BLOCKED BASIS CONTRACT UNDER HARD EVIDENCE CEILING: BLOCKED remains YOUR semantic conclusion. EVIDENCE_PROVES_BLOCKED means current evidence disproves/defeats the requirement. MORE_EVIDENCE_REQUIRED is also permitted here only when YOU conclude the requirement cannot be completed honestly after the bounded evidence strategy has converged; it will remain a branch-local BLOCKED result rather than reopening context or pausing the lifecycle.'
                  : 'BLOCKED BASIS CONTRACT: BLOCKED is a semantic conclusion, never a resource status. If the current evidence itself proves the requirement cannot honestly be completed, choose BLOCKED with block_basis=EVIDENCE_PROVES_BLOCKED. If completion merely requires evidence/context that is not currently available, choose NEED_CONTEXT. If you nevertheless serialize BLOCKED with block_basis=MORE_EVIDENCE_REQUIRED, the runtime will normalize it to NEED_CONTEXT without changing the stated evidence gap.',
                'Before deciding, interrogate semantic equivalence, definitions, time horizons, populations/scopes, proxy metrics, evidence sufficiency, assumptions, and unresolved gaps.',
                'REPEATED ACQUISITION RULE: if an exact context/research request has already been repeated and the required evidence remains unresolved, do not issue the same request again. Use materially different retrieval if one exists; otherwise preserve the criterion as UNKNOWN when the task can proceed, or choose BLOCKED when the unresolved evidence prevents honest completion.',
                'AUTHORITATIVE DEPENDENCY HANDOFF: authoritative_completed_sibling_evidence contains both direct resolved siblings and inherited prerequisite results routed from ancestor branches. evidence_scope=ancestor_dependency means the result was already made available to an ancestor and must remain available down this branch. Inspect this durable evidence before deciding NEED_CONTEXT; do not research again for information already present here.',
                'Only evidence_scope=direct_sibling paths are subject to inspected_sibling_paths attention accounting. Inherited ancestor dependencies do not require path echoing; they are durable prerequisite context, not a serialization invariant.',
                siblingInspectionRetry
                  ? 'SIBLING INSPECTION RETRY: Your immediately prior discovery output was rejected only because it omitted required sibling path(s) from inspected_sibling_paths. Re-inspect the exact evidence rows named in sibling_inspection_retry.missing_paths before deciding again. Do not merely echo those paths: reconsider your evidence assessment and routing decision in light of the re-inspected sibling evidence. You may preserve or change your prior decision, but the new output must be fully agent-authored and must explicitly account for every supplied sibling path.'
                  : '',
                'Do not treat a nearby metric or label as equivalent unless YOU can justify the equivalence from supplied evidence.',
                'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
                'When supplied_context contains research_source_catalog, treat it as the complete discoverable source index for prior research rounds. If context acquisition is available and a source is indexed but its excerpt is insufficient, put its exact listed HTTPS URL in research_urls (not context_requests) so the runtime can fetch it directly.',
                'Do not solve the requirement or author child requirements in this pass.',
                'Return complete JSON only: {"decision":"ATOMIC|SPLIT|NEED_CONTEXT|BLOCKED|REMEDIATE","block_basis":"EVIDENCE_PROVES_BLOCKED|MORE_EVIDENCE_REQUIRED|null","reason":"auditable reason","requirement_interpretation":"what this requirement actually demands","evidence_assessment":"what the current evidence does and does not establish","inspected_sibling_paths":["R.001..."],"unresolved_gaps":["..."],"context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."],"remediation":{"observed_anomaly":"required when REMEDIATE","prior_belief":"required when REMEDIATE","contradicting_evidence":[],"diagnosis":"required when REMEDIATE","repair_type":"INVALIDATE_DISCOVERY_CHECKPOINT|REFRESH_SIBLING_EVIDENCE","repair_payload":{},"verification_criterion":"required when REMEDIATE"}}. When decision=BLOCKED, block_basis is required. Use MORE_EVIDENCE_REQUIRED when the gap could be resolved by additional evidence, even if runtime resources are currently exhausted.',
                forceReconsider
                  ? 'A prior atomic execution was rejected or exhausted. Reconsider the requirement under the persisted constraints rather than repeating the failed action.'
                  : '',
              ].filter(Boolean).join('\n')},
              {role:'user',content:safeJson({
                requirement:node.requirement_text,
                agent_authored_discovery_state:agentDiscoveryState(node),
                source:{kind:node.source_kind,ref:node.source_ref},
                authoritative_completed_sibling_evidence:siblingEvidence,
                sibling_inspection_retry:siblingInspectionRetry,
                prior_cognitive_state:priorCognitiveState,
                durable_self_remediation_history:compactRemediationEpisodes(remediationEpisodes),
                decomposition_execution_failure:asObject(node?.decision_payload?.child_authoring_failure),
                supplied_context:cognitionContext,
                available_context_index:idx,
                available_supplied_context_index:indexObject(cognitionContext),
                available_decisions:availableDecisions,
                runtime_resource_constraints:{
                  semantic_runtime_contract:SEMANTIC_RUNTIME_CONTRACT,
                  epoch_no:semanticRuntime.epoch_no,
                  remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
                  initial_budget_units:Number(runtimeView?.initial_budget_units||semanticRuntime.initial_budget_units),
                  budget_quantum_tokens:semanticRuntime.quantum_tokens,
                  semantic_child_capacity:availableChildCapacity,
                  semantic_branch_economics_contract:branchEconomics.contract,
                  expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
                  completion_reserve_units:branchEconomics.completion_reserve_units,
                  branch_economics_components:branchEconomics.components,
                  storage_path_depth:normalizedBranchDepth,
                  emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
                  multi_child_split_available:structuralBranchingAvailable,
                  single_child_refinement_available:singleRefinementAvailable,
                  context_acquisition_available:resourceView.available,
                  context_acquisition_exhausted:resourceView.exhausted,
                  context_exhaustion_reasons:resourceView.reasons,
                  context_rounds_attempted:resourceView.context_rounds_attempted,
                  research_rounds_attempted:resourceView.research_rounds_attempted,
                  local_context_rounds_attempted:resourceView.local_context_rounds_attempted,
                  stagnant_rounds:resourceView.stagnant_rounds,
                  unchanged_gap_rounds:resourceView.unchanged_gap_rounds,
                  repeated_request_rounds:resourceView.repeated_request_rounds,
                  elapsed_context_acquisition_ms:resourceView.elapsed_ms,
                  unique_research_sources:resourceView.unique_sources,
                  self_remediation_available:remediationAvailable,
                  self_remediation_attempts_used:remediationAttemptsUsed,
                  max_self_remediation_attempts:MAX_SELF_REMEDIATION_ATTEMPTS,
                  allowed_self_remediation_repairs:SELF_REMEDIATION_REPAIR_TYPES,
                  model_runtime_contract:{
                    model_id:agentRuntimeContract.model_id,
                    operational_context_limit_tokens:agentRuntimeContract.operational_context_limit_tokens,
                    max_output_tokens:agentRuntimeContract.max_output_tokens,
                    input_safety_margin_tokens:agentRuntimeContract.input_safety_margin_tokens,
                    safe_input_tokens:discoveryContextView.safeInputTokens,
                    supplied_context_budget_tokens:discoveryContextView.contextBudget,
                    estimated_supplied_context_tokens:discoveryContextView.estimatedSuppliedTokens,
                  },
                },
              })},
            ],10000,'req_'+node.node_path.replaceAll('.','_')+'_discovery_'+(resourceView.context_rounds_attempted+1)+'_'+attempt);

            const candidate=asObject(response?.parsed);
            const rawCandidateDecision=text(candidate.decision).toUpperCase();
            let candidateDecision=rawCandidateDecision;
            const blockBasis=text(candidate.block_basis).toUpperCase();
            let blockNormalization=null;

            if(rawCandidateDecision==='BLOCKED'){
              const validBlockBasis=['EVIDENCE_PROVES_BLOCKED','MORE_EVIDENCE_REQUIRED'].includes(blockBasis);
              if(!validBlockBasis&&!durableDiscovery.parsed){
                if(attempt===2)
                  throw new Error('autonomous_decomposition_block_basis_invalid:'+node.node_path);
                continue;
              }
              if(blockBasis==='MORE_EVIDENCE_REQUIRED'&&!evidenceAcquisitionClosed){
                candidateDecision='NEED_CONTEXT';
                blockNormalization={
                  contract:'resource_independent_block_normalization_v0_1',
                  raw_decision:'BLOCKED',
                  normalized_decision:'NEED_CONTEXT',
                  block_basis:blockBasis,
                  reason:'more_evidence_required_is_not_semantic_blocked',
                  context_resource_available:resourceView.available,
                  context_resource_reasons:resourceView.reasons,
                  normalized_at:new Date().toISOString(),
                };
                console.warn('AAU_RESOURCE_BLOCK_NORMALIZED',JSON.stringify({
                  agent_id:agentId,
                  intent_execution_id:intentExecutionId,
                  node_path:node.node_path,
                  raw_decision:'BLOCKED',
                  normalized_decision:'NEED_CONTEXT',
                  block_basis:blockBasis,
                  context_resource_available:resourceView.available,
                  context_resource_reasons:resourceView.reasons,
                }));
              }else if(blockBasis==='MORE_EVIDENCE_REQUIRED'&&evidenceAcquisitionClosed){
                blockNormalization={
                  contract:'bounded_evidence_ceiling_branch_resolution_v0_1',
                  raw_decision:'BLOCKED',
                  normalized_decision:'BLOCKED',
                  block_basis:blockBasis,
                  reason:'bound_agent_declared_requirement_not_honestly_completable_after_bounded_evidence_convergence',
                  context_resource_available:false,
                  context_resource_reasons:resourceView.reasons,
                  normalized_at:new Date().toISOString(),
                };
              }
            }

            if(!availableDecisions.includes(candidateDecision)){
              if(attempt===2)throw new Error('autonomous_decomposition_discovery_invalid_available_action:'+node.node_path);
              continue;
            }
            if(candidateDecision==='REMEDIATE'){
              const remediation=asObject(candidate.remediation);
              const repairType=text(remediation.repair_type).toUpperCase();
              const validRemediation=
                remediationAvailable
                && SELF_REMEDIATION_REPAIR_TYPES.includes(repairType)
                && text(remediation.observed_anomaly).length>=8
                && text(remediation.prior_belief).length>=3
                && text(remediation.diagnosis).length>=8
                && text(remediation.verification_criterion).length>=8
                && asArray(remediation.contradicting_evidence).length>0;
              if(!validRemediation){
                if(attempt===2)throw new Error('autonomous_decomposition_discovery_invalid_remediation:'+node.node_path);
                continue;
              }
            }
            const directSiblingEvidence=siblingEvidence.filter(
              row=>text(row?.evidence_scope)!=='ancestor_dependency'
            );
            const siblingInspection=durableSiblingInspection({
              siblingEvidence:directSiblingEvidence,
              candidateInspectedPaths:asArray(candidate.inspected_sibling_paths).map(text).filter(Boolean),
              priorDiscovery,
            });
            const missingSiblingInspection=siblingInspection.missing_paths;
            if(missingSiblingInspection.length){
              if(attempt===2){
                siblingInspectionUnconfirmed={
                  reason:'agent_did_not_serialize_sibling_attention_after_explicit_retry',
                  paths:missingSiblingInspection,
                  evidence_hashes:siblingEvidence
                    .filter(v=>missingSiblingInspection.includes(text(v?.path)))
                    .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)||null})),
                  candidate_decision:candidateDecision,
                  candidate_reason:clip(candidate.reason,1400),
                };
                console.warn('AAU_AUTONOMOUS_SIBLING_INSPECTION_UNCONFIRMED',JSON.stringify({
                  agent_id:agentId,
                  intent_execution_id:intentExecutionId,
                  node_path:node.node_path,
                  missing_paths:missingSiblingInspection,
                  candidate_decision:candidateDecision,
                  policy:'durable_warning_not_wake_failure',
                }));
              }else{
                siblingInspectionRetry={
                  reason:'prior_discovery_omitted_required_or_changed_sibling_attention_accounting',
                  missing_paths:missingSiblingInspection,
                  prior_inspected_paths:siblingInspection.inspected_paths,
                  invalidated_paths:siblingInspection.invalidated_paths,
                  prior_decision:candidateDecision,
                  prior_reason:clip(candidate.reason,1400),
                  evidence_to_reinspect:siblingEvidence.filter(v=>missingSiblingInspection.includes(text(v?.path))),
                };
                console.log('AAU_AUTONOMOUS_SIBLING_INSPECTION_RETRY',JSON.stringify({
                  agent_id:agentId,
                  intent_execution_id:intentExecutionId,
                  node_path:node.node_path,
                  missing_paths:missingSiblingInspection,
                  prior_decision:candidateDecision,
                }));
                continue;
              }
            }

            const durableUnconfirmedSiblingPaths=[...new Set([
              ...siblingInspection.inherited_unconfirmed_paths,
              ...asArray(siblingInspectionUnconfirmed?.paths).map(text).filter(Boolean),
            ])];

            const normalizedCandidate={
              ...candidate,
              decision:candidateDecision,
              raw_decision:rawCandidateDecision,
              block_basis:blockBasis||null,
              block_normalization:blockNormalization,
            };

            if(!durableDiscovery.parsed){
              await saveJsonPhaseCheckpoint(
                node.node_path,'DISCOVERY',contextFingerprint,normalizedCandidate,{
                  semantic_fingerprint:contextFingerprint,
                  semantic_decision:candidateDecision,
                  raw_semantic_decision:rawCandidateDecision,
                  block_basis:blockBasis||null,
                  resource_block_normalized:Boolean(blockNormalization),
                  resource_independent_identity:true,
                }
              );
            }

            discovery={
              version:'agent_deep_discovery_v0_1',
              context_fingerprint:contextFingerprint,
              decision:candidateDecision,
              raw_decision:rawCandidateDecision,
              block_basis:blockBasis||null,
              block_normalization:blockNormalization,
              reason:clip(candidate.reason,2200),
              requirement_interpretation:clip(candidate.requirement_interpretation,2800),
              evidence_assessment:clip(candidate.evidence_assessment,3200),
              inspected_sibling_paths:siblingInspection.inspected_paths.slice(0,16),
              inherited_sibling_inspection_paths:siblingInspection.inherited_paths.slice(0,16),
              inherited_unconfirmed_sibling_inspection_paths:siblingInspection.inherited_unconfirmed_paths.slice(0,16),
              invalidated_sibling_inspection_paths:siblingInspection.invalidated_paths.slice(0,16),
              sibling_inspection_unconfirmed_paths:durableUnconfirmedSiblingPaths.slice(0,16),
              sibling_inspection_accounting_status:durableUnconfirmedSiblingPaths.length
                ?'evidence_delivered_acknowledgment_unconfirmed'
                :'agent_acknowledged',
              sibling_inspection_unconfirmed_reason:siblingInspectionUnconfirmed?.reason
                ||(durableUnconfirmedSiblingPaths.length
                  ?text(priorDiscovery.sibling_inspection_unconfirmed_reason)
                    ||'prior_unconfirmed_acknowledgment_inherited_for_unchanged_hash'
                  :null),
              sibling_inspection_state_version:'monotonic_result_hash_v0_2_delivery_separated_from_acknowledgment',
              sibling_inspection_retry_applied:Boolean(siblingInspectionRetry),
              sibling_inspection_retry_missing_paths:asArray(siblingInspectionRetry?.missing_paths).map(text).filter(Boolean).slice(0,16),
              authoritative_sibling_result_hashes:siblingEvidence
                .filter(v=>text(v?.evidence_scope)!=='ancestor_dependency')
                .map(v=>({path:v.path,result_hash:v.result_hash})),
              authoritative_dependency_result_hashes:siblingEvidence
                .filter(v=>text(v?.evidence_scope)==='ancestor_dependency')
                .map(v=>({path:v.path,result_hash:v.result_hash})),
              remediation_prior_state:candidateDecision==='REMEDIATE'?{
                decision:text(priorCognitiveState.decision)||null,
                reason:clip(priorCognitiveState.reason,1800)||null,
                requirement_interpretation:clip(priorCognitiveState.requirement_interpretation,1800)||null,
                evidence_assessment:clip(priorCognitiveState.evidence_assessment,2200)||null,
                unresolved_gaps:asArray(priorCognitiveState.unresolved_gaps).map(v=>clip(text(v),600)).slice(0,12),
                context_fingerprint:text(priorCognitiveState.context_fingerprint)||null,
                authoritative_sibling_result_hashes:asArray(priorCognitiveState.authoritative_sibling_result_hashes).slice(0,12),
              }:null,
              remediation:candidateDecision==='REMEDIATE'?{
                observed_anomaly:clip(candidate?.remediation?.observed_anomaly,2400),
                prior_belief:clip(candidate?.remediation?.prior_belief,2400),
                contradicting_evidence:asArray(candidate?.remediation?.contradicting_evidence).slice(0,16),
                diagnosis:clip(candidate?.remediation?.diagnosis,3000),
                repair_type:text(candidate?.remediation?.repair_type).toUpperCase(),
                repair_payload:asObject(candidate?.remediation?.repair_payload),
                verification_criterion:clip(candidate?.remediation?.verification_criterion,2400),
              }:null,
              unresolved_gaps:asArray(candidate.unresolved_gaps).map(v=>clip(text(v),900)).filter(Boolean).slice(0,16),
              context_requests:asArray(candidate.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND),
              research_queries:asArray(candidate.research_queries).map(text).filter(Boolean).slice(0,8),
              research_urls:asArray(candidate.research_urls).map(text).filter(v=>/^https:\/\//i.test(v)).slice(0,8),
              force_reconsider:Boolean(forceReconsider),
              atomic_unavailable:atomicUnavailable,
              atomic_execution_failures:atomicExecutionFailures,
              atomic_overflow_recovery:atomicOverflowRecovery,
              prior_atomic_rejection:priorAtomicRejection||null,
              semantic_runtime_contract:SEMANTIC_RUNTIME_CONTRACT,
              remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
              semantic_child_capacity:availableChildCapacity,
              semantic_branch_economics_contract:branchEconomics.contract,
              expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
              completion_reserve_units:branchEconomics.completion_reserve_units,
              branch_economics_components:branchEconomics.components,
              storage_path_depth:normalizedBranchDepth,
              emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
              multi_child_split_available:structuralBranchingAvailable,
              single_child_refinement_available:singleRefinementAvailable,
              context_resource_state:resourceView,
            };

            node=await saveNode({
              nodePath:node.node_path,
              parentPath:node.parent_path??parentPathOf(node.node_path),
              ordinal:node.ordinal||0,
              requirement:node.requirement_text,
              sourceKind:node.source_kind,
              sourceRef:node.source_ref,
              status:'deciding',
              decisionType:null,
              decisionPayload:{
                ...(node.decision_payload||{}),
                context_resource_state:contextState,
                routing_discovery_checkpoint:discovery,
                routing_discovery_checkpointed:true,
                routing_discovery_checkpointed_at:new Date().toISOString(),
                routing_protocol:'deep_discovery_then_commit_v0_2_agent_visible_context_resource',
              },
              contextPayload,
              resultArtifact:node.result_artifact||null,
            });
            node.parent_path=node.parent_path??parentPathOf(node.node_path);
            break;
          }catch(error){
            if(attempt===2)throw error;
            if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT'
               &&!String(error?.message||'').startsWith('autonomous_decomposition_discovery_invalid_available_action:'))throw error;
          }
        }
      }

      if(!discovery)throw new Error('autonomous_decomposition_discovery_checkpoint_missing:'+node.node_path);

      let serialized=null;
      const routingCommitIdentity=sha256({
        discovery_fingerprint:discovery.context_fingerprint,
        decision:discovery.decision,
        reason:discovery.reason,
        context_requests:discovery.context_requests,
        research_queries:discovery.research_queries,
        research_urls:discovery.research_urls,
      });
      const durableRoutingCommit=await loadJsonPhaseCheckpoint(
        node.node_path,'ROUTE_COMMIT',routingCommitIdentity
      );
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=durableRoutingCommit.parsed
            ? {parsed:durableRoutingCommit.parsed,checkpoint_reused:true}
            : await callSerialize([
            {role:'system',content:[
              'You are serializing YOUR ALREADY-COMPLETED durable routing decision into the AAU protocol.',
              'Do not rethink, reinterpret, improve, or change the saved decision.',
              'Copy the saved decision faithfully into the required JSON shape.',
              'Return JSON only: {"decision":"ATOMIC|SPLIT|NEED_CONTEXT|BLOCKED|REMEDIATE","reason":"...","context_requests":[],"research_queries":[],"research_urls":[]}.',
            ].join('\n')},
            {role:'user',content:safeJson({
              saved_discovery_decision:{
                decision:discovery.decision,
                reason:discovery.reason,
                context_requests:discovery.context_requests,
                research_queries:discovery.research_queries,
                research_urls:discovery.research_urls,
              }
            })},
          ],700,'req_'+node.node_path.replaceAll('.','_')+'_routing_commit_'+(resourceView.context_rounds_attempted+1)+'_'+attempt);

          const candidate=asObject(response?.parsed);
          if(text(candidate.decision).toUpperCase()!==discovery.decision){
            if(attempt===2)throw new Error('autonomous_decomposition_routing_commit_mismatch:'+node.node_path);
            continue;
          }
          if(!durableRoutingCommit.parsed){
            await saveJsonPhaseCheckpoint(
              node.node_path,'ROUTE_COMMIT',routingCommitIdentity,candidate,{
                discovery_fingerprint:discovery.context_fingerprint,
                semantic_decision:discovery.decision,
              }
            );
          }
          serialized=candidate;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT'
             &&!String(error?.message||'').startsWith('autonomous_decomposition_routing_commit_mismatch:'))throw error;
        }
      }

      if(!serialized)throw new Error('autonomous_decomposition_routing_commit_missing:'+node.node_path);

      const decision=discovery.decision;
      const decisionPayload={
        ...(node.decision_payload||{}),
        reason:discovery.reason,
        requirement_interpretation:discovery.requirement_interpretation,
        evidence_assessment:discovery.evidence_assessment,
        unresolved_gaps:discovery.unresolved_gaps,
        context_round:contextState.context_rounds_attempted,
        context_resource_state:contextState,
        force_reconsider:Boolean(forceReconsider),
        atomic_execution_failures:atomicExecutionFailures,
        atomic_unavailable:atomicUnavailable,
        atomic_overflow_recovery:atomicOverflowRecovery,
        prior_atomic_rejection:priorAtomicRejection||null,
        routing_discovery_checkpoint:discovery,
        routing_discovery_reused:Boolean(reusableDiscovery),
        routing_commit_serialized:true,
        routing_protocol:'deep_discovery_then_commit_v0_2_agent_visible_context_resource',
      };

      if(decision==='REMEDIATE'){
        const remediated=await executeSelfRemediation(node,discovery,{
          contextPayload,
          pinnedEvidence,
          siblingEvidence,
        });
        node=remediated.node;
        contextPayload=remediated.contextPayload;
        continue;
      }

      let effectiveResourceView=resourceView;
      let evidenceRenewalAssessment=null;

      if(decision==='NEED_CONTEXT'&&!effectiveResourceView.available){
        const evidenceEconomics=projectedEvidenceRoundEconomics(
          contextPayload,pinnedEvidence,branchEconomics
        );
        const lastRound=asObject(contextState.last_round);
        const lastRoundProductive=
          !Object.keys(lastRound).length
          ||Number(lastRound.new_sources||0)>0
          ||Number(lastRound.new_local_context_paths||0)>0
          ||Number(lastRound.restored_pinned_evidence||0)>0;

        evidenceRenewalAssessment=autonomousEvidenceWindowDecision({
          resourceReasons:effectiveResourceView.reasons,
          remainingBudgetUnits:Number(runtimeView?.remaining_budget_units||0),
          projectedRoundUnits:evidenceEconomics.projected_round_units,
          completionReserveUnits:evidenceEconomics.completion_reserve_units,
          renewalsUsed:Number(contextState.evidence_window_renewals||0),
          maxRenewals:MAX_AUTONOMOUS_EVIDENCE_WINDOW_RENEWALS,
          lastRoundProductive,
        });

        if(evidenceRenewalAssessment.granted){
          const nextWindowNo=Math.max(0,Number(contextState.evidence_window_no||0))+1;
          const renewalAt=new Date().toISOString();
          contextState={
            ...contextState,
            version:'agent_visible_context_resource_v0_3_autonomous_evidence_windows',
            evidence_window_contract:'autonomous_evidence_window_v0_1',
            evidence_window_no:nextWindowNo,
            evidence_window_renewals:Number(contextState.evidence_window_renewals||0)+1,
            evidence_window_round_baseline:effectiveResourceView.context_rounds_attempted,
            evidence_window_source_baseline:effectiveResourceView.unique_sources,
            evidence_window_elapsed_baseline_ms:effectiveResourceView.active_context_elapsed_ms,
            evidence_window_started_at:renewalAt,
            evidence_window_last_grant:{
              ...evidenceRenewalAssessment,
              granted_at:renewalAt,
              prior_resource_reasons:effectiveResourceView.reasons,
              projected_economics:evidenceEconomics,
              last_round_productive:lastRoundProductive,
            },
          };

          await chargeSemanticRuntime({
            eventKind:'semantic_transition',
            materialKey:node.node_path+':evidence_window_renewal:'+String(nextWindowNo),
            nodePath:node.node_path,
            costUnits:1,
            eventFingerprint:sha256({
              node_path:node.node_path,
              phase:'autonomous_evidence_window_renewal',
              window_no:nextWindowNo,
              prior_resource_reasons:effectiveResourceView.reasons,
              unresolved_gaps:discovery.unresolved_gaps,
            }),
            metadata:{
              phase:'autonomous_evidence_window_renewal',
              contract:'autonomous_evidence_window_v0_1',
              window_no:nextWindowNo,
              prior_resource_reasons:effectiveResourceView.reasons,
              projected_round_units:evidenceEconomics.projected_round_units,
              completion_reserve_units:evidenceEconomics.completion_reserve_units,
              remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
              operator_approval_required:false,
            },
          });

          delete decisionPayload.routing_admission;
          decisionPayload.context_resource_state=contextState;
          decisionPayload.autonomous_evidence_window={
            status:'GRANTED',
            ...evidenceRenewalAssessment,
            window_no:nextWindowNo,
            granted_at:renewalAt,
            operator_approval_required:false,
          };
          effectiveResourceView=contextResourceView(contextState,contextPayload);

          console.log('AAU_AUTONOMOUS_EVIDENCE_WINDOW_GRANTED',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            node_path:node.node_path,
            window_no:nextWindowNo,
            prior_resource_reasons:resourceView.reasons,
            remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
            projected_round_units:evidenceEconomics.projected_round_units,
            completion_reserve_units:evidenceEconomics.completion_reserve_units,
            operator_approval_required:false,
          }));

          node=await saveNode({
            nodePath:node.node_path,
            parentPath:node.parent_path??parentPathOf(node.node_path),
            ordinal:node.ordinal||0,
            requirement:node.requirement_text,
            sourceKind:node.source_kind,
            sourceRef:node.source_ref,
            status:'pending',
            decisionType:'NEED_CONTEXT',
            decisionPayload,
            contextPayload,
            resultArtifact:node.result_artifact||null,
          });
          node.parent_path=node.parent_path??parentPathOf(node.node_path);
        }else{
          decisionPayload.autonomous_evidence_window={
            status:'DENIED',
            ...evidenceRenewalAssessment,
            evaluated_at:new Date().toISOString(),
            operator_approval_required:
              evidenceRenewalAssessment.reason==='insufficient_semantic_budget'
              ||evidenceRenewalAssessment.reason==='evidence_window_renewal_limit',
          };
        }
      }

      if(
        decision==='NEED_CONTEXT'
        &&evidenceCeilingRequiresAgentResolution(evidenceRenewalAssessment)
      ){
        const resolutionAt=new Date().toISOString();
        const nextDecisionPayload={
          ...decisionPayload,
          autonomous_evidence_window:{
            status:'DENIED',
            ...evidenceRenewalAssessment,
            evaluated_at:resolutionAt,
            operator_approval_required:false,
          },
          evidence_ceiling_resolution:{
            status:'ACTIVE',
            contract:'bounded_evidence_ceiling_agent_resolution_v0_1',
            reason:evidenceRenewalAssessment.reason,
            resource_reasons:effectiveResourceView.reasons,
            hard_reasons:asArray(evidenceRenewalAssessment.hard_reasons),
            renewable_reasons:asArray(evidenceRenewalAssessment.renewable_reasons),
            prior_semantic_decision:'NEED_CONTEXT',
            prior_discovery_fingerprint:discovery.context_fingerprint,
            unresolved_gaps:asArray(discovery.unresolved_gaps),
            activated_at:resolutionAt,
            policy:'return_semantic_control_to_bound_agent_without_global_pause',
          },
        };
        delete nextDecisionPayload.routing_admission;
        delete nextDecisionPayload.routing_discovery_checkpoint;
        delete nextDecisionPayload.routing_discovery_checkpointed;
        delete nextDecisionPayload.routing_discovery_checkpointed_at;
        delete nextDecisionPayload.context_plan;

        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:null,
          decisionPayload:nextDecisionPayload,
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        node.parent_path=node.parent_path??parentPathOf(node.node_path);
        forceReconsider=true;

        console.log('AAU_AUTONOMOUS_EVIDENCE_CEILING_RETURNED_TO_AGENT',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          reason:evidenceRenewalAssessment.reason,
          resource_reasons:effectiveResourceView.reasons,
          remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
          policy:'bound_agent_resolution_no_global_pause',
        }));
        continue;
      }

      const admissionReasons=[];
      if(decision==='SPLIT'&&!storageDepthAvailable)
        admissionReasons.push('emergency_storage_path_depth_reached');
      if(decision==='SPLIT'&&availableChildCapacity<1)
        admissionReasons.push('insufficient_branch_lifecycle_budget');
      if(decision==='ATOMIC'&&atomicUnavailable)
        admissionReasons.push('bounded_atomic_execution_admission_exhausted');
      if(decision==='NEED_CONTEXT'&&!effectiveResourceView.available)
        admissionReasons.push('context_acquisition_resource_exhausted');
      if(decision==='REMEDIATE'&&!remediationAvailable)
        admissionReasons.push('self_remediation_admission_exhausted');

      if(admissionReasons.length){
        const admission={
          contract:'cognition_resource_admission_v0_2_autonomous_evidence_windows',
          status:'DEFERRED',
          semantic_decision:decision,
          reasons:admissionReasons,
          remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
          semantic_child_capacity:availableChildCapacity,
          expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
          completion_reserve_units:branchEconomics.completion_reserve_units,
          storage_path_depth:normalizedBranchDepth,
          emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
          context_resource_available:effectiveResourceView.available,
          context_resource_reasons:effectiveResourceView.reasons,
          evidence_window_renewal:evidenceRenewalAssessment,
          atomic_execution_failures:atomicExecutionFailures,
          discovery_fingerprint:discovery.context_fingerprint,
          resume_policy:'reuse_semantic_decision_until_evidence_mutation',
          deferred_at:new Date().toISOString(),
        };
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:decision,
          decisionPayload:{
            ...decisionPayload,
            routing_admission:admission,
          },
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        if(
          decision==='NEED_CONTEXT'
          &&evidenceRenewalAssessment?.reason==='insufficient_semantic_budget'
        ){
          const economicTerminal=await closeSemanticRuntime('budget_exhausted',{
            reason:'protected_completion_reserve_economic_exhaustion',
            node_path:node.node_path,
            semantic_decision:decision,
            remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
            required_budget_units:Number(evidenceRenewalAssessment.required_budget_units||0),
            completion_reserve_units:Number(branchEconomics.completion_reserve_units||0),
            evidence_window_no:Number(contextState.evidence_window_no||0),
            evidence_window_renewals:Number(contextState.evidence_window_renewals||0),
            semantic_state_preserved:true,
            discovery_replay_forbidden_until_evidence_mutation:true,
          });
          const error=new Error(
            'semantic_runtime_budget_exhausted:economic_admission:'+node.node_path
            +':remaining='+String(economicTerminal?.remaining_budget_units??0)
          );
          error.code='SEMANTIC_BUDGET_EXHAUSTED';
          error.semanticRuntime=economicTerminal;
          error.admission=admission;
          throw error;
        }
        const error=new Error(
          'cognition_admission_deferred:'+node.node_path+':'+admissionReasons.join(',')
        );
        error.code='COGNITION_ADMISSION_DEFERRED';
        error.admission=admission;
        throw error;
      }

      if(decision==='NEED_CONTEXT'){

        let rawRequests=asArray(discovery.context_requests).map(text).filter(Boolean);
        let plannedResearchQueries=asArray(discovery.research_queries).map(text).filter(Boolean);
        let plannedResearchUrls=asArray(discovery.research_urls).map(text).filter(v=>/^https:\/\//i.test(v));

        if(!rawRequests.length&&!plannedResearchQueries.length&&!plannedResearchUrls.length){
          const windowNo=Math.max(0,Number(contextState.evidence_window_no||0));
          const contextPlanIdentity=sha256({
            node_path:node.node_path,
            discovery_fingerprint:discovery.context_fingerprint,
            semantic_decision:'NEED_CONTEXT',
            unresolved_gaps:discovery.unresolved_gaps,
            evidence_window_no:windowNo,
            prior_request_signal:contextState.last_request_signal||null,
            source_catalog_hash:sha256(
              asArray(contextPayload.research_source_catalog).map(v=>({
                source_id:v?.source_id||null,url:v?.url||null,sha256:v?.sha256||null
              }))
            ),
          });
          const durableContextPlan=await loadJsonPhaseCheckpoint(
            node.node_path,'CONTEXT_PLAN',contextPlanIdentity
          );
          let contextPlan=durableContextPlan.parsed;
          for(let attempt=1;attempt<=2&&!contextPlan;attempt++){
            const response=await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent authoring an EXECUTABLE CONTEXT ACQUISITION PLAN for a semantic decision you already made: NEED_CONTEXT.',
                'Do not change, reinterpret, or revisit the NEED_CONTEXT decision in this phase.',
                'The runtime autonomously opened a bounded evidence window. Specify materially useful retrievals that can reduce the persisted unresolved gaps.',
                'Avoid repeating the prior request signal. Prefer exact URLs already present in research_source_catalog when a known source is relevant but its excerpt is insufficient; otherwise provide materially different research queries.',
                'Return JSON only: {"context_requests":[],"research_queries":[],"research_urls":[],"plan_reason":"why these retrievals target the unresolved gaps"}. At least one retrieval item is required.',
              ].join('\n')},
              {role:'user',content:safeJson({
                requirement:node.requirement_text,
                semantic_decision:'NEED_CONTEXT',
                persisted_reason:discovery.reason,
                unresolved_gaps:discovery.unresolved_gaps,
                evidence_assessment:discovery.evidence_assessment,
                prior_request_signal:contextState.last_request_signal||null,
                evidence_window:{
                  window_no:windowNo,
                  renewals:Number(contextState.evidence_window_renewals||0),
                  limits:effectiveResourceView.evidence_window_limits,
                },
                research_source_catalog:compactResearchCatalogForModel(
                  contextPayload.research_source_catalog,'minimal'
                ).slice(-120),
                available_context_index:idx,
              })},
            ],2500,'req_'+node.node_path.replaceAll('.','_')+'_context_plan_'+windowNo+'_'+attempt);
            const candidate=asObject(response?.parsed);
            const candidateRequests=asArray(candidate.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
            const candidateQueries=asArray(candidate.research_queries).map(text).filter(Boolean).slice(0,8);
            const candidateUrls=asArray(candidate.research_urls).map(text).filter(v=>/^https:\/\//i.test(v)).slice(0,8);
            if(!candidateRequests.length&&!candidateQueries.length&&!candidateUrls.length){
              if(attempt===2){
                const error=new Error('autonomous_decomposition_context_plan_empty:'+node.node_path);
                error.code='COGNITION_CONTEXT_PLAN_EXHAUSTED';
                throw error;
              }
              continue;
            }
            contextPlan={
              context_requests:candidateRequests,
              research_queries:candidateQueries,
              research_urls:candidateUrls,
              plan_reason:clip(candidate.plan_reason,2200),
            };
          }
          if(!contextPlan)
            throw new Error('autonomous_decomposition_context_plan_missing:'+node.node_path);

          if(!durableContextPlan.parsed){
            await saveJsonPhaseCheckpoint(
              node.node_path,'CONTEXT_PLAN',contextPlanIdentity,contextPlan,{
                semantic_decision:'NEED_CONTEXT',
                evidence_window_no:windowNo,
                retrieval_item_count:
                  asArray(contextPlan.context_requests).length
                  +asArray(contextPlan.research_queries).length
                  +asArray(contextPlan.research_urls).length,
              }
            );
          }

          rawRequests=asArray(contextPlan.context_requests).map(text).filter(Boolean);
          plannedResearchQueries=asArray(contextPlan.research_queries).map(text).filter(Boolean);
          plannedResearchUrls=asArray(contextPlan.research_urls).map(text).filter(v=>/^https:\/\//i.test(v));

          decisionPayload.context_plan={
            contract:'autonomous_context_plan_v0_1',
            phase_checkpointed:true,
            evidence_window_no:windowNo,
            plan_reason:clip(contextPlan.plan_reason,2200),
            context_requests:rawRequests,
            research_queries:plannedResearchQueries,
            research_urls:plannedResearchUrls,
          };
          node=await saveNode({
            nodePath:node.node_path,
            parentPath:node.parent_path??parentPathOf(node.node_path),
            ordinal:node.ordinal||0,
            requirement:node.requirement_text,
            sourceKind:node.source_kind,
            sourceRef:node.source_ref,
            status:'pending',
            decisionType:'NEED_CONTEXT',
            decisionPayload,
            contextPayload,
            resultArtifact:node.result_artifact||null,
          });
          node.parent_path=node.parent_path??parentPathOf(node.node_path);
        }

        const urlRequestsFromContext=rawRequests.filter(v=>/^https:\/\//i.test(text(v)));
        const nonUrlRequests=rawRequests.filter(v=>!/^https:\/\//i.test(text(v)));
        const catalogSourceRequests=resolveCatalogSourceRequests(
          nonUrlRequests,
          contextPayload.research_source_catalog
        );
        const requests=catalogSourceRequests.unresolved;
        const researchQueries=plannedResearchQueries;
        const researchUrls=[...new Set([
          ...plannedResearchUrls,
          ...urlRequestsFromContext,
          ...catalogSourceRequests.resolved.map(v=>v.url),
        ].map(text).filter(v=>/^https:\/\//i.test(v)))].slice(0,8);
        if(!requests.length&&!researchQueries.length&&!researchUrls.length){
          const error=new Error('autonomous_decomposition_context_plan_resolved_to_empty:'+node.node_path);
          error.code='COGNITION_CONTEXT_PLAN_EXHAUSTED';
          throw error;
        }

        counters.context_requests+=requests.length+researchQueries.length+researchUrls.length;
        await chargeSemanticRuntime({
          eventKind:'context_acquisition',
          materialKey:node.node_path+':routing:'+String(contextState.context_rounds_attempted+1)+':'+sha256({requests,researchQueries,researchUrls}),
          nodePath:node.node_path,
          costUnits:semanticRuntime.context_acquire_units,
          eventFingerprint:sha256({
            node_path:node.node_path,
            phase:'routing_need_context',
            requests,
            research_queries:researchQueries,
            research_urls:researchUrls,
            prior_gap_signal:contextState.last_gap_signal||null,
          }),
          metadata:{
            phase:'routing_need_context',
            request_count:requests.length,
            query_count:researchQueries.length,
            url_count:researchUrls.length,
          },
        });
        const contextAcquisitionStartedAt=Date.now();

        const beforeCatalogCount=asArray(contextPayload.research_source_catalog).length;
        const resolved=resolveContext(packet,requests,cognitionContext);
        const newLocalContextPaths=Object.entries(resolved)
          .filter(([path,value])=>value?.available&&!Object.prototype.hasOwnProperty.call(contextPayload,path))
          .length;

        let researchObserved=null;
        if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
          researchObserved=await researchContext({
            nodePath:node.node_path,
            queries:researchQueries,
            urls:researchUrls,
          });
        }else if(researchQueries.length||researchUrls.length){
          researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
        }

        if(researchObserved?.audit_batch_id){
          await linkResearchBatch(node.node_path,researchObserved.audit_batch_id);
        }
        const researchCatalog=researchObserved
          ? mergeResearchSourceCatalog(contextPayload.research_source_catalog,researchObserved.source_index)
          : asArray(contextPayload.research_source_catalog);
        const newSourceCount=Math.max(0,researchCatalog.length-beforeCatalogCount);

        const pinnedResult=await persistExplicitResearchEvidence(node.node_path,researchUrls,researchObserved);
        const pinnedSave=pinnedResult.save;
        pinnedEvidence=pinnedResult.evidence;
        const restoredPinnedEvidence=Math.max(0,Number(pinnedSave?.restored_or_extended||0));

        const gapSignal=normalizedSignal(discovery.unresolved_gaps);
        const requestSignal=normalizedSignal([
          ...requests,
          ...researchQueries,
          ...researchUrls,
        ]);
        const gapSimilarity=contextState.last_gap_signal
          ? requirementSimilarity(contextState.last_gap_signal,gapSignal)
          : 0;
        const requestSimilarity=contextState.last_request_signal
          ? requirementSimilarity(contextState.last_request_signal,requestSignal)
          : 0;
        const productive=(newSourceCount>0||newLocalContextPaths>0||restoredPinnedEvidence>0);
        const contextAcquisitionElapsedMs=Math.max(0,Date.now()-contextAcquisitionStartedAt);

        contextState={
          ...contextState,
          version:'agent_visible_context_resource_v0_3_autonomous_evidence_windows',
          active_context_elapsed_ms:
            Math.max(0,Number(contextState.active_context_elapsed_ms||0))
            +contextAcquisitionElapsedMs,
          elapsed_accounting:'active_context_acquisition_only_v0_3_evidence_windows',
          context_rounds_attempted:Number(contextState.context_rounds_attempted||0)+1,
          research_rounds_attempted:Number(contextState.research_rounds_attempted||0)+((researchQueries.length||researchUrls.length)?1:0),
          local_context_rounds_attempted:Number(contextState.local_context_rounds_attempted||0)+(requests.length?1:0),
          stagnant_rounds:productive?0:Number(contextState.stagnant_rounds||0)+1,
          unchanged_gap_rounds:contextState.last_gap_signal&&gapSimilarity>=0.88
            ? Number(contextState.unchanged_gap_rounds||0)+1
            : 0,
          repeated_request_rounds:contextState.last_request_signal&&requestSimilarity>=0.90
            ? Number(contextState.repeated_request_rounds||0)+1
            : 0,
          total_new_sources:Number(contextState.total_new_sources||0)+newSourceCount,
          total_new_local_context_paths:Number(contextState.total_new_local_context_paths||0)+newLocalContextPaths,
          total_restored_pinned_evidence:Number(contextState.total_restored_pinned_evidence||0)+restoredPinnedEvidence,
          last_gap_signal:gapSignal||null,
          last_request_signal:requestSignal||null,
          last_round:{
            at:new Date().toISOString(),
            active_context_acquisition_ms:contextAcquisitionElapsedMs,
            cumulative_active_context_elapsed_ms:
              Math.max(0,Number(contextState.active_context_elapsed_ms||0))
              +contextAcquisitionElapsedMs,
            new_sources:newSourceCount,
            new_local_context_paths:newLocalContextPaths,
            gap_similarity:Number(gapSimilarity.toFixed(4)),
            request_similarity:Number(requestSimilarity.toFixed(4)),
            research_status:researchObserved?.status||null,
            audit_batch_id:researchObserved?.audit_batch_id||null,
            normalized_url_requests_from_context:urlRequestsFromContext.length,
            resolved_catalog_source_requests:catalogSourceRequests.resolved.map(v=>v.source_id),
            resolved_catalog_source_urls:catalogSourceRequests.resolved.map(v=>v.url),
            restored_pinned_evidence:restoredPinnedEvidence,
            pinned_evidence_items:pinnedEvidence.length,
          },
        };

        const researchRoundNumber=contextState.context_rounds_attempted;
        contextPayload=boundInMemoryContext({
          ...contextPayload,
          ...resolved,
          ...(researchCatalog.length?{research_source_catalog:researchCatalog}:{}),
          ...(researchObserved?{['external_research_round_'+researchRoundNumber]:researchObserved}:{}),
        },pinnedEvidence,10000);

        const nextResourceView=contextResourceView(contextState,contextPayload);
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'waiting_context',
          decisionType:'NEED_CONTEXT',
          decisionPayload:{
            ...decisionPayload,
            context_resource_state:contextState,
            context_requests:requests,
            research_queries:researchQueries,
            research_urls:researchUrls,
            context_resource_after_round:nextResourceView,
          },
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:'NEED_CONTEXT',
          decisionPayload:{
            ...decisionPayload,
            context_resource_state:contextState,
            context_requests:requests,
            research_queries:researchQueries,
            research_urls:researchUrls,
            context_supplied:true,
            context_resource_after_round:nextResourceView,
          },
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        continue;
      }

      if(decision==='BLOCKED'){
        const resultArtifact=JSON.stringify({
          status:'BLOCKED',
          artifact:discovery.reason||'Requirement blocked because the bound agent determined the remaining evidence gap prevents honest completion under the available runtime resources.',
          handoff:{
            conclusions:[],
            facts:[],
            unresolved:discovery.unresolved_gaps,
          },
        });
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'blocked',
          decisionType:'BLOCKED',
          decisionPayload:{
            ...decisionPayload,
            blocked_by_bound_agent:true,
            block_reason:discovery.reason,
            context_resource_state:contextState,
            context_resource_at_block:resourceView,
          },
          contextPayload,
          resultArtifact,
        });
        return {node,decision};
      }

      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:decision==='SPLIT'?'split':'executing',
        decisionType:decision,
        decisionPayload,
        contextPayload,
        resultArtifact:node.result_artifact||null,
      });
      return {node,decision};
    }
  }

  async function reviewChildProposalProvenance(node,ordinal,proposal,childContextView,previous,revisionGuidance=''){
    if(text(proposal?.status).toUpperCase()!=='CHILD'){
      return {
        status:'ACCEPT',
        reason:'No child requirement was proposed; DONE contains no child factual bindings to audit.',
        issues:[],
        evidence_bindings:[],
        agent_authored:true,
      };
    }

    const response=await callJson([
      {role:'system',content:[
        'You are the same bound autonomous agent auditing YOUR OWN proposed child requirement before it becomes durable.',
        'This is a provenance-preservation review, not a new decomposition decision.',
        'Compare every source-bound factual premise, number, date, unit, scope, entity/value relationship, and named-source attribution in the proposed child against the authoritative sibling evidence and supplied context.',
        'REVISE if the proposed child swaps or recombines values that belong to different sources, changes a source/value pairing, changes units or forecast periods, strengthens an uncertain claim into a fact, or treats a derived/scenario value as though a source directly reported it.',
        'Derived calculations and hypothetical scenarios are allowed only when the child explicitly labels them as derived/hypothetical, preserves the exact source inputs, and states the transformation or formula. Never silently relabel a transformation as a sourced fact.',
        'If the evidence does not support a factual premise needed by the proposed child, REVISE the proposal so the child researches/resolves that gap instead of baking the unsupported premise into its requirement.',
        'Do not reject merely because the child is narrower. Do not solve the child.',
        'Return JSON only: {"status":"ACCEPT|REVISE","reason":"auditable explanation","issues":["..."],"evidence_bindings":[{"claim":"...","source_path_or_id":"...","preserved":true}],"revision_guidance":"specific guidance when REVISE; empty when ACCEPT"}.',
      ].join('\n')},
      {role:'user',content:safeJson({
        parent_requirement:node.requirement_text,
        agent_authored_discovery_state:agentDiscoveryState(node),
        proposed_child:{
          requirement:proposal.requirement,
          scope_removed:proposal.scope_removed,
          completion_criterion:proposal.completion_criterion,
          reason:proposal.reason,
        },
        authoritative_completed_sibling_evidence:childContextView.siblingEvidence,
        supplied_context:childContextView.suppliedContext,
        previously_authored_children:previous,
        prior_provenance_revision_guidance:revisionGuidance||null,
      })},
    ],stageBudgets.child_provenance_review,'req_'+node.node_path.replaceAll('.','_')+'_author_child_provenance_'+ordinal);

    const candidate=asObject(response?.parsed);
    const status=text(candidate.status).toUpperCase();
    if(!['ACCEPT','REVISE'].includes(status))
      throw new Error('autonomous_decomposition_child_provenance_status_invalid:'+node.node_path);

    return {
      status,
      reason:clip(candidate.reason,2400),
      issues:asArray(candidate.issues).map(v=>clip(v,800)).filter(Boolean).slice(0,16),
      evidence_bindings:asArray(candidate.evidence_bindings).map(v=>({
        claim:clip(v?.claim,800),
        source_path_or_id:clip(v?.source_path_or_id,500),
        preserved:Boolean(v?.preserved),
      })).filter(v=>v.claim||v.source_path_or_id).slice(0,24),
      revision_guidance:clip(candidate.revision_guidance,2400),
      agent_authored:true,
    };
  }

  async function authorChildren(node,{branchDepth=0,singleChildRefinements=0}={}){
    const allExisting=await children(node.node_path);
    const existing=allExisting
      .filter((child)=>String(child?.status||'')!=='cancelled')
      .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
    const childAuthoringFinalized=Boolean(node?.decision_payload?.children_authored);
    if(existing.length&&childAuthoringFinalized)
      return {children:existing,reconsider:false};

    // Durable children are authoritative accepted work. A restart continues from them;
    // it never starts the decomposition over from the parent requirement.
    const authored=existing.map(child=>({
      ...child,
      parent_path:child.parent_path??node.node_path,
    }));
    const normalizedBranchDepth=pathDepth(node.node_path);
    const storageDepthAvailable=Number.isFinite(normalizedBranchDepth)
      &&normalizedBranchDepth<semanticRuntime.hard_storage_path_depth;
    if(!storageDepthAvailable)
      throw new Error('autonomous_decomposition_split_mode_unavailable:'+node.node_path);
    const startOrdinal=Math.max(0,...allExisting.map((child)=>Number(child?.ordinal||0)))+1;

    const returnChildAuthoringFailure=async({ordinal,phase,error})=>{
      const failureCount=Math.max(0,Number(node?.decision_payload?.child_authoring_failure_count||0))+1;
      const priorDiscovery=asObject(node?.decision_payload?.routing_discovery_checkpoint);
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:null,
        decisionPayload:{
          ...(node.decision_payload||{}),
          reconsider_decomposition:true,
          child_authoring_failure_count:failureCount,
          child_authoring_failure:{
            version:'agent_visible_child_authoring_failure_v0_1',
            at:new Date().toISOString(),
            ordinal,
            phase,
            rejection_reason:String(error?.rejectionReason||error?.code||error?.message||'child_authoring_failed').slice(0,300),
            finish_reason:error?.finishReason||null,
            prior_split_discovery:{
              decision:text(priorDiscovery.decision)||'SPLIT',
              reason:clip(priorDiscovery.reason,1600)||null,
              context_fingerprint:text(priorDiscovery.context_fingerprint)||null,
            },
            rejected_attempt_evidence_durable:true,
            next_action_owned_by_bound_agent:true,
          },
        },
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      console.warn('AAU_AUTONOMOUS_CHILD_AUTHORING_RETURNED_TO_AGENT',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        ordinal,
        phase,
        child_authoring_failure_count:failureCount,
        rejection_reason:String(error?.rejectionReason||error?.code||error?.message||'child_authoring_failed').slice(0,300),
      }));
      return {children:[],reconsider:true,node:reset};
    };

    const finalizeBudgetConstrainedSplit=async({
      runtimeView,branchEconomics,availableChildCapacity
    })=>{
      const finalized=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'split',decisionType:'SPLIT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          child_count:authored.length,
          children_authored:true,
          conserved_branch_economics_constraint_applied:true,
          semantic_branch_economics_contract:branchEconomics.contract,
          expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
          completion_reserve_units:branchEconomics.completion_reserve_units,
          branch_economics_components:branchEconomics.components,
          remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
          semantic_child_capacity_at_stop:availableChildCapacity,
          storage_path_depth:normalizedBranchDepth,
          emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
          child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
        },
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      return {children:authored,reconsider:false,node:finalized};
    };

    for(let offset=0;offset<MAX_CHILDREN_PER_NODE;offset++){
      const ordinal=startOrdinal+offset;
      const previous=authored.map(c=>({
        node_path:c.node_path||null,
        ordinal:Number(c.ordinal||0),
        status:c.node_status||c.status||null,
        requirement:c.requirement_text,
        scope_removed:c?.decision_payload?.scope_removed||null,
        completion_criterion:c?.decision_payload?.completion_criterion||null,
      }));
      const runtimeView=await semanticRuntimeView();
      const childPinnedEvidence=await loadPinnedEvidence(node.node_path);
      const branchEconomics=projectedBranchEconomics(node.context_payload||{},childPinnedEvidence);
      const currentChildCapacity=semanticChildCapacity({
        remainingBudgetUnits:Number(runtimeView?.remaining_budget_units||0),
        nodeCreateUnits:semanticRuntime.node_create_units,
        safetyReserveUnits:semanticRuntime.safety_reserve_units,
        expectedChildLifecycleUnits:branchEconomics.expected_child_lifecycle_units,
        completionReserveUnits:branchEconomics.completion_reserve_units,
        maxChildren:MAX_CHILDREN_PER_NODE-authored.length,
      });
      const structuralBranchingAvailable=currentChildCapacity>=2;
      const singleRefinementAvailable=currentChildCapacity>=1;
      if(currentChildCapacity<1){
        if(authored.length<1)
          throw new Error('autonomous_decomposition_split_mode_unavailable:'+node.node_path);
        return finalizeBudgetConstrainedSplit({
          runtimeView,branchEconomics,availableChildCapacity:currentChildCapacity,
        });
      }
      const childContextView=agentModelContextView(
        node.context_payload||{},childPinnedEvidence,stageBudgets.child_formulation
      );

      let proposalCheckpoint=await loadChildProposalCheckpoint(node,ordinal,previous);
      let proposal=proposalCheckpoint?.proposal||null;

      if(!proposal){
        let formulationError=null;
        let provenanceRevisionGuidance='';
        for(let attempt=1;attempt<=2;attempt++){
          try{
            const response=await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent FORMULATING the next child for ONE parent requirement.',
                'Thinking is enabled. Do the substantive decomposition reasoning here.',
                'You own the child requirement. The runtime will not invent, narrow, or repair it for you.',
                'Author exactly ONE next child requirement, or declare DONE when the children already authored adequately cover the parent.',
                'previously_authored_children are durable, accepted, and authoritative. Do NOT restate, paraphrase, re-research, or recreate work already assigned to any previous child.',
                'When supplied_context.expertise_candidate_ledger is available and the parent asks for repeated candidate/proposal work, bind each child to exactly ONE canonical ledger candidate. Preserve that candidate domain verbatim in the child requirement; include its proposal_id when useful. Different canonical proposal_ids/domains are distinct work instances even when they share the same analytical framework.',
                'Derive the NEXT child only from the parent scope that remains uncovered after subtracting previously_authored_children. If no independently executable scope remains, return DONE.',
                'The runtime performs terminal parent synthesis automatically after all children resolve. Do NOT create a child whose sole purpose is to merge, format, summarize, reconcile, or submit the other children; return DONE instead when only terminal synthesis remains.',
                'A CHILD must be independently completable, materially narrower than the parent, non-overlapping with accepted children, and include explicit scope removed plus a concrete completion criterion.',
                'Do not execute or solve the child.',
                'Return complete JSON only: {"status":"CHILD","requirement":"...","scope_removed":"...","completion_criterion":"...","reason":"brief"} OR {"status":"DONE","coverage_note":"brief"}.',
                'There is no required number of children. One child is valid only when genuinely narrower; use as many or as few children as your reasoning requires within the conserved work budget.',
                'Current semantic child capacity from the live remaining budget is '+currentChildCapacity+'. Each additional child is priced at approximately '+branchEconomics.expected_child_lifecycle_units+' units for first-pass lifecycle work, while '+branchEconomics.completion_reserve_units+' units remain protected for terminal reconciliation/synthesis. Tree depth is not the ordinary convergence rule; the '+semanticRuntime.hard_storage_path_depth+'-level path ceiling is only an emergency persistence guard.',
              ].join('\n')},
              {role:'user',content:safeJson({
                parent_requirement:node.requirement_text,
                agent_authored_discovery_state:agentDiscoveryState(node),
                authoritative_completed_sibling_evidence:childContextView.siblingEvidence,
                supplied_context:childContextView.suppliedContext,
                previously_authored_children:previous,
                prior_child_authoring_failure:asObject(node?.decision_payload?.child_authoring_failure),
                provenance_revision_guidance:provenanceRevisionGuidance||null,
                runtime_resource_constraints:{
                  semantic_runtime_contract:SEMANTIC_RUNTIME_CONTRACT,
                  remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
                  semantic_child_capacity:currentChildCapacity,
                  semantic_branch_economics_contract:branchEconomics.contract,
                  expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
                  completion_reserve_units:branchEconomics.completion_reserve_units,
                  branch_economics_components:branchEconomics.components,
                  storage_path_depth:normalizedBranchDepth,
                  emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
                  multi_child_split_available:structuralBranchingAvailable,
                  single_child_refinement_available:singleRefinementAvailable,
                  max_children_this_split:currentChildCapacity,
                },
              })},
            ],stageBudgets.child_formulation,'req_'+node.node_path.replaceAll('.','_')+'_author_child_formulate_'+ordinal+'_'+attempt);

            const candidate=asObject(response?.parsed);
            const candidateStatus=text(candidate.status).toUpperCase();
            if(!['CHILD','DONE'].includes(candidateStatus))
              throw new Error('autonomous_decomposition_child_formulation_status_invalid:'+node.node_path);
            if(candidateStatus==='CHILD'){
              const validation=childConvergenceValidation(
                node.requirement_text,
                candidate.requirement,
                candidate.scope_removed,
                candidate.completion_criterion
              );
              if(!validation.valid)
                throw new Error('autonomous_decomposition_nonconvergent_child:'+node.node_path+':'+validation.failures.join(','));
              candidate._convergence_validation=validation;

              if(runtimeOwnedTerminalSynthesisChild(candidate)){
                proposal={
                  status:'DONE',
                  coverage_note:'Remaining uncovered work is terminal synthesis/formatting/submission owned by the runtime under '+TERMINAL_SYNTHESIS_OWNERSHIP_VERSION+'.',
                  _runtime_terminal_synthesis_collapsed:true,
                };
                proposalCheckpoint={
                  row:await saveChildProposalCheckpoint(node,ordinal,proposal,previous),
                  proposal,
                };
                console.log('AAU_AUTONOMOUS_TERMINAL_SYNTHESIS_CHILD_COLLAPSED',JSON.stringify({
                  agent_id:agentId,
                  intent_execution_id:intentExecutionId,
                  node_path:node.node_path,
                  ordinal,
                  ownership_version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
                }));
                break;
              }

              const candidateCanonicalIdentity=canonicalCandidateIdentity(
                candidate,childContextView.suppliedContext
              );
              const siblingOverlap=previous
                .map(v=>({
                  ordinal:Number(v?.ordinal||0),
                  requirement:text(v?.requirement),
                  similarity:requirementSimilarity(candidate.requirement,v?.requirement),
                  explicit_instance_id:explicitRepeatedInstanceId(v),
                  explicit_instance_disjoint:explicitRepeatedInstancesDisjoint(candidate,v),
                  canonical_identity:canonicalCandidateIdentity(
                    v,childContextView.suppliedContext
                  ),
                  canonical_instance_disjoint:canonicalRepeatedInstancesDisjoint(
                    candidate,v,childContextView.suppliedContext
                  ),
                }))
                .sort((a,b)=>b.similarity-a.similarity)[0]||null;
              const candidateInstanceId=explicitRepeatedInstanceId(candidate);
              if(
                siblingOverlap
                &&siblingOverlap.similarity>=0.78
                &&!siblingOverlap.explicit_instance_disjoint
                &&!siblingOverlap.canonical_instance_disjoint
              ){
                provenanceRevisionGuidance=
                  'The proposed child overlaps accepted child ordinal '
                  +siblingOverlap.ordinal
                  +' (requirement similarity '+siblingOverlap.similarity.toFixed(3)+'). '
                  +'Treat that child as already assigned. Author only uncovered parent scope, or return DONE if only terminal parent synthesis remains.';
                const overlapError=new Error('autonomous_decomposition_overlapping_child:'+node.node_path);
                overlapError.code='COGNITION_CHILD_OVERLAP';
                throw overlapError;
              }
              candidate._sibling_overlap_validation={
                valid:true,
                max_similarity:Number(siblingOverlap?.similarity||0),
                compared_children:previous.length,
                explicit_instance_id:candidateInstanceId,
                canonical_candidate_identity:candidateCanonicalIdentity,
                compared_sibling_canonical_identity:siblingOverlap?.canonical_identity||null,
                disjoint_repeated_instance_override:Boolean(
                  siblingOverlap?.similarity>=0.78
                  &&(
                    siblingOverlap?.explicit_instance_disjoint
                    ||siblingOverlap?.canonical_instance_disjoint
                  )
                ),
                override_basis:
                  siblingOverlap?.canonical_instance_disjoint
                    ?'canonical_candidate_identity'
                    :siblingOverlap?.explicit_instance_disjoint
                      ?'explicit_repeated_instance'
                      :null,
              };

              const provenanceReview=await reviewChildProposalProvenance(
                node,
                ordinal,
                candidate,
                childContextView,
                previous,
                provenanceRevisionGuidance
              );
              console.log('AAU_AUTONOMOUS_CHILD_PROVENANCE_REVIEW',JSON.stringify({
                agent_id:agentId,
                intent_execution_id:intentExecutionId,
                node_path:node.node_path,
                ordinal,
                status:provenanceReview.status,
                issue_count:provenanceReview.issues.length,
              }));
              if(provenanceReview.status!=='ACCEPT'){
                provenanceRevisionGuidance=
                  provenanceReview.revision_guidance
                  ||provenanceReview.reason
                  ||'Revise the child requirement so every source-bound claim preserves the authoritative evidence bindings.';
                if(attempt===2)
                  throw new Error('autonomous_decomposition_child_provenance_rejected:'+node.node_path);
                continue;
              }
              candidate._provenance_review=provenanceReview;
            }
            proposal=candidate;
            proposalCheckpoint={row:await saveChildProposalCheckpoint(node,ordinal,proposal,previous),proposal};
            break;
          }catch(error){
            formulationError=error;
            const recoverable=
              error?.code==='COGNITION_RESPONSE_REJECTED'
              || error?.code==='NVIDIA_TIMEOUT'
              || String(error?.message||'').startsWith('autonomous_decomposition_nonconvergent_child:')
              || String(error?.message||'').startsWith('autonomous_decomposition_child_formulation_status_invalid:')
              || error?.code==='COGNITION_CHILD_OVERLAP'
              || String(error?.message||'').startsWith('autonomous_decomposition_overlapping_child:')
              || String(error?.message||'').startsWith('autonomous_decomposition_child_provenance_status_invalid:')
              || String(error?.message||'').startsWith('autonomous_decomposition_child_provenance_rejected:');
            if(!recoverable)throw error;
            if(attempt===2)
              return returnChildAuthoringFailure({ordinal,phase:'deep_formulation',error});
          }
        }
        if(!proposal&&formulationError)
          return returnChildAuthoringFailure({ordinal,phase:'deep_formulation',error:formulationError});
      }

      const proposalStatus=text(proposal?.status).toUpperCase();
      let parsed=null;
      if(proposalStatus==='CHILD'){
        parsed={status:'CHILD',requirement:text(proposal.requirement),scope_removed:text(proposal.scope_removed),completion_criterion:text(proposal.completion_criterion),reason:text(proposal.reason),_convergence_validation:proposal._convergence_validation,_sibling_overlap_validation:proposal._sibling_overlap_validation,_provenance_review:proposal._provenance_review};
      }else if(proposalStatus==='DONE'){
        parsed={status:'DONE',coverage_note:text(proposal.coverage_note)};
      }else{
        throw new Error('autonomous_decomposition_child_checkpoint_status_invalid:'+node.node_path);
      }
      console.log('AAU_AUTONOMOUS_CHILD_SERIALIZED_DETERMINISTIC',JSON.stringify({agent_id:agentId,intent_execution_id:intentExecutionId,node_path:node.node_path,ordinal,status:proposalStatus,policy:'checkpoint_exact_projection_v0_1'}));

      const status=text(parsed?.status).toUpperCase();
      if(status==='DONE'){
        if(authored.length<1)
          throw new Error('autonomous_decomposition_split_requires_child:'+node.node_path);
        await saveNode({
          nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
          requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
          status:'split',decisionType:'SPLIT',
          decisionPayload:{
            ...(node.decision_payload||{}),
            child_count:authored.length,
            coverage_note:clip(parsed?.coverage_note,1500),
            children_authored:true,
            child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
          },
          contextPayload:node.context_payload||{},resultArtifact:null,
        });
        return {children:authored,reconsider:false};
      }

      const requirement=text(parsed?.requirement);
      if(requirement.length<5)throw new Error('autonomous_decomposition_child_requirement_empty:'+node.node_path);
      const duplicate=authored.some(c=>
        c.requirement_hash===sha256(requirement)
        || normalizedRequirement(c.requirement_text)===normalizedRequirement(requirement)
      );
      if(duplicate){
        const duplicateError=new Error('autonomous_decomposition_duplicate_child:'+node.node_path);
        duplicateError.code='COGNITION_CHILD_OVERLAP';
        duplicateError.rejectionReason=
          'accepted_child_already_covers_proposed_scope; formulate_only_remaining_scope_or_DONE';
        return returnChildAuthoringFailure({
          ordinal,
          phase:'duplicate_child_remaining_scope',
          error:duplicateError,
        });
      }

      const nodePath=node.node_path+'.'+String(ordinal).padStart(3,'0');
      const childRequirementHash=sha256(requirement);
      await chargeSemanticRuntime({
        eventKind:'semantic_node_created',
        materialKey:nodePath+':'+childRequirementHash,
        nodePath,
        costUnits:semanticRuntime.node_create_units,
        eventFingerprint:sha256({
          parent_path:node.node_path,
          child_path:nodePath,
          requirement_hash:childRequirementHash,
        }),
        metadata:{
          parent_path:node.node_path,
          ordinal,
          requirement_hash:childRequirementHash,
        },
      });
      const child=await saveNode({
        nodePath,parentPath:node.node_path,ordinal,
        requirement,sourceKind:'agent_decomposition',sourceRef:node.node_path,
        status:'pending',decisionType:null,
        decisionPayload:{
          authored_reason:clip(parsed?.reason,1200),
          authored_by_bound_agent:true,
          scope_removed:clip(parsed?.scope_removed,1600),
          completion_criterion:clip(parsed?.completion_criterion,1600),
          convergence_similarity:Number(parsed?._convergence_validation?.similarity||0),
          sibling_overlap_validation:asObject(parsed?._sibling_overlap_validation),
          provenance_review:asObject(parsed?._provenance_review),
          child_proposal_checkpoint_step_key:childProposalStepKey(node,ordinal),
          child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
        },
        contextPayload:inheritedChildContext(node.context_payload),resultArtifact:null,
      });

      const inheritedPinned=await loadPinnedEvidence(node.node_path);
      if(inheritedPinned.length){
        const inheritedSave=await pinnedEvidenceRpc('save',nodePath,inheritedPinned.map(v=>({
          source_key:v.source_key,
          source_id:v.source_id,
          url:v.url,
          title:v.title,
          publisher:v.publisher,
          sha256:v.sha256,
          fetch_status:v.fetch_status,
          coverage:v.coverage,
          excerpt:v.excerpt,
          audit_batch_id:v.audit_batch_id,
        })));
        if(inheritedSave?.status!=='ready')
          throw new Error('autonomous_decomposition_pinned_evidence_inherit_failed:'+nodePath);
      }

      child.parent_path=node.node_path;
      authored.push(child);
      counters.nodes++;

    }
    throw new Error('autonomous_decomposition_child_resource_limit:'+node.node_path);
  }

  async function executeAtomic(node){
    let pinnedEvidence=await loadPinnedEvidence(node.node_path);
    const atomicDurableCatalog=await loadDurableResearchCatalog(node.node_path);
    const atomicBaseContext={
      ...(node.context_payload||{}),
      ...(atomicDurableCatalog.length?{
        research_source_catalog:mergeResearchSourceCatalog(
          node.context_payload?.research_source_catalog,
          atomicDurableCatalog
        )
      }:{}),
    };
    const atomicContextView=()=>agentModelContextView(
      atomicBaseContext,pinnedEvidence,stageBudgets.atomic_execution
    );
    const siblingEvidence=atomicContextView().siblingEvidence;
    const atomicCognitionContext=()=>atomicContextView().suppliedContext;
    const mathRetryState=qdaQuantitativeAtomicRequirement(packet,node)?{
      required:Boolean(node?.decision_payload?.deterministic_math_reconciliation_required),
      attempt:Math.max(0,Number(node?.decision_payload?.deterministic_math_attempts||0)),
      gate:text(node?.decision_payload?.deterministic_math_gate)||null,
      feedback:asObject(node?.context_payload?.deterministic_math_feedback),
    }:null;
    const statisticsRetryState=qdaStatisticalAtomicRequirement(packet,node)?{
      required:Boolean(node?.decision_payload?.deterministic_statistics_reconciliation_required),
      attempt:Math.max(0,Number(node?.decision_payload?.deterministic_statistics_attempts||0)),
      gate:text(node?.decision_payload?.deterministic_statistics_gate)||null,
      feedback:asObject(node?.context_payload?.deterministic_statistics_feedback),
    }:null;
    const atomicSemanticIdentity=sha256({
      node_path:node.node_path,
      requirement:node.requirement_text,
      discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
      deterministic_math_retry:mathRetryState,
      deterministic_statistics_retry:statisticsRetryState,
      authoritative_sibling_results:siblingEvidence.map(v=>({
        path:v.path,status:v.status,decision_type:v.decision_type,result_hash:v.result_hash
      })),
      supplied_context:atomicCognitionContext(),
      pinned_evidence:pinnedEvidence.map(v=>({
        source_key:v.source_key,url:v.url,sha256:v.sha256,excerpt_bytes:v.excerpt_bytes
      })),
    });
    const durableAtomic=await loadJsonPhaseCheckpoint(
      node.node_path,'ATOMIC_EXECUTION',atomicSemanticIdentity
    );
    let parsed=durableAtomic.parsed;
    if(!parsed){
    try{
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent executing exactly ONE requirement you previously judged ATOMIC.',
              'Complete only this requirement. Do not silently expand into unrelated work.',
              'authoritative_completed_sibling_evidence contains durable outputs from direct siblings and inherited ancestor prerequisites. Treat both as available evidence and inspect them before asking for information already supplied anywhere in the dependency chain.',
              'If you discover it is not actually bounded, return {"status":"SPLIT","reason":"..."} instead of forcing an oversized answer.',
              'If context is missing, return {"status":"NEED_CONTEXT","context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."],"reason":"..."}. You choose any research questions; do not fabricate findings.',
              'Otherwise return JSON only: {"status":"COMPLETE","artifact":"concise auditable work product OR a real nested JSON object when the requirement names a structured lifecycle contract","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
              'Never stringify an object as "[object Object]". If the work product is structured, place the actual JSON object in artifact.',
              'Keep the artifact bounded. Preserve uncertainty and do not claim external facts without supplied evidence.',
              ...(qdaQuantitativeAtomicRequirement(packet,node)?[
                'DETERMINISTIC MATH COMPANION: this is a quantitative QDA requirement. Return artifact as a real JSON object and put python_checks INSIDE that artifact object, not beside the wrapper. Each material numerical result must have a check object with label, expression, and claimed_result. The expression may use numeric constants, + - * / ** %, parentheses, and safe functions such as sqrt/log/log10/exp/abs/round. Python verifies arithmetic only; you remain responsible for selecting the correct formula, units, assumptions, and interpretation.',
                'Do your reasoning first. Treat a later Python disagreement as evidence that your numerical execution must be reconciled; never change the formula merely to force a match.',
                'If deterministic_math_feedback is present, this is a fresh correction attempt. Inspect that feedback explicitly and return NEW python_checks; do not repeat or reuse an earlier artifact.'
              ]:[]),
              ...(qdaStatisticalAtomicRequirement(packet,node)?[
                'QUANTITATIVE PYTHON STATISTICS COMPANION: choose the statistical method yourself, state why it is appropriate, state assumptions/limitations, then return artifact as a real JSON object containing python_analyses INSIDE that artifact object, not beside the wrapper.',
                'Each python_analyses item must contain id, analysis, spec, and claims. claims are YOUR numerical/statistical conclusions keyed to result fields (for example mean, median, r, ci_low, ci_high, t, p_two_sided). Python recomputes them independently.',
                'Allowed analyses include describe, pearson_correlation, simple_linear_regression, proportion_ci, difference_proportions_ci, mean_ci, one_sample_t, welch_t, coefficient_t, bootstrap_ci, and monte_carlo_expression.',
                'Python owns numerical execution only. You own method selection, assumptions, causal limits, interpretation, and decision relevance. A p-value or correlation is not a causal conclusion.',
                'If deterministic_statistics_feedback is present, this is a fresh correction attempt. Inspect the returned calculations/diagnostics explicitly and return NEW python_analyses and revised interpretation; do not reuse the rejected artifact.'
              ]:[]),
               'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
            ].join('\n')},
            {role:'user',content:safeJson({
              requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              authoritative_completed_sibling_evidence:siblingEvidence,
              supplied_context:atomicCognitionContext(),
              deterministic_math_feedback:mathRetryState?.feedback||null,
              deterministic_math_retry_attempt:mathRetryState?.attempt||0,
              deterministic_statistics_feedback:statisticsRetryState?.feedback||null,
              deterministic_statistics_retry_attempt:statisticsRetryState?.attempt||0,
              available_context_index:idx,
              available_supplied_context_index:indexObject(atomicCognitionContext()),
            })},
          ],stageBudgets.atomic_execution,'req_'+node.node_path.replaceAll('.','_')+'_atomic_'+attempt);
          parsed=response?.parsed;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT')throw error;
        }
      }
    }catch(error){
      if(error?.code==='NVIDIA_TIMEOUT')throw error;
      if(error?.code==='COGNITION_RESPONSE_REJECTED'){
        const atomicExecutionFailures=Math.max(0,Number(node?.decision_payload?.atomic_execution_failures||0))+1;
        const reset=await saveNode({
          nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
          requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
          status:'pending',decisionType:null,
          decisionPayload:{
            ...(node.decision_payload||{}),
            prior_atomic_rejection:String(error?.rejectionReason||error?.code||'incomplete'),
            reconsider_decomposition:true,
            atomic_execution_failures:atomicExecutionFailures,
            atomic_unavailable:atomicExecutionFailures>=MAX_ATOMIC_EXECUTION_FAILURES,
          },
          contextPayload:node.context_payload||{},resultArtifact:null,
        });
        reset.parent_path=node.parent_path??parentPathOf(node.node_path);
        return {reconsider:true,node:reset};
      }
      throw error;
    }
    }

    const atomicStageContractForProtocol=
      stageContractForRequirement(packet,node.requirement_text,node.node_path);
    let status=text(parsed?.status).toUpperCase();

    // Structured lifecycle contracts are allowed to arrive as the contract
    // object itself instead of the generic atomic wrapper. Treat that as a
    // mechanical protocol variant only when the object actually validates
    // against the authoritative current stage contract.
    if(!['SPLIT','NEED_CONTEXT','COMPLETE'].includes(status)
       &&atomicStageContractForProtocol.applies){
      const directCandidates=[
        asObject(parsed?.proposal),
        (parsed?.artifact&&typeof parsed.artifact==='object'&&!Array.isArray(parsed.artifact))
          ?asObject(parsed.artifact):{},
        asObject(parsed),
      ].filter(v=>Object.keys(v).length);
      const directProposal=directCandidates.find(candidate=>
        validateStageContractArtifact(
          atomicStageContractForProtocol.definition,
          safeJson(candidate)
        ).valid
      );
      if(directProposal){
        parsed={
          status:'COMPLETE',
          artifact:directProposal,
          handoff:asObject(parsed?.handoff),
          _atomic_protocol_normalization:{
            version:'structured_stage_contract_direct_atomic_v0_1',
            original_status:text(parsed?.status)||null,
            original_outcome:text(parsed?.outcome)||null,
            normalized_status:'COMPLETE',
            stage_contract_name:atomicStageContractForProtocol.name,
          },
        };
        status='COMPLETE';
        console.log('AAU_AUTONOMOUS_ATOMIC_PROTOCOL_NORMALIZED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          normalization:'structured_stage_contract_direct_atomic_v0_1',
          stage_contract_name:atomicStageContractForProtocol.name,
        }));
      }
    }

    // Also accept the generic outcome label as a mechanical alias when the
    // model otherwise followed the atomic response contract.
    if(!['SPLIT','NEED_CONTEXT','COMPLETE'].includes(status)){
      const outcomeAlias=text(parsed?.outcome).toUpperCase();
      if(['SPLIT','NEED_CONTEXT','COMPLETE'].includes(outcomeAlias)){
        parsed={...parsed,status:outcomeAlias};
        status=outcomeAlias;
      }
    }

    // QDA quantitative/statistical atomic work sometimes arrives as the
    // artifact object itself rather than the generic {status,artifact} wrapper.
    // This is a protocol-shape normalization only. It does NOT certify the
    // computation: deterministic Python verification still runs immediately
    // afterward and blocks any numerical/statistical disagreement.
    if(!['SPLIT','NEED_CONTEXT','COMPLETE'].includes(status)
       &&(qdaQuantitativeAtomicRequirement(packet,node)
          ||qdaStatisticalAtomicRequirement(packet,node))){
      const directQdaArtifact=companionNormalizedArtifact(parsed);
      const directQdaObject=asObject(directQdaArtifact);
      const hasQdaBody=
        Object.keys(directQdaObject).length>0
        &&(
          directQdaObject.calculation!==undefined
          ||directQdaObject.formula_or_model!==undefined
          ||Array.isArray(directQdaObject.python_checks)
          ||Array.isArray(directQdaObject.python_analyses)
        );
      if(hasQdaBody){
        parsed={
          status:'COMPLETE',
          artifact:directQdaObject,
          handoff:asObject(parsed?.handoff),
          _atomic_protocol_normalization:{
            version:'qda_direct_atomic_artifact_v0_1',
            original_status:text(parsed?.status)||null,
            original_outcome:text(parsed?.outcome)||null,
            normalized_status:'COMPLETE',
            python_verification_still_required:true,
          },
        };
        status='COMPLETE';
        console.log('AAU_AUTONOMOUS_ATOMIC_PROTOCOL_NORMALIZED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          normalization:'qda_direct_atomic_artifact_v0_1',
          python_verification_still_required:true,
        }));
      }
    }

    if(!['SPLIT','NEED_CONTEXT','COMPLETE'].includes(status)){
      if(!durableAtomic.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'ATOMIC_PROTOCOL_REJECTED',atomicSemanticIdentity,
          asObject(parsed),{
            atomic_status:text(parsed?.status)||null,
            atomic_outcome:text(parsed?.outcome)||null,
            rejection_reason:'atomic_status_invalid_after_protocol_normalization',
          }
        );
      }
      const atomicExecutionFailures=
        Math.max(0,Number(node?.decision_payload?.atomic_execution_failures||0))+1;
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:null,
        decisionPayload:{
          ...(node.decision_payload||{}),
          prior_atomic_rejection:'atomic_status_invalid_after_protocol_normalization',
          reconsider_decomposition:true,
          atomic_execution_failures:atomicExecutionFailures,
          atomic_unavailable:atomicExecutionFailures>=MAX_ATOMIC_EXECUTION_FAILURES,
          atomic_protocol_recovery_version:'structured_stage_contract_direct_atomic_v0_1',
        },
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    if(status==='SPLIT'){
      if(!durableAtomic.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'ATOMIC_EXECUTION',atomicSemanticIdentity,parsed,{
            atomic_status:'SPLIT',
          }
        );
      }
      const split=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'split',decisionType:'SPLIT',
        decisionPayload:{...(node.decision_payload||{}),reason:clip(parsed?.reason,1200),reclassified_during_execution:true},
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      split.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {split:true,node:split};
    }
    if(status==='NEED_CONTEXT'){
      const rawRequests=asArray(parsed?.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
      const urlRequestsFromContext=rawRequests.filter(v=>/^https:\/\//i.test(v));
      const requests=rawRequests.filter(v=>!/^https:\/\//i.test(v));
      const researchQueries=asArray(parsed?.research_queries).map(text).filter(Boolean).slice(0,8);
      const researchUrls=[...new Set([
        ...asArray(parsed?.research_urls),
        ...urlRequestsFromContext,
      ].map(text).filter(v=>/^https:\/\//i.test(v)))].slice(0,8);
      if(!requests.length&&!researchQueries.length&&!researchUrls.length)
        throw new Error('autonomous_decomposition_atomic_context_empty:'+node.node_path);
      if(!durableAtomic.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'ATOMIC_EXECUTION',atomicSemanticIdentity,parsed,{
            atomic_status:'NEED_CONTEXT',
          }
        );
      }
      await chargeSemanticRuntime({
        eventKind:'context_acquisition',
        materialKey:node.node_path+':atomic:'+sha256({requests,researchQueries,researchUrls}),
        nodePath:node.node_path,
        costUnits:semanticRuntime.context_acquire_units,
        eventFingerprint:sha256({
          node_path:node.node_path,
          phase:'atomic_need_context',
          requests,
          research_queries:researchQueries,
          research_urls:researchUrls,
        }),
        metadata:{
          phase:'atomic_need_context',
          request_count:requests.length,
          query_count:researchQueries.length,
          url_count:researchUrls.length,
        },
      });
      let researchObserved=null;
      if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
        researchObserved=await researchContext({nodePath:node.node_path,queries:researchQueries,urls:researchUrls});
      }else if(researchQueries.length||researchUrls.length){
        researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
      }
      if(researchObserved?.audit_batch_id){
        await linkResearchBatch(node.node_path,researchObserved.audit_batch_id);
      }
      const pinnedResult=await persistExplicitResearchEvidence(node.node_path,researchUrls,researchObserved);
      pinnedEvidence=pinnedResult.evidence;
      const contextPayload=boundInMemoryContext({
        ...atomicBaseContext,
        ...resolveContext(packet,requests,atomicCognitionContext()),
        ...(researchObserved?{external_research_atomic:researchObserved}:{}),
      },pinnedEvidence,stageBudgets.atomic_execution);
      counters.context_requests+=requests.length+researchQueries.length+researchUrls.length;
      const reset=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'pending',decisionType:'NEED_CONTEXT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          reason:clip(parsed?.reason,1200),
          context_requests:requests,
          research_queries:researchQueries,
          research_urls:researchUrls,
          reclassified_during_execution:true
        },
        contextPayload,resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }
    const proposedArtifact=artifactText(companionNormalizedArtifact(parsed));
    if(!proposedArtifact)throw new Error('autonomous_decomposition_atomic_artifact_empty:'+node.node_path);
    const proposedHandoff=asObject(parsed?.handoff);
    const proposedMathVerification=deterministicMathVerification(packet,node,proposedArtifact);
    const proposedStatisticsVerification=deterministicStatisticalVerification(packet,node,proposedArtifact);
    if(!durableAtomic.parsed){
      await saveJsonPhaseCheckpoint(
        node.node_path,'ATOMIC_EXECUTION',atomicSemanticIdentity,parsed,{
          atomic_status:'COMPLETE',
          artifact_hash:sha256(proposedArtifact),
        }
      );
    }

    // Deterministic arithmetic is checked BEFORE model reconciliation. A known
    // arithmetic mismatch is not a reason to spend another long reasoning call.
    // Return the exact Python observations to the same bound agent on the next
    // atomic attempt; the changed context invalidates reuse of the bad checkpoint.
    if(proposedMathVerification.required
       &&(!proposedMathVerification.ok||!proposedMathVerification.all_match)){
      const priorMathAttempts=Math.max(
        0,
        Number(node?.decision_payload?.deterministic_math_attempts||0)
      );
      const mathAttempt=priorMathAttempts+1;
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          deterministic_math_reconciliation_required:true,
          deterministic_math_attempts:mathAttempt,
          deterministic_math_verification:proposedMathVerification,
          deterministic_math_gate:'pre_reconciliation_python_v0_3_checkpoint_identity',
          deterministic_math_retry_nonce:sha256({
            node_path:node.node_path,
            attempt:mathAttempt,
            verification:proposedMathVerification,
          }).slice(0,24),
          reconsider_decomposition:false,
        },
        contextPayload:{
          ...(node.context_payload||{}),
          deterministic_math_feedback:{
            attempt:mathAttempt,
            verifier:'python3_safe_math_v0_1',
            verification:proposedMathVerification,
            instruction:'Correct the numerical work and python_checks from first principles. Preserve the correct formula, units, and assumptions; do not force a match by changing the model.'
          },
        },
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    if(proposedStatisticsVerification.required
       &&(!proposedStatisticsVerification.ok||!proposedStatisticsVerification.all_claims_match)){
      const priorStatisticsAttempts=Math.max(
        0,
        Number(node?.decision_payload?.deterministic_statistics_attempts||0)
      );
      const statisticsAttempt=priorStatisticsAttempts+1;
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          deterministic_statistics_reconciliation_required:true,
          deterministic_statistics_attempts:statisticsAttempt,
          deterministic_statistics_verification:proposedStatisticsVerification,
          deterministic_statistics_gate:'pre_reconciliation_python_statistics_v0_1',
          deterministic_statistics_retry_nonce:sha256({
            node_path:node.node_path,
            attempt:statisticsAttempt,
            verification:proposedStatisticsVerification,
          }).slice(0,24),
          reconsider_decomposition:false,
        },
        contextPayload:{
          ...(node.context_payload||{}),
          deterministic_statistics_feedback:{
            attempt:statisticsAttempt,
            verifier:'aau_quantitative_python_v0_1',
            verification:proposedStatisticsVerification,
            instruction:'Reassess method, inputs, claims, and interpretation. Correct the statistical claims from first principles. Python executes the selected analysis; it does not choose the method or causal conclusion for you.'
          },
        },
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    // Cognitive continuity: before runtime may persist completion, the same bound
    // agent reconciles its proposed result against its own discovery state.
    const reconciliationSemanticIdentity=sha256({
      atomic_semantic_identity:atomicSemanticIdentity,
      proposed_artifact_hash:sha256(proposedArtifact),
      proposed_handoff:proposedHandoff,
      authoritative_sibling_results:siblingEvidence.map(v=>({
        path:v.path,status:v.status,decision_type:v.decision_type,result_hash:v.result_hash
      })),
      supplied_context:atomicCognitionContext(),
    });
    const durableReconciliation=await loadJsonPhaseCheckpoint(
      node.node_path,'RECONCILIATION',reconciliationSemanticIdentity
    );
    let reconciliation=durableReconciliation.parsed;
    if(!reconciliation){
    try{
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent reconciling YOUR proposed completion against YOUR OWN prior discovery state.',
              'This is not an external verifier. The runtime has made no substantive judgment and must not reinterpret your task for you.',
              'Re-read your requirement, your authored discovery state, your proposed artifact, the authoritative completed sibling evidence, and the supplied evidence.',
              'Completed sibling outputs are already available evidence. Do not reopen a missing-context claim solely because the original source excerpt is absent when the sibling output already carries the required result.',
              'Decide whether YOU consider your own completion criterion actually satisfied.',
              'Return one status only:',
              'COMPLETE = you judge the requirement and your own completion criterion genuinely satisfied by the evidence. You may correct wording/calculation in artifact and handoff before finalizing.',
              'When COMPLETE, artifact is a COMPLETE REPLACEMENT work product, not a critique summary. Preserve every material derivation, assumption, unit, evidence distinction, unresolved limitation, and substantive section from the proposed artifact unless you explicitly correct or retire it. Do not shorten a multi-part artifact into a fragment.',
              'NEED_CONTEXT = evidence or stored context is still missing. Supply at least one exact context_request and/or research_query/research_url you choose.',
              'A formatting/serialization defect is NOT missing context. If the proposed completion already contains the underlying structured work product, choose COMPLETE and correct the artifact representation.',
              'SPLIT = you now judge the requirement is not actually bounded and should be decomposed by you.',
              'Do not treat a nearby metric, label, time horizon, population, market definition, or proxy as equivalent unless you can justify that equivalence from the supplied evidence.',
              'Preserve uncertainty. A retrieved source is evidence only for what it actually supports.',
              ...(qdaQuantitativeAtomicRequirement(packet,node)?[
                'DETERMINISTIC MATH COMPANION is authoritative for arithmetic execution only. Inspect deterministic_math_verification below. If any check is missing, invalid, or mismatched, correct your numerical work and python_checks before choosing COMPLETE. Do not defer arithmetic disagreement as NEED_CONTEXT.',
                'When you return COMPLETE for a quantitative QDA requirement, artifact must remain a JSON object containing python_checks for every material numerical result.'
              ]:[]),
              ...(qdaStatisticalAtomicRequirement(packet,node)?[
                'QUANTITATIVE PYTHON STATISTICS COMPANION is authoritative for statistical computation only. Inspect deterministic_statistics_verification below.',
                'Do not convert statistical significance, correlation, model fit, or simulation output into causal certainty. Re-check assumptions, sample size, design, and alternative explanations before COMPLETE.',
                'When you return COMPLETE for a statistical QDA requirement, artifact must remain a JSON object containing python_analyses with explicit claims.'
              ]:[]),
               'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
               'If a scoring framework is binary but evidence for a criterion is insufficient, preserve UNKNOWN explicitly rather than coercing UNKNOWN to FAIL. Do not compute a fully-known score by silently counting UNKNOWN as zero unless the framework itself explicitly defines that treatment.',
              'Return JSON only: {"status":"COMPLETE|NEED_CONTEXT|SPLIT","reason":"brief auditable reason","criterion_assessment":"brief comparison to your own criterion","gaps":["..."],"artifact":"required when COMPLETE","handoff":{"conclusions":[],"facts":[],"unresolved":[]},"context_requests":[],"research_queries":[],"research_urls":[]}.',
            ].join('\n')},
            {role:'user',content:safeJson({
              requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              proposed_completion:{artifact:proposedArtifact,handoff:proposedHandoff},
              deterministic_math_verification:proposedMathVerification,
              deterministic_statistics_verification:proposedStatisticsVerification,
              authoritative_completed_sibling_evidence:siblingEvidence,
              supplied_context:atomicCognitionContext(),
              available_context_index:idx,
              available_supplied_context_index:indexObject(atomicCognitionContext()),
            })},
          ],stageBudgets.atomic_reconciliation,'req_'+node.node_path.replaceAll('.','_')+'_reconcile_'+attempt);
          const candidate=asObject(response?.parsed);
          const candidateStatus=text(candidate?.status).toUpperCase();
          if(candidateStatus==='NEED_CONTEXT'){
            const hasContextRequest=
              asArray(candidate?.context_requests).map(text).some(Boolean)
              ||asArray(candidate?.research_queries).map(text).some(Boolean)
              ||asArray(candidate?.research_urls).map(text).some(Boolean);
            if(!hasContextRequest){
              const validationError=new Error(
                'reconciliation_need_context_requires_retrieval_request:'+node.node_path
              );
              validationError.code='COGNITION_RESPONSE_REJECTED';
              validationError.rejectionReason=
                'NEED_CONTEXT requires an actual retrieval request. Formatting or serialization defects must be corrected under COMPLETE using the durable proposed artifact.';
              throw validationError;
            }
          }
          if(candidateStatus==='COMPLETE'){
            const candidateArtifact=artifactText(companionNormalizedArtifact(candidate));
            const replacementQuality=reconciliationReplacementQuality(
              proposedArtifact,candidateArtifact
            );
            if(!replacementQuality.acceptable){
              console.warn('AAU_RECONCILIATION_REPLACEMENT_REJECTED',JSON.stringify({
                agent_id:agentId,intent_execution_id:intentExecutionId,
                node_path:node.node_path,attempt,
                ...replacementQuality,
                policy:'complete_replacement_or_preserve_proposed_v0_1',
              }));
              if(attempt<2){
                const validationError=new Error(
                  'reconciliation_complete_artifact_abbreviated:'+node.node_path
                );
                validationError.code='COGNITION_RESPONSE_REJECTED';
                validationError.rejectionReason='RECONCILIATION_ARTIFACT_ABBREVIATED';
                throw validationError;
              }
              reconciliation={
                ...candidate,
                status:'COMPLETE',
                artifact:proposedArtifact,
                handoff:proposedHandoff,
                _runtime_reconciliation_fallback:{
                  version:'preserve_proposed_when_critic_replacement_abbreviated_v0_1',
                  reason:replacementQuality.reason,
                  proposed_bytes:replacementQuality.proposed_bytes,
                  rejected_candidate_bytes:replacementQuality.candidate_bytes,
                  minimum_replacement_bytes:replacementQuality.minimum_bytes||null,
                },
              };
              break;
            }
          }
          reconciliation=candidate;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT')throw error;
        }
      }
    }catch(error){
      if(error?.code==='NVIDIA_TIMEOUT')throw error;
      if(error?.code==='COGNITION_RESPONSE_REJECTED'){
        const phaseError=new Error(
          'autonomous_decomposition_reconciliation_response_exhausted:'+node.node_path
        );
        phaseError.code='COGNITION_PHASE_VALIDATION_EXHAUSTED';
        phaseError.cause=error;
        throw phaseError;
      }
      throw error;
    }
    }

    const reconciliationStatus=text(reconciliation?.status).toUpperCase();
    const reconciliationMeta={
      reconciliation_performed:true,
      reconciliation_reason:clip(reconciliation?.reason,1600),
      reconciliation_criterion_assessment:clip(reconciliation?.criterion_assessment,2200),
      reconciliation_gaps:asArray(reconciliation?.gaps).map(v=>clip(text(v),700)).filter(Boolean).slice(0,12),
      cognitive_continuity_policy:'agent_discovery_restore_and_reconcile_v0_1',
      reconciliation_replacement_fallback:
        asObject(reconciliation?._runtime_reconciliation_fallback),
    };

    if(reconciliationStatus==='SPLIT'){
      if(!durableReconciliation.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'RECONCILIATION',reconciliationSemanticIdentity,reconciliation,{
            reconciliation_status:'SPLIT',
          }
        );
      }
      const split=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'split',decisionType:'SPLIT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          ...reconciliationMeta,
          reason:clip(reconciliation?.reason,1200),
          reclassified_during_reconciliation:true,
        },
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      split.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {split:true,node:split};
    }

    if(reconciliationStatus==='NEED_CONTEXT'){
      const rawRequests=asArray(reconciliation?.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
      const urlRequestsFromContext=rawRequests.filter(v=>/^https:\/\//i.test(v));
      const requests=rawRequests.filter(v=>!/^https:\/\//i.test(v));
      const researchQueries=asArray(reconciliation?.research_queries).map(text).filter(Boolean).slice(0,8);
      const researchUrls=[...new Set([
        ...asArray(reconciliation?.research_urls),
        ...urlRequestsFromContext,
      ].map(text).filter(v=>/^https:\/\//i.test(v)))].slice(0,8);
      if(!requests.length&&!researchQueries.length&&!researchUrls.length)
        throw new Error('autonomous_decomposition_reconciliation_context_empty:'+node.node_path);
      if(!durableReconciliation.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'RECONCILIATION',reconciliationSemanticIdentity,reconciliation,{
            reconciliation_status:'NEED_CONTEXT',
          }
        );
      }
      await chargeSemanticRuntime({
        eventKind:'context_acquisition',
        materialKey:node.node_path+':reconciliation:'+sha256({requests,researchQueries,researchUrls}),
        nodePath:node.node_path,
        costUnits:semanticRuntime.context_acquire_units,
        eventFingerprint:sha256({
          node_path:node.node_path,
          phase:'reconciliation_need_context',
          requests,
          research_queries:researchQueries,
          research_urls:researchUrls,
        }),
        metadata:{
          phase:'reconciliation_need_context',
          request_count:requests.length,
          query_count:researchQueries.length,
          url_count:researchUrls.length,
        },
      });
      let researchObserved=null;
      if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
        researchObserved=await researchContext({nodePath:node.node_path,queries:researchQueries,urls:researchUrls});
      }else if(researchQueries.length||researchUrls.length){
        researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
      }
      if(researchObserved?.audit_batch_id){
        await linkResearchBatch(node.node_path,researchObserved.audit_batch_id);
      }
      const pinnedResult=await persistExplicitResearchEvidence(node.node_path,researchUrls,researchObserved);
      pinnedEvidence=pinnedResult.evidence;
      const contextPayload=boundInMemoryContext({
        ...atomicBaseContext,
        ...resolveContext(packet,requests,atomicCognitionContext()),
        ...(researchObserved?{external_research_reconciliation:researchObserved}:{}),
      },pinnedEvidence,stageBudgets.atomic_reconciliation);
      counters.context_requests+=requests.length+researchQueries.length+researchUrls.length;
      const reset=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'pending',decisionType:'NEED_CONTEXT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          ...reconciliationMeta,
          reason:clip(reconciliation?.reason,1200),
          context_requests:requests,
          research_queries:researchQueries,
          research_urls:researchUrls,
          reclassified_during_reconciliation:true,
        },
        contextPayload,resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    if(reconciliationStatus!=='COMPLETE')
      throw new Error('autonomous_decomposition_reconciliation_status_invalid:'+node.node_path);

    let artifact=artifactText(companionNormalizedArtifact(reconciliation))||proposedArtifact;
    if(!artifact)throw new Error('autonomous_decomposition_reconciliation_artifact_empty:'+node.node_path);
    const handoff=Object.keys(asObject(reconciliation?.handoff)).length?asObject(reconciliation?.handoff):proposedHandoff;
    const finalMathVerification=deterministicMathVerification(packet,node,artifact);
    const finalStatisticsVerification=deterministicStatisticalVerification(packet,node,artifact);
    if(finalMathVerification.required && (!finalMathVerification.ok || !finalMathVerification.all_match)){
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          ...reconciliationMeta,
          deterministic_math_reconciliation_required:true,
          deterministic_math_verification:finalMathVerification,
          reconsider_decomposition:false,
        },
        contextPayload:{
          ...(node.context_payload||{}),
          deterministic_math_verification:finalMathVerification,
        },
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    if(finalStatisticsVerification.required
       &&(!finalStatisticsVerification.ok||!finalStatisticsVerification.all_claims_match)){
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          deterministic_statistics_reconciliation_required:true,
          deterministic_statistics_verification:finalStatisticsVerification,
          deterministic_statistics_gate:'post_reconciliation_python_statistics_v0_1',
          reconsider_decomposition:false,
        },
        contextPayload:{
          ...(node.context_payload||{}),
          deterministic_statistics_feedback:{
            attempt:Math.max(1,Number(node?.decision_payload?.deterministic_statistics_attempts||0)+1),
            verifier:'aau_quantitative_python_v0_1',
            verification:finalStatisticsVerification,
            instruction:'Your reconciled artifact still disagrees with deterministic statistical computation. Correct the claims and interpretation before completion.'
          },
        },
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }
    const atomicStageContract=stageContractForRequirement(packet,node.requirement_text,node.node_path);
    let atomicStageProposal=null;
    let atomicStageMaterializationVersion=null;
    if(atomicStageContract.applies&&atomicStageContract.name==='expertise_viability_proposal_v0_1'){
      const directValidation=validateStageContractArtifact(
        atomicStageContract.definition,
        artifact
      );
      if(directValidation.valid){
        atomicStageProposal=directValidation.artifact;
        artifact=safeJson(atomicStageProposal);
        atomicStageMaterializationVersion='atomic_stage_contract_direct_v0_1';
      }else{
        atomicStageProposal=await materializeTerminalStageContract(
          node,[],{},{
            outcome:'COMPLETE',
            reason:reconciliation?.reason,
            artifact,
            handoff,
          },atomicStageContract
        );
        artifact=safeJson(atomicStageProposal);
        atomicStageMaterializationVersion=STAGE_CONTRACT_MATERIALIZATION_VERSION;
      }
    }
    if(!durableReconciliation.parsed){
      await saveJsonPhaseCheckpoint(
        node.node_path,'RECONCILIATION',reconciliationSemanticIdentity,reconciliation,{
          reconciliation_status:'COMPLETE',
          artifact_hash:sha256(artifact),
        }
      );
    }
    const resultArtifact=JSON.stringify({artifact,handoff});
    const done=await saveNode({
      nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
      requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
      status:'completed',decisionType:'ATOMIC',
      decisionPayload:{
        ...(node.decision_payload||{}),
        ...reconciliationMeta,
        completed_as_atomic:true,
        ...(finalMathVerification.required?{
          deterministic_math_verified:true,
          deterministic_math_check_count:finalMathVerification.check_count,
          deterministic_math_verification:finalMathVerification,
        }:{}),
        ...(finalStatisticsVerification.required?{
          deterministic_statistics_verified:true,
          deterministic_statistics_analysis_count:finalStatisticsVerification.analysis_count,
          deterministic_statistics_verification:finalStatisticsVerification,
        }:{}),
        ...(atomicStageProposal?{
          atomic_stage_contract_validated:true,
          terminal_stage_contract_name:atomicStageContract.name,
          stage_contract_materialization_version:atomicStageMaterializationVersion,
        }:{}),
      },
      contextPayload:node.context_payload||{},resultArtifact,
    });
    done.parent_path=node.parent_path??parentPathOf(node.node_path);
    const persistedDone=atomicStageProposal
      ? await ensureCanonicalStageCandidateSubmission(done,atomicStageProposal)
      : done;
    return {completed:true,node:persistedDone};
  }

  async function reviewSynthesisProvenance(node,childRows,accumulator,proposedFinal,revisionGuidance=''){
    const childEvidence=childRows.map(child=>{
      const parts=resultParts(child.result_artifact);
      return {
        path:child.node_path,
        status:child.node_status||child.status||null,
        decision_type:child.decision_type||null,
        requirement:child.requirement_text,
        artifact:clip(parts.artifact,7000),
        handoff:parts.handoff,
      };
    });
    const provenanceSemanticIdentity=sha256({
      parent_path:node.node_path,
      parent_requirement:node.requirement_text,
      child_evidence:childEvidence.map(v=>({
        path:v.path,status:v.status,decision_type:v.decision_type,
        artifact_hash:sha256(v.artifact||''),handoff:v.handoff,
      })),
      accumulator,
      proposed_final:proposedFinal,
      revision_guidance:revisionGuidance||null,
      terminal_synthesis_ownership_version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
      lifecycle_stage_contract:lifecycleStageContract(packet),
    });
    const durableProvenance=await loadJsonPhaseCheckpoint(
      node.node_path,'SYNTHESIS_PROVENANCE',provenanceSemanticIdentity
    );
    const response=durableProvenance.parsed
      ? {parsed:durableProvenance.parsed,checkpoint_reused:true}
      : await callJson([
      {role:'system',content:[
        'You are the same bound autonomous agent auditing YOUR OWN proposed parent synthesis before it becomes durable.',
        'This is a provenance-preservation review, not a new task or a runtime verdict.',
        'Compare every number, unit, date, forecast period, source/value relationship, scope claim, and derived conclusion in the proposed synthesis against the resolved child evidence.',
        'REVISE if the synthesis swaps values between sources, silently changes a source/value pairing, changes units or time horizons, converts a derived scenario into a sourced fact, or strengthens uncertainty beyond what the children support.',
        'Derived calculations and scenarios are allowed only when explicitly labeled as derived, their exact source inputs remain correctly paired, and the transformation/formula is stated.',
        'BLOCKED child gaps must remain visible when they are material to the parent requirement.',
        'Terminal synthesis/formatting/submission is runtime-owned. Do NOT ACCEPT a proposed BLOCKED outcome merely because no separate synthesis child previously created the final formatted artifact.',
        'When the parent requirement names the lifecycle stage contract, the proposed final artifact itself must satisfy that contract from the resolved evidence, while preserving unresolved evidence gaps honestly.',
        'Return JSON only: {"status":"ACCEPT|REVISE","reason":"auditable explanation","issues":["..."],"evidence_bindings":[{"claim":"...","source_path_or_id":"...","preserved":true}],"revision_guidance":"specific correction when REVISE; empty when ACCEPT"}.',
      ].join('\n')},
      {role:'user',content:safeJson({
        parent_requirement:node.requirement_text,
        agent_authored_discovery_state:agentDiscoveryState(node),
        resolved_child_evidence:childEvidence,
        cumulative_synthesis:accumulator,
        terminal_synthesis_ownership:{
          version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
          lifecycle_stage_contract:lifecycleStageContract(packet),
        },
        proposed_final:{
          outcome:text(proposedFinal?.outcome).toUpperCase(),
          reason:proposedFinal?.reason,
          artifact:proposedFinal?.artifact,
          handoff:asObject(proposedFinal?.handoff),
        },
        prior_provenance_revision_guidance:revisionGuidance||null,
      })},
    ],stageBudgets.synthesis_provenance_review,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_provenance');

    const candidate=asObject(response?.parsed);
    const status=text(candidate.status).toUpperCase();
    if(!['ACCEPT','REVISE'].includes(status))
      throw new Error('autonomous_decomposition_synthesis_provenance_status_invalid:'+node.node_path);
    if(!durableProvenance.parsed){
      await saveJsonPhaseCheckpoint(
        node.node_path,'SYNTHESIS_PROVENANCE',provenanceSemanticIdentity,candidate,{
          provenance_status:status,
        }
      );
    }
    return {
      status,
      reason:clip(candidate.reason,2400),
      issues:asArray(candidate.issues).map(v=>clip(v,800)).filter(Boolean).slice(0,16),
      evidence_bindings:asArray(candidate.evidence_bindings).map(v=>({
        claim:clip(v?.claim,800),
        source_path_or_id:clip(v?.source_path_or_id,500),
        preserved:Boolean(v?.preserved),
      })).filter(v=>v.claim||v.source_path_or_id).slice(0,24),
      revision_guidance:clip(candidate.revision_guidance,2400),
      agent_authored:true,
    };
  }

  async function materializeTerminalStageContract(
    node,childRows,accumulator,semanticFinal,terminalStageContract
  ){
    const childEvidence=childRows.map(child=>{
      const parts=resultParts(child.result_artifact);
      return {
        path:child.node_path,
        status:child.node_status||child.status||null,
        decision_type:child.decision_type||null,
        requirement:child.requirement_text,
        artifact:clip(parts.artifact,7000),
        handoff:parts.handoff,
      };
    });
    const materializationIdentity=sha256({
      version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
      node_path:node.node_path,
      parent_requirement:node.requirement_text,
      stage_contract_name:terminalStageContract.name,
      stage_contract_hash:sha256(terminalStageContract.definition),
      semantic_final:{
        outcome:text(semanticFinal?.outcome).toUpperCase(),
        reason:text(semanticFinal?.reason),
        artifact:text(semanticFinal?.artifact),
        handoff:asObject(semanticFinal?.handoff),
      },
      accumulator,
      child_result_hashes:childRows.map(v=>({
        path:v.node_path,
        result_hash:v.result_hash||sha256(v.result_artifact||''),
      })),
    });
    const durable=await loadJsonPhaseCheckpoint(
      node.node_path,'STAGE_CONTRACT_MATERIALIZE',materializationIdentity
    );
    if(durable.parsed){
      const persistedProposal=asObject(durable.parsed?.proposal||durable.parsed);
      const persistedValidation=validateStageContractArtifact(
        terminalStageContract.definition,
        safeJson(persistedProposal)
      );
      if(persistedValidation.valid)return persistedProposal;
    }

    let validationGuidance='';
    for(let attempt=1;attempt<=3;attempt++){
      const response=await callJson([
        {role:'system',content:[
          'You are the bound autonomous agent materializing YOUR already-completed semantic synthesis into the authoritative lifecycle stage contract.',
          'This phase is contract materialization, not new research and not a new domain decision.',
          'Use only the resolved child evidence, cumulative synthesis, and semantic final result supplied here.',
          'Do not invent customers, revenue, employment, funding, competence, pricing, market segmentation, or source claims.',
          'Preserve unresolved evidence gaps explicitly in confidence_and_gaps and keep unsupported demand/economic assertions labeled as hypotheses.',
          'Return JSON only in exactly this wrapper: {"proposal":{...}} where proposal satisfies every required field in stage_contract_definition.',
          'Do NOT JSON-encode proposal as a string. proposal must be a real nested JSON object.',
        ].join('\n')},
        {role:'user',content:safeJson({
          parent_requirement:node.requirement_text,
          stage_contract_name:terminalStageContract.name,
          stage_contract_definition:terminalStageContract.definition,
          cumulative_synthesis:accumulator,
          resolved_child_evidence:childEvidence,
          semantic_final:{
            outcome:text(semanticFinal?.outcome).toUpperCase(),
            reason:semanticFinal?.reason,
            artifact:semanticFinal?.artifact,
            handoff:asObject(semanticFinal?.handoff),
          },
          validation_guidance:validationGuidance||null,
          materialization_version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
        })},
      ],stageBudgets.synthesis_final,
      'req_'+node.node_path.replaceAll('.','_')+'_stage_contract_materialize_'+attempt);

      const proposal=asObject(response?.parsed?.proposal);
      const validation=validateStageContractArtifact(
        terminalStageContract.definition,
        safeJson(proposal)
      );
      if(validation.valid){
        await saveJsonPhaseCheckpoint(
          node.node_path,'STAGE_CONTRACT_MATERIALIZE',materializationIdentity,
          {proposal},{
            stage_contract_name:terminalStageContract.name,
            materialization_version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
            proposal_hash:sha256(proposal),
          }
        );
        console.log('AAU_AUTONOMOUS_STAGE_CONTRACT_MATERIALIZED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          stage_contract_name:terminalStageContract.name,
          materialization_version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
          attempt,
        }));
        return proposal;
      }
      validationGuidance=
        'Previous proposal failed structural validation: '
        +validation.issues.join(', ')
        +'. Correct only the contract structure/content sufficiency using the same evidence.';
    }
    const error=new Error('autonomous_decomposition_stage_contract_materialization_invalid:'+node.node_path);
    error.code='COGNITION_RESPONSE_REJECTED';
    throw error;
  }

  function isTopLevelViabilityCandidateNode(node){
    return /^R[.]\d{3}$/.test(text(node?.node_path));
  }

  function materializedStageProposalFromNode(node){
    const version=text(node?.decision_payload?.stage_contract_materialization_version);
    const directAtomic=Boolean(node?.decision_payload?.atomic_stage_contract_validated);
    if(version!==STAGE_CONTRACT_MATERIALIZATION_VERSION&&!directAtomic)return null;
    const parts=resultParts(node?.result_artifact);
    if(!parts.artifact)return null;
    try{
      const proposal=JSON.parse(parts.artifact);
      return proposal&&typeof proposal==='object'&&!Array.isArray(proposal)?proposal:null;
    }catch{return null;}
  }

  async function ensureCanonicalStageCandidateSubmission(node,proposalOverride=null){
    if(node?.node_status!=='completed'||!isTopLevelViabilityCandidateNode(node))
      return node;
    const stageContract=stageContractForRequirement(packet,node.requirement_text,node.node_path);
    if(!stageContract.applies||stageContract.name!=='expertise_viability_proposal_v0_1')
      return node;

    const prior=asObject(node?.decision_payload?.canonical_stage_candidate_submission);
    if(text(prior.proposal_id)&&prior.persisted===true)return node;

    let proposal=proposalOverride||materializedStageProposalFromNode(node);

    // A completed top-level Stage-4 candidate is not canonically complete until
    // its durable semantic result has been materialized under the current
    // lifecycle contract. This also repairs completed nodes created by older
    // phrase-matching ownership logic without re-running their research.
    if(!proposal){
      const parts=resultParts(node?.result_artifact);
      if(!parts.artifact)return node;

      // Mechanical serialization recovery comes before another model call.
      // Only trailing unmatched closing braces are eligible, and the recovered
      // object must pass the full authoritative stage contract. No semantic
      // content is added, removed, or rewritten.
      let serializationRecovered=false;
      const rawArtifact=text(parts.artifact).trim();
      for(let trimCount=1;trimCount<=3&&!proposal;trimCount++){
        if(!rawArtifact.endsWith('}'.repeat(trimCount)))continue;
        const candidateText=rawArtifact.slice(0,-trimCount);
        try{
          const candidate=JSON.parse(candidateText);
          const check=validateStageContractArtifact(
            stageContract.definition,
            safeJson(candidate)
          );
          if(check.valid){
            proposal=candidate;
            serializationRecovered=true;
          }
        }catch{}
      }

      if(!proposal){
        proposal=await materializeTerminalStageContract(
          node,[],{},{
            outcome:'COMPLETE',
            reason:'Canonical completion invariant: materialize the already-completed durable candidate result under the current Stage-4 contract.',
            artifact:parts.artifact,
            handoff:parts.handoff,
          },stageContract
        );
      }

      const repairedArtifact=JSON.stringify({
        artifact:safeJson(proposal),
        handoff:parts.handoff,
      });
      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'completed',
        decisionType:node.decision_type||'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          atomic_stage_contract_validated:true,
          terminal_stage_contract_name:stageContract.name,
          stage_contract_materialization_version:
            serializationRecovered
              ?'atomic_stage_contract_trailing_brace_repair_v0_1'
              :STAGE_CONTRACT_MATERIALIZATION_VERSION,
          canonical_completion_invariant_repaired:true,
          canonical_completion_invariant_repair_kind:
            serializationRecovered
              ?'deterministic_trailing_brace_serialization_repair'
              :'runtime_owned_stage_contract_materialization',
          canonical_completion_invariant_repaired_at:new Date().toISOString(),
        },
        contextPayload:node.context_payload||{},
        resultArtifact:repairedArtifact,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);

      if(serializationRecovered){
        console.log('AAU_AUTONOMOUS_STAGE_CONTRACT_SERIALIZATION_REPAIRED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          repair:'deterministic_trailing_brace_serialization_repair',
          stage_contract_name:stageContract.name,
        }));
      }
    }

    const validation=validateStageContractArtifact(stageContract.definition,safeJson(proposal));
    if(!validation.valid){
      const error=new Error(
        'autonomous_decomposition_canonical_candidate_contract_invalid:'
        +node.node_path+':'+validation.issues.join(',')
      );
      error.code='COGNITION_RUNTIME_ACCOUNTING_FAULT';
      throw error;
    }

    const persisted=await rpc('aau_bridge_ensure_expertise_viability_candidate_v0_1',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_proposal:proposal,
    });
    if(!persisted?.proposal_id){
      const error=new Error(
        'autonomous_decomposition_canonical_candidate_persistence_failed:'
        +node.node_path
      );
      error.code='COGNITION_RUNTIME_ACCOUNTING_FAULT';
      throw error;
    }

    const decisionPayload={
      ...(node.decision_payload||{}),
      canonical_stage_candidate_submission:{
        persisted:true,
        proposal_id:persisted.proposal_id,
        domain:persisted.domain||proposal.domain||null,
        status:persisted.status||null,
        candidate_ordinal:persisted.candidate_ordinal??null,
        candidate_count:persisted.candidate_count??persisted.revised_count??null,
        target_count:persisted.target_count??null,
        candidate_cohort:persisted.candidate_cohort??null,
        idempotent_domain_replay:Boolean(persisted.idempotent_domain_replay),
        revision_cycle_id:persisted.revision_cycle_id??null,
        revision_number:persisted.revision_number??null,
        revised_count:persisted.revised_count??null,
        review_pending:Boolean(persisted.review_pending),
        persistence_contract:
          text(persisted.status)==='candidate_revised'
          ||text(persisted.status)==='already_revised'
            ?'canonical_stage_candidate_revision_v0_1'
            :'canonical_stage_candidate_submission_v0_1',
        persisted_at:new Date().toISOString(),
      },
      ...(persisted.revision_cycle_id?{
        candidate_revision_submission:{
          persisted:true,
          proposal_id:persisted.proposal_id,
          domain:persisted.domain||proposal.domain||null,
          revision_cycle_id:persisted.revision_cycle_id,
          revision_number:persisted.revision_number??null,
          revised_count:persisted.revised_count??null,
          target_count:persisted.target_count??null,
          review_pending:Boolean(persisted.review_pending),
          persistence_contract:'canonical_stage_candidate_revision_v0_1',
          persisted_at:new Date().toISOString(),
        },
      }:{}),
    };
    const saved=await saveNode({
      nodePath:node.node_path,
      parentPath:node.parent_path??parentPathOf(node.node_path),
      ordinal:node.ordinal||0,
      requirement:node.requirement_text,
      sourceKind:node.source_kind,
      sourceRef:node.source_ref,
      status:'completed',
      decisionType:node.decision_type||'SPLIT',
      decisionPayload,
      contextPayload:node.context_payload||{},
      resultArtifact:node.result_artifact,
    });
    saved.parent_path=node.parent_path??parentPathOf(node.node_path);
    console.log('AAU_AUTONOMOUS_CANONICAL_STAGE_CANDIDATE_PERSISTED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      proposal_id:persisted.proposal_id,
      domain:persisted.domain||proposal.domain||null,
      status:persisted.status||null,
      candidate_ordinal:persisted.candidate_ordinal??null,
      candidate_count:persisted.candidate_count??null,
      target_count:persisted.target_count??null,
      idempotent_domain_replay:Boolean(persisted.idempotent_domain_replay),
    }));
    return saved;
  }

  async function synthesize(node,childRows){
    const currentChildResultHashes=childRows.map(child=>({
      path:child.node_path,
      result_hash:child.result_hash||sha256(child.result_artifact||''),
      status:child.node_status||child.status||null,
      decision_type:child.decision_type||null,
    }));
    const priorChildResultHashes=asArray(node?.decision_payload?.synthesis_child_result_hashes);
    const synthesisInputsChanged=
      priorChildResultHashes.length!==currentChildResultHashes.length
      ||priorChildResultHashes.some((prior,index)=>{
        const current=currentChildResultHashes[index];
        return !current
          ||text(prior?.path)!==text(current.path)
          ||text(prior?.result_hash)!==text(current.result_hash)
          ||text(prior?.status)!==text(current.status)
          ||text(prior?.decision_type)!==text(current.decision_type);
      });

    let accumulator=synthesisInputsChanged
      ?{}
      :asObject(node?.decision_payload?.synthesis_accumulator);
    let cursor=synthesisInputsChanged
      ?0
      :Number(node?.decision_payload?.synthesis_cursor||0);

    if(synthesisInputsChanged){
      const nextPayload={...(node.decision_payload||{})};
      delete nextPayload.synthesis_accumulator;
      delete nextPayload.synthesis_provenance_pending;
      delete nextPayload.synthesis_complete;
      delete nextPayload.synthesis_outcome;
      delete nextPayload.synthesis_reason;
      delete nextPayload.synthesis_provenance_review;
      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'split',
        decisionType:'SPLIT',
        decisionPayload:{
          ...nextPayload,
          synthesis_cursor:0,
          synthesis_child_result_hashes:currentChildResultHashes,
          synthesis_rebuild_reason:'child_result_hash_changed',
          synthesis_rebuild_at:new Date().toISOString(),
        },
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);
    }

    for(let i=cursor;i<childRows.length;i++){
      const child=childRows[i];
      const parts=resultParts(child.result_artifact);
      const mergeSemanticIdentity=sha256({
        parent_path:node.node_path,
        parent_requirement:node.requirement_text,
        discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
        prior_accumulator:accumulator,
        child_path:child.node_path,
        child_status:child.node_status||child.status||null,
        child_decision_type:child.decision_type||null,
        child_requirement:child.requirement_text,
        child_result_hash:child.result_hash||sha256(child.result_artifact||''),
      });
      const durableMerge=await loadJsonPhaseCheckpoint(
        node.node_path,'SYNTHESIS_MERGE_'+String(i+1),mergeSemanticIdentity
      );
      let response=durableMerge.parsed
        ? {parsed:durableMerge.parsed,checkpoint_reused:true}
        : null;
      for(let attempt=1;attempt<=2&&!response;attempt++){
        try{
          response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent synthesizing YOUR resolved child requirements back into their parent.',
              'A child may be COMPLETED or BLOCKED. BLOCKED is not successful completion; preserve its unresolved evidence or dependency explicitly.',
              'Update a compact accumulator using exactly one newly resolved child.',
              'Do not invent facts, erase a blocked gap, or change the parent requirement.',
               'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
               'When merging child scoring results, preserve PASS, FAIL, and UNKNOWN distinctions; never convert missing evidence into a negative finding.',
              'Return JSON only: {"summary":"compact cumulative synthesis","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
            ].join('\n')},
            {role:'user',content:safeJson({
              parent_requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              prior_accumulator:accumulator,
              child:{
                path:child.node_path,
                status:child.node_status||child.status||null,
                decision_type:child.decision_type||null,
                requirement:child.requirement_text,
                artifact:clip(parts.artifact,7000),
                handoff:parts.handoff,
              },
            })},
          ],stageBudgets.synthesis_merge,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_merge_'+(i+1)+'_'+attempt);
          break;
        }catch(error){
          const recoverable=error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT';
          if(!recoverable||attempt===2)throw error;
        }
      }
      if(!durableMerge.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'SYNTHESIS_MERGE_'+String(i+1),mergeSemanticIdentity,
          asObject(response?.parsed),{
            child_path:child.node_path,
            child_result_hash:child.result_hash||sha256(child.result_artifact||''),
          }
        );
      }
      accumulator={
        summary:clip(response?.parsed?.summary,9000),
        handoff:asObject(response?.parsed?.handoff),
      };
      cursor=i+1;
      node=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'split',decisionType:'SPLIT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          synthesis_cursor:cursor,
          synthesis_accumulator:accumulator,
          synthesis_child_result_hashes:currentChildResultHashes,
        },
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);
    }

    const childStates=childRows.map(child=>({
      path:child.node_path,
      status:child.node_status||child.status||null,
      decision_type:child.decision_type||null,
    }));
    const terminalStageContract=stageContractForRequirement(packet,node.requirement_text,node.node_path);
    let final=null;
    let synthesisProvenanceReview=null;
    const priorProvenanceContinuation=asObject(node?.decision_payload?.synthesis_provenance_pending);
    let synthesisProvenanceGuidance=clip(priorProvenanceContinuation.revision_guidance,5000);
    let provenanceContinuationRound=Math.max(0,Number(priorProvenanceContinuation.continuation_round||0));
    const MAX_SYNTHESIS_PROVENANCE_CONTINUATION_ROUNDS=3;
    for(let attempt=1;attempt<=2;attempt++){
      try{
        const finalSemanticIdentity=sha256({
          parent_path:node.node_path,
          parent_requirement:node.requirement_text,
          discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
          child_states:childStates,
          accumulator,
          provenance_revision_guidance:synthesisProvenanceGuidance||null,
          terminal_synthesis_ownership_version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
          stage_contract_materialization_version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
          lifecycle_stage_contract_applies:Boolean(terminalStageContract.applies),
          lifecycle_stage_contract_ownership_scope:terminalStageContract.ownership_scope||null,
          lifecycle_stage_contract_name:terminalStageContract.name||null,
          lifecycle_stage_contract_hash:terminalStageContract.definition
            ?sha256(terminalStageContract.definition):null,
        });
        const durableFinal=await loadJsonPhaseCheckpoint(
          node.node_path,'FINAL_SYNTHESIS',finalSemanticIdentity
        );
        final=durableFinal.parsed
          ? {parsed:durableFinal.parsed,checkpoint_reused:true}
          : await callJson([
          {role:'system',content:[
            'You are the bound autonomous agent closing a parent requirement after all child requirements have resolved.',
            'Some children may be BLOCKED. Decide whether the parent can honestly be COMPLETE from the resolved evidence or must itself be BLOCKED.',
            'The runtime does not make the substantive COMPLETE/BLOCKED decision for you, but terminal synthesis/formatting/submission is explicitly YOUR task in this phase.',
            'If the parent requirement names a lifecycle stage contract, the runtime owns the exact contract materialization immediately AFTER this semantic decision. The absence of a separate synthesis child or previously formatted proposal is NOT a blocking gap.',
            'Choose BLOCKED only when a substantive evidence/dependency gap prevents truthful satisfaction of the parent requirement; never choose BLOCKED merely because synthesis, formatting, or submission remains to be performed.',
            'When a lifecycle stage contract applies, keep artifact as a concise semantic synthesis. Do NOT embed or stringify the contract object here; the next runtime-owned materialization phase will produce the exact JSON object.',
            'If any essential child gap prevents the parent requirement from being satisfied, choose BLOCKED and preserve the unresolved gap.',
            'Return JSON only: {"outcome":"COMPLETE|BLOCKED","reason":"auditable reason","artifact":"concise semantic parent result","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
            'Do not add requirements or conclusions that are not supported by the resolved children.',
             'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
             'If a child contains UNKNOWN threshold states, preserve them as UNKNOWN in the parent synthesis unless later resolved by explicit evidence.',
          ].join('\n')},
          {role:'user',content:safeJson({
            parent_requirement:node.requirement_text,
            agent_authored_discovery_state:agentDiscoveryState(node),
            child_states:childStates,
            cumulative_synthesis:accumulator,
            terminal_synthesis_ownership:{
              version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
              applies_to_parent:terminalStageContract.applies,
              ownership_scope:terminalStageContract.ownership_scope||null,
              stage_contract_name:terminalStageContract.name||null,
              stage_contract_definition:terminalStageContract.applies
                ?terminalStageContract.definition
                :null,
            },
            prior_provenance_revision_guidance:synthesisProvenanceGuidance||null,
          })},
        ],stageBudgets.synthesis_final,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_final_'+attempt);

        const finalCandidate=asObject(final?.parsed);
        const candidateOutcome=text(finalCandidate.outcome).toUpperCase();
        if(!['COMPLETE','BLOCKED'].includes(candidateOutcome))
          throw new Error('autonomous_decomposition_synthesis_outcome_invalid:'+node.node_path);
        if(!text(finalCandidate.artifact))
          throw new Error('autonomous_decomposition_synthesis_empty:'+node.node_path);

        if(terminalStageContract.applies){
          const allChildrenSubstantivelyResolved=childStates.every(v=>v.status==='completed');
          const blockText=normalizedRequirement(
            text(finalCandidate.reason)+' '+text(finalCandidate.artifact)
          );
          if(candidateOutcome==='BLOCKED'
            &&allChildrenSubstantivelyResolved
            &&/(synthesis|synthesize|synthesise|format|submit|submission|proposal pending)/.test(blockText)){
            synthesisProvenanceGuidance=
              'Terminal synthesis is runtime-owned. All substantive children are complete, so do not BLOCK because the proposal has not yet been formatted/submitted. Construct the '+terminalStageContract.name+' artifact now from the resolved evidence; BLOCK only for a substantive evidence gap.';
            const ownershipError=new Error('autonomous_decomposition_terminal_synthesis_ownership_violation:'+node.node_path);
            ownershipError.code='COGNITION_RESPONSE_REJECTED';
            throw ownershipError;
          }
          if(candidateOutcome==='COMPLETE'){
            const proposal=await materializeTerminalStageContract(
              node,childRows,accumulator,finalCandidate,terminalStageContract
            );
            finalCandidate.artifact=safeJson(proposal);
            finalCandidate.terminal_stage_contract_materialized=true;
            finalCandidate.stage_contract_name=terminalStageContract.name;
            finalCandidate.stage_contract_materialization_version=
              STAGE_CONTRACT_MATERIALIZATION_VERSION;
            final={...final,parsed:finalCandidate};
          }
        }

        if(!durableFinal.parsed){
          await saveJsonPhaseCheckpoint(
            node.node_path,'FINAL_SYNTHESIS',finalSemanticIdentity,finalCandidate,{
              synthesis_outcome:candidateOutcome,
              artifact_hash:sha256(text(finalCandidate.artifact)),
              stage_contract_materialization_version:
                terminalStageContract.applies?STAGE_CONTRACT_MATERIALIZATION_VERSION:null,
            }
          );
        }

        synthesisProvenanceReview=await reviewSynthesisProvenance(
          node,
          childRows,
          accumulator,
          final?.parsed,
          synthesisProvenanceGuidance
        );
        console.log('AAU_AUTONOMOUS_SYNTHESIS_PROVENANCE_REVIEW',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          status:synthesisProvenanceReview.status,
          issue_count:synthesisProvenanceReview.issues.length,
        }));
        if(synthesisProvenanceReview.status!=='ACCEPT'){
          synthesisProvenanceGuidance=
            synthesisProvenanceReview.revision_guidance
            ||synthesisProvenanceReview.reason
            ||'Revise the parent synthesis so all source/value bindings and derived transformations remain faithful to the resolved child evidence.';
          if(attempt===2){
            const nextContinuationRound=provenanceContinuationRound+1;
            const continuation={
              contract:'synthesis_provenance_continuation_v0_1',
              phase:'FINAL_SYNTHESIS_TO_PROVENANCE',
              node_path:node.node_path,
              continuation_round:nextContinuationRound,
              max_continuation_rounds:MAX_SYNTHESIS_PROVENANCE_CONTINUATION_ROUNDS,
              revision_guidance:synthesisProvenanceGuidance,
              review:asObject(synthesisProvenanceReview),
              child_state_hash:sha256(childStates),
              accumulator_hash:sha256(accumulator),
              semantic_state_preserved:true,
              merges_reused:true,
              deferred_at:new Date().toISOString(),
            };
            node=await saveNode({
              nodePath:node.node_path,
              parentPath:node.parent_path??parentPathOf(node.node_path),
              ordinal:node.ordinal||0,
              requirement:node.requirement_text,
              sourceKind:node.source_kind,
              sourceRef:node.source_ref,
              status:'split',
              decisionType:'SPLIT',
              decisionPayload:{
                ...(node.decision_payload||{}),
                synthesis_cursor:childRows.length,
                synthesis_accumulator:accumulator,
                synthesis_complete:false,
                synthesis_provenance_pending:continuation,
              },
              contextPayload:node.context_payload||{},
              resultArtifact:null,
            });
            node.parent_path=node.parent_path??parentPathOf(node.node_path);
            const exhausted=nextContinuationRound>=MAX_SYNTHESIS_PROVENANCE_CONTINUATION_ROUNDS;
            const error=new Error(
              (exhausted
                ?'cognition_provenance_continuation_exhausted:'
                :'cognition_provenance_continuation_required:')
              +node.node_path
            );
            error.code=exhausted
              ?'COGNITION_PROVENANCE_CONTINUATION_EXHAUSTED'
              :'COGNITION_PROVENANCE_CONTINUATION_REQUIRED';
            error.provenanceContinuation=continuation;
            throw error;
          }
          continue;
        }
        break;
      }catch(error){
        const recoverable=error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT';
        if(!recoverable||attempt===2)throw error;
      }
    }

    const outcome=text(final?.parsed?.outcome).toUpperCase();
    if(!['COMPLETE','BLOCKED'].includes(outcome))
      throw new Error('autonomous_decomposition_synthesis_outcome_invalid:'+node.node_path);
    const artifact=artifactText(final?.parsed?.artifact);
    if(!artifact)throw new Error('autonomous_decomposition_synthesis_empty:'+node.node_path);
    const resultArtifact=JSON.stringify({status:outcome,artifact,handoff:asObject(final?.parsed?.handoff)});
    const completedDecisionPayload={...(node.decision_payload||{})};
    delete completedDecisionPayload.synthesis_provenance_pending;
    const done=await saveNode({
      nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
      requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
      status:outcome==='BLOCKED'?'blocked':'completed',
      decisionType:outcome==='BLOCKED'?'BLOCKED':'SPLIT',
      decisionPayload:{
        ...completedDecisionPayload,
        synthesis_cursor:childRows.length,
        synthesis_child_result_hashes:currentChildResultHashes,
        synthesis_complete:true,
        synthesis_outcome:outcome,
        synthesis_reason:clip(final?.parsed?.reason,2200),
        decomposition_decision:'SPLIT',
        blocked_child_count:childStates.filter(v=>v.status==='blocked'||v.decision_type==='BLOCKED').length,
        synthesis_provenance_review:asObject(synthesisProvenanceReview),
        terminal_synthesis_ownership_version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
        terminal_stage_contract_name:terminalStageContract.applies?terminalStageContract.name:null,
        stage_contract_materialization_version:
          terminalStageContract.applies?STAGE_CONTRACT_MATERIALIZATION_VERSION:null,
      },
      contextPayload:node.context_payload||{},resultArtifact,
    });
    done.parent_path=node.parent_path??parentPathOf(node.node_path);
    if(outcome==='COMPLETE')
      return ensureCanonicalStageCandidateSubmission(
        done,
        terminalStageContract.applies
          ? JSON.parse(text(final?.parsed?.artifact))
          : null
      );
    return done;
  }

  async function process(nodePath,parentPath=null,branchDepth=0,singleChildRefinements=0){
    // Depth is persisted for addressability only. It is not the normal convergence budget.
    branchDepth=pathDepth(nodePath);
    singleChildRefinements=0;
    let node=await getNode(nodePath);
    if(node?.status!=='ready')throw new Error('autonomous_decomposition_node_missing:'+nodePath);
    node.parent_path=parentPath;
    counters.nodes++;

    if(node.node_status==='completed'){
      const atomicRevalidation=completedAtomicDeterministicRevalidation(packet,node);
      if(atomicRevalidation.required){
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:'ATOMIC',
          decisionPayload:{
            ...(node.decision_payload||{}),
            deterministic_math_reconciliation_required:true,
            deterministic_math_attempts:Math.max(0,Number(node?.decision_payload?.deterministic_math_attempts||0)),
            deterministic_math_verification:atomicRevalidation.verification,
            deterministic_math_gate:'legacy_completed_atomic_revalidation_v0_1',
            legacy_completed_atomic_reopened:true,
            legacy_completed_atomic_prior_result_hash:node.result_hash||null,
            reconsider_decomposition:false,
          },
          contextPayload:{
            ...(node.context_payload||{}),
            deterministic_math_feedback:{
              attempt:Math.max(0,Number(node?.decision_payload?.deterministic_math_attempts||0)),
              verifier:'python3_safe_math_v0_1',
              verification:atomicRevalidation.verification,
              instruction:'This completed quantitative node predates deterministic verification. Re-author the same requirement with explicit Python checks for every material result, preserving correct reasoning and correcting any disagreement.'
            },
          },
          resultArtifact:null,
        });
        node.parent_path=parentPath;
        console.log('AAU_AUTONOMOUS_LEGACY_ATOMIC_REOPENED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          reason:atomicRevalidation.verification?.error||'deterministic_verification_not_satisfied',
        }));
      }else if(text(node.decision_type).toUpperCase()==='SPLIT'){
        const existingChildRefs=(await children(node.node_path))
          .filter(child=>String(child?.status||child?.node_status||'')!=='cancelled');
        const existingChildren=[];
        for(const childRef of existingChildRefs){
          const hydrated=await getNode(childRef.node_path);
          if(hydrated?.status==='ready'){
            existingChildren.push({
              ...hydrated,
              parent_path:node.node_path,
            });
          }
        }
        const legacyChild=existingChildren.find(child=>
          completedAtomicDeterministicRevalidation(packet,child).required
        );
        if(!legacyChild)return ensureCanonicalStageCandidateSubmission(node);
        const nextPayload={...(node.decision_payload||{})};
        delete nextPayload.synthesis_complete;
        delete nextPayload.synthesis_outcome;
        delete nextPayload.synthesis_reason;
        delete nextPayload.synthesis_provenance_review;
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'split',
          decisionType:'SPLIT',
          decisionPayload:{
            ...nextPayload,
            synthesis_cursor:0,
            synthesis_accumulator:{},
            synthesis_rebuild_reason:'legacy_child_requires_deterministic_revalidation',
            synthesis_rebuild_at:new Date().toISOString(),
          },
          contextPayload:node.context_payload||{},
          resultArtifact:null,
        });
        node.parent_path=parentPath;
        console.log('AAU_AUTONOMOUS_PARENT_REOPENED_FOR_LEGACY_CHILD_VERIFICATION',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          child_path:legacyChild.node_path,
        }));
      }else{
        return ensureCanonicalStageCandidateSubmission(node);
      }
    }
    if(node.node_status==='blocked')return node;

    for(let transitions=0;transitions<8;transitions++){
      if(node.node_status==='split'||node.decision_type==='SPLIT'){
        let kids=(await children(node.node_path))
          .filter((child)=>String(child?.status||'')!=='cancelled')
          .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
        const childAuthoringFinalized=Boolean(node?.decision_payload?.children_authored);
        if(!childAuthoringFinalized){
          const authoredResult=await authorChildren(node,{branchDepth,singleChildRefinements});
          if(authoredResult?.reconsider){
            node=authoredResult.node;
            node.parent_path=parentPath;
            continue;
          }
          kids=asArray(authoredResult?.children);
        }
        if(!kids.length)
          throw new Error('autonomous_decomposition_split_requires_child:'+node.node_path);
        const completed=[];
        for(const child of kids){
          child.parent_path=node.node_path;
          const inherited=inheritedChildContext(node.context_payload);
          if(completed.length||Object.keys(inherited).length){
            const current=await getNode(child.node_path);
            if(current?.status!=='ready')throw new Error('autonomous_decomposition_child_lookup_failed:'+child.node_path);
            const routed=await saveNode({
              nodePath:current.node_path,
              parentPath:node.node_path,
              ordinal:current.ordinal||child.ordinal||0,
              requirement:current.requirement_text,
              sourceKind:current.source_kind||child.source_kind||'agent_decomposition',
              sourceRef:current.source_ref??child.source_ref??node.node_path,
              status:current.node_status,
              decisionType:current.decision_type??null,
              decisionPayload:current.decision_payload||{},
              contextPayload:boundContextPayload({
                ...(current.context_payload||{}),
                ...inherited,
                ...(completed.length?{completed_sibling_results:compactCompletedSiblingResults(completed)}:{}),
              }),
              resultArtifact:current.result_artifact||null,
            });
            routed.parent_path=node.node_path;
          }
          const done=await process(
            child.node_path,
            node.node_path,
            pathDepth(child.node_path),
            0
          );
          if(done.node_status!=='completed'&&done.node_status!=='blocked')
            throw new Error('autonomous_decomposition_child_not_resolved:'+child.node_path);
          completed.push(done);
        }
        return synthesize(node,completed);
      }

      const forceReconsider=Boolean(node?.decision_payload?.reconsider_decomposition);
      const decision=await decide(node,{forceReconsider,branchDepth,singleChildRefinements});
      node=decision.node;
      node.parent_path=parentPath;

      if(decision.decision==='SPLIT')continue;
      if(decision.decision==='BLOCKED')return node;
      if(decision.decision==='ATOMIC'){
        const result=await executeAtomic(node);
        node=result.node;
        node.parent_path=parentPath;
        if(result.completed)return node;
        if(result.split||result.reconsider)continue;
      }
    }
    throw new Error('autonomous_decomposition_transition_limit:'+nodePath);
  }

  let root=await getNode('R');
  if(root?.status==='not_found'){
    await chargeSemanticRuntime({
      eventKind:'semantic_node_created',
      materialKey:'R:'+sha256(rootReq.requirement),
      nodePath:'R',
      costUnits:semanticRuntime.node_create_units,
      eventFingerprint:sha256({node_path:'R',requirement:rootReq.requirement}),
      metadata:{root:true},
    });
    root=await saveNode({
      nodePath:'R',parentPath:null,ordinal:0,
      requirement:rootReq.requirement,sourceKind:rootReq.source_kind,sourceRef:rootReq.source_ref,
      status:'pending',decisionType:null,
      decisionPayload:{authored_decomposition_required:true},
      contextPayload:{},resultArtifact:null,
    });
  }else if(root?.status!=='ready'){
    throw new Error('autonomous_decomposition_root_lookup_failed');
  }

  if(String(semanticRuntimeSnapshot?.runtime_status||'')==='blocked'
     &&root.node_status!=='blocked'
     &&root.node_status!=='completed'){
    const error=new Error('semantic_runtime_terminal:cycle_lock:'+assignmentKey);
    error.code='SEMANTIC_RUNTIME_CYCLE_LOCK';
    error.semanticRuntime=semanticRuntimeSnapshot;
    throw error;
  }

  if(root.node_status!=='completed'&&root.node_status!=='blocked'){
    const wakeRuntimeView=await semanticRuntimeView();
    const wakeStateFingerprint=sha256({
      material_transition_count:Number(wakeRuntimeView?.material_transition_count||0),
      semantic_node_count:Number(wakeRuntimeView?.semantic_node_count||0),
      root_status:root.node_status||null,
      root_decision_type:root.decision_type||null,
      root_result_hash:root.result_hash||null,
      root_updated_at:root.updated_at||null,
      root_decision_payload:root.decision_payload||{},
      root_context_hash:sha256(root.context_payload||{}),
    });
    const wakeCharge=await chargeSemanticRuntime({
      eventKind:'wake_resume',
      materialKey:String(intentExecutionId),
      nodePath:'R',
      costUnits:1,
      eventFingerprint:wakeStateFingerprint,
      metadata:{root_status:root.node_status||null},
    });
    const cycleLocked=repeatedStructuralFailureLocked({
      repeatCount:Number(wakeCharge?.fingerprint_repeat_count||0),
      currentMaterialFingerprint:wakeStateFingerprint,
      lockedMaterialFingerprint:wakeStateFingerprint,
      limit:semanticRuntime.identical_structural_failure_limit+1,
    });
    if(cycleLocked){
      await closeSemanticRuntime('blocked',{
        block_reason:'repeated_wake_without_material_state_progress',
        repeated_state_fingerprint:wakeStateFingerprint,
        repeat_count:Number(wakeCharge?.fingerprint_repeat_count||0),
      });
      const error=new Error('semantic_runtime_cycle_lock:'+assignmentKey);
      error.code='SEMANTIC_RUNTIME_CYCLE_LOCK';
      error.semanticRuntime=semanticRuntimeSnapshot;
      throw error;
    }
  }

  let completedRoot;
  try{
    completedRoot=await process('R',null,0,0);
  }catch(error){
    if(error?.code==='SEMANTIC_BUDGET_EXHAUSTED'){
      semanticRuntimeSnapshot=await semanticRuntimeView().catch(()=>semanticRuntimeSnapshot);
    }
    throw error;
  }

  if(completedRoot.node_status==='completed'||completedRoot.node_status==='blocked'){
    semanticRuntimeSnapshot=await closeSemanticRuntime(
      completedRoot.node_status==='blocked'?'blocked':'complete',
      {
        root_node_id:completedRoot.node_id,
        root_status:completedRoot.node_status,
        root_result_hash:completedRoot.result_hash||null,
      }
    );
  }
  const parts=resultParts(completedRoot.result_artifact);
  if(!parts.artifact)throw new Error('autonomous_decomposition_root_artifact_empty');
  const authoritativeRootChildRefs=(await children('R'))
    .filter(child=>String(child?.status||child?.node_status||'')!=='cancelled')
    .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
  const authoritativeRootChildren=[];
  for(const childRef of authoritativeRootChildRefs){
    const child=await getNode(childRef.node_path);
    if(child?.status!=='ready')continue;
    authoritativeRootChildren.push({
      node_path:child.node_path,
      status:child.node_status||null,
      decision_type:child.decision_type||null,
      requirement_text:child.requirement_text||null,
      result_hash:child.result_hash||null,
      result_artifact:child.result_artifact||null,
      deterministic_math_verified:child?.decision_payload?.deterministic_math_verified===true
        ||String(child?.decision_payload?.deterministic_math_verified||'').toLowerCase()==='true',
      deterministic_math_check_count:Number(child?.decision_payload?.deterministic_math_check_count||0),
    });
  }

  return {
    artifact:parts.artifact,
    authoritative_children:authoritativeRootChildren,
    meta:{
      contract:'autonomous_recursive_decomposition_v0_2',
      assignment_key:assignmentKey,
      root_node_id:completedRoot.node_id,
      root_requirement_hash:completedRoot.requirement_hash,
      root_source_kind:rootReq.source_kind,
      root_source_ref:rootReq.source_ref,
      nodes_touched:counters.nodes,
      model_calls:counters.model_calls,
      context_requests:counters.context_requests,
      convergence_policy:'conserved_work_budget_v0_2_with_emergency_storage_depth_only',
      cognitive_continuity_policy:'agent_discovery_restore_and_reconcile_v0_1',
      routing_protocol:'deep_discovery_then_commit_v0_1',
      decomposition_authored_by_bound_agent:true,
      runtime_role:'semantic_tree_persistence_plus_separate_execution_budget_ledger',
      cognition_mode:modeInfo?.mode||'deep',
      root_status:completedRoot.node_status||null,
      root_decision_type:completedRoot.decision_type||null,
      context_resource_policy:'agent_visible_progress_based_context_resource_v0_1',
      evidence_retention_policy:'pinned_research_evidence_v0_1_outside_context_eviction',
      sibling_evidence_handoff_policy:'authoritative_completed_sibling_evidence_v0_1_attention_accounted',
      self_remediation_policy:'agent_authored_cognitive_self_remediation_v0_1_bounded_verified',
      child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
      child_authoring_failure_policy:'durable_rejected_attempt_then_agent_reconsideration_v0_1',
      atomic_execution_budget_policy:'dedicated_deep_budget_v0_1_7000',
      atomic_reconciliation_budget_policy:'dedicated_deep_budget_v0_1_5000',
      synthesis_merge_budget_policy:'dedicated_deep_budget_v0_1_6000_with_bounded_retry',
      synthesis_final_budget_policy:'dedicated_deep_budget_v0_1_7000_with_bounded_retry',
      model_context_policy:'model_profile_token_context_v0_2_in_memory_model_view_durable_catalog_rehydration',
      model_runtime_contract_version:'model_runtime_profiles_v0_2',
      model_runtime_variables:{
        context_window_tokens:agentRuntimeContract.context_window_tokens??null,
        operational_context_limit_tokens:agentRuntimeContract.operational_context_limit_tokens??null,
        max_output_tokens:agentRuntimeContract.max_output_tokens??null,
        operational_output_limit_tokens:agentRuntimeContract.operational_output_limit_tokens??null,
        request_timeout_ms:agentRuntimeContract.request_timeout_ms??null,
        max_request_timeout_ms:agentRuntimeContract.max_request_timeout_ms??null,
        reasoning_support:agentRuntimeContract.reasoning_support??null,
        supports_thinking:agentRuntimeContract.supports_thinking===true,
        reasoning_counts_against_output:agentRuntimeContract.reasoning_counts_against_output===true,
      },
      stage_output_budgets:stageBudgets,
      node_checkpoint_transport_policy:'envelope_aware_context_compaction_v0_1_220000_bytes',
      research_batch_handoff_policy:'requirement_linked_durable_receipts_v0_1',
      semantic_runtime_contract:SEMANTIC_RUNTIME_CONTRACT,
      semantic_runtime_epoch:semanticRuntime.epoch_no,
      semantic_runtime_budget_quantum_tokens:semanticRuntime.quantum_tokens,
      semantic_runtime_initial_budget_units:semanticRuntime.initial_budget_units,
      semantic_runtime_remaining_budget_units:Number(semanticRuntimeSnapshot?.remaining_budget_units||0),
      semantic_runtime_transition_count:Number(semanticRuntimeSnapshot?.transition_count||0),
      semantic_runtime_semantic_node_count:Number(semanticRuntimeSnapshot?.semantic_node_count||0),
      semantic_runtime_status:semanticRuntimeSnapshot?.runtime_status||null,
    },
  };
}
