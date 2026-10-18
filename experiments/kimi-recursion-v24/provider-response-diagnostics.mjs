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
export function classifyV28ThrownError(error){
 return error?.name==='AbortError'||error?.name==='TimeoutError'
  ?'TRANSPORT_TIMEOUT_OR_ABORT':'TRANSPORT_OR_CLIENT_ERROR';
}
