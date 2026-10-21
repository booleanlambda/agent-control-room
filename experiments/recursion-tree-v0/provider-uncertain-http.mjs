// Disposable-only external provider emulator. This simulates HTTP execution
// and account-side billing, NOT a real remote provider or actual USD billing.
import {createServer} from 'node:http';
import {lightModelDouble,deepConfig} from './depth10-traversability.mjs';

export function startProvider({port=0}={}){
  const entries=new Map(),requests=[];
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const route=url.pathname;
    function send(status,data){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));}
    if(req.method==='POST'&&route==='/v1/complete'){
      let raw='';for await(const part of req)raw+=part;
      let body;try{body=JSON.parse(raw)}catch{return send(400,{error:'invalid_json'})}
      const id=String(req.headers['idempotency-key']||'');
      if(!/^aau-ci-(?:recoverable|opaque)-R$/.test(id))return send(400,{error:'invalid_request_id'});
      const model='recorded-kimi-equivalent-root';
      const existing=entries.get(id);
      if(existing){
        requests.push({kind:'repeat_post',id});
        return send(200,{response:existing.response,request_id:id,chargedNew:false,model});
      }
      const answer=await lightModelDouble({path:'R',depth:0,start:0,end:11},
        deepConfig('spine',55000));
      entries.set(id,{response:answer,id,chargeCount:1});
      requests.push({kind:'new_post',id});
      return send(200,{response:answer,request_id:id,chargedNew:true,model});
    }
    if(req.method==='GET'&&route.startsWith('/v1/responses/')){
      const id=decodeURIComponent(route.slice('/v1/responses/'.length));
      requests.push({kind:'lookup',id});
      if(!id.startsWith('aau-ci-recoverable-'))
        return send(404,{error:'lookup_not_supported'});
      const entry=entries.get(id);
      if(!entry)return send(404,{error:'not_found'});
      return send(200,{request_id:id,response:entry.response,chargedNew:false});
    }
    return send(404,{error:'route_not_found'});
  });
  server.on('error',()=>{});
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>resolve({
      endpoint:'http://127.0.0.1:'+server.address().port,
      requests,entries,
      stats:()=>({postRequests:requests.filter(x=>x.kind.endsWith('post')).length,
        newChargedExecutions:requests.filter(x=>x.kind==='new_post').length,
        lookups:requests.filter(x=>x.kind==='lookup').length,
        requests:structuredClone(requests),
        accountCharges:Object.fromEntries([...entries].map(([id,x])=>[id,x.chargeCount]))}),
      close:()=>new Promise(done=>server.close(done)),
    }));
  });
}
