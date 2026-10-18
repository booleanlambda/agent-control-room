// Research-only single live Kimi thinking-ON response-shape probe.
// Preserve *only* sanitized structural/provider metadata; never raw reasoning or final text.
// Research evaluation only; no production writes.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inspectThinkingOnFinalJson} from '../kimi-recursion-v24/thinking-on-json-syntax.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {kimiStageRequest} from '../kimi-recursion-v24/thinking-router.mjs';
import {inspectV28ProviderResponse,inspectV28TransportFailure} from '../kimi-recursion-v24/provider-response-diagnostics.mjs';
import {summarizeFinalStructure} from './shape-helpers.mjs';
import {assessDiagnosticStrategy} from './diagnostic-acceptance.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_THINKING_ON_SHAPE_PROBE!=='yes')
 throw Error('ISOLATED_RESEARCH_ONLY');
const stage='repair_2',cfg=kimiStageRequest(stage,32768);
if(cfg.thinking.type!=='enabled'||cfg.max_tokens!==32768||cfg.timeoutMs!==720000)
 throw Error('THINKING_ON_BUDGET_INVARIANT');
const source=readFileSync(new URL('../real-world-aau-debug-v1/legacy-model-source.txt',import.meta.url),'utf8');
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const evidence={probe:'KIMI_THINKING_ON_FINAL_JSON_SHAPE',
 version:1,run:randomUUID(),isolation:'GitHub Actions research-only',
 sourceSha256:hash(source),mode:'enabled',
 model:cfg.model,maxCompletionTokens:cfg.max_tokens,
 callLimit:1,automaticRetries:false,
 status:'preparing',httpHeadersReceived:false,requestDeadlineFired:false,
 providerReceipt:null,finalSchema:[],messageFields:[],transport:null,
 rawContentStored:false,privateReasoningStored:false,
 tempFinalFileCreated:false,tempFinalFileDeleted:false,
 finalContentSha256:null,inRunnerParseCheck:null,
 semanticAcceptance:null,overallResult:'NOT_EVALUATED'};
const save=()=>writeFileSync('thinking-on-shape-evidence.json',JSON.stringify(evidence,null,2)+'\n');
const body={model:cfg.model,thinking:cfg.thinking,temperature:cfg.temperature,
 response_format:{type:'json_object'},max_tokens:cfg.max_tokens,stream:false,
 messages:[
  {role:'system',content:'You are diagnosing a real historic software failure. Thinking mode is enabled. Produce a valid JSON object for the final response. Do not expose any private reasoning as a JSON field.'},
  {role:'user',content:JSON.stringify({
   incident:'The AAU runtime used an indiscriminate catch that overwrote model provider error categories, usage and finish reason on MODEL_REQUEST_MANUAL_HOLD.',
   request:'Independently diagnose the causes and provide a concise, testable remediation strategy in a JSON object of your chosen structure. Include edge cases for malformed JSON, HTTP errors, timeouts, completion length and ambiguous database receipts. No implementation or production operation is requested.',
   historicalSource:source
  })}
 ]};
evidence.requestSha256=hash(JSON.stringify(body));
const key=String(process.env.MOONSHOT_API_KEY||'').trim();
if(!key)throw Error('PROVIDER_KEY_UNAVAILABLE');
let started=Date.now(),settled=false,deadlineFired=false,headersReceived=false;
let temporaryDirectory=null;
const ctrl=new AbortController();
const timer=setTimeout(()=>{
 if(!settled){deadlineFired=true;ctrl.abort()}
},cfg.timeoutMs);
evidence.status='sent_or_uncertain';evidence.sentAt=new Date(started).toISOString();save();
try{
 const res=await fetch('https://api.moonshot.ai/v1/chat/completions',{
  method:'POST',redirect:'manual',signal:ctrl.signal,
  headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json'},
  body:JSON.stringify(body)});
 headersReceived=true;
 const parsed=await res.json().then(x=>({ok:true,value:x})).catch(()=>({ok:false,value:null}));
 settled=true;clearTimeout(timer);
 const finalText=parsed.value?.choices?.[0]?.message?.content;
 if(typeof finalText==='string'&&finalText.length<=262144){
  temporaryDirectory=mkdtempSync(path.join(tmpdir(),'aau-final-'));
  const tempFile=path.join(temporaryDirectory,'answer.txt');
  writeFileSync(tempFile,finalText,{encoding:'utf8',mode:0o600,flag:'wx'});
  evidence.tempFinalFileCreated=true;
  evidence.finalContentSha256=hash(finalText);
  const localCheck=inspectThinkingOnFinalJson(readFileSync(tempFile,'utf8'));
  evidence.inRunnerParseCheck=localCheck.meta;
 }
 const outcome=inspectV28ProviderResponse(stage,res.status,parsed.value,parsed.ok);
 evidence.providerReceipt={...outcome.receipt,elapsedMs:Date.now()-started};
 evidence.status=outcome.category;
 const msg=parsed.value?.choices?.[0]?.message;
 evidence.messageFields=['role','content','reasoning_content','reasoning','tool_calls','refusal']
  .filter(k=>Object.hasOwn(msg??{},k));
 if(outcome.answer){
  evidence.finalSchema=summarizeFinalStructure(outcome.answer);
  evidence.semanticAcceptance=assessDiagnosticStrategy(outcome.answer);
 }
 evidence.overallResult=outcome.category!=='ACCEPTED'?'FORMAT_OR_PROVIDER_FAILED':
  evidence.semanticAcceptance?.verdict==='REQUIREMENTS_COVERED'?
   'FORMAT_AND_REQUIREMENTS_COVERED':'FORMAT_ONLY_REQUIREMENTS_UNMET';
 evidence.httpHeadersReceived=headersReceived;
 evidence.requestDeadlineFired=deadlineFired;
 save();
 console.log('THINKING_ON_SHAPE_PROBE='+JSON.stringify({
  status:evidence.status,finishReason:evidence.providerReceipt.finishReason,
  totalTokens:evidence.providerReceipt.providerTokens,
  reasoningPresent:evidence.providerReceipt.reasoningPresent,
  finalContentKind:evidence.providerReceipt.finalContentKind,
  contentJson:evidence.providerReceipt.contentJson,
  finalSchema:evidence.finalSchema,
  semanticVerdict:evidence.semanticAcceptance?.verdict??null,
  requirementsMet:evidence.semanticAcceptance?.metCount??0,
  overallResult:evidence.overallResult,
  elapsedMs:evidence.providerReceipt.elapsedMs
 }));
 if(evidence.overallResult!=='FORMAT_AND_REQUIREMENTS_COVERED')process.exitCode=2;
}catch(e){
 evidence.transport=inspectV28TransportFailure(e,{
  elapsedMs:Date.now()-started,httpHeadersReceived:headersReceived,
  requestDeadlineFired:deadlineFired});
 evidence.status=evidence.transport.category;
 evidence.httpHeadersReceived=headersReceived;
 evidence.requestDeadlineFired=deadlineFired;
 save();
 console.log('THINKING_ON_SHAPE_PROBE='+JSON.stringify({
  status:evidence.status,transport:evidence.transport}));
 process.exitCode=2;
}finally{
 clearTimeout(timer);
 if(temporaryDirectory!==null){
  rmSync(temporaryDirectory,{recursive:true,force:true});
  evidence.tempFinalFileDeleted=true;
 }
 save();
}
