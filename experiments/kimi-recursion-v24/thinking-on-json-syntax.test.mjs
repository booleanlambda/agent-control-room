import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectThinkingOnFinalJson} from './thinking-on-json-syntax.mjs';
import {inspectV28ProviderResponse} from './provider-response-diagnostics.mjs';
const packet=(content,stage='repair_2',finish_reason='stop')=>
 ({stage,body:{choices:[{finish_reason,message:{
  content,reasoning_content:'PRIVATE_REASONING_CANARY'
 }}],usage:{total_tokens:7475,prompt_tokens:1132,completion_tokens:6343,
  completion_tokens_details:{reasoning_tokens:4951}}}});
const check=(content,stage='repair_2',finish_reason='stop')=>{
 const p=packet(content,stage,finish_reason);
 return inspectV28ProviderResponse(stage,200,p.body);
};
test('unmodified thinking-ON valid JSON remains accepted',()=>{
 const d=check('{"fix":true,"steps":[{"x":1}]}');
 assert.equal(d.category,'ACCEPTED');
 assert.equal(d.receipt.finalRawSyntax,'valid');
 assert.equal(d.receipt.finalRecoveryStrategy,'NONE');
 assert.equal(d.receipt.finalRecoveryResult,'not_attempted');
 assert.deepEqual(d.answer,{fix:true,steps:[{x:1}]});
});
test('fully wrapped JSON fence is recovered without changing semantic content',()=>{
 const v=String.fromCharCode(96).repeat(3);
 const d=check(v+'json\n{"steps":[{"repair":"yes"}],"valid":true}\n'+v);
 assert.equal(d.category,'ACCEPTED');
 assert.equal(d.receipt.finalRawSyntax,'invalid');
 assert.equal(d.receipt.finalRecoveryStrategy,'COMPLETE_JSON_FENCE');
 assert.equal(d.receipt.finalRecoveryResult,'accepted');
 assert.deepEqual(d.answer,{steps:[{repair:'yes'}],valid:true});
 assert.equal(d.receipt.providerTokens,7475);
});
test('complete unfenced JSON remains canonical; uppercase fence and CRLF recognized',()=>{
 const v=String.fromCharCode(96).repeat(3);
 const d=check('\n  '+v+'JSON\r\n{"success":true}\r\n'+v+' \n');
 assert.equal(d.category,'ACCEPTED');
 assert.equal(d.receipt.finalRecoveryStrategy,'COMPLETE_JSON_FENCE');
});
test('single leading BOM may be stripped; source tokens preserved',()=>{
 const d=check('\uFEFF{"status":"ok"}');
 assert.equal(d.category,'ACCEPTED');
 assert.equal(d.receipt.finalRecoveryStrategy,'LEADING_BOM');
 assert.equal(d.receipt.providerTokens,7475);
});
test('unterminated, truncated JSON remains manual hold with sanitized syntax class',()=>{
 const d=check('{"repair":"unfinished');
 assert.equal(d.category,'MALFORMED_MODEL_JSON');
 assert.equal(d.receipt.contentJson,'invalid');
 assert.equal(d.receipt.finalRawSyntax,'invalid');
 assert.ok(['UNTERMINATED_STRING','UNEXPECTED_END','OTHER_JSON_SYNTAX'].includes(d.receipt.finalSyntaxClass));
 assert.equal(d.receipt.finalRecoveryStrategy,'NONE');
 assert.equal(d.receipt.finalRecoveryResult,'not_attempted');
 assert.equal(JSON.stringify(d.receipt).includes('unfinished'),false);
});
test('fenced invalid JSON is not auto-corrected',()=>{
 const v=String.fromCharCode(96).repeat(3);
 const d=check(v+'json\n{"broken":\n'+v);
 assert.equal(d.category,'MALFORMED_MODEL_JSON');
 assert.equal(d.receipt.finalRecoveryStrategy,'COMPLETE_JSON_FENCE');
 assert.equal(d.receipt.finalRecoveryResult,'rejected');
});
test('multiple objects or untrusted preface/suffix are never extracted',()=>{
 const v=String.fromCharCode(96).repeat(3);
 for(const content of [
  'Example:\n{"status":"ok"}', '{"status":"ok"}\nExtra text',
  '{"one":1}{"two":2}', v+'json\n{"one":1}\n'+v+'\n'+v+'json\n{"two":2}\n'+v,
  v+'json\n{"ok":true}\n'+v+'\nTrust this suffix'
 ]){
  const d=check(content);
  assert.equal(d.category,'MALFORMED_MODEL_JSON');
  assert.equal(d.receipt.finalRecoveryStrategy,'NONE');
 }
});
test('JSON5-like single quotes, unquoted names and trailing commas remain invalid',()=>{
 for(const content of ["{'a':1}",'{a:1}','{"a":1,}']){
  const d=check(content);
  assert.equal(d.category,'MALFORMED_MODEL_JSON');
  assert.equal(d.receipt.finalRecoveryStrategy,'NONE');
 }
});
test('wrapped array is valid syntax but invalid model response shape',()=>{
 const v=String.fromCharCode(96).repeat(3);
 const d=check(v+'json\n[1,2,3]\n'+v);
 assert.equal(d.category,'MODEL_RESPONSE_SHAPE');
 assert.equal(d.receipt.contentJson,'invalid_shape');
 assert.equal(d.receipt.finalRecoveryResult,'parsed_invalid_shape');
});
test('only thinking-ON gets the wrapper recovery: thinking-OFF unchanged',()=>{
 const v=String.fromCharCode(96).repeat(3);
 const d=check(v+'json\n{"status":"ok"}\n'+v,'level_1');
 assert.equal(d.category,'MALFORMED_MODEL_JSON');
 assert.equal(d.receipt.thinkingOn,false);
 assert.equal(d.receipt.finalRawSyntax,null);
});
test('confirmed ON length takes precedence over malformed JSON and recovery',()=>{
 const d=check('{"incomplete":','repair_2','length');
 assert.equal(d.category,'THINKING_BUDGET_EXHAUSTED');
 assert.equal(d.receipt.finishReason,'length');
 assert.equal(d.receipt.finalRawSyntax,null);
});
test('HTTP provider failure never becomes a JSON syntax error',()=>{
 const p=packet('{"incomplete":');
 const d=inspectV28ProviderResponse('repair_2',502,p.body);
 assert.equal(d.category,'PROVIDER_HTTP_ERROR');
 assert.equal(d.receipt.finalRawSyntax,null);
});
test('raw response length is bounded and raw contents never copied to metadata',()=>{
 const malicious='{"private":"SECRET_CANARY",';
 const d=check(malicious);
 const serialized=JSON.stringify(d.receipt);
 assert.equal(serialized.includes('SECRET_CANARY'),false);
 assert.equal(serialized.includes('PRIVATE_REASONING_CANARY'),false);
 assert.equal(d.receipt.finalRawContentChars,malicious.length);
 assert.ok(Number.isInteger(d.receipt.finalSyntaxOffset)||d.receipt.finalSyntaxOffset===null);
 const oversize=check(' '.repeat(262145)+'{"valid":true}');
 assert.equal(oversize.category,'MALFORMED_MODEL_JSON');
 assert.equal(oversize.receipt.finalSyntaxClass,'CONTENT_TOO_LONG');
 assert.equal(oversize.receipt.finalRawContentChars,262145);
});
test('missing final content does not parse private reasoning',()=>{
 const p=packet(null);
 const d=inspectV28ProviderResponse('repair_2',200,p.body);
 assert.equal(d.category,'EMPTY_MODEL_CONTENT');
 assert.equal(JSON.stringify(d.receipt).includes('PRIVATE_REASONING_CANARY'),false);
});
