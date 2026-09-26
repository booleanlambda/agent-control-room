// AAU autonomous recursive decomposition v0.1
// The bound agent authors decomposition. Runtime only persists/routes/checkpoints.

const MAX_BRANCH_DEPTH=12;
const MAX_SINGLE_CHILD_REFINEMENTS=4;
const MAX_ATOMIC_EXECUTION_FAILURES=1;
const MAX_CHILDREN_PER_NODE=16;
const MAX_CONTEXT_ROUNDS=4;
const MAX_CONTEXT_REQUESTS_PER_ROUND=8;
const MAX_CONTEXT_VALUE_BYTES=12000;
const MAX_PERSISTED_CONTEXT_BYTES=52000;

const asObject=(v)=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const asArray=(v)=>Array.isArray(v)?v:[];

function text(v){return String(v??'').trim();}
function bytes(v){try{return Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v));}catch{return 0;}}
function clip(s,n){const v=String(s??'');return v.length<=n?v:v.slice(0,n);}
function safeJson(v){try{return JSON.stringify(v);}catch{return '{}';}}
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
  const reserve=3500;
  const priority=(key)=>key==='completed_sibling_results'
    ||key==='inherited_completed_sibling_results'
    ||key.startsWith('external_research');
  const tryAdd=(key,value)=>{
    const candidate={...out,[key]:value};
    if(bytes(candidate)<=MAX_PERSISTED_CONTEXT_BYTES-reserve){
      out[key]=value;
      return true;
    }
    evicted.push({path:key,bytes:bytes(value)});
    return false;
  };
  for(const [key,value] of entries){
    if(priority(key))tryAdd(key,value);
  }
  for(let i=entries.length-1;i>=0;i--){
    const [key,value]=entries[i];
    if(priority(key)||Object.prototype.hasOwnProperty.call(out,key))continue;
    tryAdd(key,value);
  }
  out._context_evicted=evicted.slice(0,40);
  out._context_budget={
    max_bytes:MAX_PERSISTED_CONTEXT_BYTES,
    policy:'preserve_upstream_handoffs_and_recent_requested_context_v0_1',
    evicted_count:evicted.length,
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

function getPath(root,path){
  const parts=String(path||'').split('.').filter(Boolean);
  let cur=root;
  for(const part of parts){
    if(cur===null||cur===undefined||typeof cur!=='object')return {found:false,value:null};
    if(Array.isArray(cur)){
      if(!/^[0-9]+$/.test(part))return {found:false,value:null};
      const index=Number(part);
      if(index<0||index>=cur.length)return {found:false,value:null};
      cur=cur[index];
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
    for(let i=0;i<Math.min(root.length,24)&&out.length<180;i++){
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

function resolveContext(packet,requests){
  const out={};
  for(const raw of asArray(requests).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND)){
    const path=text(raw);
    if(!path||Object.prototype.hasOwnProperty.call(out,path))continue;
    const hit=getPath(packet,path);
    if(!hit.found){
      out[path]={available:false};
      continue;
    }
    if(bytes(hit.value)>MAX_CONTEXT_VALUE_BYTES){
      let childIndex=[];
      if(Array.isArray(hit.value)){
        childIndex=hit.value.slice(0,48).map((v,i)=>({
          path:path+'.'+i,bytes:bytes(v),kind:Array.isArray(v)?'array':typeof v
        }));
      }else if(hit.value&&typeof hit.value==='object'){
        childIndex=Object.keys(hit.value).slice(0,80).map(k=>({
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
      requirement:clip(row?.requirement_text,700),
      artifact:clip(parts.artifact,3500),
      handoff_json:clip(safeJson(parts.handoff),1800),
      result_hash:row?.result_hash||null,
    };
  });
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
  const rootReq=extractTriggerRequirement(packet);
  const assignmentKey='req:'+sha256({
    agent_id:agentId,
    source_kind:rootReq.source_kind,
    source_ref:rootReq.source_ref,
    requirement:rootReq.requirement,
  }).slice(0,48);
  const idx=contextIndex(packet);
  const counters={nodes:0,model_calls:0,context_requests:0};

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

  async function getNode(nodePath){
    return nodeRpc('get',{nodePath});
  }

  async function children(nodePath){
    const row=await nodeRpc('children',{nodePath});
    return asArray(row?.children);
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
    const atomicExecutionFailures=Math.max(0,Number(node?.decision_payload?.atomic_execution_failures||0));
    const atomicUnavailable=atomicExecutionFailures>=MAX_ATOMIC_EXECUTION_FAILURES;
    const normalizedBranchDepth=Math.max(0,Math.min(Number(branchDepth)||0,MAX_BRANCH_DEPTH));
    const structuralBranchingAvailable=normalizedBranchDepth<MAX_BRANCH_DEPTH;
    const singleRefinementAvailable=singleChildRefinements<MAX_SINGLE_CHILD_REFINEMENTS;
    const splitAvailable=structuralBranchingAvailable||singleRefinementAvailable;

    for(let round=0;round<MAX_CONTEXT_ROUNDS;round++){
      const contextFingerprint=sha256({
        node_path:node.node_path,
        requirement:node.requirement_text,
        context_payload:contextPayload,
        force_reconsider:Boolean(forceReconsider),
        atomic_unavailable:atomicUnavailable,
        atomic_execution_failures:atomicExecutionFailures,
        structural_branch_depth:normalizedBranchDepth,
        max_structural_branch_depth:MAX_BRANCH_DEPTH,
        structural_branching_available:structuralBranchingAvailable,
        single_child_refinements_used:singleChildRefinements,
        max_single_child_refinements:MAX_SINGLE_CHILD_REFINEMENTS,
        single_refinement_available:singleRefinementAvailable,
      });

      const priorPayload=asObject(node.decision_payload);
      const priorDiscovery=asObject(priorPayload.routing_discovery_checkpoint);
      const reusableDiscovery=
        priorDiscovery.version==='agent_deep_discovery_v0_1'
        && priorDiscovery.context_fingerprint===contextFingerprint
        && ['ATOMIC','SPLIT','NEED_CONTEXT'].includes(text(priorDiscovery.decision).toUpperCase())
        && !(atomicUnavailable&&text(priorDiscovery.decision).toUpperCase()==='ATOMIC')
        && !(text(priorDiscovery.decision).toUpperCase()==='SPLIT'&&!splitAvailable);

      let discovery=reusableDiscovery?priorDiscovery:null;

      if(!discovery){
        for(let attempt=1;attempt<=2;attempt++){
          try{
            const availableDecisions=['ATOMIC','SPLIT','NEED_CONTEXT']
              .filter(v=>!(v==='ATOMIC'&&atomicUnavailable))
              .filter(v=>!(v==='SPLIT'&&!splitAvailable));
            const response=await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent performing a DEEP DISCOVERY pass for ONE requirement.',
                'Thinking is enabled. This pass is where YOU determine what the requirement means and what action YOU intend to take.',
                'The runtime does not choose, reinterpret, decompose, or repair the requirement for you.',
                'Available decisions for this exact node: '+availableDecisions.join(', ')+'.',
                atomicUnavailable
                  ? 'ATOMIC is mechanically unavailable because this exact node already exhausted its bounded atomic execution.'
                  : 'ATOMIC remains available if you judge the requirement genuinely bounded.',
                'Mechanical decomposition budget: structural branch depth '+normalizedBranchDepth+' of '+MAX_BRANCH_DEPTH+'; consecutive single-child refinements '+singleChildRefinements+' of '+MAX_SINGLE_CHILD_REFINEMENTS+'.',
                structuralBranchingAvailable
                  ? 'A SPLIT may create multiple children if your reasoning requires it.'
                  : (singleRefinementAvailable
                    ? 'Structural branch depth is exhausted. SPLIT remains available only as exactly ONE genuinely narrower refinement child; it may not create multiple children.'
                    : 'Structural branch depth and the single-child refinement budget are both exhausted, so SPLIT is mechanically unavailable.'),
                'Before deciding, interrogate semantic equivalence, definitions, time horizons, populations/scopes, proxy metrics, evidence sufficiency, assumptions, and unresolved gaps.',
                'Do not treat a nearby metric or label as equivalent unless YOU can justify the equivalence from supplied evidence.',
                'Do not solve the requirement or author child requirements in this pass.',
                'Return complete JSON only: {"decision":"ATOMIC|SPLIT|NEED_CONTEXT","reason":"auditable reason","requirement_interpretation":"what this requirement actually demands","evidence_assessment":"what the current evidence does and does not establish","unresolved_gaps":["..."],"context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."]}.',
                forceReconsider
                  ? 'A prior atomic execution was rejected or exhausted. Reconsider the requirement under the persisted constraints rather than repeating the failed action.'
                  : '',
              ].filter(Boolean).join('\n')},
              {role:'user',content:safeJson({
                requirement:node.requirement_text,
                agent_authored_discovery_state:agentDiscoveryState(node),
                source:{kind:node.source_kind,ref:node.source_ref},
                supplied_context:contextPayload,
                available_context_index:idx,
                available_decisions:availableDecisions,
                runtime_resource_constraints:{
                  structural_branch_depth:normalizedBranchDepth,
                  max_structural_branch_depth:MAX_BRANCH_DEPTH,
                  multi_child_split_available:structuralBranchingAvailable,
                  single_child_refinements_used:singleChildRefinements,
                  max_single_child_refinements:MAX_SINGLE_CHILD_REFINEMENTS,
                  single_child_refinement_available:singleRefinementAvailable,
                },
              })},
            ],10000,'req_'+node.node_path.replaceAll('.','_')+'_discovery_'+(round+1)+'_'+attempt);

            const candidate=asObject(response?.parsed);
            const candidateDecision=text(candidate.decision).toUpperCase();
            if(!availableDecisions.includes(candidateDecision)){
              if(attempt===2)throw new Error('autonomous_decomposition_discovery_invalid_available_action:'+node.node_path);
              continue;
            }

            discovery={
              version:'agent_deep_discovery_v0_1',
              context_fingerprint:contextFingerprint,
              decision:candidateDecision,
              reason:clip(candidate.reason,2200),
              requirement_interpretation:clip(candidate.requirement_interpretation,2800),
              evidence_assessment:clip(candidate.evidence_assessment,3200),
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
                routing_discovery_checkpoint:discovery,
                routing_discovery_checkpointed:true,
                routing_discovery_checkpointed_at:new Date().toISOString(),
                routing_protocol:'deep_discovery_then_commit_v0_1',
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
              'Return JSON only: {"decision":"ATOMIC|SPLIT|NEED_CONTEXT","reason":"...","context_requests":[],"research_queries":[],"research_urls":[]}.',
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
          ],700,'req_'+node.node_path.replaceAll('.','_')+'_routing_commit_'+(round+1)+'_'+attempt);

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

      // The durable deep-discovery checkpoint is authoritative. The serialization
      // call is protocol packaging only and cannot alter substantive agent cognition.
      const decision=discovery.decision;
      const decisionPayload={
        ...(node.decision_payload||{}),
        reason:discovery.reason,
        requirement_interpretation:discovery.requirement_interpretation,
        evidence_assessment:discovery.evidence_assessment,
        unresolved_gaps:discovery.unresolved_gaps,
        context_round:round,
        force_reconsider:Boolean(forceReconsider),
        atomic_execution_failures:atomicExecutionFailures,
        atomic_unavailable:atomicUnavailable,
        routing_discovery_checkpoint:discovery,
        routing_discovery_reused:Boolean(reusableDiscovery),
        routing_commit_serialized:true,
        routing_protocol:'deep_discovery_then_commit_v0_1',
      };

      if(decision==='NEED_CONTEXT'){
        const requests=discovery.context_requests;
        const researchQueries=discovery.research_queries;
        const researchUrls=discovery.research_urls;
        if(!requests.length&&!researchQueries.length&&!researchUrls.length)
          throw new Error('autonomous_decomposition_context_request_empty:'+node.node_path);

        counters.context_requests+=requests.length+researchQueries.length+researchUrls.length;
        const resolved=resolveContext(packet,requests);
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
        contextPayload={
          ...contextPayload,
          ...resolved,
          ...(researchObserved?{['external_research_round_'+(round+1)]:researchObserved}:{}),
        };
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
            context_requests:requests,
            research_queries:researchQueries,
            research_urls:researchUrls,
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
            context_requests:requests,
            research_queries:researchQueries,
            research_urls:researchUrls,
            context_supplied:true,
          },
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        continue;
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
    throw new Error('autonomous_decomposition_context_round_limit:'+node.node_path);
  }

  async function authorChildren(node,{branchDepth=0,singleChildRefinements=0}={}){
    const allExisting=await children(node.node_path);
    const existing=allExisting.filter((child)=>String(child?.status||'')!=='cancelled');
    if(existing.length)return existing;

    const authored=[];
    const normalizedBranchDepth=Math.max(0,Math.min(Number(branchDepth)||0,MAX_BRANCH_DEPTH));
    const structuralBranchingAvailable=normalizedBranchDepth<MAX_BRANCH_DEPTH;
    const singleRefinementAvailable=singleChildRefinements<MAX_SINGLE_CHILD_REFINEMENTS;
    const maxChildrenThisSplit=structuralBranchingAvailable?MAX_CHILDREN_PER_NODE:(singleRefinementAvailable?1:0);
    if(maxChildrenThisSplit<1)throw new Error('autonomous_decomposition_split_mode_unavailable:'+node.node_path);
    const startOrdinal=Math.max(0,...allExisting.map((child)=>Number(child?.ordinal||0)))+1;
    for(let offset=0;offset<maxChildrenThisSplit;offset++){
      const ordinal=startOrdinal+offset;
      const previous=authored.map(c=>({ordinal:c.ordinal,requirement:c.requirement_text}));
      let parsed=null;
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callRoute([
            {role:'system',content:[
              'You are the bound autonomous agent decomposing ONE parent requirement.',
              'You own the decomposition. The runtime will persist exactly what you author.',
              'Author exactly ONE next child requirement, or declare DONE when the children already authored adequately cover the parent.',
              'A child must be a real independently completable requirement, not a vague label.',
              'Every child must materially reduce the parent scope. State what scope is removed and give a concrete completion criterion.',
              'Do not solve the child here.',
              'Return JSON only: {"status":"CHILD","requirement":"...","scope_removed":"...","completion_criterion":"...","reason":"brief"} OR {"status":"DONE","coverage_note":"brief"}.',
              structuralBranchingAvailable
                ? 'There is no required number of children. One child is valid only when it is a genuinely narrower refinement; do not merely restate the parent. Use as many or as few as your reasoning requires.'
                : 'MECHANICAL DEPTH CONSTRAINT: structural branch depth is exhausted. You chose SPLIT knowing this split may author exactly ONE genuinely narrower refinement child. Do not author sibling branches.',
            ].join('\n')},
            {role:'user',content:safeJson({
              parent_requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              supplied_context:node.context_payload||{},
              previously_authored_children:previous,
              runtime_resource_constraints:{
                structural_branch_depth:normalizedBranchDepth,
                max_structural_branch_depth:MAX_BRANCH_DEPTH,
                multi_child_split_available:structuralBranchingAvailable,
                max_children_this_split:maxChildrenThisSplit,
                single_child_refinements_used:singleChildRefinements,
                max_single_child_refinements:MAX_SINGLE_CHILD_REFINEMENTS,
              },
            })},
          ],900,'req_'+node.node_path.replaceAll('.','_')+'_author_child_'+ordinal+'_'+attempt);
          const candidate=response?.parsed;
          const candidateStatus=text(candidate?.status).toUpperCase();
          if(candidateStatus==='CHILD'){
            const validation=childConvergenceValidation(
              node.requirement_text,
              candidate?.requirement,
              candidate?.scope_removed,
              candidate?.completion_criterion
            );
            if(!validation.valid){
              if(attempt===2)
                throw new Error('autonomous_decomposition_nonconvergent_child:'+node.node_path+':'+validation.failures.join(','));
              continue;
            }
            candidate._convergence_validation=validation;
          }
          parsed=candidate;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT'
             &&!String(error?.message||'').startsWith('autonomous_decomposition_nonconvergent_child:'))throw error;
        }
      }

      const status=text(parsed?.status).toUpperCase();
      if(status==='DONE'){
        if(authored.length<1)
          throw new Error('autonomous_decomposition_split_requires_child:'+node.node_path);
        await saveNode({
          nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
          requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
          status:'split',decisionType:'SPLIT',
          decisionPayload:{...(node.decision_payload||{}),child_count:authored.length,coverage_note:clip(parsed?.coverage_note,1500),children_authored:true},
          contextPayload:node.context_payload||{},resultArtifact:null,
        });
        return authored;
      }
      if(status!=='CHILD')throw new Error('autonomous_decomposition_child_status_invalid:'+node.node_path);
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
        },
        contextPayload:inheritedChildContext(node.context_payload),resultArtifact:null,
      });
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
          },
          contextPayload:node.context_payload||{},resultArtifact:null,
        });
        return authored;
      }
    }
    throw new Error('autonomous_decomposition_child_resource_limit:'+node.node_path);
  }

  async function executeAtomic(node){
    let parsed=null;
    try{
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent executing exactly ONE requirement you previously judged ATOMIC.',
              'Complete only this requirement. Do not silently expand into unrelated work.',
              'If you discover it is not actually bounded, return {"status":"SPLIT","reason":"..."} instead of forcing an oversized answer.',
              'If context is missing, return {"status":"NEED_CONTEXT","context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."],"reason":"..."}. You choose any research questions; do not fabricate findings.',
              'Otherwise return JSON only: {"status":"COMPLETE","artifact":"concise auditable work product","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
              'Keep the artifact bounded. Preserve uncertainty and do not claim external facts without supplied evidence.',
            ].join('\n')},
            {role:'user',content:safeJson({
              requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              supplied_context:node.context_payload||{},
              available_context_index:idx,
            })},
          ],1800,'req_'+node.node_path.replaceAll('.','_')+'_atomic_'+attempt);
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
      const requests=asArray(parsed?.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
      const researchQueries=asArray(parsed?.research_queries).map(text).filter(Boolean).slice(0,8);
      const researchUrls=asArray(parsed?.research_urls).map(text).filter(v=>/^https:\/\//i.test(v)).slice(0,8);
      if(!requests.length&&!researchQueries.length&&!researchUrls.length)
        throw new Error('autonomous_decomposition_atomic_context_empty:'+node.node_path);
      let researchObserved=null;
      if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
        researchObserved=await researchContext({nodePath:node.node_path,queries:researchQueries,urls:researchUrls});
      }else if(researchQueries.length||researchUrls.length){
        researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
      }
      const contextPayload={
        ...(node.context_payload||{}),
        ...resolveContext(packet,requests),
        ...(researchObserved?{external_research_atomic:researchObserved}:{}),
      };
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
              'Re-read your requirement, your authored discovery state, your proposed artifact, and the supplied evidence.',
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
              supplied_context:node.context_payload||{},
              available_context_index:idx,
            })},
          ],1800,'req_'+node.node_path.replaceAll('.','_')+'_reconcile_'+attempt);
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
      const requests=asArray(reconciliation?.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
      const researchQueries=asArray(reconciliation?.research_queries).map(text).filter(Boolean).slice(0,8);
      const researchUrls=asArray(reconciliation?.research_urls).map(text).filter(v=>/^https:\/\//i.test(v)).slice(0,8);
      if(!requests.length&&!researchQueries.length&&!researchUrls.length)
        throw new Error('autonomous_decomposition_reconciliation_context_empty:'+node.node_path);
      let researchObserved=null;
      if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
        researchObserved=await researchContext({nodePath:node.node_path,queries:researchQueries,urls:researchUrls});
      }else if(researchQueries.length||researchUrls.length){
        researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
      }
      const contextPayload={
        ...(node.context_payload||{}),
        ...resolveContext(packet,requests),
        ...(researchObserved?{external_research_reconciliation:researchObserved}:{}),
      };
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
      const response=await callJson([
        {role:'system',content:[
          'You are the bound autonomous agent synthesizing YOUR completed child requirements back into their parent.',
          'Update a compact accumulator using exactly one newly completed child.',
          'Do not invent facts or change the parent requirement.',
          'Return JSON only: {"summary":"compact cumulative synthesis","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
        ].join('\n')},
        {role:'user',content:safeJson({
          parent_requirement:node.requirement_text,
          agent_authored_discovery_state:agentDiscoveryState(node),
          prior_accumulator:accumulator,
          child:{path:child.node_path,requirement:child.requirement_text,artifact:clip(parts.artifact,7000),handoff:parts.handoff},
        })},
      ],1600,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_merge_'+(i+1));
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

    const final=await callJson([
      {role:'system',content:[
        'You are the bound autonomous agent closing a parent requirement after all child requirements completed.',
        'Using your cumulative synthesis, produce the parent work product.',
        'Return JSON only: {"artifact":"concise auditable parent result","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
        'Do not add requirements or conclusions that are not supported by the completed children.',
      ].join('\n')},
      {role:'user',content:safeJson({
        parent_requirement:node.requirement_text,
        agent_authored_discovery_state:agentDiscoveryState(node),
        cumulative_synthesis:accumulator,
      })},
    ],1800,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_final');

    const artifact=text(final?.parsed?.artifact);
    if(!artifact)throw new Error('autonomous_decomposition_synthesis_empty:'+node.node_path);
    const resultArtifact=JSON.stringify({artifact,handoff:asObject(final?.parsed?.handoff)});
    const done=await saveNode({
      nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
      requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
      status:'completed',decisionType:'SPLIT',
      decisionPayload:{...(node.decision_payload||{}),synthesis_cursor:childRows.length,synthesis_complete:true},
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

    if(node.node_status==='completed')return node;

    for(let transitions=0;transitions<8;transitions++){
      if(node.node_status==='split'||node.decision_type==='SPLIT'){
        let kids=(await children(node.node_path)).filter((child)=>String(child?.status||'')!=='cancelled');
        if(!kids.length)kids=await authorChildren(node,{branchDepth,singleChildRefinements});
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
          if(done.node_status!=='completed')throw new Error('autonomous_decomposition_child_not_complete:'+child.node_path);
          completed.push(done);
        }
        return synthesize(node,completed);
      }

      const forceReconsider=Boolean(node?.decision_payload?.reconsider_decomposition);
      const decision=await decide(node,{forceReconsider,branchDepth,singleChildRefinements});
      node=decision.node;
      node.parent_path=parentPath;

      if(decision.decision==='SPLIT')continue;
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
    },
  };
}
