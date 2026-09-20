// One bounded synthetic endpoint probe at broker-bridge startup.
// Does not read agent data, affect expertise/product verdicts, or replay failed jobs.
// A successful short probe is connectivity evidence, NOT a completed independent review.
import { withReviewerNvidiaSlot } from './reviewer-nvidia-endpoint-gate.js';
const key = String(process.env.NVIDIA_API_KEY || '').trim();

async function probe(model, label) {
  const begun = Date.now();
  return withReviewerNvidiaSlot('startup_endpoint_probe', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const body = {
        model, messages: [
          {role:'system',content:'Return exactly the single token AAU_REVIEWER_ENDPOINT_OK. No explanation.'},
          {role:'user',content:'Connectivity probe only.'}
        ],max_tokens:64,temperature:0,stream:false
      };
      if (model.startsWith('nvidia/nemotron')) {
        body.chat_template_kwargs={enable_thinking:false};
      }
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
        signal:controller.signal,body:JSON.stringify(body)
      });
      const raw = await r.text();
      let parsed;
      try { parsed=JSON.parse(raw); } catch { parsed={}; }
      const txt=String(parsed?.choices?.[0]?.message?.content || '').trim();
      const ok=r.ok && txt.includes('AAU_REVIEWER_ENDPOINT_OK');
      return {label,model,status:ok?'reachable':'invalid_or_unavailable',http_status:r.status,
        elapsed_ms:Date.now()-begun,finish_reason:parsed?.choices?.[0]?.finish_reason || null,
        error_code:ok?null:String(parsed?.error?.code || parsed?.error?.message || 'unexpected_response').slice(0,110)};
    } catch(error) {
      return {label,model,status:'failed',elapsed_ms:Date.now()-begun,
        error_code:error?.name==='AbortError'?'probe_timeout':String(error?.message||error).slice(0,110)};
    } finally {clearTimeout(timer);}
  });
}

export function startReviewerEndpointSmoke() {
  if (!key) return {started:false,reason:'nvidia_key_missing'};
  void (async () => {
    const primary=await probe('moonshotai/kimi-k3','primary');
    console.log('AAU_REVIEWER_ENDPOINT_PROBE',JSON.stringify(primary));
    if (primary.status==='reachable') return;
    const fallback=await probe('nvidia/nemotron-3.5-lightning-30b-a3b','fallback');
    console.log('AAU_REVIEWER_ENDPOINT_PROBE',JSON.stringify(fallback));
  })().catch(error=>console.error('AAU_REVIEWER_ENDPOINT_PROBE_FATAL',
    String(error?.message||error).slice(0,150)));
  return {started:true,frequency:'once_per_service_start',verdict_authority:false};
}
