import { PRECISION_SPEC_SCHEMA, validatePrecisionSpec } from './precision-engineer.js';

export const PRECISION_LOCAL_MODEL_PROTOCOL='aau.precision_local_model.v0_1';

export const PRECISION_ENGINEER_SYSTEM_PROMPT=`
You are AAU Precision Engineer. Convert a quantitative request into a strict executable specification.
You DO NOT make arithmetic authoritative. Deterministic local tools verify every material numeric claim.
Never invent missing numeric assumptions. Put unresolved facts in missing_information.
Every arithmetic material result requires its own arithmetic_checks item with: id, expression, claimed_result, unit.
For statistical work use only supported statistical_analyses.
Return JSON only, schema "${PRECISION_SPEC_SCHEMA}".
`.trim();

function assertLoopbackEndpoint(endpoint){
  const url=new URL(String(endpoint||''));
  const host=url.hostname.toLowerCase();
  const loopback=host==='localhost'||host==='127.0.0.1'||host==='::1'||host==='[::1]';
  if(!loopback) throw new Error('precision_local_model_endpoint_must_be_loopback');
  if(!['http:','https:'].includes(url.protocol)) throw new Error('precision_local_model_protocol_invalid');
  return url;
}

function extractJson(text){
  const raw=String(text||'').trim();
  if(!raw) throw new Error('precision_local_model_empty_response');
  try{return JSON.parse(raw);}catch{}
  const first=raw.indexOf('{'),last=raw.lastIndexOf('}');
  if(first>=0&&last>first) return JSON.parse(raw.slice(first,last+1));
  throw new Error('precision_local_model_invalid_json');
}

export function validateLocalPrecisionEndpoint(endpoint){
  const url=assertLoopbackEndpoint(endpoint);
  return {ok:true,endpoint:url.toString(),host:url.hostname};
}

export async function planPrecisionSpecLocal({
  endpoint='http://127.0.0.1:11434/api/generate',
  model,
  request,
  protocol='ollama',
  timeoutMs=60000,
  fetchImpl=globalThis.fetch,
}={}){
  if(typeof fetchImpl!=='function') throw new Error('precision_local_model_fetch_unavailable');
  const url=assertLoopbackEndpoint(endpoint);
  if(!String(model||'').trim()) throw new Error('precision_local_model_name_required');
  if(!String(request||'').trim()) throw new Error('precision_request_required');

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||60000));
  try{
    let body;
    if(protocol==='ollama'){
      body={
        model:String(model),
        stream:false,
        format:'json',
        prompt:PRECISION_ENGINEER_SYSTEM_PROMPT+'\n\nREQUEST:\n'+String(request),
      };
    }else if(protocol==='openai_compatible'){
      body={
        model:String(model),
        temperature:0,
        messages:[
          {role:'system',content:PRECISION_ENGINEER_SYSTEM_PROMPT},
          {role:'user',content:String(request)},
        ],
      };
    }else{
      throw new Error('precision_local_model_protocol_unsupported');
    }

    const response=await fetchImpl(url,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(body),
      signal:controller.signal,
    });
    if(!response.ok) throw new Error('precision_local_model_http_'+response.status);
    const payload=await response.json();
    const raw=protocol==='ollama'
      ?payload?.response
      :payload?.choices?.[0]?.message?.content;
    const spec=extractJson(raw);
    const validation=validatePrecisionSpec(spec);
    if(!validation.ok){
      const error=new Error('precision_local_model_spec_invalid');
      error.validation_failures=validation.failures;
      throw error;
    }
    return {ok:true,protocol:PRECISION_LOCAL_MODEL_PROTOCOL,model:String(model),spec};
  }finally{
    clearTimeout(timer);
  }
}
