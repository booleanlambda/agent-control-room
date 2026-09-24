// Silas-only thinking-ON bounded purchase continuation after the first 180s B timeout.
// Preserve all original attempts; no gold answers and no agent state or grading mutations.
import { nvidiaChatCompletion } from './providers/nvidia.js';
import { pilotHelpers as h } from './silas-thinking-on-helper.js';
const R=h.ROOT;
const required1=['day0','day14_pre','day14_post','day28_pre','day28_post'];
const required2=['day35_pre','day35_post','day42','minimum_cash','minimum_day'];
async function readRow(path){const f=await h.read(path);return f?JSON.parse(f.text):null;}
async function part(name,brief,sha,prior){
 const path=R+'/step_2_B_'+name+'.json',old=await readRow(path);
 if(old){
  if(old.agent_id!==h.AGENT||old.model_returned!==h.MODEL||old.brief_sha!==sha||
     old.output_sha256!==h.digest(JSON.stringify(old.output)))throw Error('B_'+name+'_stored_invalid');
  h.log('ON_B_PART_RESUME',{part:name,sha:old.output_sha256,checks:old.assessment});
  return old;
 }
 const first=name==='days_0_28';
 const ask=first?
 'Compute ONLY purchase B from day 0 through day 28, using initial cash 11000, day0 purchase 8850, daily fuel 31, day14 collection +4500, day28 overhead -6100. Deduct each daily cost before same-day event. Return JSON {"stage":"purchase_B_0_28","source_ids":["CASE42-V1"],"option":{"day0":number,"day14_pre":number,"day14_post":number,"day28_pre":number,"day28_post":number,"formula":"running equations"},"comment":"..."}.' :
 'Continue the same purchase B cash trajectory from the SAVED day28_post amount, for days 29-42. Fuel 31/day, collection +3000 on day35, no day70 salvage within 42 days. Compute day35 pre and post, day42, absolute MINIMUM over days 0-42 (consider original cash minimum as well), its day, and whether $2500 floor holds. Return JSON {"stage":"purchase_B_29_42","source_ids":["CASE42-V1"],"option":{"day35_pre":number,"day35_post":number,"day42":number,"minimum_cash":number,"minimum_day":number,"constraint_pass":boolean,"formula":"running equations"},"comment":"..."}.';
 const system='You are Silas, solving one complete bounded part of an unfamiliar, off-curriculum Masters-level finance problem using the same bound model with thinking ON. Reason independently; return complete JSON only. Never claim verified external evidence or replace a missing calculation with guesswork.';
 const {novel_variant,...visible}=brief;
 const user=ask+'\nFROZEN SOURCE:\n'+JSON.stringify(visible)+'\nSAVED PRIOR CHECKPOINT:\n'+JSON.stringify(prior);
 const begin=Date.now();let result;
 try{result=await nvidiaChatCompletion({model:h.MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],
  temperature:0,jsonMode:true,enableThinking:true,maxTokens:3072,timeoutMs:180000});}
 catch(e){h.log('ON_B_PART_BLOCKED',{part:name,reason:'request_or_timeout',code:e.code||e.name,elapsed_ms:Date.now()-begin});return null;}
 let o;try{o=JSON.parse(result.content);}catch{o=null;}
 if(result.model_returned!==h.MODEL||result.finish_reason!=='stop'||o?.stage!==(first?'purchase_B_0_28':'purchase_B_29_42')||
    !Array.isArray(o.source_ids)||!o.source_ids.includes('CASE42-V1')){
   h.log('ON_B_PART_BLOCKED',{part:name,reason:'invalid_or_incomplete',finish_reason:result.finish_reason,elapsed_ms:Date.now()-begin});return null;
 }
 const missing=(first?required1:required2).filter(k=>!Number.isFinite(Number(o.option?.[k])));
 if(!first&&typeof o.option?.constraint_pass!=='boolean')missing.push('constraint_pass');
 const rec={agent_id:h.AGENT,model_returned:result.model_returned,brief_sha:sha,step:2,part:name,
  input_sha256:h.digest(system+'\n'+user),input_chars:system.length+user.length,output_sha256:h.digest(JSON.stringify(o)),
  output_chars:result.content.length,reasoning_chars:String(result.reasoning_content||'').length,
  usage:result.usage||null,finish_reason:result.finish_reason,elapsed_ms:Date.now()-begin,
  assessment:{passed:missing.length===0,issues:missing},output:o};
 const saved=await h.save(path,rec);
 h.log('ON_B_PART_CHECKPOINT',{part:name,passed:rec.assessment.passed,issues:rec.assessment.issues,
  elapsed_ms:rec.elapsed_ms,reasoning_tokens:rec.usage?.completion_tokens_details?.reasoning_tokens,
  output_sha256:rec.output_sha256,blob:saved.blob,commit:saved.commit});
 return rec;
}
