// Read-only batch/files access probe. No POST, no inference, no uploads.
const key=String(process.env.MOONSHOT_API_KEY||'').trim();
if(!key)throw Error('MOONSHOT_KEY_MISSING');
const base='https://api.moonshot.ai/v1';
const results=[];
for(const endpoint of ['/models','/files?limit=1','/batches?limit=1']){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),15000);
  try{
    const r=await fetch(base+endpoint,{headers:{
      authorization:'Bearer '+key,accept:'application/json'},signal:c.signal});
    let b={};try{b=await r.json()}catch{}
    const error=b?.error||b;
    const detail=String(error?.message||'')
      .replace(/org[-_][\w-]+/ig,'[org]')
      .replace(/ak[-_][\w-]+/ig,'[key]')
      .replace(/[A-F0-9]{20,}/gi,'[identifier]').slice(0,230);
    results.push({endpoint:endpoint.split('?')[0],status:r.status,
      errorType:String(error?.type||error?.code||'').slice(0,75),
      errorDetail:!r.ok?detail:null,
      returnedItems:Array.isArray(b?.data)?b.data.length:null});
  }catch(e){results.push({endpoint,status:null,error:String(e?.name||'network')});}
  finally{clearTimeout(timer);}
}
console.log('MOONSHOT_READONLY_BATCH_ACCESS='+JSON.stringify(results));
