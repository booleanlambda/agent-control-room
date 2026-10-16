// Bounded live NVIDIA 10-deep AAU experiment, no production database access.
// Calls are real. Model must author split boundaries, terminal labels and parent
// claims. Separate deterministic authenticators verify each stage.
import {writeFileSync} from 'node:fs';
import {newDeepTree,deepConfig,nextDeep,lightModelDouble} from './depth10-traversability.mjs';
import {auditCognitiveTree,scriptedSynthesis} from './cognitive-integrity.mjs';
import {bindAndAuthenticateSynthesis} from './synthesis-slots.mjs';

const MODEL='nvidia/nemotron-3.5-lightning-30b-a3b';
const KEY=String(process.env.NVIDIA_API_KEY||'').trim();
if(!KEY)throw Error('NVIDIA_API_KEY_MISSING');
const NODE_CALL_LIMIT=30;
const SYNTH_CALL_LIMIT=12;
const MAX_REAL_TOKENS=30000;
const HARD_DEADLINE=Date.now()+9*60*1000;
let realCalls=0,usageTotal=0;
const calls=[],decisions=[];
const config={...deepConfig('spine',40000),maxCalls:NODE_CALL_LIMIT,maxAttempts:2,outputCap:320};
const state=newDeepTree(config);
const outputFile='recursion-live-depth10-report.json';
const compactError=e=>String(e?.message||e).slice(0,220);

