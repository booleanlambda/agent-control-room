// One bounded synthetic endpoint probe at broker-bridge startup.
// Does not read agent data, affect expertise/product verdicts, or replay failed jobs.
import { withReviewerModelSlot, noteReviewerModelTimeout, noteReviewerModelSuccess } from './reviewer-model-endpoint-gate.js';
import { modelChatCompletion, modelProviderConfigStatus } from './providers/model-provider.js';

const providerReady=()=>{try{return modelProviderConfigStatus().ready===true;}catch{return false;}};

async function probe(model, label) {
  const begun = Date.now();
  return withReviewerModelSlot('startup_endpoint_probe', async () => {
    try {
      const result=await modelChatCompletion({
        model,
        messages:[
          {role:'system',content:'Return exactly the single token AAU_REVIEWER_ENDPOINT_OK. No explanation.'},
          {role:'user',content:'Connectivity probe only.'},
        ],
        maxTokens:64,temperature:0,jsonMode:false,enableThinking:false,timeoutMs:30000,runtimeRole:'reviewer',
      });
      const txt=String(result.content||'').trim();
      const ok=txt.includes('AAU_REVIEWER_ENDPOINT_OK');
      if(ok)noteReviewerModelSuccess(model);
      return {label,model,status:ok?'reachable':'invalid_or_unavailable',
        provider:result.provider||null,elapsed_ms:Date.now()-begun,
        finish_reason:result.finish_reason||null,error_code:ok?null:'unexpected_response'};
    } catch(error) {
      if(error?.code==='MODEL_TIMEOUT'||error?.name==='AbortError'||error?.name==='TimeoutError')
        noteReviewerModelTimeout(model,'startup_probe_timeout');
      return {label,model,status:'failed',elapsed_ms:Date.now()-begun,
        error_code:error?.code||String(error?.message||error).slice(0,110)};
    }
  });
}

export function startReviewerEndpointSmoke() {
  if (!providerReady()) return {started:false,reason:'model_provider_unavailable'};
  void (async () => {
    const primary=await probe('moonshotai/kimi-k3','primary');
    console.log('AAU_REVIEWER_ENDPOINT_PROBE',JSON.stringify(primary));
    if(primary.status==='reachable')return;
    const fallback=await probe('nvidia/nemotron-3.5-lightning-30b-a3b','fallback');
    console.log('AAU_REVIEWER_ENDPOINT_PROBE',JSON.stringify(fallback));
  })().catch(error=>console.error('AAU_REVIEWER_ENDPOINT_PROBE_FATAL',
    String(error?.message||error).slice(0,150)));
  return {started:true,frequency:'once_per_service_start',verdict_authority:false};
}
