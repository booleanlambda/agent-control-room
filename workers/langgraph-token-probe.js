const token=String(process.env.LANGGRAPH_TOKEN||'').trim();

export async function probeLangGraphToken(){
  if(!token){
    console.log('AAU_LANGGRAPH_TOKEN_PROBE',JSON.stringify({present:false,ok:false,reason:'missing'}));
    return {present:false,ok:false,reason:'missing'};
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch('https://api.smith.langchain.com/sessions?limit=1',{
      method:'GET',
      headers:{
        'X-API-Key':token,
        'Accept':'application/json',
        'User-Agent':'AAU-LangGraph-Token-Probe/0.1'
      },
      signal:controller.signal
    });
    let body='';
    try{body=await r.text();}catch{}
    const parsed=(()=>{try{return JSON.parse(body)}catch{return null}})();
    const result={
      present:true,
      ok:r.ok,
      http_status:r.status,
      endpoint_host:'api.smith.langchain.com',
      response_kind:Array.isArray(parsed)?'array':(parsed&&typeof parsed==='object'?'object':'text'),
      response_count:Array.isArray(parsed)?parsed.length:null,
      auth_test:'read_only_list_sessions_limit_1'
    };
    console.log('AAU_LANGGRAPH_TOKEN_PROBE',JSON.stringify(result));
    return result;
  }catch(e){
    const result={
      present:true,ok:false,
      reason:e?.name==='AbortError'?'timeout':'request_error',
      error:String(e?.message||e).slice(0,300),
      endpoint_host:'api.smith.langchain.com'
    };
    console.log('AAU_LANGGRAPH_TOKEN_PROBE',JSON.stringify(result));
    return result;
  }finally{
    clearTimeout(timeout);
  }
}
