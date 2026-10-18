// Prove interplay of Undici's header deadline vs a longer application abort.
// Loopback HTTP only; no credentials, Moonshot API traffic or charge.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {Agent,fetch as transportFetch} from 'undici';

async function delayedLoopbackResponse(ms,fn){
 const server=http.createServer((req,res)=>{
  res.on('error',()=>{});
  setTimeout(()=>{
   if(!res.headersSent&&!res.destroyed){
    res.writeHead(200,{'content-type':'application/json'});
    res.end('{"result":"success"}');
   }
  },ms).unref();
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 try{return await fn('http://127.0.0.1:'+server.address().port+'/test')}
 finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
 }
}
async function probe(url,{headersTimeout,applicationTimeoutMs}){
 const dispatcher=new Agent({connections:1,headersTimeout,bodyTimeout:1500});
 const ctrl=new AbortController();
 const started=performance.now();let deadlineFired=false,headerReceived=false;
 const timer=setTimeout(()=>{deadlineFired=true;ctrl.abort()},applicationTimeoutMs);
 try{
  const resp=await transportFetch(url,{dispatcher,signal:ctrl.signal});
  headerReceived=true;
  const result=await resp.json();
  return {status:'received',elapsedMs:Math.round(performance.now()-started),
   headerReceived,deadlineFired,result};
 }catch(e){
  return {status:'failed',exceptionName:e?.name??null,
   causeCode:e?.cause?.code??null,
   elapsedMs:Math.round(performance.now()-started),
   headerReceived,deadlineFired};
 }finally{
  clearTimeout(timer);
  await dispatcher.close();
 }
}
test('HTTP-client timeout ends request even though application still allows it',async()=>{
 await delayedLoopbackResponse(2400,async url=>{
  const result=await probe(url,{headersTimeout:700,applicationTimeoutMs:4000});
  assert.equal(result.status,'failed');
  assert.equal(result.causeCode,'UND_ERR_HEADERS_TIMEOUT');
  assert.equal(result.headerReceived,false);
  assert.equal(result.deadlineFired,false);
  assert.ok(result.elapsedMs<3400);
 });
});
test('larger header deadline lets same long-request complete without changing response',async()=>{
 await delayedLoopbackResponse(2400,async url=>{
  const result=await probe(url,{headersTimeout:3500,applicationTimeoutMs:4000});
  assert.equal(result.status,'received');
  assert.equal(result.headerReceived,true);
  assert.equal(result.deadlineFired,false);
  assert.deepEqual(result.result,{result:'success'});
 });
});
test('explicit application timeout remains authoritative below transport deadline',async()=>{
 await delayedLoopbackResponse(2400,async url=>{
  const result=await probe(url,{headersTimeout:3500,applicationTimeoutMs:600});
  assert.equal(result.status,'failed');
  assert.equal(result.deadlineFired,true);
  assert.equal(result.headerReceived,false);
  assert.notEqual(result.causeCode,'UND_ERR_HEADERS_TIMEOUT');
 });
});
