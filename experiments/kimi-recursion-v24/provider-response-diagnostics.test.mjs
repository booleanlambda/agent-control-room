import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectV28ProviderResponse,classifyV28ThrownError,inspectV28TransportFailure} from './provider-response-diagnostics.mjs';
const choice=(finish='stop',content='{"old":"one","replacement":"two"}')=>({choices:[{finish_reason:finish,message:{content}}],usage:{total_tokens:5263,prompt_tokens:400,completion_tokens:4863,completion_tokens_details:{reasoning_tokens:4500}}});
test('successful model response retains bounded non-sensitive accounting',()=>{
 const d=inspectV28ProviderResponse('repair_2',200,choice());
 assert.equal(d.category,'ACCEPTED');assert.equal(d.receipt.providerTokens,5263);
 assert.equal(d.receipt.finishReason,'stop');assert.equal(d.receipt.contentJson,'valid_object');
 assert.equal(Object.hasOwn(d.receipt,'answer'),false);
 assert.equal(Object.hasOwn(d.receipt,'reasoning_content'),false);
});
test('confirmed 32K thinking length is the only exhaustion-to-decomposition trigger',()=>{
 assert.equal(inspectV28ProviderResponse('repair_2',200,choice('length','{')).category,'THINKING_BUDGET_EXHAUSTED');
 assert.equal(inspectV28ProviderResponse('level_2',200,choice('length','{')).category,'OUTPUT_TRUNCATED_UNCONFIRMED_FALLBACK');
 assert.equal(inspectV28ProviderResponse('repair_2',503,choice('length','{')).category,'PROVIDER_HTTP_ERROR');
});
test('stop + malformed JSON is distinct from provider finish and HTTP errors',()=>{
 const d=inspectV28ProviderResponse('repair_2',200,choice('stop','{"old":'));
 assert.equal(d.category,'MALFORMED_MODEL_JSON');assert.equal(d.receipt.contentJson,'invalid');
 assert.equal(d.receipt.providerTokens,5263);assert.equal(d.receipt.finishReason,'stop');
 assert.equal(inspectV28ProviderResponse('repair_2',200,choice('tool_calls')).category,'PROVIDER_FINISH_INCOMPLETE');
 assert.equal(inspectV28ProviderResponse('repair_2',200,choice('stop','')).category,'EMPTY_MODEL_CONTENT');
 assert.equal(inspectV28ProviderResponse('repair_2',502,{}).category,'PROVIDER_HTTP_ERROR');
 assert.equal(inspectV28ProviderResponse('repair_2',200,null,false).category,'PROVIDER_BODY_NOT_JSON');
});
test('transport timeout, strange server fields and OFF unexpected reasoning classified safely',()=>{
 assert.equal(classifyV28ThrownError({name:'AbortError'}),'TRANSPORT_TIMEOUT_OR_ABORT');
 assert.equal(classifyV28ThrownError({name:'TypeError',message:'secret=123'}),'TRANSPORT_OR_CLIENT_ERROR');
 const d=inspectV28ProviderResponse('level_1',200,{choices:[{finish_reason:'stop',message:{content:'{}',reasoning_content:'PRIVATE'}}],usage:{total_tokens:10}});
 assert.equal(d.category,'MODEL_RESPONSE_CONTRACT_REJECTED');
 assert.equal(JSON.stringify(d.receipt).includes('PRIVATE'),false);
 assert.equal(inspectV28ProviderResponse('repair_2',200,{choices:[{finish_reason:'unsafe foo',message:{content:'{}'}}]}).receipt.finishReason,null);
});
test('live runner persists real classification tokens and finish reason before any manual hold',()=>{
 const src=readFileSync(new URL('./live.mjs',import.meta.url),'utf8');
 assert.match(src,/inspectV28ProviderResponse\(stage,res\.status,j,bodyParsed\)/);
 assert.match(src,/db\.finishCall\(run,stage,attempt,category\.toLowerCase\(\),/);
 assert.match(src,/outcome\?\.receipt\?\.providerTokens\?\?null,outcome\?\.receipt\?\.finishReason\?\?null/);
 assert.match(src,/report\.providerCallDiagnostics\.push/);
 assert.match(src,/const hold=new Error\('MODEL_REQUEST_MANUAL_HOLD'\)/);
 assert.match(src,/hold\.diagnostic=diagnostic/);
 assert.match(src,/providerDiagnostic:e\?\.diagnostic\|\|null/);
});

test('nested Undici header timeout classified without exposing credential-bearing message',()=>{
 const err=new TypeError('fetch failed: bearer private-key',{
  cause:Object.assign(new Error('socket private host'),{
   code:'UND_ERR_HEADERS_TIMEOUT',hostname:'private-provider'
  })
 });
 const d=inspectV28TransportFailure(err,{
  elapsedMs:319817,httpHeadersReceived:false,requestDeadlineFired:false
 });
 assert.deepEqual(d,{
  exceptionName:'TypeError',errorCode:null,causeCode:'UND_ERR_HEADERS_TIMEOUT',
  elapsedMs:319817,httpHeadersReceived:false,requestDeadlineFired:false,
  category:'TRANSPORT_TIMEOUT_OR_ABORT'
 });
 assert.equal(JSON.stringify(d).includes('private'),false);
 assert.equal(JSON.stringify(d).includes('bearer'),false);
 assert.equal(JSON.stringify(d).includes('host'),false);
});
test('connection reset, DNS failures and local deadline remain distinguishable',()=>{
 let d=inspectV28TransportFailure(Object.assign(new TypeError('private URL'),{
  cause:{code:'ECONNRESET',url:'https://secret.example'}
 }),{elapsedMs:254444});
 assert.equal(d.category,'TRANSPORT_OR_CLIENT_ERROR');
 assert.equal(d.causeCode,'ECONNRESET');
 assert.equal(d.httpHeadersReceived,false);
 d=inspectV28TransportFailure(Object.assign(new Error('DNS private'),{
  code:'EAI_AGAIN'
 }),{elapsedMs:5000});
 assert.equal(d.errorCode,'EAI_AGAIN');
 d=inspectV28TransportFailure(Object.assign(new Error('request deadline'),{
  code:'ABORT_ERR'
 }),{elapsedMs:720000,requestDeadlineFired:true,httpHeadersReceived:true});
 assert.equal(d.category,'TRANSPORT_TIMEOUT_OR_ABORT');
 assert.equal(d.requestDeadlineFired,true);
 assert.equal(d.httpHeadersReceived,true);
});
test('unrecognized exception names and error codes are not copied into evidence',()=>{
 const err={name:'PrivateVendorException: api_key=secret',code:'SOCKET private token',
  cause:{code:'private_token_billing'},stack:'SECRET STACK',message:'SECRET URL'};
 const d=inspectV28TransportFailure(err,{elapsedMs:-1000,httpHeadersReceived:'true',
  requestDeadlineFired:'true'});
 assert.deepEqual(d,{
  exceptionName:'OTHER_ERROR',errorCode:null,causeCode:null,
  elapsedMs:null,httpHeadersReceived:false,requestDeadlineFired:false,
  category:'TRANSPORT_OR_CLIENT_ERROR'
 });
 assert.equal(JSON.stringify(d).includes('SECRET'),false);
 assert.equal(JSON.stringify(d).includes('private_token'),false);
});
test('runner binds elapsed clock, header observation and allowlisted code into durable hold event',()=>{
 const src=readFileSync(new URL('./live.mjs',import.meta.url),'utf8');
 assert.match(src,/requestDeadlineFired=true;ctrl\.abort\(\)/);
 assert.match(src,/if\(!providerResponseSettled\)\{requestDeadlineFired=true;ctrl\.abort\(\)\}/);
 assert.match(src,/providerResponseSettled=true;clearTimeout\(timer\)/);
 assert.match(src,/httpHeadersReceived=true;/);
 assert.match(src,/inspectV28TransportFailure\(e,\{/);
 assert.match(src,/elapsedMs:Date\.now\(\)-lastStart,httpHeadersReceived,requestDeadlineFired/);
 assert.match(src,/causeCode:transport\.causeCode/);
 assert.match(src,/requestDeadlineFired:transport\.requestDeadlineFired/);
 assert.match(src,/providerDiagnostic:e\?\.diagnostic\|\|null/);
 assert.match(src,/ledgerWriteFailed:!ledgerPersisted/);
 assert.match(src,/await db\.advance\(run,before\.seq,before\.next_phase,next\.phase,next\.status,next\.state,next\.event\)/);
 assert.doesNotMatch(src,/message:\s*e\.message\s*,\s*stack/);
});

test('thinking-ON separates private reasoning_content from final JSON',()=>{
 const d=inspectV28ProviderResponse('repair_2',200,{
  choices:[{finish_reason:'stop',message:{
   reasoning_content:'PRIVATE_THOUGHTS_SECRET_CANARY',
   content:'{"result":{"edits":[{"find":"original","replace":"fixed"}]},"status":"ok"}'
  }}],
  usage:{total_tokens:890,prompt_tokens:190,completion_tokens:700,
   completion_tokens_details:{reasoning_tokens:610}}
 });
 assert.equal(d.category,'ACCEPTED');
 assert.equal(d.receipt.thinkingOn,true);
 assert.equal(d.receipt.reasoningPresent,true);
 assert.equal(d.receipt.finalContentKind,'string');
 assert.deepEqual(d.receipt.finalJsonKeys,['result','status']);
 assert.equal(d.receipt.reasoningTokens,610);
 assert.equal(JSON.stringify(d.receipt).includes('PRIVATE_THOUGHTS'),false);
 assert.equal(JSON.stringify(d.answer).includes('PRIVATE_THOUGHTS'),false);
});
test('thinking-ON stop with missing final answer does not interpret reasoning as JSON',()=>{
 const d=inspectV28ProviderResponse('repair_2',200,{
  choices:[{finish_reason:'stop',message:{reasoning_content:'{"patch":"fake"}',content:null}}],
  usage:{total_tokens:999}
 });
 assert.equal(d.category,'EMPTY_MODEL_CONTENT');
 assert.equal(d.receipt.reasoningPresent,true);
 assert.equal(d.receipt.finalContentKind,'null');
 assert.deepEqual(d.receipt.finalJsonKeys,[]);
 assert.equal(d.receipt.providerTokens,999);
});
test('thinking-ON length with malformed or absent final content is budget exhaustion, not JSON failure',()=>{
 for(const content of [null,'{"unfinished":','']){
  const d=inspectV28ProviderResponse('repair_2',200,{
   choices:[{finish_reason:'length',message:{reasoning_content:'private trace',content}}],
   usage:{total_tokens:32768,completion_tokens:32768}
  });
  assert.equal(d.category,'THINKING_BUDGET_EXHAUSTED');
  assert.equal(d.receipt.finishReason,'length');
  assert.equal(d.receipt.providerTokens,32768);
  assert.equal(JSON.stringify(d.receipt).includes('private trace'),false);
 }
});
test('thinking-ON nontext final content is distinguished from legitimate JSON object',()=>{
 const d=inspectV28ProviderResponse('repair_2',200,{
  choices:[{finish_reason:'stop',message:{reasoning_content:'secret',content:[{type:'text',text:'{"valid":true}'}]}}],
  usage:{total_tokens:211}
 });
 assert.equal(d.category,'EMPTY_MODEL_CONTENT');
 assert.equal(d.receipt.finalContentKind,'array');
 assert.equal(d.receipt.providerTokens,211);
});
test('thinking-OFF receipts do not gain thinking-ON structural metadata',()=>{
 const d=inspectV28ProviderResponse('level_0',200,choice());
 assert.equal(d.category,'ACCEPTED');
 assert.equal(d.receipt.thinkingOn,false);
 assert.equal(d.receipt.reasoningPresent,false);
 assert.equal(d.receipt.finalContentKind,null);
 assert.deepEqual(d.receipt.finalJsonKeys,[]);
});
