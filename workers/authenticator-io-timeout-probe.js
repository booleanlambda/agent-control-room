// Explicitly opt-in, read-only calibration of direct Kimi authenticator I/O.
// It performs exactly ONE paid model request and never reads or writes agent evidence.
import { createHash } from 'node:crypto';
import { modelChatCompletion, modelProviderConfigStatus } from './providers/model-provider.js';

const MODEL='kimi-k3';
const PROVIDER='moonshot_direct';
const OUTPUT_CAP=640;
const expected=['execution','method','security','validation','communication','critical','confidence','unsupported'];
const receipts=['AUTH_HEAD_62B7','AUTH_MIDDLE_8C04','AUTH_TAIL_51D9'];

const system='Independent AAU expertise authenticator calibration. Inspect the entire synthetic candidate record. Return exactly one JSON object with numeric execution, method, security, validation, communication (0-100), string critical, numeric confidence (0..1), boolean unsupported, and input_receipts containing the exact three marker IDs in order. Do not invent IDs. No markdown or explanation.';
const sample='The candidate distinguishes request timeout from server failure, uses a stable idempotency key, stores results atomically, supports duplicate replay, bounds retry backoff with jitter, validates retryable HTTP statuses, records operational metrics, and tests timeout-after-commit without claiming unobserved results. ';
const user=[
  'DOMAIN: HTTP API reliability. SYNTHETIC TEST ONLY; NOT AN AAU AGENT ASSESSMENT.',
  'START MARKER: '+receipts[0],
  ...Array.from({length:33},(_,i)=>'SUPPORTING NOTE '+i+': '+sample),
  'MIDPOINT MARKER: '+receipts[1],
  ...Array.from({length:33},(_,i)=>'SUPPORTING NOTE '+(i+33)+': '+sample),
  'FINAL MARKER: '+receipts[2],
  'Grade only the synthetic answer and return the required JSON including all three markers.'
].join('\n');

async function one(){
  const started=Date.now();
  try{
    const result=await modelChatCompletion({
      provider:PROVIDER,
      model:MODEL,
      messages:[{role:'system',content:system},{role:'user',content:user}],
      maxTokens:OUTPUT_CAP,
      temperature:0,
      jsonMode:true,
      enableThinking:false,
      reasoningEffort:'low',
      timeoutMs:120000,
      runtimeRole:'authenticator',
    });
    const output=String(result.content||'').trim();
    let grade; try{grade=JSON.parse(output);}catch{grade=null;}
    const fields=grade&&typeof grade==='object'&&expected.every(k=>Object.hasOwn(grade,k));
    const echoed=Array.isArray(grade?.input_receipts)
      && receipts.every((x,i)=>grade.input_receipts[i]===x)
      && grade.input_receipts.length===3;
    const finish=result.finish_reason||null;
    const promptTokens=result.usage?.prompt_tokens??null;
    const completionTokens=result.usage?.completion_tokens??null;
    return {
      label:'direct_kimi_compact_640',
      model_requested:MODEL,
      model_returned:result.model_returned||null,
      provider:result.provider||null,
      elapsed_ms:Date.now()-started,
      input_chars:system.length+user.length,
      input_sha256:createHash('sha256').update(system+'\n'+user).digest('hex'),
      requested_output_tokens:OUTPUT_CAP,
      output_chars:output.length,
      prompt_tokens:promptTokens,
      completion_tokens:completionTokens,
      total_tokens:Number.isFinite(Number(promptTokens))&&Number.isFinite(Number(completionTokens))
        ? Number(promptTokens)+Number(completionTokens):null,
      output_budget_utilization:Number.isFinite(Number(completionTokens))
        ? Number((Number(completionTokens)/OUTPUT_CAP).toFixed(4)):null,
      finish_reason:finish,
      required_fields_complete:!!fields,
      head_mid_tail_verified:echoed,
      review_accepted_under_strict_completion:finish==='stop'&&!!fields&&echoed,
      error_code:null,
    };
  }catch(e){
    const timedOut=e?.code==='MODEL_TIMEOUT'||e?.name==='AbortError'||e?.name==='TimeoutError';
    return {
      label:'direct_kimi_compact_640',
      model_requested:MODEL,
      provider:PROVIDER,
      elapsed_ms:Date.now()-started,
      input_chars:system.length+user.length,
      requested_output_tokens:OUTPUT_CAP,
      error_code:timedOut?'timeout':String(e?.code||e?.message||e).slice(0,160),
      timed_out:timedOut,
      review_accepted_under_strict_completion:false,
    };
  }
}

export async function probeAuthenticatorIoTimeout(){
  try{
    if(modelProviderConfigStatus(PROVIDER).ready!==true)
      return {status:'unavailable',reason:'moonshot_direct_unavailable'};
  }catch{
    return {status:'unavailable',reason:'moonshot_direct_unavailable'};
  }
  console.log('AAU_AUTH_IO_TEST_BEGIN',JSON.stringify({
    synthetic:true,source_records_accessed:false,provider:PROVIDER,model:MODEL,
    input_chars:system.length+user.length,output_cap:OUTPUT_CAP,reasoning_effort:'low',paid_request_count:1
  }));
  const result=await one();
  console.log('AAU_AUTH_IO_TEST_RESULT',JSON.stringify(result));
  return {
    status:'complete',
    synthetic:true,
    source_records_accessed:false,
    paid_request_count:1,
    test:{
      label:result.label,
      strict_complete:result.review_accepted_under_strict_completion,
      elapsed_ms:result.elapsed_ms,
      prompt_tokens:result.prompt_tokens??null,
      completion_tokens:result.completion_tokens??null,
      total_tokens:result.total_tokens??null,
      output_budget_utilization:result.output_budget_utilization??null,
      error_code:result.error_code||null,
    },
  };
}
