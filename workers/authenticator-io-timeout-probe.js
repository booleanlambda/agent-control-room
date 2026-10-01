// Explicitly opt-in, read-only, synthetic probe of AAU expertise authenticator I/O.
// No agent data, grades, state writes, or credentials are logged.
import { createHash } from 'node:crypto';
import { modelChatCompletion, modelProviderConfigStatus } from './providers/model-provider.js';

const expected=['execution','method','security','validation','communication','critical','confidence','unsupported'];
const receipts=['AUTH_HEAD_62B7','AUTH_MIDDLE_8C04','AUTH_TAIL_51D9'];

const system='You are the independent AAU expertise authenticator. Inspect the entire supplied synthetic candidate record. Return exactly ONE JSON object with numeric execution, method, security, validation, communication (0-100), string critical, numeric confidence (0..1), boolean unsupported, and input_receipts as an array containing the EXACT three marker IDs seen in the candidate record, in order. Do not invent IDs. No markdown.';
const sample='The candidate distinguishes a request timeout from server-side failure, uses a stable idempotency key, stores the result atomically, supports duplicate response replay, bounds backoff with jitter, validates retryable HTTP statuses, records operational metrics and tests timeout-after-commit without claiming observed results. ';
const user=[
 'DOMAIN: HTTP API reliability. SYNTHETIC TEST ONLY; NOT AN AAU AGENT ASSESSMENT.',
 'START MARKER: '+receipts[0],
 ...Array.from({length:33},(_,i)=>'SUPPORTING NOTE '+i+': '+sample),
 'MIDPOINT MARKER: '+receipts[1],
 ...Array.from({length:33},(_,i)=>'SUPPORTING NOTE '+(i+33)+': '+sample),
 'FINAL MARKER: '+receipts[2],
 'GRADE ONLY THE SYNTHETIC ANSWER. Return the required JSON including all three exact markers.'
].join('\n');

async function one(model,maxTokens,timeoutMs,label){
 const started=Date.now();
 try{
  const result=await modelChatCompletion({
    model,messages:[{role:'system',content:system},{role:'user',content:user}],
    maxTokens,temperature:0,jsonMode:true,
    enableThinking:model.startsWith('nvidia/nemotron')?false:null,
    timeoutMs,runtimeRole:'authenticator',
  });
  const output=String(result.content||'').trim();
  let grade;try{grade=JSON.parse(output);}catch{grade=null;}
  const fields=grade&&typeof grade==='object'&&expected.every(k=>Object.hasOwn(grade,k));
  const echoed=Array.isArray(grade?.input_receipts)&&receipts.every((x,i)=>grade.input_receipts[i]===x)&&grade.input_receipts.length===3;
  const finish=result.finish_reason||null;
  return {label,model_requested:model,model_returned:result.model_returned||null,
   provider:result.provider||null,elapsed_ms:Date.now()-started,
   input_chars:system.length+user.length,
   input_sha256:createHash('sha256').update(system+'\\n'+user).digest('hex'),
   requested_output_tokens:maxTokens,output_chars:output.length,
   prompt_tokens:result.usage?.prompt_tokens??null,completion_tokens:result.usage?.completion_tokens??null,
   finish_reason:finish,required_fields_complete:!!fields,head_mid_tail_verified:echoed,
   review_accepted_under_strict_completion:finish==='stop'&&!!fields&&echoed,error_code:null};
 }catch(e){
  const timedOut=e?.code==='MODEL_TIMEOUT'||e?.name==='AbortError'||e?.name==='TimeoutError';
  return {label,model_requested:model,elapsed_ms:Date.now()-started,
   input_chars:system.length+user.length,requested_output_tokens:maxTokens,
   error_code:timedOut?'timeout':String(e?.code||e?.message||e).slice(0,120),
   timed_out:timedOut,review_accepted_under_strict_completion:false};
 }
}

export async function probeAuthenticatorIoTimeout(){
 try{if(modelProviderConfigStatus().ready!==true)return {status:'unavailable',reason:'model_provider_unavailable'};}catch{return {status:'unavailable',reason:'model_provider_unavailable'};}
 console.log('AAU_AUTH_IO_TEST_BEGIN',JSON.stringify({synthetic:true,source_records_accessed:false,input_chars:system.length+user.length}));
 const tests=[];
 tests.push(await one('moonshotai/kimi-k3',1800,65000,'primary_production_budget'));
 console.log('AAU_AUTH_IO_TEST_RESULT',JSON.stringify(tests[tests.length-1]));
 tests.push(await one('nvidia/nemotron-3.5-lightning-30b-a3b',1200,120000,'fallback_production_budget'));
 console.log('AAU_AUTH_IO_TEST_RESULT',JSON.stringify(tests[tests.length-1]));
 tests.push(await one('nvidia/nemotron-3.5-lightning-30b-a3b',75,30000,'deliberately_insufficient_output_budget'));
 console.log('AAU_AUTH_IO_TEST_RESULT',JSON.stringify(tests[tests.length-1]));
 return {status:'complete',synthetic:true,source_records_accessed:false,tests:tests.map(x=>({label:x.label,strict_complete:x.review_accepted_under_strict_completion,elapsed_ms:x.elapsed_ms,error_code:x.error_code||null}))};
}
