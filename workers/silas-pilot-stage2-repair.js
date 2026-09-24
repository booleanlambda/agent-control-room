// One bounded, source-complete correction of Silas's failed stage 2.
// Preserve original immutable stage 2; never insert gold answers into the prompt.
import { nvidiaChatCompletion } from './providers/nvidia.js';
export async function repairSilasStage2(h,brief,f,original,prior){
 if(original.step!==2||original.audit?.passed!==false)throw Error('pilot_repair_wrong_source');
 const path=h.ROOT+'/step_2_revision_1.json';
 let row;
 const existing=await h.read(path);
 if(existing){
  row=JSON.parse(existing.text);
  if(row.agent_id!==h.AGENT||row.model_returned!==h.MODEL||row.brief_sha!==f.sha||
    row.step!==2||row.revision!==1||row.replaces_sha256!==original.output_sha256||
    row.output_sha256!==h.digest(JSON.stringify(row.output)))throw Error('invalid_pilot_revision');
  h.log('REPAIR_RESUME',{revision:1,output_sha256:row.output_sha256,audit_passed:row.audit?.passed,sha:existing.sha});
  return row;
 }
 const {novel_variant,...caseWithoutFutureQuote}=brief;
 const system='You are Silas in a standalone off-curriculum error-correction test using your bound model. Your prior full response and the deterministic audit are provided; the audit does NOT provide any correct numerical answers. Recalculate directly from the original fictional case. Be precise, show your formulas, and emit one COMPLETE JSON object with the identical analysis_ab schema. This is not MBA grading or a normal wake.';
 const user='Your saved step 2 had arithmetic mismatches in these fields: '+JSON.stringify(original.audit.issues)+'. Your original calculation follows: '+JSON.stringify(original.output)+'. Recompute option A and B from scratch. Show an explicit running cash expression in each formula. Check day 14, 28 and 35 pre and post event and all-day minima. Do not adopt a previous number merely because it was previously output. Required JSON keys: stage="analysis_ab", source_ids=["CASE42-V1"], option_A, option_B, limitations. Each option object must contain day0,day14_pre,day14_post,day28_pre,day28_post,day35_pre,day35_post,day42,minimum_cash,minimum_day,constraint_pass,formula. Original case: '+JSON.stringify(caseWithoutFutureQuote);
 const started=Date.now();let result;
 try{result=await nvidiaChatCompletion({model:h.MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],
  maxTokens:4096,timeoutMs:120000,temperature:0,jsonMode:true,enableThinking:false});}
 catch(e){h.log('REPAIR_BLOCKED',{reason:'model_request_failed',code:e.code||e.name||'error',elapsed_ms:Date.now()-started});return null;}
 let output;try{output=JSON.parse(result.content);}catch{output=null;}
 if(result.finish_reason!=='stop'||result.model_returned!==h.MODEL||!output||output.stage!=='analysis_ab'){
  h.log('REPAIR_BLOCKED',{reason:'incomplete_response',finish_reason:result.finish_reason,elapsed_ms:Date.now()-started});return null;
 }
 const audit=h.check(2,output,brief,prior);
 row={agent_id:h.AGENT,model_returned:result.model_returned,brief_sha:f.sha,
  step:2,revision:1,replaces_sha256:original.output_sha256,
  input_sha256:h.digest(system+'\n'+user),input_chars:system.length+user.length,
  output_sha256:h.digest(JSON.stringify(output)),output_chars:result.content.length,
  usage:result.usage,finish_reason:result.finish_reason,elapsed_ms:Date.now()-started,audit,output};
 const saved=await h.save(path,row);
 h.log('REPAIR_CHECKPOINT',{revision:1,audit_passed:audit.passed,issues:audit.issues,
  elapsed_ms:row.elapsed_ms,output_sha256:row.output_sha256,original_sha256:row.replaces_sha256,
  blob:saved.blob,commit:saved.commit,bytes:saved.bytes});
 return row;
}
