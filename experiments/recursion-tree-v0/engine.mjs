// Isolated AAU recursive-tree laboratory. No AAU database, RabbitMQ or agent credentials.
import {createHash} from 'node:crypto';

export const BASELINE = Object.freeze({
  sample: 'Silas most recent 100 completed/failed wakes, sampled October 16 2026',
  denominator: 100, completed: 37, failed: 63,
  errors: Object.freeze({budget:29, other:22, provider:7, evidence:4, scheduler:1}),
  caveat: 'Wake outcomes, NOT independent model error rate. Excludes cancelled wakes.',
});

// Representative error strings are reduced diagnostic fixtures, not full agent memory.
export const CASES = Object.freeze([
  {id:'E01',error:'semantic_bucket_rollover_denied:reasoning:bucket_limit_exhausted',expected:'budget'},
  {id:'E02',error:'model_provider_http_504: HTTP 504',expected:'provider'},
  {id:'E03',error:'autonomous_decomposition_split_requires_child:R.001',expected:'cognition'},
  {id:'E04',error:'qda_root_verified_child_materialization_invalid:coverage_missing',expected:'evidence'},
  {id:'E05',error:'semantic_runtime_cycle_lock:repeated_material_fingerprint',expected:'budget'},
  {id:'E06',error:'provider_transport_attempts_exhausted:model_timeout_after_120000ms',expected:'provider'},
  {id:'E07',error:'autonomous_decomposition_synthesis_empty:R.003',expected:'cognition'},
  {id:'E08',error:'orphaned_running_intent_recovered_by_health_monitor',expected:'scheduler'},
  {id:'E09',error:'declared_verified_checks_unresolved:checks_source_cardinality_invalid',expected:'evidence'},
  {id:'E10',error:'autonomous_decomposition_discovery_invalid_available_action',expected:'cognition'},
  {id:'E11',error:'semantic_budget_bucket_exhausted:finalization',expected:'budget'},
  {id:'E12',error:'model_timeout_after_120000ms',expected:'provider'},
  {id:'E13',error:'qda_math_check_batch_count_mismatch',expected:'evidence'},
  {id:'E14',error:'autonomous_decomposition_child_reconsideration_limit',expected:'cognition'},
  {id:'E15',error:'semantic_budget_rollover_denied:automatic_rollover_limit_exhausted',expected:'budget'},
  {id:'E16',error:'cognition_admission_deferred:bounded_atomic_execution_admission_exhausted',expected:'budget'},
]);
export const LABELS = Object.freeze(['budget','provider','cognition','evidence','scheduler','unknown']);
const byId = new Map(CASES.map(x=>[x.id,x]));
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sorted = a => [...a].sort();
export function settings(stage=1, overrides={}){
  if(![1,2,3].includes(Number(stage)))throw Error('stage_not_supported');
  const s=Number(stage);
  return Object.freeze({stage:s,depthLimit:s,caseCount:2**(s+1),
    budgetTokens:s===1?9000:s===2?15000:30000,maxCalls:s===1?6:s===2?12:24,
    outputLimit:650,maxAttemptsPerNode:2,maxChildren:2,maxLeafSize:2,...overrides});
}

