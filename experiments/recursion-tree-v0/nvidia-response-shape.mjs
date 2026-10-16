// Second and final bounded NVIDIA diagnostic. One *new* small probe only,
// never a duplicate of an earlier request. Logs shape, never generated content.
import {writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const digest=x=>createHash('sha256').update(String(x||'')).digest('hex');
const key=String(process.env.NVIDIA_API_KEY||'').trim();
const out={provider:'nvidia-nim-chat',model:'nvidia/nemotron-3.5-lightning-30b-a3b',
  generationLimit:1,requestIdempotencyVerified:false,retrievalVerified:false};
const base='https://integrate.api.nvidia.com/v1';
async function call(path,opts,ms=60000){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),ms);
  try{
    const r=await fetch(base+path,{...opts,signal:ctl.signal,redirect:'manual'});
    let b=null;try{b=await r.json()}catch{}
    return {http:r.status,body:b,headerNames:[...r.headers.keys()]
      .filter(x=>/^(x-request-id|request-id|x-nv-request-id|traceparent)$/i.test(x))};
  }finally{clearTimeout(timer)}
}
try{
  if(!key){out.error='github_key_missing';}
  else{
    const r=await call('/chat/completions',{
      method:'POST',
      headers:{authorization:'Bearer '+key,'content-type':'application/json'},
      body:JSON.stringify({model:out.model,stream:false,max_tokens:160,
        temperature:0,messages:[{role:'user',content:
          'Say one short sentence confirming this test: '+randomUUID().slice(0,8)}]}),
    });
    const b=r.body||{},choice=b.choices?.[0]||{},message=choice.message||{};
    out.http=r.http;
    out.responseShape={topKeys:Object.keys(b).slice(0,28),
      idPresent:typeof b.id==='string'&&b.id.length>0,
      idType:typeof b.id,choicesCount:Array.isArray(b.choices)?b.choices.length:null,
      choiceKeys:Object.keys(choice),messageKeys:Object.keys(message),
      contentType:typeof message.content,contentLength:
        typeof message.content==='string'?message.content.length:null,
      finishReason:choice.finish_reason||null,
      usageTotal:b.usage?.total_tokens||null,
      requestHeaderNames:r.headerNames,
      responseIdDigest:typeof b.id==='string'?digest(b.id):null};
    if(typeof b.id==='string'&&b.id){
      for(const path of ['/chat/completions/'+encodeURIComponent(b.id),
        '/responses/'+encodeURIComponent(b.id)]){
        const got=await call(path,{
          method:'GET',headers:{authorization:'Bearer '+key,accept:'application/json'},
        },16000);
        const sameId=got.body?.id===b.id;
        const sameContent=typeof message.content==='string'&&
          got.body?.choices?.[0]?.message?.content===message.content;
        out.probes??=[];
        out.probes.push({kind:path.startsWith('/responses')?'get_response':'get_completion',
          status:got.http,sameId,sameContent});
        if(got.http===200&&sameId&&sameContent)out.retrievalVerified=true;
      }
    }
  }
}catch(e){out.error=String(e.name||'transport_error').slice(0,50)}
writeFileSync('nvidia-response-shape-report.json',JSON.stringify(out,null,2)+'\n');
console.log('NVIDIA_RESPONSE_SHAPE_RESULT='+JSON.stringify(out));
