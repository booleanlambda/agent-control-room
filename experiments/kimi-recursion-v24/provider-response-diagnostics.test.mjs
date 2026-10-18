import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectV28ProviderResponse,classifyV28ThrownError} from './provider-response-diagnostics.mjs';
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
 assert.match(src,/throw Error\('MODEL_REQUEST_MANUAL_HOLD'\)/);
});
