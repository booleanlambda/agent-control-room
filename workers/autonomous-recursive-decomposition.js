import {
  resolveModelRuntimeContract,
  modelInputBudgetTokens,
} from './model-runtime-profiles.js';

// AAU autonomous recursive decomposition v0.1
// The bound agent authors decomposition. Runtime only persists/routes/checkpoints.

const MAX_BRANCH_DEPTH=12;
const MAX_SINGLE_CHILD_REFINEMENTS=4;
const MAX_ATOMIC_EXECUTION_FAILURES=1;
const MAX_CHILDREN_PER_NODE=16;
const MAX_CONTEXT_RESEARCH_ROUNDS=12;
const MAX_CONTEXT_STAGNANT_ROUNDS=2;
const MAX_CONTEXT_UNCHANGED_GAP_ROUNDS=3;
const MAX_CONTEXT_REPEAT_REQUEST_ROUNDS=2;
const MAX_CONTEXT_ELAPSED_MS=30*60*1000;
const MAX_CONTEXT_UNIQUE_SOURCES=250;
const MAX_CONTEXT_REQUESTS_PER_ROUND=8;
const MAX_CONTEXT_VALUE_BYTES=12000;
const MAX_PERSISTED_CONTEXT_BYTES=262144;
const MAX_PINNED_EVIDENCE_ITEMS_IN_COGNITION=16;
const MAX_PINNED_EVIDENCE_EXCERPT_CHARS=12000;
const MAX_SELF_REMEDIATION_ATTEMPTS=2;
const CHILD_FORMULATION_DEEP_TOKENS=7000;
const ATOMIC_EXECUTION_DEEP_TOKENS=7000;
const ATOMIC_RECONCILIATION_DEEP_TOKENS=5000;
const SYNTHESIS_MERGE_DEEP_TOKENS=6000;
const SYNTHESIS_FINAL_DEEP_TOKENS=7000;
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
  const startedMs=Date.parse(text(s.started_at));
  const elapsedMs=Number.isFinite(startedMs)?Math.max(0,Date.now()-startedMs):0;
  const uniqueSources=Math.max(
    asArray(contextPayload?.research_source_catalog).length,
    Number(s.total_new_sources||0)
  );
  const reasons=[];
  if(Number(s.context_rounds_attempted||0)>=MAX_CONTEXT_RESEARCH_ROUNDS)
    reasons.push('absolute_context_round_safety_ceiling');
  if(Number(s.stagnant_rounds||0)>=MAX_CONTEXT_STAGNANT_ROUNDS)
    reasons.push('no_new_observations');
  if(Number(s.unchanged_gap_rounds||0)>=MAX_CONTEXT_UNCHANGED_GAP_ROUNDS)
    reasons.push('unresolved_gap_not_changing');
  if(Number(s.repeated_request_rounds||0)>=MAX_CONTEXT_REPEAT_REQUEST_ROUNDS)
    reasons.push('research_request_repeating');
  if(elapsedMs>=MAX_CONTEXT_ELAPSED_MS)
    reasons.push('context_acquisition_elapsed_time_ceiling');
  if(uniqueSources>=MAX_CONTEXT_UNIQUE_SOURCES)
    reasons.push('unique_source_safety_ceiling');
  return {
    available:reasons.length===0,
    exhausted:reasons.length>0,
    reasons,
    elapsed_ms:elapsedMs,
    unique_sources:uniqueSources,
    context_rounds_attempted:Number(s.context_rounds_attempted||0),
    research_rounds_attempted:Number(s.research_rounds_attempted||0),
    local_context_rounds_attempted:Number(s.local_context_rounds_attempted||0),
    stagnant_rounds:Number(s.stagnant_rounds||0),
    unchanged_gap_rounds:Number(s.unchanged_gap_rounds||0),
    repeated_request_rounds:Number(s.repeated_request_rounds||0),
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
function boundContextPayload(payload){
  const src=asObject(payload);
  if(bytes(src)<=MAX_PERSISTED_CONTEXT_BYTES)return src;
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
    if(key==='completed_sibling_results'||key==='inherited_completed_sibling_results')return 9000;
    if(key.startsWith('external_research'))return 7000+researchRound(key);
    return 0;
  };
  const tryAdd=(key,value)=>{
    const candidate={...out,[key]:value};
    if(bytes(candidate)<=MAX_PERSISTED_CONTEXT_BYTES-reserve){
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
    max_bytes:MAX_PERSISTED_CONTEXT_BYTES,
    policy:'durable_context_independent_of_model_v0_1_compact_catalog_never_wholesale_drop',
    evicted_count:evicted.length,
    research_source_catalog_items:asArray(out.research_source_catalog).length,
  };
  while(bytes(out)>MAX_PERSISTED_CONTEXT_BYTES && out._context_evicted.length){
    out._context_evicted.pop();
  }
  return out;
}

function inheritedChildContext(parentPayload){
  const src=asObject(parentPayload);
  const inherited={};
  if(Array.isArray(src.completed_sibling_results)&&src.completed_sibling_results.length){
    inherited.completed_sibling_results=src.completed_sibling_results;
  }
  if(Array.isArray(src.inherited_completed_sibling_results)&&src.inherited_completed_sibling_results.length){
    inherited.inherited_completed_sibling_results=src.inherited_completed_sibling_results;
  }
  return boundContextPayload(inherited);
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

function extractTriggerRequirement(packet){
  const admin=asObject(packet?.admin_chat_context?.current_admin_message);
  if(text(admin.content)){
    return {source_kind:'admin_message',source_ref:text(admin.message_id)||null,requirement:text(admin.content)};
  }
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

function resolveContext(packet,requests,localContext={}){
  const out={};
  for(const raw of asArray(requests).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND)){
    const path=text(raw);
    if(!path||Object.prototype.hasOwnProperty.call(out,path))continue;
    const localHit=getPath(localContext,path);
    const packetHit=localHit.found?localHit:getPath(packet,path);
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
      artifact:text(parsed.artifact)||text(parsed.summary)||raw,
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
    ...asArray(src.inherited_completed_sibling_results),
    ...asArray(src.completed_sibling_results),
  ];
  const out=[];
  const seen=new Set();
  for(const raw of merged){
    const row=asObject(raw);
    const key=text(row.path)||text(row.result_hash)||safeJson(row).slice(0,240);
    if(!key||seen.has(key))continue;
    seen.add(key);
    out.push({
      path:row.path||null,
      status:row.status||null,
      decision_type:row.decision_type||null,
      requirement:clip(row.requirement,900),
      artifact:clip(row.artifact,5000),
      handoff_json:clip(row.handoff_json,2400),
      result_hash:row.result_hash||null,
    });
  }
  return out.slice(-8);
}
function siblingEvidencePaths(rows){
  return asArray(rows).map(v=>text(v?.path)).filter(Boolean);
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
  const rootReq=extractTriggerRequirement(packet);
  const assignmentKey='req:'+sha256({
    agent_id:agentId,
    source_kind:rootReq.source_kind,
    source_ref:rootReq.source_ref,
    requirement:rootReq.requirement,
  }).slice(0,48);
  const idx=contextIndex(packet);
  const counters={nodes:0,model_calls:0,context_requests:0};

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

  async function nodeRpc(action,args={}){
    return rpc('aau_bridge_cognition_requirement_node_v0_1',{
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
      p_context_payload:boundContextPayload(args.contextPayload??{}),
      p_result_artifact:args.resultArtifact??null,
    });
  }

  async function saveNode(args){
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
    if(!researchObserved||!asArray(researchUrls).length)
      return {save:{status:'ready',inserted:0,extended:0,unchanged:0,restored_or_extended:0},evidence:await loadPinnedEvidence(nodePath)};
    const requestedUrlKeys=new Set(asArray(researchUrls).map(normalizedUrl).filter(Boolean));
    const pinCandidates=asArray(researchObserved.sources)
      .filter(source=>
        source?.fetch_status==='fetched_text'
        && typeof source?.excerpt==='string'
        && source.excerpt.length
        && requestedUrlKeys.has(normalizedUrl(source?.url))
      )
      .slice(0,16)
      .map(source=>({
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
      inserted:Number(save.inserted||0),
      extended:Number(save.extended||0),
      unchanged:Number(save.unchanged||0),
      restored_or_extended:Number(save.restored_or_extended||0),
      pinned_items:evidence.length,
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

  function childProposalStepKey(node,ordinal){
    const discovery=asObject(node?.decision_payload?.routing_discovery_checkpoint);
    return 'childprop:'+sha256({
      node_path:node.node_path,
      ordinal,
      requirement_hash:node.requirement_hash||sha256(node.requirement_text||''),
      discovery_fingerprint:text(discovery.context_fingerprint)||null,
      discovery_decision:text(discovery.decision)||null,
    }).slice(0,56);
  }

  async function loadChildProposalCheckpoint(node,ordinal){
    const row=await cognitionStepRpc('get',childProposalStepKey(node,ordinal),null,{});
    if(row?.status==='not_found')return null;
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_child_proposal_checkpoint_lookup_failed:'+node.node_path);
    let proposal=null;
    try{proposal=JSON.parse(String(row.artifact||''));}
    catch{throw new Error('autonomous_decomposition_child_proposal_checkpoint_malformed:'+node.node_path);}
    return {row,proposal:asObject(proposal)};
  }

  async function saveChildProposalCheckpoint(node,ordinal,proposal){
    const artifact=JSON.stringify(proposal);
    const row=await cognitionStepRpc('save',childProposalStepKey(node,ordinal),artifact,{
      contract:'agent_authored_child_proposal_v0_1',
      node_path:node.node_path,
      ordinal,
      discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
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

  async function callJson(messages,maxTokens,phase){
    counters.model_calls++;
    return completeJson(messages,maxTokens,phase);
  }

  async function callRoute(messages,maxTokens,phase){
    counters.model_calls++;
    const fn=typeof completeRouteJson==='function'?completeRouteJson:completeJson;
    return fn(messages,maxTokens,phase);
  }

  async function callSerialize(messages,maxTokens,phase){
    counters.model_calls++;
    const fn=typeof completeSerializeJson==='function'?completeSerializeJson
      :(typeof completeRouteJson==='function'?completeRouteJson:completeJson);
    return fn(messages,maxTokens,phase);
  }

  async function decide(node,{forceReconsider=false,branchDepth=0,singleChildRefinements=0}={}){
    let contextPayload=asObject(node.context_payload);
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
    const normalizedBranchDepth=Math.max(0,Math.min(Number(branchDepth)||0,MAX_BRANCH_DEPTH));
    const structuralBranchingAvailable=normalizedBranchDepth<MAX_BRANCH_DEPTH;
    const singleRefinementAvailable=singleChildRefinements<MAX_SINGLE_CHILD_REFINEMENTS;
    const splitAvailable=structuralBranchingAvailable||singleRefinementAvailable;

    let contextState=asObject(node?.decision_payload?.context_resource_state);
    if(contextState.version!=='agent_visible_context_resource_v0_1'){
      const legacyRounds=Math.max(
        0,
        Number(node?.decision_payload?.context_round??-1)+1,
        Object.keys(contextPayload).filter(key=>/^external_research_round_\d+$/.test(key)).length
      );
      contextState={
        version:'agent_visible_context_resource_v0_1',
        started_at:new Date().toISOString(),
        context_rounds_attempted:legacyRounds,
        research_rounds_attempted:legacyRounds,
        local_context_rounds_attempted:0,
        stagnant_rounds:0,
        unchanged_gap_rounds:0,
        repeated_request_rounds:0,
        total_new_sources:0,
        total_new_local_context_paths:0,
        last_gap_signal:null,
        last_request_signal:null,
      };
    }

    while(true){
      contextPayload=boundInMemoryContext(contextPayload,pinnedEvidence,10000);
      const discoveryContextView=agentModelContextView(contextPayload,pinnedEvidence,10000);
      const siblingEvidence=discoveryContextView.siblingEvidence;
      const cognitionContext=discoveryContextView.suppliedContext;
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
      const availableDecisions=[
        'ATOMIC',
        'SPLIT',
        resourceView.available?'NEED_CONTEXT':'BLOCKED',
        ...(remediationAvailable?['REMEDIATE']:[]),
      ]
        .filter(v=>!(v==='ATOMIC'&&atomicUnavailable))
        .filter(v=>!(v==='SPLIT'&&!splitAvailable));

      const contextFingerprint=sha256({
        node_path:node.node_path,
        requirement:node.requirement_text,
        context_payload:contextPayload,
        pinned_evidence_index:pinnedEvidence.map(v=>({
          source_key:v.source_key,source_id:v.source_id,url:v.url,sha256:v.sha256,excerpt_bytes:v.excerpt_bytes
        })),
        authoritative_sibling_results:siblingEvidence.map(v=>({
          path:v.path,status:v.status,decision_type:v.decision_type,result_hash:v.result_hash
        })),
        remediation_history:compactRemediationEpisodes(remediationEpisodes),
        child_authoring_failure_count:Number(node?.decision_payload?.child_authoring_failure_count||0),
        child_authoring_failure:asObject(node?.decision_payload?.child_authoring_failure),
        force_reconsider:Boolean(forceReconsider),
        atomic_unavailable:atomicUnavailable,
        atomic_execution_failures:atomicExecutionFailures,
        structural_branch_depth:normalizedBranchDepth,
        max_structural_branch_depth:MAX_BRANCH_DEPTH,
        structural_branching_available:structuralBranchingAvailable,
        single_child_refinements_used:singleChildRefinements,
        max_single_child_refinements:MAX_SINGLE_CHILD_REFINEMENTS,
        single_refinement_available:singleRefinementAvailable,
        context_resource_available:resourceView.available,
        context_resource_reasons:resourceView.reasons,
        context_rounds_attempted:resourceView.context_rounds_attempted,
        stagnant_rounds:resourceView.stagnant_rounds,
        unchanged_gap_rounds:resourceView.unchanged_gap_rounds,
        repeated_request_rounds:resourceView.repeated_request_rounds,
        unique_sources:resourceView.unique_sources,
      });

      const priorPayload=asObject(node.decision_payload);
      const priorDiscovery=asObject(priorPayload.routing_discovery_checkpoint);
      const priorDecision=text(priorDiscovery.decision).toUpperCase();
      const reusableDiscovery=
        priorDiscovery.version==='agent_deep_discovery_v0_1'
        && priorDiscovery.context_fingerprint===contextFingerprint
        && availableDecisions.includes(priorDecision);

      let discovery=reusableDiscovery?priorDiscovery:null;

      if(!discovery){
        for(let attempt=1;attempt<=2;attempt++){
          try{
            const response=await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent performing a DEEP DISCOVERY pass for ONE requirement.',
                'Thinking is enabled. This pass is where YOU determine what the requirement means and what action YOU intend to take.',
                'The runtime does not choose, reinterpret, decompose, repair, or declare the requirement blocked for you.',
                'Available decisions for this exact node: '+availableDecisions.join(', ')+'.',
                remediationAvailable
                  ? 'REMEDIATE is available because you have a prior durable cognitive state and remaining remediation budget. Choose it only if YOU detect a contradiction, stale belief, or recoverable cognitive-state failure in your own prior reasoning. The runtime will not diagnose the anomaly for you.'
                  : 'REMEDIATE is mechanically unavailable because there is no eligible prior cognitive state or the remediation budget is exhausted.',
                'If you choose REMEDIATE, YOU must supply observed_anomaly, prior_belief, contradicting_evidence, diagnosis, repair_type, repair_payload, and verification_criterion. Allowed repair types are '+SELF_REMEDIATION_REPAIR_TYPES.join(', ')+'. INVALIDATE_DISCOVERY_CHECKPOINT supersedes your current discovery checkpoint and makes you reconsider. REFRESH_SIBLING_EVIDENCE mechanically reloads resolved siblings and also supersedes your current discovery checkpoint. Neither repair changes facts, conclusions, atomic-failure counts, or hard resource ceilings.',
                atomicUnavailable
                  ? 'ATOMIC is mechanically unavailable because this exact node already exhausted its bounded atomic execution.'
                  : 'ATOMIC remains available if you judge the requirement genuinely bounded.',
                'Mechanical decomposition budget: structural branch depth '+normalizedBranchDepth+' of '+MAX_BRANCH_DEPTH+'; consecutive single-child refinements '+singleChildRefinements+' of '+MAX_SINGLE_CHILD_REFINEMENTS+'.',
                structuralBranchingAvailable
                  ? 'A SPLIT may create multiple children if your reasoning requires it.'
                  : (singleRefinementAvailable
                    ? 'Structural branch depth is exhausted. SPLIT remains available only as exactly ONE genuinely narrower refinement child; it may not create multiple children.'
                    : 'Structural branch depth and the single-child refinement budget are both exhausted, so SPLIT is mechanically unavailable.'),
                resourceView.available
                  ? 'Context/research acquisition remains mechanically available. NEED_CONTEXT is valid only when another retrieval or exact context lookup can materially reduce a stated gap.'
                  : 'CONTEXT RESOURCE CONSTRAINT: further context/research acquisition is mechanically unavailable for this node because: '+resourceView.reasons.join(', ')+'. Do not request more context or research. BLOCKED is available if the remaining evidence gap prevents honest completion; ATOMIC or SPLIT remain yours to choose when mechanically available.',
                'Before deciding, interrogate semantic equivalence, definitions, time horizons, populations/scopes, proxy metrics, evidence sufficiency, assumptions, and unresolved gaps.',
                'AUTHORITATIVE SIBLING HANDOFF: authoritative_completed_sibling_evidence contains durable outputs of already resolved sibling requirements. Inspect every listed sibling before deciding NEED_CONTEXT. A fact already present in a completed sibling artifact or handoff is available evidence; do not request it again merely because the original source excerpt is absent from this node. You may still reject or qualify a sibling fact if you identify a substantive insufficiency, but state that reason explicitly.',
                'For every sibling path supplied, include it in inspected_sibling_paths. This is an attention/accounting requirement only; the runtime does not decide whether the sibling evidence is substantively sufficient.',
                'Do not treat a nearby metric or label as equivalent unless YOU can justify the equivalence from supplied evidence.',
                'When supplied_context contains research_source_catalog, treat it as the complete discoverable source index for prior research rounds. If context acquisition is available and a source is indexed but its excerpt is insufficient, put its exact listed HTTPS URL in research_urls (not context_requests) so the runtime can fetch it directly.',
                'Do not solve the requirement or author child requirements in this pass.',
                'Return complete JSON only: {"decision":"ATOMIC|SPLIT|NEED_CONTEXT|BLOCKED|REMEDIATE","reason":"auditable reason","requirement_interpretation":"what this requirement actually demands","evidence_assessment":"what the current evidence does and does not establish","inspected_sibling_paths":["R.001..."],"unresolved_gaps":["..."],"context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."],"remediation":{"observed_anomaly":"required when REMEDIATE","prior_belief":"required when REMEDIATE","contradicting_evidence":[],"diagnosis":"required when REMEDIATE","repair_type":"INVALIDATE_DISCOVERY_CHECKPOINT|REFRESH_SIBLING_EVIDENCE","repair_payload":{},"verification_criterion":"required when REMEDIATE"}}.',
                forceReconsider
                  ? 'A prior atomic execution was rejected or exhausted. Reconsider the requirement under the persisted constraints rather than repeating the failed action.'
                  : '',
              ].filter(Boolean).join('\n')},
              {role:'user',content:safeJson({
                requirement:node.requirement_text,
                agent_authored_discovery_state:agentDiscoveryState(node),
                source:{kind:node.source_kind,ref:node.source_ref},
                authoritative_completed_sibling_evidence:siblingEvidence,
                prior_cognitive_state:priorCognitiveState,
                durable_self_remediation_history:compactRemediationEpisodes(remediationEpisodes),
                decomposition_execution_failure:asObject(node?.decision_payload?.child_authoring_failure),
                supplied_context:cognitionContext,
                available_context_index:idx,
                available_supplied_context_index:indexObject(cognitionContext),
                available_decisions:availableDecisions,
                runtime_resource_constraints:{
                  structural_branch_depth:normalizedBranchDepth,
                  max_structural_branch_depth:MAX_BRANCH_DEPTH,
                  multi_child_split_available:structuralBranchingAvailable,
                  single_child_refinements_used:singleChildRefinements,
                  max_single_child_refinements:MAX_SINGLE_CHILD_REFINEMENTS,
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
            const candidateDecision=text(candidate.decision).toUpperCase();
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
            const requiredSiblingPaths=siblingEvidencePaths(siblingEvidence);
            const inspectedSiblingPaths=new Set(asArray(candidate.inspected_sibling_paths).map(text).filter(Boolean));
            const missingSiblingInspection=requiredSiblingPaths.filter(path=>!inspectedSiblingPaths.has(path));
            if(missingSiblingInspection.length){
              if(attempt===2)throw new Error('autonomous_decomposition_discovery_sibling_evidence_uninspected:'+node.node_path+':'+missingSiblingInspection.join(','));
              continue;
            }

            discovery={
              version:'agent_deep_discovery_v0_1',
              context_fingerprint:contextFingerprint,
              decision:candidateDecision,
              reason:clip(candidate.reason,2200),
              requirement_interpretation:clip(candidate.requirement_interpretation,2800),
              evidence_assessment:clip(candidate.evidence_assessment,3200),
              inspected_sibling_paths:asArray(candidate.inspected_sibling_paths).map(text).filter(Boolean).slice(0,16),
              authoritative_sibling_result_hashes:siblingEvidence.map(v=>({path:v.path,result_hash:v.result_hash})),
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
              structural_branch_depth:normalizedBranchDepth,
              max_structural_branch_depth:MAX_BRANCH_DEPTH,
              multi_child_split_available:structuralBranchingAvailable,
              single_child_refinements_used:singleChildRefinements,
              max_single_child_refinements:MAX_SINGLE_CHILD_REFINEMENTS,
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
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callSerialize([
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

      if(decision==='NEED_CONTEXT'){
        if(!resourceView.available)
          throw new Error('autonomous_decomposition_context_action_protocol_violation:'+node.node_path);

        const rawRequests=discovery.context_requests;
        const urlRequestsFromContext=rawRequests.filter(v=>/^https:\/\//i.test(text(v)));
        const requests=rawRequests.filter(v=>!/^https:\/\//i.test(text(v)));
        const researchQueries=discovery.research_queries;
        const researchUrls=[...new Set([
          ...discovery.research_urls,
          ...urlRequestsFromContext,
        ].map(text).filter(v=>/^https:\/\//i.test(v)))].slice(0,8);
        if(!requests.length&&!researchQueries.length&&!researchUrls.length)
          throw new Error('autonomous_decomposition_context_request_empty:'+node.node_path);

        counters.context_requests+=requests.length+researchQueries.length+researchUrls.length;

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

        contextState={
          ...contextState,
          version:'agent_visible_context_resource_v0_1',
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
            new_sources:newSourceCount,
            new_local_context_paths:newLocalContextPaths,
            gap_similarity:Number(gapSimilarity.toFixed(4)),
            request_similarity:Number(requestSimilarity.toFixed(4)),
            research_status:researchObserved?.status||null,
            audit_batch_id:researchObserved?.audit_batch_id||null,
            normalized_url_requests_from_context:urlRequestsFromContext.length,
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

  async function authorChildren(node,{branchDepth=0,singleChildRefinements=0}={}){
    const allExisting=await children(node.node_path);
    const existing=allExisting.filter((child)=>String(child?.status||'')!=='cancelled');
    if(existing.length)return {children:existing,reconsider:false};

    const authored=[];
    const normalizedBranchDepth=Math.max(0,Math.min(Number(branchDepth)||0,MAX_BRANCH_DEPTH));
    const structuralBranchingAvailable=normalizedBranchDepth<MAX_BRANCH_DEPTH;
    const singleRefinementAvailable=singleChildRefinements<MAX_SINGLE_CHILD_REFINEMENTS;
    const maxChildrenThisSplit=structuralBranchingAvailable?MAX_CHILDREN_PER_NODE:(singleRefinementAvailable?1:0);
    if(maxChildrenThisSplit<1)throw new Error('autonomous_decomposition_split_mode_unavailable:'+node.node_path);
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

    for(let offset=0;offset<maxChildrenThisSplit;offset++){
      const ordinal=startOrdinal+offset;
      const previous=authored.map(c=>({ordinal:c.ordinal,requirement:c.requirement_text}));
      const childPinnedEvidence=await loadPinnedEvidence(node.node_path);
      const childContextView=agentModelContextView(
        node.context_payload||{},childPinnedEvidence,CHILD_FORMULATION_DEEP_TOKENS
      );

      let proposalCheckpoint=await loadChildProposalCheckpoint(node,ordinal);
      let proposal=proposalCheckpoint?.proposal||null;

      if(!proposal){
        let formulationError=null;
        for(let attempt=1;attempt<=2;attempt++){
          try{
            const response=await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent FORMULATING the next child for ONE parent requirement.',
                'Thinking is enabled. Do the substantive decomposition reasoning here.',
                'You own the child requirement. The runtime will not invent, narrow, or repair it for you.',
                'Author exactly ONE next child requirement, or declare DONE when the children already authored adequately cover the parent.',
                'A CHILD must be independently completable, materially narrower than the parent, and include explicit scope removed plus a concrete completion criterion.',
                'Do not execute or solve the child.',
                'Return complete JSON only: {"status":"CHILD","requirement":"...","scope_removed":"...","completion_criterion":"...","reason":"brief"} OR {"status":"DONE","coverage_note":"brief"}.',
                structuralBranchingAvailable
                  ? 'There is no required number of children. One child is valid only when genuinely narrower; use as many or as few children as your reasoning requires.'
                  : 'MECHANICAL DEPTH CONSTRAINT: structural branch depth is exhausted. You may author exactly ONE genuinely narrower refinement child and no sibling branch.',
              ].join('\n')},
              {role:'user',content:safeJson({
                parent_requirement:node.requirement_text,
                agent_authored_discovery_state:agentDiscoveryState(node),
                authoritative_completed_sibling_evidence:childContextView.siblingEvidence,
                supplied_context:childContextView.suppliedContext,
                previously_authored_children:previous,
                prior_child_authoring_failure:asObject(node?.decision_payload?.child_authoring_failure),
                runtime_resource_constraints:{
                  structural_branch_depth:normalizedBranchDepth,
                  max_structural_branch_depth:MAX_BRANCH_DEPTH,
                  multi_child_split_available:structuralBranchingAvailable,
                  max_children_this_split:maxChildrenThisSplit,
                  single_child_refinements_used:singleChildRefinements,
                  max_single_child_refinements:MAX_SINGLE_CHILD_REFINEMENTS,
                },
              })},
            ],CHILD_FORMULATION_DEEP_TOKENS,'req_'+node.node_path.replaceAll('.','_')+'_author_child_formulate_'+ordinal+'_'+attempt);

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
            }
            proposal=candidate;
            proposalCheckpoint={row:await saveChildProposalCheckpoint(node,ordinal,proposal),proposal};
            break;
          }catch(error){
            formulationError=error;
            const recoverable=
              error?.code==='COGNITION_RESPONSE_REJECTED'
              || error?.code==='NVIDIA_TIMEOUT'
              || String(error?.message||'').startsWith('autonomous_decomposition_nonconvergent_child:')
              || String(error?.message||'').startsWith('autonomous_decomposition_child_formulation_status_invalid:');
            if(!recoverable)throw error;
            if(attempt===2)
              return returnChildAuthoringFailure({ordinal,phase:'deep_formulation',error});
          }
        }
        if(!proposal&&formulationError)
          return returnChildAuthoringFailure({ordinal,phase:'deep_formulation',error:formulationError});
      }

      let parsed=null;
      let serializationError=null;
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callSerialize([
            {role:'system',content:[
              'You are the same bound model performing MECHANICAL SERIALIZATION of YOUR already-authored child proposal.',
              'Do not redo decomposition reasoning. Do not alter the substantive requirement, scope removed, completion criterion, reason, or DONE decision.',
              'Return only compact valid JSON in exactly one of these shapes:',
              '{"status":"CHILD","requirement":"...","scope_removed":"...","completion_criterion":"...","reason":"brief"}',
              'or {"status":"DONE","coverage_note":"brief"}.',
            ].join('\n')},
            {role:'user',content:safeJson({
              durable_agent_authored_child_proposal:proposal,
              checkpoint:{
                step_key:childProposalStepKey(node,ordinal),
                artifact_hash:proposalCheckpoint?.row?.artifact_hash||null,
                authored_by_bound_agent:true,
              },
            })},
          ],700,'req_'+node.node_path.replaceAll('.','_')+'_author_child_serialize_'+ordinal+'_'+attempt);
          const candidate=asObject(response?.parsed);
          const candidateStatus=text(candidate.status).toUpperCase();
          if(candidateStatus!==text(proposal.status).toUpperCase())
            throw new Error('autonomous_decomposition_child_serialization_status_mismatch:'+node.node_path);
          if(candidateStatus==='CHILD'){
            const fields=['requirement','scope_removed','completion_criterion','reason'];
            const mismatch=fields.some(key=>text(candidate[key])!==text(proposal[key]));
            if(mismatch)
              throw new Error('autonomous_decomposition_child_serialization_content_mismatch:'+node.node_path);
            candidate._convergence_validation=proposal._convergence_validation;
          }else if(text(candidate.coverage_note)!==text(proposal.coverage_note)){
            throw new Error('autonomous_decomposition_child_serialization_content_mismatch:'+node.node_path);
          }
          parsed=candidate;
          break;
        }catch(error){
          serializationError=error;
          const recoverable=
            error?.code==='COGNITION_RESPONSE_REJECTED'
            || error?.code==='NVIDIA_TIMEOUT'
            || String(error?.message||'').startsWith('autonomous_decomposition_child_serialization_');
          if(!recoverable)throw error;
          if(attempt===2)
            return returnChildAuthoringFailure({ordinal,phase:'protocol_serialization',error});
        }
      }
      if(!parsed&&serializationError)
        return returnChildAuthoringFailure({ordinal,phase:'protocol_serialization',error:serializationError});

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
      const duplicate=authored.some(c=>c.requirement_hash===sha256(requirement));
      if(duplicate)throw new Error('autonomous_decomposition_duplicate_child:'+node.node_path);

      const nodePath=node.node_path+'.'+String(ordinal).padStart(3,'0');
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

      if(!structuralBranchingAvailable&&authored.length===1){
        await saveNode({
          nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
          requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
          status:'split',decisionType:'SPLIT',
          decisionPayload:{
            ...(node.decision_payload||{}),
            child_count:1,
            children_authored:true,
            mechanical_depth_constraint_applied:true,
            structural_branch_depth:normalizedBranchDepth,
            max_structural_branch_depth:MAX_BRANCH_DEPTH,
            max_children_this_split:1,
            child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
          },
          contextPayload:node.context_payload||{},resultArtifact:null,
        });
        return {children:authored,reconsider:false};
      }
    }
    throw new Error('autonomous_decomposition_child_resource_limit:'+node.node_path);
  }

  async function executeAtomic(node){
    let pinnedEvidence=await loadPinnedEvidence(node.node_path);
    const atomicContextView=()=>agentModelContextView(
      node.context_payload||{},pinnedEvidence,ATOMIC_EXECUTION_DEEP_TOKENS
    );
    const siblingEvidence=atomicContextView().siblingEvidence;
    const atomicCognitionContext=()=>atomicContextView().suppliedContext;
    let parsed=null;
    try{
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent executing exactly ONE requirement you previously judged ATOMIC.',
              'Complete only this requirement. Do not silently expand into unrelated work.',
              'authoritative_completed_sibling_evidence contains durable outputs from resolved sibling requirements. Treat those as available evidence and inspect them before asking for information that a sibling already supplied.',
              'If you discover it is not actually bounded, return {"status":"SPLIT","reason":"..."} instead of forcing an oversized answer.',
              'If context is missing, return {"status":"NEED_CONTEXT","context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."],"reason":"..."}. You choose any research questions; do not fabricate findings.',
              'Otherwise return JSON only: {"status":"COMPLETE","artifact":"concise auditable work product","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
              'Keep the artifact bounded. Preserve uncertainty and do not claim external facts without supplied evidence.',
            ].join('\n')},
            {role:'user',content:safeJson({
              requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              authoritative_completed_sibling_evidence:siblingEvidence,
              supplied_context:atomicCognitionContext(),
              available_context_index:idx,
              available_supplied_context_index:indexObject(atomicCognitionContext()),
            })},
          ],ATOMIC_EXECUTION_DEEP_TOKENS,'req_'+node.node_path.replaceAll('.','_')+'_atomic_'+attempt);
          parsed=response?.parsed;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT')throw error;
        }
      }
    }catch(error){
      if(error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT'){
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

    const status=text(parsed?.status).toUpperCase();
    if(status==='SPLIT'){
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
      let researchObserved=null;
      if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
        researchObserved=await researchContext({nodePath:node.node_path,queries:researchQueries,urls:researchUrls});
      }else if(researchQueries.length||researchUrls.length){
        researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
      }
      const pinnedResult=await persistExplicitResearchEvidence(node.node_path,researchUrls,researchObserved);
      pinnedEvidence=pinnedResult.evidence;
      const contextPayload=boundInMemoryContext({
        ...(node.context_payload||{}),
        ...resolveContext(packet,requests,atomicCognitionContext()),
        ...(researchObserved?{external_research_atomic:researchObserved}:{}),
      },pinnedEvidence,ATOMIC_EXECUTION_DEEP_TOKENS);
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
    if(status!=='COMPLETE')throw new Error('autonomous_decomposition_atomic_status_invalid:'+node.node_path);

    const proposedArtifact=text(parsed?.artifact);
    if(!proposedArtifact)throw new Error('autonomous_decomposition_atomic_artifact_empty:'+node.node_path);
    const proposedHandoff=asObject(parsed?.handoff);

    // Cognitive continuity: before runtime may persist completion, the same bound
    // agent reconciles its proposed result against its own discovery state.
    let reconciliation=null;
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
              'NEED_CONTEXT = evidence or stored context is still missing. Supply exact context_requests and/or research_queries/research_urls you choose.',
              'SPLIT = you now judge the requirement is not actually bounded and should be decomposed by you.',
              'Do not treat a nearby metric, label, time horizon, population, market definition, or proxy as equivalent unless you can justify that equivalence from the supplied evidence.',
              'Preserve uncertainty. A retrieved source is evidence only for what it actually supports.',
              'Return JSON only: {"status":"COMPLETE|NEED_CONTEXT|SPLIT","reason":"brief auditable reason","criterion_assessment":"brief comparison to your own criterion","gaps":["..."],"artifact":"required when COMPLETE","handoff":{"conclusions":[],"facts":[],"unresolved":[]},"context_requests":[],"research_queries":[],"research_urls":[]}.',
            ].join('\n')},
            {role:'user',content:safeJson({
              requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              proposed_completion:{artifact:proposedArtifact,handoff:proposedHandoff},
              authoritative_completed_sibling_evidence:siblingEvidence,
              supplied_context:atomicCognitionContext(),
              available_context_index:idx,
              available_supplied_context_index:indexObject(atomicCognitionContext()),
            })},
          ],ATOMIC_RECONCILIATION_DEEP_TOKENS,'req_'+node.node_path.replaceAll('.','_')+'_reconcile_'+attempt);
          reconciliation=response?.parsed;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT')throw error;
        }
      }
    }catch(error){
      if(error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT'){
        const atomicExecutionFailures=Math.max(0,Number(node?.decision_payload?.atomic_execution_failures||0))+1;
        const reset=await saveNode({
          nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
          requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
          status:'pending',decisionType:null,
          decisionPayload:{
            ...(node.decision_payload||{}),
            prior_atomic_rejection:String(error?.rejectionReason||error?.code||'reconciliation_incomplete'),
            reconsider_decomposition:true,
            atomic_execution_failures:atomicExecutionFailures,
            atomic_unavailable:atomicExecutionFailures>=MAX_ATOMIC_EXECUTION_FAILURES,
            reconciliation_incomplete:true,
          },
          contextPayload:node.context_payload||{},resultArtifact:null,
        });
        reset.parent_path=node.parent_path??parentPathOf(node.node_path);
        return {reconsider:true,node:reset};
      }
      throw error;
    }

    const reconciliationStatus=text(reconciliation?.status).toUpperCase();
    const reconciliationMeta={
      reconciliation_performed:true,
      reconciliation_reason:clip(reconciliation?.reason,1600),
      reconciliation_criterion_assessment:clip(reconciliation?.criterion_assessment,2200),
      reconciliation_gaps:asArray(reconciliation?.gaps).map(v=>clip(text(v),700)).filter(Boolean).slice(0,12),
      cognitive_continuity_policy:'agent_discovery_restore_and_reconcile_v0_1',
    };

    if(reconciliationStatus==='SPLIT'){
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
      let researchObserved=null;
      if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
        researchObserved=await researchContext({nodePath:node.node_path,queries:researchQueries,urls:researchUrls});
      }else if(researchQueries.length||researchUrls.length){
        researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
      }
      const pinnedResult=await persistExplicitResearchEvidence(node.node_path,researchUrls,researchObserved);
      pinnedEvidence=pinnedResult.evidence;
      const contextPayload=boundInMemoryContext({
        ...(node.context_payload||{}),
        ...resolveContext(packet,requests,atomicCognitionContext()),
        ...(researchObserved?{external_research_reconciliation:researchObserved}:{}),
      },pinnedEvidence,ATOMIC_RECONCILIATION_DEEP_TOKENS);
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

    const artifact=text(reconciliation?.artifact)||proposedArtifact;
    if(!artifact)throw new Error('autonomous_decomposition_reconciliation_artifact_empty:'+node.node_path);
    const handoff=Object.keys(asObject(reconciliation?.handoff)).length?asObject(reconciliation?.handoff):proposedHandoff;
    const resultArtifact=JSON.stringify({artifact,handoff});
    const done=await saveNode({
      nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
      requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
      status:'completed',decisionType:'ATOMIC',
      decisionPayload:{
        ...(node.decision_payload||{}),
        ...reconciliationMeta,
        completed_as_atomic:true,
      },
      contextPayload:node.context_payload||{},resultArtifact,
    });
    done.parent_path=node.parent_path??parentPathOf(node.node_path);
    return {completed:true,node:done};
  }

  async function synthesize(node,childRows){
    let accumulator=asObject(node?.decision_payload?.synthesis_accumulator);
    let cursor=Number(node?.decision_payload?.synthesis_cursor||0);
    for(let i=cursor;i<childRows.length;i++){
      const child=childRows[i];
      const parts=resultParts(child.result_artifact);
      let response=null;
      for(let attempt=1;attempt<=2;attempt++){
        try{
          response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent synthesizing YOUR resolved child requirements back into their parent.',
              'A child may be COMPLETED or BLOCKED. BLOCKED is not successful completion; preserve its unresolved evidence or dependency explicitly.',
              'Update a compact accumulator using exactly one newly resolved child.',
              'Do not invent facts, erase a blocked gap, or change the parent requirement.',
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
          ],SYNTHESIS_MERGE_DEEP_TOKENS,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_merge_'+(i+1)+'_'+attempt);
          break;
        }catch(error){
          const recoverable=error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT';
          if(!recoverable||attempt===2)throw error;
        }
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
        decisionPayload:{...(node.decision_payload||{}),synthesis_cursor:cursor,synthesis_accumulator:accumulator},
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);
    }

    const childStates=childRows.map(child=>({
      path:child.node_path,
      status:child.node_status||child.status||null,
      decision_type:child.decision_type||null,
    }));
    let final=null;
    for(let attempt=1;attempt<=2;attempt++){
      try{
        final=await callJson([
          {role:'system',content:[
            'You are the bound autonomous agent closing a parent requirement after all child requirements have resolved.',
            'Some children may be BLOCKED. Decide whether the parent can honestly be COMPLETE from the resolved evidence or must itself be BLOCKED.',
            'The runtime does not make that semantic decision for you.',
            'If any essential child gap prevents the parent requirement from being satisfied, choose BLOCKED and preserve the unresolved gap.',
            'Return JSON only: {"outcome":"COMPLETE|BLOCKED","reason":"auditable reason","artifact":"concise auditable parent result","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
            'Do not add requirements or conclusions that are not supported by the resolved children.',
          ].join('\n')},
          {role:'user',content:safeJson({
            parent_requirement:node.requirement_text,
            agent_authored_discovery_state:agentDiscoveryState(node),
            child_states:childStates,
            cumulative_synthesis:accumulator,
          })},
        ],SYNTHESIS_FINAL_DEEP_TOKENS,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_final_'+attempt);
        break;
      }catch(error){
        const recoverable=error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT';
        if(!recoverable||attempt===2)throw error;
      }
    }

    const outcome=text(final?.parsed?.outcome).toUpperCase();
    if(!['COMPLETE','BLOCKED'].includes(outcome))
      throw new Error('autonomous_decomposition_synthesis_outcome_invalid:'+node.node_path);
    const artifact=text(final?.parsed?.artifact);
    if(!artifact)throw new Error('autonomous_decomposition_synthesis_empty:'+node.node_path);
    const resultArtifact=JSON.stringify({status:outcome,artifact,handoff:asObject(final?.parsed?.handoff)});
    const done=await saveNode({
      nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
      requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
      status:outcome==='BLOCKED'?'blocked':'completed',
      decisionType:outcome==='BLOCKED'?'BLOCKED':'SPLIT',
      decisionPayload:{
        ...(node.decision_payload||{}),
        synthesis_cursor:childRows.length,
        synthesis_complete:true,
        synthesis_outcome:outcome,
        synthesis_reason:clip(final?.parsed?.reason,2200),
        decomposition_decision:'SPLIT',
        blocked_child_count:childStates.filter(v=>v.status==='blocked'||v.decision_type==='BLOCKED').length,
      },
      contextPayload:node.context_payload||{},resultArtifact,
    });
    done.parent_path=node.parent_path??parentPathOf(node.node_path);
    return done;
  }

  async function process(nodePath,parentPath=null,branchDepth=0,singleChildRefinements=0){
    // Structural depth counts actual multi-child branching only. Legacy callers may
    // arrive with an over-counted value; clamp that runtime accounting instead of
    // killing the wake and expose the ceiling to the agent as a mechanical constraint.
    branchDepth=Math.max(0,Math.min(Number(branchDepth)||0,MAX_BRANCH_DEPTH));
    let node=await getNode(nodePath);
    if(node?.status!=='ready')throw new Error('autonomous_decomposition_node_missing:'+nodePath);
    node.parent_path=parentPath;
    counters.nodes++;

    if(node.node_status==='completed'||node.node_status==='blocked')return node;

    for(let transitions=0;transitions<8;transitions++){
      if(node.node_status==='split'||node.decision_type==='SPLIT'){
        let kids=(await children(node.node_path)).filter((child)=>String(child?.status||'')!=='cancelled');
        if(!kids.length){
          const authoredResult=await authorChildren(node,{branchDepth,singleChildRefinements});
          if(authoredResult?.reconsider){
            node=authoredResult.node;
            node.parent_path=parentPath;
            continue;
          }
          kids=asArray(authoredResult?.children);
        }
        if(kids.length===1&&singleChildRefinements>=MAX_SINGLE_CHILD_REFINEMENTS){
          const child=kids[0];
          await saveNode({
            nodePath:child.node_path,parentPath:node.node_path,ordinal:child.ordinal||0,
            requirement:child.requirement_text,sourceKind:child.source_kind||'agent_decomposition',
            sourceRef:child.source_ref??node.node_path,status:'cancelled',
            decisionType:child.decision_type??null,
            decisionPayload:{
              ...(child.decision_payload||{}),
              cancelled_for_nonconvergence:true,
              cancellation_reason:'single_child_refinement_budget_exhausted',
            },
            contextPayload:child.context_payload||{},resultArtifact:child.result_artifact||null,
          });
          node=await saveNode({
            nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
            requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
            status:'pending',decisionType:null,
            decisionPayload:{
              ...(node.decision_payload||{}),
              reconsider_decomposition:true,
              convergence_recovery:'single_child_refinement_budget_exhausted',
              cancelled_child_path:child.node_path,
            },
            contextPayload:node.context_payload||{},resultArtifact:null,
          });
          node.parent_path=parentPath;
          continue;
        }
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
          const singleChild=kids.length===1;
          const nextBranchDepth=singleChild?branchDepth:Math.min(MAX_BRANCH_DEPTH,branchDepth+1);
          const done=await process(
            child.node_path,
            node.node_path,
            nextBranchDepth,
            singleChild?singleChildRefinements+1:0
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

  const completedRoot=await process('R',null,0,0);
  const parts=resultParts(completedRoot.result_artifact);
  if(!parts.artifact)throw new Error('autonomous_decomposition_root_artifact_empty');

  return {
    artifact:parts.artifact,
    meta:{
      contract:'autonomous_recursive_decomposition_v0_1',
      assignment_key:assignmentKey,
      root_node_id:completedRoot.node_id,
      root_requirement_hash:completedRoot.requirement_hash,
      root_source_kind:rootReq.source_kind,
      root_source_ref:rootReq.source_ref,
      nodes_touched:counters.nodes,
      model_calls:counters.model_calls,
      context_requests:counters.context_requests,
      convergence_policy:'branch_depth_v0_4_structural_only_agent_visible_ceiling',
      cognitive_continuity_policy:'agent_discovery_restore_and_reconcile_v0_1',
      routing_protocol:'deep_discovery_then_commit_v0_1',
      decomposition_authored_by_bound_agent:true,
      runtime_role:'persist_route_resume_completion_integrity_only',
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
      research_batch_handoff_policy:'requirement_linked_durable_receipts_v0_1',
    },
  };
}
