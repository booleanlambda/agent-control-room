// Explicitly opt-in, read-only, synthetic probe of AAU expertise authenticator I/O.
// No agent data, grades, state writes, or credentials are logged.
import { createHash } from 'node:crypto';

const key=String(process.env.NVIDIA_API_KEY||'').trim();
const endpoint='https://integrate.api.nvidia.com/v1/chat/completions';
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
 const started=Date.now(),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 const request={model,messages:[{role:'system',content:system},{role:'user',content:user}],
  max_tokens:maxTokens,temperature:0,stream:false};
 if(model.startsWith('nvidia/nemotron'))request.chat_template_kwargs={enable_thinking:false};
 try{
  const response=await fetch(endpoint,{method:'POST',signal:controller.signal,
    headers:{authorization:`Bearer ${key}`,'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify(request)});
  const raw=await response.text();
  let body;try{body=JSON.parse(raw);}catch{body={};}
  const result=String(body?.choices?.[0]?.message?.content||'').trim();
  let grade;try{grade=JSON.parse(result);}catch{grade=null;}
  const fields=grade&&typeof grade==='object'&&expected.every(k=>Object.hasOwn(grade,k));
  const echoed=Array.isArray(grade?.input_receipts)&&receipts.every((x,i)=>grade.input_receipts[i]===x)&&grade.input_receipts.length===3;
  const finish=body?.choices?.[0]?.finish_reason||null;
  const outputTokens=body?.usage?.completion_tokens??null;
  const promptTokens=body?.usage?.prompt_tokens??null;
  return {label,model_requested:model,model_returned:body?.model||null,
   http_status:response.status,elapsed_ms:Date.now()-started,
   input_chars:system.length+user.length,
   input_sha256:createHash('sha256').update(system+'\n'+user).digest('hex'),
   requested_output_tokens:maxTokens,
   output_chars:result.length,prompt_tokens:promptTokens,completion_tokens:outputTokens,
   finish_reason:finish,required_fields_complete:!!fields,head_mid_tail_verified:echoed,
   review_accepted_under_strict_completion:response.ok&&finish==='stop'&&!!fields&&echoed,
   error_code:response.ok?null:String(body?.error?.code||body?.error?.message||body?.detail||response.status).slice(0,120)};
 }catch(e){
  return {label,model_requested:model,elapsed_ms:Date.now()-started,
   input_chars:system.length+user.length,requested_output_tokens:maxTokens,
   error_code:e?.name==='AbortError'?'timeout':String(e?.message||e).slice(0,120),
   timed_out:e?.name==='AbortError',review_accepted_under_strict_completion:false};
 }finally{clearTimeout(timer);}
}

export async function probeAuthenticatorIoTimeout(){
 if(!key)return {status:'unavailable',reason:'nvidia_key_missing'};
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
