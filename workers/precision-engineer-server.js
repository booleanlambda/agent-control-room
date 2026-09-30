#!/usr/bin/env node
import http from 'node:http';
import {
  executePrecisionSpec,
  getPrecisionCapabilities,
  PRECISION_ENGINEER_VERSION,
} from './precision-engineer.js';

const MAX_BODY_BYTES=1024*1024;
const host=String(process.env.PRECISION_ENGINEER_HOST||'127.0.0.1').trim();
const port=Number(process.env.PRECISION_ENGINEER_PORT||47821);

if(!['127.0.0.1','localhost','::1'].includes(host)){
  throw new Error('precision_engineer_server_must_bind_loopback');
}
if(!Number.isInteger(port)||port<1||port>65535){
  throw new Error('precision_engineer_server_port_invalid');
}

function send(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body)});
  res.end(body);
}

async function readJson(req){
  let size=0;
  const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_BODY_BYTES) throw new Error('precision_request_body_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='GET' && req.url==='/health'){
      return send(res,200,{
        ok:true,
        service:'AAU Precision Engineer',
        engine:PRECISION_ENGINEER_VERSION,
        architecture:'agent_to_deterministic_substrate_to_agent',
        secondary_model_required:false,
        offline_boundary:'loopback_only',
      });
    }

    if(req.method==='GET' && req.url==='/v1/capabilities'){
      return send(res,200,getPrecisionCapabilities());
    }

    if(req.method==='POST' && req.url==='/v1/execute'){
      const spec=await readJson(req);
      const result=executePrecisionSpec(spec);
      return send(res,result.status==='VERIFIED'?200:result.status==='RECONCILE'?409:422,result);
    }

    return send(res,404,{ok:false,error:'precision_route_not_found'});
  }catch(error){
    return send(res,500,{
      ok:false,
      engine:PRECISION_ENGINEER_VERSION,
      error:String(error?.message||error).slice(0,500),
    });
  }
});

server.listen(port,host,()=>{
  console.log('AAU_PRECISION_ENGINEER_LISTENING',JSON.stringify({
    ok:true,
    host,
    port,
    engine:PRECISION_ENGINEER_VERSION,
    architecture:'agent_to_deterministic_substrate_to_agent',
    secondary_model_required:false,
    offline_boundary:'loopback_only',
  }));
});
