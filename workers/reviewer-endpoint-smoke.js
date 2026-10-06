// One bounded synthetic endpoint probe at broker-bridge startup.
// Disabled by default in broker-bridge-start.js. Never reads agent data or changes verdicts.
import { withReviewerModelSlot, noteReviewerModelTimeout, noteReviewerModelSuccess } from './reviewer-model-endpoint-gate.js';
import { modelChatCompletion, modelProviderConfigStatus } from './providers/model-provider.js';

const providerReady=()=>{try{return modelProviderConfigStatus().ready===true;}catch{return false;}};

async function probe(model,label){
  const begun=Date.now();
  const directKimi=model==='kimi-k3';
  return withReviewerModelSlot('startup_endpoint_probe',async()=>{
    try{
      const result=await modelChatCompletion({
        provider:directKimi?'moonshot_direct':null,
        model,
        messages:[
          {role:'system',content:'Return exactly AAU_REVIEWER_ENDPOINT_OK and nothing else.'},
          {role:'user',content:'Connectivity probe only.'},
        ],
        maxTokens:64,
        temperature:0,
        jsonMode:false,
        enableThinking:false,
        reasoningEffort:directKimi?'low':null,
        timeoutMs:directKimi?120000:30000,
        runtimeRole:'reviewer',
      });
      const txt=String(result.content||'').trim();
      const ok=txt.includes('AAU_REVIEWER_ENDPOINT_OK');
      if(ok)noteReviewerModelSuccess(model);
      return {label,model,status:ok?'reachable':'invalid_or_unavailable',
        provider:result.provider||null,elapsed_ms:Date.now()-begun,
        finish_reason:result.finish_reason||null,error_code:ok?null:'unexpected_response'};
    }catch(error){
      if(error?.code==='MODEL_TIMEOUT'||error?.name==='AbortError'||error?.name==='TimeoutError')
        noteReviewerModelTimeout(model,'startup_probe_timeout');
      return {label,model,status:'failed',elapsed_ms:Date.now()-begun,
        error_code:error?.code||String(error?.message||error).slice(0,110)};
    }
  });
}

export function startReviewerEndpointSmoke(){
  if(!providerReady())return {started:false,reason:'model_provider_unavailable'};
  void (async()=>{
    const primary=await probe('kimi-k3','primary');
    console.log('AAU_REVIEWER_ENDPOINT_PROBE',JSON.stringify(primary));
    if(primary.status==='reachable')return;
    const fallback=await probe('nvidia/nemotron-3.5-lightning-30b-a3b','fallback');
    console.log('AAU_REVIEWER_ENDPOINT_PROBE',JSON.stringify(fallback));
  })().catch(error=>console.error('AAU_REVIEWER_ENDPOINT_PROBE_FATAL',
    String(error?.message||error).slice(0,150)));
  return {started:true,frequency:'explicit_opt_in',verdict_authority:false,primary:'kimi-k3',provider:'moonshot_direct'};
}