async function api(messages,kind,path,maxTokens){
  if(Date.now()>HARD_DEADLINE)throw Error('campaign_deadline_exhausted');
  if(realCalls>=NODE_CALL_LIMIT+SYNTH_CALL_LIMIT)throw Error('campaign_call_ceiling');
  if(usageTotal>=MAX_REAL_TOKENS)throw Error('campaign_actual_token_ceiling');
  const attempt=++realCalls;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30000);
  const started=Date.now();
  let reply=null,answer=null,status='error',error=null,usage={};
  try {
    const response=await fetch('https://integrate.api.nvidia.com/v1/chat/completions',{
      method:'POST',
      headers:{authorization:'Bearer '+KEY,'content-type':'application/json',accept:'application/json'},
      signal:controller.signal,
      body:JSON.stringify({model:MODEL,messages,max_tokens:maxTokens,
        temperature:0,stream:false,response_format:{type:'json_object'},
        chat_template_kwargs:{enable_thinking:false}}),
    });
    if(!response.ok)throw Error('NVIDIA_HTTP_'+response.status+':'+(await response.text()).slice(0,180));
    reply=await response.json();
    if(reply?.choices?.[0]?.finish_reason!=='stop')
      throw Error('model_incomplete:'+reply?.choices?.[0]?.finish_reason);
    const content=reply?.choices?.[0]?.message?.content;
    if(!content)throw Error('empty_model_content');
    answer=JSON.parse(String(content).replace(/^\`\`\`json\s*/,'').replace(/\`\`\`$/,'').trim());
    if(!answer||typeof answer!=='object'||Array.isArray(answer))throw Error('invalid_json_shape');
    status='answered';
    return answer;
  } catch (e) {
    error=compactError(e);
    throw e;
  } finally {
    clearTimeout(timeout);
    usage={prompt_tokens:reply?.usage?.prompt_tokens||0,
      completion_tokens:reply?.usage?.completion_tokens||0,
      total_tokens:reply?.usage?.total_tokens||0};
    usageTotal+=Math.max(0,Number(usage.total_tokens)||0);
    const event={attempt,kind,path,status,latencyMs:Date.now()-started,usage,
      error,answer:answer?JSON.stringify(answer).slice(0,800):null};
    calls.push(event);
  }
}
async function nodeModel(node,limits){
  const isLeaf=node.end-node.start===1;
  const rules=`Return exactly one JSON object with no markdown or explanation. You are a limited-budget reasoning worker in an isolated tree test. If range contains more than one item, you MUST return {"action":"SPLIT","splitAt":NUMBER}, with splitAt exactly start+1, ensuring the left child handles exactly the first item and the right child handles all remaining items. If range size is 1, you MUST return {"action":"ATOMIC","id":"CASE-0001","classification":"budget"} replacing with the exact supplied ID and its correct class. Allowed classes: budget,provider,cognition,evidence,scheduler,unknown. Classify exhaustion/rollover/cycle_lock as budget, HTTP 504/timeout as provider, autonomous_decomposition decision/split/synthesis as cognition, QDA/materialization/checks as evidence, orphaned intent as scheduler. Output only JSON and NEVER invent IDs. All partition boundaries must be integers.`;
  const input={path:node.path,depth:node.depth,start:node.start,end:node.end,
    rangeCount:node.end-node.start,requiredSplitAt:isLeaf?null:node.start+1,
    item:isLeaf?node.item:null,outputSchema:isLeaf?'ATOMIC':'SPLIT'};
  const answer=await api([
    {role:'system',content:rules},
    {role:'user',content:JSON.stringify(input)},
  ],'node',node.path,limits.outputCap);
  decisions.push({path:node.path,depth:node.depth,action:answer.action,
    splitAt:answer.splitAt??null,classification:answer.classification??null});
  return answer;
}
const synthesisMap=new Map();
const synthCalls=[];
async function generateSynthesis(){
  // Replay the known-good deterministic structure to produce trusted child
  // attestations; then independently ask model to create each parent claim.
  const planned=auditCognitiveTree(state);
  if(!planned.complete)return {status:'skipped_unfinished_tree'};
  const parents=Object.values(state.nodes).filter(n=>n.status==='split')
    .sort((a,b)=>b.depth-a.depth||a.path.localeCompare(b.path));
  const proofs=new Map(Object.entries(planned.proofs).filter(([p,v])=>v.childEvidence.length===0));
  for(const node of parents){
    if(Date.now()>HARD_DEADLINE||realCalls>=NODE_CALL_LIMIT+SYNTH_CALL_LIMIT||
       usageTotal>=MAX_REAL_TOKENS)return {status:'bounded_stop',at:node.path};
    const children=node.children.map(p=>proofs.get(p));
    if(children.some(c=>!c))return {status:'missing_child_proof',at:node.path};
    let answer;
    try {
      answer=await api([
        {role:'system',content:`You are a lightweight AAU synthesis worker. Return exactly ONE strict JSON object without markdown: {"summary":"...", "slots":[0,1], "covered":NUMBER, "counts":{"budget":0,"provider":0,"cognition":0,"evidence":0,"scheduler":0,"unknown":0}}. The only two possible child references are slot 0 and slot 1, each exactly once and in that order. NEVER output any child path, sha256 digest, parent ID, children array or evidence hash. Runtime will bind verified child references itself. Your task is to add classification counts from both slots, set covered to their sum and produce a short meaningful summary. Do not fabricate numbers or child records.`},
        {role:'user',content:JSON.stringify({parentDepth:node.depth,rangeCount:node.end-node.start,
          slots:children.map((c,index)=>({slot:index,covered:c.covered,counts:c.counts}))})},
      ],'synthesis',node.path,450);
      synthCalls.push({path:node.path,reply:answer});
    }catch(e){return {status:'provider_error',at:node.path,error:compactError(e)};}
    const bound=bindAndAuthenticateSynthesis(node,answer,children);
    if(!bound.ok)return {status:'auth_rejected',at:node.path,reason:bound.reason};
    // The canonical evidence paths and digests come from verified runtime
    // proofs, not model-generated transcriptions of ten-level identifiers.
    synthesisMap.set(node.path,bound.proposal);
    // Validate immediately, do not use faulty claim as dependency proof.
    const audit=auditCognitiveTree(state,{proposeSynthesis:(n,c)=>
      synthesisMap.get(n.path)||scriptedSynthesis(n,c)});
    const verdict=audit.results[node.path];
    if(!verdict?.accepted)return {status:'auth_rejected',at:node.path,
      reason:verdict?.reason||'missing_certification'};
    proofs.set(node.path,audit.proofs[node.path]);
  }
  return {status:'completed',parents:parents.length};
}
let stage='init',synthesis={status:'not_started'};
try{
  stage='node_recursion';
  // An explicit bound of 30 attempts, at most 21 accepted nodes (no auto-promotion).
  for(let i=0;state.queue.length&&i<NODE_CALL_LIMIT;i++){
    if(Date.now()>HARD_DEADLINE||usageTotal>=MAX_REAL_TOKENS)break;
    await nextDeep(state,nodeModel);
  }
  state.complete=state.queue.length===0&&Object.values(state.nodes)
    .every(n=>n.status==='complete'||n.status==='split');
  if(state.complete){
    stage='parent_synthesis';
    synthesis=await generateSynthesis();
  }else synthesis={status:'skipped_unfinished_tree'};
}catch(e){synthesis={status:'campaign_error',error:compactError(e)};}
finally{
  const audit=auditCognitiveTree(state,{proposeSynthesis:(node,children)=>
    synthesisMap.get(node.path)||{summary:'',children:[],covered:0,counts:{}}});
  const output={
    experiment:'AAU_LIVE_NEMOTRON_DEPTH10_SPINE_SLOTS_V2',model:MODEL,simulated:false,
    shape:'10 consecutive nested splits, 21 nodes and 11 diagnostic leaves',
    callCeiling:NODE_CALL_LIMIT+SYNTH_CALL_LIMIT,actualTokenCeiling:MAX_REAL_TOKENS,
    calls:realCalls,reportedTokens:usageTotal,estimatedBudget:state.config.budget,
    estimatedSpent:state.spent,stage,synthesis,complete:state.complete,
    authenticatedRoot:audit.complete,rootDigest:audit.rootDigest,
    acceptedLeaves:audit.acceptedLeaves,acceptedParents:audit.acceptedParents,
    rejectedNodes:audit.rejectedNodes.slice(0,22),
    counts:{nodes:Object.keys(state.nodes).length,
      splits:Object.values(state.nodes).filter(n=>n.status==='split').length,
      completedLeaves:Object.values(state.nodes).filter(n=>n.status==='complete').length,
      blocked:Object.values(state.nodes).filter(n=>n.status==='blocked').length},
    decisions,callsDetail:calls,modelSyntheses:synthCalls,
    tree:Object.fromEntries(Object.entries(state.nodes).map(([p,n])=>[p,{
      depth:n.depth,parent:n.parent,children:n.children,status:n.status,
      attempts:n.attempts,start:n.start,end:n.end,hash:n.hash,result:n.result}])),
    ledger:state.ledger,
  };
  writeFileSync(outputFile,JSON.stringify(output,null,2)+'\n');
  console.log('LIVE_DEPTH10_RESULT='+JSON.stringify({
    complete:output.complete,authenticatedRoot:output.authenticatedRoot,
    nodes:output.counts.nodes,depth:Math.max(...Object.values(state.nodes).map(n=>n.depth)),
    calls:output.calls,reportedTokens:output.reportedTokens,
    budgetUsed:output.estimatedSpent,budget:output.estimatedBudget,
    acceptedLeaves:output.acceptedLeaves,acceptedParents:output.acceptedParents,
    synthesis:output.synthesis,rejectedNodes:output.rejectedNodes.slice(0,3),
  }));
  if(!output.complete||!output.authenticatedRoot)process.exitCode=2;
}
