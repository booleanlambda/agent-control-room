// Isolated provider preflight. Uses the user's newly supplied GitHub Actions
// MOONSHOT_API_KEY (alias MOONSHOT_APIKEY) without printing its contents.
const KEY=String(process.env.MOONSHOT_API_KEY||process.env.MOONSHOT_APIKEY||'').trim();
const ENDPOINT=String(process.env.MOONSHOT_ENDPOINT||'https://api.moonshot.ai/v1')
  .replace(/\/+$/,'').replace(/\/chat\/completions$/,'')+'/chat/completions';
if(!KEY){console.log('MOONSHOT_K26_PREFLIGHT=missing_api_key');process.exit(3);}
const ctl=new AbortController();const timeout=setTimeout(()=>ctl.abort(),60000);
try{
  const started=Date.now();
  const r=await fetch(ENDPOINT,{method:'POST',
    headers:{authorization:'Bearer '+KEY,'content-type':'application/json',accept:'application/json'},
    signal:ctl.signal,
    body:JSON.stringify({model:'kimi-k2.6',stream:false,max_tokens:128,
      temperature:0.6,response_format:{type:'json_object'},thinking:{type:'disabled'},
      messages:[{role:'system',content:'Return only valid JSON. No commentary.'},
        {role:'user',content:'Return this exact object: {"probe":"KIMI26_NO_THINK_OK"}'}]})
  });
  if(!r.ok){
    let detail='';try{const j=await r.json();detail=String(j?.error?.type||j?.error?.code||'').slice(0,80)}catch{}
    console.log('MOONSHOT_K26_PREFLIGHT='+JSON.stringify({ok:false,http:r.status,errorType:detail}));
    process.exitCode=2;
  }else{
    const body=await r.json(),msg=body?.choices?.[0]?.message||{};
    const parsed=JSON.parse(String(msg.content||''));
    const passed=parsed?.probe==='KIMI26_NO_THINK_OK' &&
      !String(msg.reasoning_content||'').trim()&&body?.choices?.[0]?.finish_reason==='stop';
    const usage=body?.usage||{};
    console.log('MOONSHOT_K26_PREFLIGHT='+JSON.stringify({ok:passed,
      returnedModel:body?.model||null,finish:body?.choices?.[0]?.finish_reason||null,
      reasoningContentPresent:Boolean(String(msg.reasoning_content||'').trim()),
      usage:{prompt:usage.prompt_tokens??null,completion:usage.completion_tokens??null},
      latencyMs:Date.now()-started}));
    if(!passed)process.exitCode=2;
  }
}catch(error){
  console.log('MOONSHOT_K26_PREFLIGHT='+JSON.stringify({ok:false,
    failure:error?.name==='AbortError'?'timeout':String(error?.name||'network_error').slice(0,80)}));
  process.exitCode=2;
}finally{clearTimeout(timeout);}
