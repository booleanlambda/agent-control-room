// Explicit opt-in, isolated synthetic probe of agent cognition I/O through the ACTUAL NVIDIA adapter.
// No agent packets, lifecycle events, memory writes, resource grants, or private evidence are touched.
// Logs only metrics and booleans; never prints credentials, raw prompts, or model output.
import { createHash } from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';

const MODEL='google/gemma-4-31b-it';
const RECEIPTS=['AAU_AGENT_HEAD_62B7','AAU_AGENT_MID_8C04','AAU_AGENT_TAIL_51D9'];
const HASH=(v)=>createHash('sha256').update(v).digest('hex');
const SYSTEM='You are a synthetic AAU cognition I/O test, NOT an actual agent. Read the entire packet, find three receipt IDs at the beginning, middle and end, and return JSON only. Never invent receipts, real agent events, research claims, or actions. Return keys: receipt_ids (exact three strings in order); items (integer array from 1 to the requested count in order); status (string "synthetic_complete").';
const FILL='Synthetic domain exercise: observe, calculate and check invariants before storing evidence. The facts in this passage are invented and cannot justify a real-world claim. Check provenance of inputs, preserve original observations, and refuse completion if mandatory evidence is missing. ';
function packet(targetChars,items){
  const half=Math.max(0,Math.ceil((targetChars-250)/2));
  const make=(n)=>{
    const chunks=[]; let length=0; let i=0;
    while(length<n){ const chunk='SYNTHETIC_NOTE_'+i+': '+FILL+'\n';chunks.push(chunk);length+=chunk.length;i++;}
    return chunks.join('').slice(0,n);
  };
  return 'SYNTHETIC INPUT ONLY; no real agent record. BEGIN='+RECEIPTS[0]+'\n'
   +make(half)+'\nMID='+RECEIPTS[1]+'\n'
   +make(half)+'\nEND='+RECEIPTS[2]+'\n'
   +'Return the full requested JSON. items must contain all integers 1 through '+items+'. No explanation.';
}
function validResult(text,count){
  let parsed;
  try{parsed=JSON.parse(String(text||''));}catch{return {json:false,markers:false,items:false};}
  const markers=Array.isArray(parsed?.receipt_ids)&&
    parsed.receipt_ids.length===3&&RECEIPTS.every((v,i)=>parsed.receipt_ids[i]===v);
  const items=Array.isArray(parsed?.items)&&parsed.items.length===count&&
    parsed.items.every((v,i)=>v===i+1);
  return {json:true,markers,items,status:parsed?.status==='synthetic_complete'};
}
async function runCase(label, inputChars, count, maxTokens, timeoutMs){
  const user=packet(inputChars,count);
  const start=Date.now();
  const requestHash=HASH(SYSTEM+'\n'+user);
  try{
    const result=await nvidiaChatCompletion({
      model:MODEL,messages:[{role:'system',content:SYSTEM},{role:'user',content:user}],
      maxTokens,timeoutMs,temperature:0,jsonMode:true,enableThinking:false
    });
    const checks=validResult(result.content,count);
    const stop=result.finish_reason==='stop';
    return {
      label,model_requested:MODEL,model_returned:result.model_returned,
      input_chars:SYSTEM.length+user.length,input_sha256:requestHash,
      requested_output_tokens:maxTokens,adapter_max_tokens:Math.min(maxTokens,4096),
      timeout_ms:timeoutMs,elapsed_ms:Date.now()-start,output_chars:String(result.content||'').length,
      prompt_tokens:result.usage?.prompt_tokens??null,completion_tokens:result.usage?.completion_tokens??null,
      finish_reason:result.finish_reason, ...checks,
      strict_complete:stop&&checks.json&&checks.markers&&checks.items&&checks.status&&result.model_returned===MODEL
    };
  }catch(e){
    return {label,model_requested:MODEL,input_chars:SYSTEM.length+user.length,input_sha256:requestHash,
      requested_output_tokens:maxTokens,adapter_max_tokens:Math.min(maxTokens,4096),
      timeout_ms:timeoutMs,elapsed_ms:Date.now()-start,error_code:e?.code||e?.name||'error',
      error_summary:String(e?.message||e).slice(0,130),strict_complete:false};
  }
}
export async function probeAgentCognitionIoTimeout(){
  if(!String(process.env.NVIDIA_API_KEY||'').trim())return {status:'unavailable',reason:'nvidia_key_missing'};
  console.log('AAU_AGENT_IO_TEST_BEGIN',JSON.stringify({model:MODEL,synthetic:true,agent_data_accessed:false}));
  const cases=[
    ['medium_input_standard_output',24500,120,2600,60000],
    ['large_input_complete_coverage',95000,16,600,120000],
    ['output_above_adapter_cap',8500,220,6000,120000],
    ['forced_output_limit',8500,120,64,60000],
    ['short_timeout_guard',24500,350,4096,5000]
  ];
  const tests=[];
  for(const [label,size,items,maxTokens,timeoutMs] of cases){
    const one=await runCase(label,size,items,maxTokens,timeoutMs);
    tests.push(one);console.log('AAU_AGENT_IO_TEST_RESULT',JSON.stringify(one));
  }
  const summary={status:'complete',synthetic:true,agent_data_accessed:false,
    tests:tests.map(x=>({label:x.label,strict_complete:x.strict_complete,finish_reason:x.finish_reason||null,error_code:x.error_code||null,elapsed_ms:x.elapsed_ms}))};
  console.log('AAU_AGENT_IO_TEST_COMPLETE',JSON.stringify(summary));
  return summary;
}
