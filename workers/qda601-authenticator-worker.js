import { createHash } from 'node:crypto';
import { withReviewerModelSlot,isReviewerModelInBackoff,noteReviewerModelTimeout,noteReviewerModelSuccess } from './reviewer-model-endpoint-gate.js';
import { modelChatCompletion, modelProviderConfigStatus } from './providers/model-provider.js';
import { getModelRuntimeProfile } from './model-runtime-profiles.js';

const SB=String(process.env.AAU_SUPABASE_URL||'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/,'');
const anon=String(process.env.AAU_SUPABASE_ANON_KEY||'').trim();
const bridge=String(process.env.AAU_BROKER_BRIDGE_TOKEN||'').trim();
const modelProviderReady=()=>{try{return modelProviderConfigStatus().ready===true;}catch{return false;}};
const executorId=`render:qda601-authenticator:${process.env.RENDER_INSTANCE_ID||process.pid}`;
const pollMs=Math.max(3000,Number(process.env.AAU_QDA601_AUTHENTICATOR_POLL_MS||5000));
let timer=null,working=false;
const PRIMARY='kimi-k3';
const MODELS=[PRIMARY,'meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b','openai/gpt-oss-20b'];
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sha256=(v)=>createHash('sha256').update(String(v??'')).digest('hex');

async function rpc(name,args={}){
  const r=await fetch(`${SB}/rest/v1/rpc/${name}`,{
    method:'POST',
    headers:{apikey:anon,authorization:`Bearer ${anon}`,'content-type':'application/json'},
    body:JSON.stringify({p_bridge_token:bridge,...args}),
  });
  const raw=await r.text(); let body=null; try{body=JSON.parse(raw);}catch{}
  if(!r.ok){const e=new Error(`${name}:${r.status}:${body?.message||raw.slice(0,700)}`);e.status=r.status;throw e;}
  return body;
}

function jsonObject(raw){
  const text=String(raw||'').trim();
  try{return JSON.parse(text);}catch{}
  const s=text.indexOf('{'),e=text.lastIndexOf('}');
  if(s<0||e<=s)throw new Error('qda_authenticator_json_missing');
  return JSON.parse(text.slice(s,e+1));
}
function score01(v,name){
  const n=Number(v);
  if(!Number.isFinite(n)||n<0||n>1)throw new Error('qda_authenticator_invalid_score:'+name);
  return n;
}
function normalize(raw){
  const x=jsonObject(raw);
  const r={
    overall_score:score01(x.overall_score,'overall_score'),
    arithmetic_accuracy:score01(x.arithmetic_accuracy,'arithmetic_accuracy'),
    model_integrity:score01(x.model_integrity??x.financial_model_integrity,'model_integrity'),
    reconciliation_consistency:score01(x.reconciliation_consistency,'reconciliation_consistency'),
    evidence_provenance:score01(x.evidence_provenance,'evidence_provenance'),
    material_numeric_contradictions:Number(x.material_numeric_contradictions),
    self_audit_pass:x.self_audit_pass,
    rationale:String(x.rationale||'').trim(),
    strengths:Array.isArray(x.strengths)?x.strengths.map(String):[],
    weaknesses:Array.isArray(x.weaknesses)?x.weaknesses.map(String):[],
    remediation:Array.isArray(x.remediation)?x.remediation.map(String):[],
    model_reported_verdict:String(x.verdict||'').trim(),
  };
  if(!Number.isInteger(r.material_numeric_contradictions)||r.material_numeric_contradictions<0)
    throw new Error('qda_authenticator_invalid_contradictions');
  if(typeof r.self_audit_pass!=='boolean')throw new Error('qda_authenticator_self_audit_not_boolean');
  if(r.rationale.length<80||!r.strengths.length||!r.weaknesses.length)
    throw new Error('qda_authenticator_review_incomplete');
  const pass=r.overall_score>=0.90&&r.arithmetic_accuracy>=0.95&&
    r.model_integrity>=0.90&&r.reconciliation_consistency>=0.90&&
    r.evidence_provenance>=1.00&&r.material_numeric_contradictions===0&&r.self_audit_pass===true;
  r.deterministic_gate={
    overall_score_floor:0.90,arithmetic_accuracy_floor:0.95,
    model_integrity_floor:0.90,reconciliation_consistency_floor:0.90,
    evidence_provenance_floor:1.00,material_numeric_contradictions_max:0,
    self_audit_required:true,non_compensatory_pass:pass,
    contract:'qda_601_authenticator_unit_gate_v0_2'
  };
  return {report:r,score:r.overall_score,verdict:pass?'verified_pass':'verified_fail'};
}

async function callModel(model,task){
  const directKimi=model===PRIMARY;
  const system='Independent AAU QDA-601 authenticator. Grade only requested requirements against the frozen artifact and supplied evidence. Do not improve the submission or invent data, methods, or deliverables. Recompute required material numerics and verify formulas, units, assumptions, reconciliation, provenance, and task-appropriate checks. For conceptual/causal tasks, grade identification logic, confounders, assumptions, causal restraint, and requested evidence design; never demand unrequested or non-identifiable quantitative work. Prefer per-problem self_audit over aggregate summaries. Return strict JSON only.';
  const user=`UNIT:${task.unit_code}
SHA:${task.artifact_sha256}
GATE: overall>=.90; arithmetic>=.95; model_integrity>=.90; reconciliation>=.90; evidence_provenance=1; contradictions=0; self_audit_pass=true.
Return exactly one JSON object with keys overall_score, arithmetic_accuracy, model_integrity, reconciliation_consistency, evidence_provenance, material_numeric_contradictions, self_audit_pass, verdict, strengths, weaknesses, rationale, remediation. Scores 0..1. contradictions integer. Return 1-2 concise strengths, 1-2 concise weaknesses, 0-2 remediation items, and an 80-220 character rationale.
FROZEN_ARTIFACT:
${task.artifact}`;
  return withReviewerModelSlot('qda601_authenticator',async()=>{
    const begun=Date.now();
    try{
      const profile=getModelRuntimeProfile(model);
      const out=await modelChatCompletion({
        provider:directKimi?'moonshot_direct':null,
        model,messages:[{role:'system',content:system},{role:'user',content:user}],
        maxTokens:directKimi?900:model.startsWith('meta/')?2600:2200,temperature:0,
        jsonMode:directKimi?true:profile.supports_json_mode===true,
        enableThinking:String(model).startsWith('nvidia/nemotron')?false:null,
        reasoningEffort:directKimi?'low':null,
        timeoutMs:directKimi?120000:model.startsWith('meta/')?90000:120000,
        runtimeRole:'authenticator',
      });
      noteReviewerModelSuccess(model);
      return {content:String(out.content||out.reasoning_content||'').trim(),model:out.model_returned||model,
        provider:out.provider||null,latency_ms:Date.now()-begun,runtime_contract:out.runtime_contract||null,
        usage:out.usage||null};
    }catch(e){if(e?.code==='MODEL_TIMEOUT'||e?.name==='AbortError'||e?.name==='TimeoutError')noteReviewerModelTimeout(model);throw e;}
  });
}
async function authenticate(task){
  const artifact=String(task.artifact||'');
  const actualSha=sha256(artifact);
  if(actualSha!==String(task.artifact_sha256||''))throw new Error('qda_authenticator_frozen_hash_mismatch');
  let last=null;
  for(const model of MODELS){
    if(isReviewerModelInBackoff(model)){console.warn('AAU_QDA601_AUTHENTICATOR_BACKOFF_SKIP',model);continue;}
    const attempts=model===PRIMARY?1:(model==='openai/gpt-oss-20b'?2:1);
    for(let attempt=1;attempt<=attempts;attempt++){
      try{
        const out=await callModel(model,task);
        const g=normalize(out.content);
        const report={...g.report,review_provider:out.provider||null,review_model:out.model,
          review_model_requested:model,authenticator_fallback_used:model!==PRIMARY,
          artifact_sha256:actualSha,frozen_file_id:task.file_id,frozen_unit_code:task.unit_code,
          independent_from_bound_agent_model:true,review_latency_ms:out.latency_ms,
          review_usage:out.usage||null,review_token_policy:model===PRIMARY?'kimi_direct_qda_compact_v0_1':'legacy_fallback_budget',
          runtime_contract:out.runtime_contract,review_contract:'qda601_independent_authenticator_v0_3'};
        return rpc('aau_bridge_complete_qda601_authenticator_review',{
          p_review_id:task.review_id,p_executor_id:executorId,p_model_returned:out.model,
          p_score:g.score,p_verdict:g.verdict,p_report:report
        });
      }catch(e){
        last=e;
        console.warn('AAU_QDA601_AUTHENTICATOR_MODEL_FAILED',JSON.stringify({
          review_id:task.review_id,unit_code:task.unit_code,model,attempt,error:String(e?.message||e).slice(0,900)}));
        const status=Number(e?.status||0),retryable=e?.code==='MODEL_TIMEOUT'||e?.name==='AbortError'||status===429||status>=500;
        if(!retryable)break;
        if(attempt<attempts)await sleep(1500*attempt);
      }
    }
  }
  throw last||new Error('qda_authenticator_all_models_failed');
}

async function tick(){
  if(working||!anon||!bridge||!modelProviderReady())return;
  working=true;let task=null;
  try{
    task=await rpc('aau_bridge_claim_qda601_authenticator_review',{p_executor_id:executorId});
    if(task?.status!=='claimed')return;
    console.log('AAU_QDA601_AUTHENTICATOR_CLAIMED',JSON.stringify({
      review_id:task.review_id,agent_id:task.agent_id,file_id:task.file_id,
      unit_code:task.unit_code,artifact_sha256:task.artifact_sha256,
      requested_model:task.authenticator_model_requested}));
    const result=await authenticate(task);
    console.log('AAU_QDA601_AUTHENTICATOR_COMPLETED',JSON.stringify(result));
  }catch(e){
    const msg=String(e?.message||e).slice(0,1500);
    console.error('AAU_QDA601_AUTHENTICATOR_FAILED',msg);
    if(task?.status==='claimed'){
      try{await rpc('aau_bridge_release_qda601_authenticator_review',{
        p_review_id:task.review_id,p_executor_id:executorId,p_error:msg});}
      catch(re){console.error('AAU_QDA601_AUTHENTICATOR_RELEASE_FAILED',String(re?.message||re).slice(0,1000));}
    }
  }finally{working=false;}
}

export function startQda601AuthenticatorWorker(){
  if(timer)return {started:true,already_running:true,poll_ms:pollMs};
  if(!anon||!bridge||!modelProviderReady())return {started:false,reason:'required_runtime_credentials_missing'};
  timer=setInterval(()=>void tick(),pollMs);void tick();
  return {started:true,poll_ms:pollMs,authenticator:PRIMARY,fallbacks:MODELS.slice(1),
    contract:'qda601_independent_authenticator_v0_2'};
}
