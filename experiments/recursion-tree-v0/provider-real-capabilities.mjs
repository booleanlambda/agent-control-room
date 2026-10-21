// One *bounded* inference per configured provider; non-mutating retrieval
// probes only. Never POST the same request twice and never leak API keys,
// header values, model output or provider request IDs in CI.
import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {VERIFIED_CAPABILITIES} from './provider-recovery-policy.mjs';
const digest=x=>createHash('sha256').update(String(x||'')).digest('hex');
const report={experiment:'external_result_retrieval_contract_v1',
  purpose:'Can a completed synchronous inference be retrieved, not merely traced?',
  time:new Date().toISOString(),newGenerationRequestsCap:2,
  providers:[],policy:VERIFIED_CAPABILITIES};
const configs=[
  {name:'moonshot-chat',base:'https://api.moonshot.ai/v1',
    key:String(process.env.MOONSHOT_API_KEY||'').trim(),
    model:'kimi-k2.6',
    extra:{thinking:{type:'disabled'},temperature:0.6}},
  {name:'nvidia-nim-chat',base:'https://integrate.api.nvidia.com/v1',
    key:String(process.env.NVIDIA_API_KEY||'').trim(),
    model:'nvidia/nemotron-3.5-lightning-30b-a3b',
    extra:{temperature:0}},
];
const onlyHeaderNames=new Set(['x-request-id','x-correlation-id',
  'request-id','traceparent','x-nv-request-id','idempotency-key']);
async function controlledFetch(url,opts={},timeoutMs=65000){
  const ctl=new AbortController();
  const clock=setTimeout(()=>ctl.abort(),timeoutMs);
  const started=Date.now();
  try{
    const r=await fetch(url,{...opts,signal:ctl.signal,redirect:'manual'});
    let data=null;
    const raw=(await r.text()).slice(0,100000);
    try{data=JSON.parse(raw)}catch{}
    return {status:r.status,elapsedMs:Date.now()-started,
      data,headerNames:[...r.headers.keys()].filter(k=>onlyHeaderNames.has(k.toLowerCase()))};
  }finally{clearTimeout(clock)}
}
function assessedFetch(r,expectedId,originalDigest){
  const actual=typeof r.data?.choices?.[0]?.message?.content==='string'?
    digest(r.data.choices[0].message.content):null;
  return {status:r.status,headerNames:r.headerNames||[],
    returnedMatchingCompletionId:!!expectedId&&r.data?.id===expectedId,
    returnedMatchingOriginalContent:!!actual&&actual===originalDigest,
    contentPresent:!!actual,networkError:r.error||null};
}
const safeName=e=>String(e?.name||'transport_error').slice(0,70);
for(const c of configs){
  const out={name:c.name,model:c.model,keyAvailable:!!c.key,
    generationAttempted:false,generationSucceeded:false,
    generationStatus:null,actualTokens:null,responseIdDigest:null,
    headersOnCreation:[],probes:[],verifiedRetrieval:false,
    guaranteeStatus:'no_documented_enforced_guarantee',
    exactlyOncePaidInferenceProven:false};
  report.providers.push(out);
  if(!c.key){out.error='github_secret_missing';continue}
  const nonce=randomUUID();
  const payload={model:c.model,stream:false,max_tokens:48,
    messages:[{role:'user',content:'Respond with exactly the text AAU_OK_'+nonce.slice(0,8)}],
    ...c.extra};
  let created=null;
  out.generationAttempted=true;
  try{
    created=await controlledFetch(c.base+'/chat/completions',{
      method:'POST',
      headers:{authorization:'Bearer '+c.key,'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify(payload),
    });
    out.generationStatus=created.status;
    out.headersOnCreation=created.headerNames;
    out.generationSucceeded=created.status===200&&
      typeof created.data?.id==='string'&&
      typeof created.data?.choices?.[0]?.message?.content==='string';
    out.actualTokens=Number.isFinite(created.data?.usage?.total_tokens)?
      created.data.usage.total_tokens:null;
    if(!out.generationSucceeded){
      out.errorType=String(created.data?.error?.type||created.data?.error?.code||'').slice(0,70);
    }
  }catch(e){out.error=safeName(e)}
  if(!out.generationSucceeded)continue;
  const id=created.data.id,bodyDigest=digest(created.data.choices[0].message.content);
  out.responseIdDigest=digest(id);
  // A ChatCompletion ID may be just an identifier in a returned envelope.
  // GET-by-ID is a read-only probe, NOT a guarantee until the exact original
  // content and documentation on retrieval semantics are both established.
  const urls=[
    {kind:'get_chat_completion_by_id',url:c.base+'/chat/completions/'+encodeURIComponent(id)},
    {kind:'get_response_by_chat_completion_id',url:c.base+'/responses/'+encodeURIComponent(id)},
  ];
  for(const u of urls){
    let got;
    try{
      got=await controlledFetch(u.url,{method:'GET',
        headers:{authorization:'Bearer '+c.key,accept:'application/json'}},16000);
      out.probes.push({kind:u.kind,...assessedFetch(got,id,bodyDigest)});
    }catch(e){
      out.probes.push({kind:u.kind,status:null,networkError:safeName(e)});
    }
  }
  out.verifiedRetrieval=out.probes.some(p=>
    p.status===200&&p.returnedMatchingCompletionId&&p.returnedMatchingOriginalContent);
  // Empirical retrieval alone is still not proof of idempotent POST,
  // retention or billing guarantees; permanent production flags remain false.
}
writeFileSync('provider-real-capabilities-report.json',JSON.stringify(report,null,2)+'\n');
console.log('EXTERNAL_PROVIDER_CAPABILITY_RESULT='+JSON.stringify(report));