export function authenticate(node,answer,limits){
  if(!answer||typeof answer!=='object'||Array.isArray(answer))return {ok:false,reason:'invalid_envelope'};
  if(answer.action==='SPLIT'){
    if(node.depth>=limits.depthLimit)return {ok:false,reason:'depth_limit'};
    if(node.ids.length<=limits.maxLeafSize)return {ok:false,reason:'unnecessary_split'};
    const children=answer.children;
    if(!Array.isArray(children)||children.length!==2||children.length>limits.maxChildren)
      return {ok:false,reason:'invalid_branch_count'};
    const flat=[];
    for(const c of children){
      if(!Array.isArray(c)||!c.length||c.length>=node.ids.length||
        c.some(x=>typeof x!=='string'))return {ok:false,reason:'non_shrinking_child'};
      flat.push(...c);
    }
    if(new Set(flat).size!==flat.length || JSON.stringify(sorted(flat))!==JSON.stringify(sorted(node.ids)))
      return {ok:false,reason:'missing_or_duplicate_coverage'};
    return {ok:true,action:'SPLIT',children:children.map(sorted)};
  }
  if(answer.action==='ATOMIC'){
    if(node.ids.length>limits.maxLeafSize)return {ok:false,reason:'oversized_atomic'};
    const rows=answer.results;
    if(!Array.isArray(rows)||rows.length!==node.ids.length)return {ok:false,reason:'incomplete_result'};
    const seen=new Set();
    for(const r of rows){
      if(!r||typeof r.id!=='string'||!byId.has(r.id)||!LABELS.includes(r.classification)||
        seen.has(r.id)||!node.ids.includes(r.id))return {ok:false,reason:'invalid_result_row'};
      seen.add(r.id);
      if(r.classification!==byId.get(r.id).expected)
        return {ok:false,reason:'deterministic_oracle_mismatch',id:r.id};
    }
    return {ok:true,action:'ATOMIC',results:rows.map(r=>({id:r.id,classification:r.classification}))
      .sort((a,b)=>a.id.localeCompare(b.id))};
  }
  return {ok:false,reason:'invalid_action'};
}

export function scriptedLightweight(node,limits){
  if(node.ids.length>limits.maxLeafSize){
    const k=Math.floor(node.ids.length/2);
    return {action:'SPLIT',children:[node.ids.slice(0,k),node.ids.slice(k)]};
  }
  return {action:'ATOMIC',results:node.ids.map(id=>({
    id,classification:byId.get(id).expected
  }))};
}

