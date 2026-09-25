// AAU autonomous recursive decomposition v0.1
// The bound agent authors decomposition. Runtime only persists/routes/checkpoints.

const MAX_DEPTH=12;
const MAX_CHILDREN_PER_NODE=16;
const MAX_CONTEXT_ROUNDS=4;
const MAX_CONTEXT_REQUESTS_PER_ROUND=8;
const MAX_CONTEXT_VALUE_BYTES=12000;

const asObject=(v)=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const asArray=(v)=>Array.isArray(v)?v:[];

function text(v){return String(v??'').trim();}
function bytes(v){try{return Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v));}catch{return 0;}}
function clip(s,n){const v=String(s??'');return v.length<=n?v:v.slice(0,n);}
function safeJson(v){try{return JSON.stringify(v);}catch{return '{}';}}

function getPath(root,path){
  const parts=String(path||'').split('.').filter(Boolean);
  let cur=root;
  for(const part of parts){
    if(!cur||typeof cur!=='object'||Array.isArray(cur)||!(part in cur))return {found:false,value:null};
    cur=cur[part];
  }
  return {found:true,value:cur};
}

function indexObject(root,prefix='',depth=0,out=[]){
  if(!root||typeof root!=='object'||Array.isArray(root)||depth>2)return out;
  for(const key of Object.keys(root).sort()){
    if(out.length>=180)break;
    const path=prefix?prefix+'.'+key:key;
    const value=root[key];
    out.push({path,kind:Array.isArray(value)?'array':typeof value,bytes:bytes(value)});
    if(value&&typeof value==='object'&&!Array.isArray(value)&&depth<2)indexObject(value,path,depth+1,out);
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
  // Index only. No values are injected unless the agent explicitly requests them.
  return indexObject(packet).map(({path,kind,bytes})=>({path,kind,bytes}));
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
      const childIndex=(hit.value&&typeof hit.value==='object'&&!Array.isArray(hit.value))
        ? Object.keys(hit.value).slice(0,80).map(k=>({path:path+'.'+k,bytes:bytes(hit.value[k]),kind:Array.isArray(hit.value[k])?'array':typeof hit.value[k]}))
        : [];
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

export async function runAutonomousRequirementCognition({
  model,packet,modeInfo,agentId,intentExecutionId,
  rpc,sha256,completeJson,researchContext=null,
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
      p_context_payload:args.contextPayload??{},
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

  async function decide(node,{forceReconsider=false}={}){
    let contextPayload=asObject(node.context_payload);
    for(let round=0;round<MAX_CONTEXT_ROUNDS;round++){
      let parsed=null;
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const prompt=[
            'You are the bound autonomous agent deciding how to handle ONE requirement.',
            'The runtime does not choose your decomposition.',
            'Choose exactly one decision:',
            'ATOMIC = you judge this requirement small and clear enough to complete as one bounded cognition.',
            'SPLIT = you decide this requirement should be decomposed into child requirements that YOU will author.',
            'NEED_CONTEXT = you need specific stored context before deciding or executing.',
            'Return JSON only: {"decision":"ATOMIC|SPLIT|NEED_CONTEXT","reason":"brief","context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."]}.',
            'For NEED_CONTEXT, request stored context by exact paths from the supplied index and/or request external research with queries/known URLs. You choose the questions; the runtime only executes them.',
            'Do not solve the requirement in this response. Do not author child requirements yet.',
            forceReconsider
              ? 'A prior ATOMIC execution was rejected as incomplete. Reconsider honestly whether this requirement should be SPLIT or needs more context; do not merely repeat the failed oversized attempt.'
              : '',
          ].filter(Boolean).join('\n');
          const response=await callJson([
            {role:'system',content:prompt},
            {role:'user',content:safeJson({
              requirement:node.requirement_text,
              source:{kind:node.source_kind,ref:node.source_ref},
              supplied_context:contextPayload,
              available_context_index:idx,
            })},
          ],1600,'req_'+node.node_path.replaceAll('.','_')+'_decision_'+(round+1)+'_'+attempt);
          parsed=response?.parsed;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT')throw error;
        }
      }

      const decision=text(parsed?.decision).toUpperCase();
      if(!['ATOMIC','SPLIT','NEED_CONTEXT'].includes(decision))
        throw new Error('autonomous_decomposition_invalid_decision:'+node.node_path);

      const decisionPayload={
        reason:clip(parsed?.reason,1200),
        context_round:round,
        force_reconsider:Boolean(forceReconsider),
      };

      if(decision==='NEED_CONTEXT'){
        const requests=asArray(parsed?.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
        const researchQueries=asArray(parsed?.research_queries).map(text).filter(Boolean).slice(0,8);
        const researchUrls=asArray(parsed?.research_urls).map(text).filter(v=>/^https:\/\//i.test(v)).slice(0,8);
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

  async function authorChildren(node){
    let existing=await children(node.node_path);
    if(existing.length)return existing;

    const authored=[];
    for(let ordinal=1;ordinal<=MAX_CHILDREN_PER_NODE;ordinal++){
      const previous=authored.map(c=>({ordinal:c.ordinal,requirement:c.requirement_text}));
      let parsed=null;
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent decomposing ONE parent requirement.',
              'You own the decomposition. The runtime will persist exactly what you author.',
              'Author exactly ONE next child requirement, or declare DONE when the children already authored adequately cover the parent.',
              'A child must be a real independently completable requirement, not a vague label.',
              'Do not solve the child here.',
              'Return JSON only: {"status":"CHILD","requirement":"...","reason":"brief"} OR {"status":"DONE","coverage_note":"brief"}.',
              'There is no required number of children. Use as many or as few as your reasoning requires.',
            ].join('\n')},
            {role:'user',content:safeJson({
              parent_requirement:node.requirement_text,
              supplied_context:node.context_payload||{},
              previously_authored_children:previous,
            })},
          ],1600,'req_'+node.node_path.replaceAll('.','_')+'_author_child_'+ordinal+'_'+attempt);
          parsed=response?.parsed;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT')throw error;
        }
      }

      const status=text(parsed?.status).toUpperCase();
      if(status==='DONE'){
        if(authored.length<2)
          throw new Error('autonomous_decomposition_split_requires_multiple_children:'+node.node_path);
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
        decisionPayload:{authored_reason:clip(parsed?.reason,1200),authored_by_bound_agent:true},
        contextPayload:{},resultArtifact:null,
      });
      child.parent_path=node.node_path;
      authored.push(child);
      counters.nodes++;
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
        const reset=await saveNode({
          nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
          requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
          status:'pending',decisionType:null,
          decisionPayload:{prior_atomic_rejection:String(error?.rejectionReason||error?.code||'incomplete'),reconsider_decomposition:true},
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
        decisionPayload:{reason:clip(parsed?.reason,1200),reclassified_during_execution:true},
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

    const artifact=text(parsed?.artifact);
    if(!artifact)throw new Error('autonomous_decomposition_atomic_artifact_empty:'+node.node_path);
    const handoff=asObject(parsed?.handoff);
    const resultArtifact=JSON.stringify({artifact,handoff});
    const done=await saveNode({
      nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
      requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
      status:'completed',decisionType:'ATOMIC',
      decisionPayload:{...(node.decision_payload||{}),completed_as_atomic:true},
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
      {role:'user',content:safeJson({parent_requirement:node.requirement_text,cumulative_synthesis:accumulator})},
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

  async function process(nodePath,parentPath=null,depth=0){
    if(depth>MAX_DEPTH)throw new Error('autonomous_decomposition_depth_resource_limit:'+nodePath);
    let node=await getNode(nodePath);
    if(node?.status!=='ready')throw new Error('autonomous_decomposition_node_missing:'+nodePath);
    node.parent_path=parentPath;
    counters.nodes++;

    if(node.node_status==='completed')return node;

    for(let transitions=0;transitions<8;transitions++){
      if(node.node_status==='split'||node.decision_type==='SPLIT'){
        let kids=await children(node.node_path);
        if(!kids.length)kids=await authorChildren(node);
        const completed=[];
        for(const child of kids){
          child.parent_path=node.node_path;
          const done=await process(child.node_path,node.node_path,depth+1);
          if(done.node_status!=='completed')throw new Error('autonomous_decomposition_child_not_complete:'+child.node_path);
          completed.push(done);
        }
        return synthesize(node,completed);
      }

      const forceReconsider=Boolean(node?.decision_payload?.reconsider_decomposition);
      const decision=await decide(node,{forceReconsider});
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

  const completedRoot=await process('R',null,0);
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
      decomposition_authored_by_bound_agent:true,
      runtime_role:'persist_route_resume_completion_integrity_only',
      cognition_mode:modeInfo?.mode||'deep',
    },
  };
}
