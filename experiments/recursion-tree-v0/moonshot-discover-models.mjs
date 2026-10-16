// Read-only credential-scoped model discovery; never prints an API key.
const key=String(process.env.MOONSHOT_API_KEY||process.env.MOONSHOT_APIKEY||'').trim();
if(!key){console.log('MOONSHOT_MODELS=missing_key');process.exit(3);}
const base=String(process.env.MOONSHOT_ENDPOINT||'https://api.moonshot.ai/v1')
  .replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
let host='';try{host=new URL(base).host}catch{}
const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),30000);
try{
 const r=await fetch(base+'/models',{headers:{authorization:'Bearer '+key,accept:'application/json'},signal:ctl.signal});
 let response={};try{response=await r.json()}catch{}
 const ids=Array.isArray(response?.data)?response.data.map(x=>String(x?.id||'')).filter(Boolean):[];
 const available=ids.filter(x=>/kimi/i.test(x)).slice(0,50);
 const error=response?.error||{};
 console.log('MOONSHOT_MODELS='+JSON.stringify({host,status:r.status,modelCount:ids.length,
   kimiModels:available,errorType:String(error?.type||error?.code||'').slice(0,70),
   errorMessage:String(error?.message||'').slice(0,180)}));
 if(!r.ok||!ids.length)process.exitCode=2;
}catch(e){console.log('MOONSHOT_MODELS='+JSON.stringify({host,exception:String(e.name||'request_failed')}));process.exitCode=2;}
finally{clearTimeout(timeout);}