export function createExperiment(config=settings(1),seedIds=null){
  const ids=seedIds||CASES.slice(0,config.caseCount).map(x=>x.id);
  if(!ids.length||ids.length>CASES.length||new Set(ids).size!==ids.length||
    ids.some(id=>!byId.has(id)))throw Error('invalid_case_set');
  const root={path:'R',depth:0,ids:sorted(ids),status:'pending',attempts:0,children:[],
    result:null,resultHash:null,lastError:null};
  return {contract:'AAU_RECURSION_LAB_V0',model:'lightweight',config,
    nodes:{R:root},queue:['R'],ledger:[],calls:0,spent:0,nextEvent:0,complete:false};
}
function record(s,kind,path,units=0,details={}){
  s.nextEvent++;
  s.ledger.push({eventKey:'lab:'+s.nextEvent,kind,path,units,...details});
}
export function invariant(s){
  if(s.spent<0||s.spent>s.config.budgetTokens||s.calls>s.config.maxCalls)throw Error('budget_invariant');
  const spent=s.ledger.reduce((n,e)=>n+e.units,0);
  if(spent!==s.spent)throw Error('ledger_not_conserved');
  for(const n of Object.values(s.nodes)){
    if(n.depth>s.config.depthLimit||n.attempts>s.config.maxAttemptsPerNode)throw Error('node_bounds');
    if(n.children.length){
      const flattened=n.children.flatMap(path=>s.nodes[path]?.ids||[]);
      if(JSON.stringify(sorted(flattened))!==JSON.stringify(sorted(n.ids)) ||
         new Set(flattened).size!==flattened.length)throw Error('semantic_tree_corrupt');
    }
  }
  return true;
}
export async function step(s,model,{injectedFailure=null,stale=false}={}){
  const path=s.queue.shift();
  if(!path)return null;
  const node=s.nodes[path];
  if(!node||node.status==='complete'||node.status==='split')return {status:'stale'};
  if(stale){record(s,'stale_wake_ignored',path);s.queue.unshift(path);return {status:'stale'};}
  if(node.attempts>=s.config.maxAttemptsPerNode){
    node.status='blocked';record(s,'attempt_limit',path);return {status:'blocked'};
  }
  // Reserve full worst-case token-equivalent cost upfront. No budget top-ups.
  // Approximate input from serialized case data, output bound fixed per request.
  const inputTokens=Math.ceil(JSON.stringify(node.ids.map(id=>byId.get(id))).length/3.2)+180;
  const charge=inputTokens+s.config.outputLimit+60;
  if(s.spent+charge>s.config.budgetTokens||s.calls>=s.config.maxCalls){
    node.status='blocked';node.lastError='budget_exhausted';
    record(s,'budget_denied',path,0,{requested:charge,remaining:s.config.budgetTokens-s.spent});
    return {status:'budget_denied',path};
  }
  node.attempts++;node.status='running';s.calls++;s.spent+=charge;
  record(s,'model_call_reserved',path,charge,{attempt:node.attempts});
  let answer;
  try{
    if(injectedFailure)throw Object.assign(new Error(injectedFailure),{code:'INJECTED_TRANSPORT'});
    answer=await model({...node,ids:[...node.ids],cases:node.ids.map(id=>({id,error:byId.get(id).error}))},s.config);
  }catch(error){
    node.lastError=String(error?.message||error).slice(0,160);node.status='pending';
    record(s,'model_transport_failed',path,0,{attempt:node.attempts,error:node.lastError});
    if(node.attempts<s.config.maxAttemptsPerNode)s.queue.push(path);
    else node.status='blocked';
    invariant(s);return {status:node.status==='blocked'?'blocked':'retryable',path};
  }
  const verdict=authenticate(node,answer,s.config);
  if(!verdict.ok){
    node.lastError=verdict.reason;node.status='pending';
    record(s,'auth_rejected',path,0,{attempt:node.attempts,reason:verdict.reason});
    if(node.attempts<s.config.maxAttemptsPerNode)s.queue.push(path);
    else node.status='blocked';
    invariant(s);return {status:node.status==='blocked'?'blocked':'retryable',path,reason:verdict.reason};
  }
  if(verdict.action==='SPLIT'){
    node.status='split';node.children=verdict.children.map((ids,i)=>{
      const childPath=path+'.'+String(i+1).padStart(3,'0');
      if(s.nodes[childPath])throw Error('duplicate_child_path');
      s.nodes[childPath]={path:childPath,depth:node.depth+1,ids,status:'pending',
        attempts:0,children:[],result:null,resultHash:null,lastError:null};
      s.queue.push(childPath);return childPath;
    });
    record(s,'semantic_split_accepted',path,0,{children:[...node.children]});
  }else{
    node.status='complete';node.result=verdict.results;node.resultHash=hash(verdict.results);
    record(s,'atomic_result_accepted',path,0,{resultHash:node.resultHash});
  }
  invariant(s);return {status:node.status,path};
}

export async function run(s,model,options={}){
  let count=0;
  while(s.queue.length && count++<50){
    const failure=options.failureForCall?.(s.calls+1,s)||null;
    await step(s,model,{injectedFailure:failure});
  }
  s.complete=Object.values(s.nodes).every(n=>n.status==='complete'||n.status==='split')
    &&!s.queue.length;
  invariant(s);
  return report(s);
}
export function report(s){
  return {contract:s.contract,stage:s.config.stage,
    complete:s.complete,calls:s.calls,spent:s.spent,remaining:s.config.budgetTokens-s.spent,
    budget:s.config.budgetTokens,nodes:Object.values(s.nodes).map(n=>({
      path:n.path,depth:n.depth,ids:n.ids,status:n.status,attempts:n.attempts,
      children:n.children,resultHash:n.resultHash,lastError:n.lastError,result:n.result,
    })),events:s.ledger};
}

// Deterministic exact histogram: this is fault-exposure modeling, not inference accuracy.
export function silasFaultHistogram(seed=71){
  const hist=[...Array(BASELINE.completed).fill('completed'),
    ...Object.entries(BASELINE.errors).flatMap(([k,n])=>Array(n).fill(k))];
  let state=seed>>>0;
  for(let i=hist.length-1;i>0;i--){
    state=(1664525*state+1013904223)>>>0;
    const j=state%(i+1);[hist[i],hist[j]]=[hist[j],hist[i]];
  }
  return hist;
}
