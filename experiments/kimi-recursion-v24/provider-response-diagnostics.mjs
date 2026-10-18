// V28 diagnostic-only provider response classification.
// Never log or persist provider messages, raw reasoning, secrets or model source.
import {isKnownThinkingExhaustion} from './budget-recovery.mjs';
import {kimiResponseAcceptable} from './thinking-router.mjs';
const integerOrNull=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const safeFinish=x=>typeof x==='string'&&/^[a-zA-Z0-9_.-]{1,48}$/.test(x)?x:null;
export function inspectV28ProviderResponse(stage,httpStatus,body,bodyParsed=true){
 const ok=Number.isInteger(httpStatus)&&httpStatus>=200&&httpStatus<300;
 const choice=body?.choices?.[0];
 const content=typeof choice?.message?.content==='string'?choice.message.content:'';
 const finishReason=safeFinish(choice?.finish_reason);
 const providerTokens=integerOrNull(body?.usage?.total_tokens);
 const receipt={
  stage, httpStatus:Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?httpStatus:null,
  finishReason, providerTokens,
  promptTokens:integerOrNull(body?.usage?.prompt_tokens),
  completionTokens:integerOrNull(body?.usage?.completion_tokens),
  reasoningTokens:integerOrNull(body?.usage?.completion_tokens_details?.reasoning_tokens),
  contentJson:'not_checked', errorCategory:null
 };
 const result=(category,answer=null)=>{
  receipt.errorCategory=category;
  return {category,answer,receipt,content};
 };
 if(!ok)return result('PROVIDER_HTTP_ERROR');
 if(!bodyParsed)return result('PROVIDER_BODY_NOT_JSON');
 if(isKnownThinkingExhaustion(stage,choice,true))return result('THINKING_BUDGET_EXHAUSTED');
 if(finishReason==='length')return result('OUTPUT_TRUNCATED_UNCONFIRMED_FALLBACK');
 if(finishReason!=='stop')return result('PROVIDER_FINISH_INCOMPLETE');
 if(!content.trim())return result('EMPTY_MODEL_CONTENT');
 if(!kimiResponseAcceptable(stage,choice))return result('MODEL_RESPONSE_CONTRACT_REJECTED');
 let answer;
 try{answer=JSON.parse(content)}catch{receipt.contentJson='invalid';return result('MALFORMED_MODEL_JSON')}
 if(!answer||typeof answer!=='object'||Array.isArray(answer)){
  receipt.contentJson='invalid_shape';return result('MODEL_RESPONSE_SHAPE');
 }
 receipt.contentJson='valid_object';
 return result('ACCEPTED',answer);
}
// Only these literal code/name values are allowed into persisted receipts.
// Never promote arbitrary error.message, stack, URL, hostname or cause objects.
const safeExceptionNames=new Set([
 'Error','TypeError','AbortError','TimeoutError','NetworkError',
 'AggregateError','SyntaxError','RangeError','ReferenceError'
]);
const safeNetworkCodes=new Set([
 'ABORT_ERR','ECONNRESET','ETIMEDOUT','ECONNREFUSED','EAI_AGAIN',
 'ENOTFOUND','EPIPE','ERR_SOCKET_CLOSED','ERR_NETWORK',
 'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT',
 'UND_ERR_SOCKET','UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
 'UND_ERR_REQUEST_ABORTED','UND_ERR_RESPONSE_STATUS_CODE',
 'CERT_HAS_EXPIRED','SELF_SIGNED_CERT_IN_CHAIN','ERR_TLS_CERT_ALTNAME_INVALID'
]);
const timeoutCodes=new Set(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT',
 'UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
const safeName=x=>safeExceptionNames.has(x)?x:'OTHER_ERROR';
const safeCode=x=>safeNetworkCodes.has(x)?x:null;
export function inspectV28TransportFailure(error,{
 elapsedMs=null,httpHeadersReceived=false,requestDeadlineFired=false
}={}){
 const exceptionName=safeName(error?.name);
 const errorCode=safeCode(error?.code);
 const causeCode=safeCode(error?.cause?.code);
 const elapsed=Number.isSafeInteger(elapsedMs)&&elapsedMs>=0&&elapsedMs<=3600000
  ?elapsedMs:null;
 const ownDeadline=requestDeadlineFired===true;
 const timeout=ownDeadline||exceptionName==='AbortError'||exceptionName==='TimeoutError'
  ||timeoutCodes.has(errorCode)||timeoutCodes.has(causeCode);
 return Object.freeze({
  exceptionName,errorCode,causeCode,elapsedMs:elapsed,
  httpHeadersReceived:httpHeadersReceived===true,
  requestDeadlineFired:ownDeadline,
  category:timeout?'TRANSPORT_TIMEOUT_OR_ABORT':'TRANSPORT_OR_CLIENT_ERROR'
 });
}
export function classifyV28ThrownError(error){
 return inspectV28TransportFailure(error).category;
}
