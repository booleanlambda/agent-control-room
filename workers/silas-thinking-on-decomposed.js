// Split ONLY the timed-out Silas thinking-on numerical stage. Retain failed full call separately.
// This runner writes one immutable result per option and assembles a transparent stage-2 bundle.
import { nvidiaChatCompletion } from './providers/nvidia.js';
import { pilotHelpers as h } from './silas-thinking-on-helper.js';
const R=h.ROOT;
const optTasks={
 A:'Independently solve ONLY rental option A of CASE42-V1. Setup=480; daily_service=105; daily_fuel=38. Trace the full 42-day cash trajectory including day 0, event days 14,28,35 (pre and post), day 42 and exact all-day minimum. Cash floor 2500. The authoritative frozen case follows. Return COMPLETE JSON {"stage":"ledger_A","source_ids":["CASE42-V1"],"option":{"day0":number,"day14_pre":number,"day14_post":number,"day28_pre":number,"day28_post":number,"day35_pre":number,"day35_post":number,"day42":number,"minimum_cash":number,"minimum_day":number,"constraint_pass":boolean,"formula":"explicit running cash expressions"},"limitations":["..."]}.',
 B:'Independently solve ONLY purchase option B of CASE42-V1. Setup=8850; daily_service=0; daily_fuel=31; potential salvage on day70 is excluded from the 42-day cash horizon. Trace day 0, event days 14,28,35 (pre/post), day42 and exact all-day minimum. Cash floor 2500. Return COMPLETE JSON {"stage":"ledger_B","source_ids":["CASE42-V1"],"option":{"day0":number,"day14_pre":number,"day14_post":number,"day28_pre":number,"day28_post":number,"day35_pre":number,"day35_post":number,"day42":number,"minimum_cash":number,"minimum_day":number,"constraint_pass":boolean,"formula":"explicit running cash expressions"},"limitations":["..."]}.'
};
async function substep(key,brief,sourceSha,plan){
 const path=R+'/step_2_'+key+'.json',old=await h.read(path);
 if(old){
  const x=JSON.parse(old.text);
  if(x.agent_id!==h.AGENT||x.model_returned!==h.MODEL||x.source_brief_sha!==sourceSha||x.output_sha256!==h.digest(JSON.stringify(x.output)))throw Error('pilot_substep_invalid_'+key);
  h.log('ON_LEDGER_RESUME',{option:key,passed:x.assessment.passed,output_sha256:x.output_sha256});
  return x;
 }
 const system='You are Silas in an isolated graduate-level, off-curriculum cognition test, with thinking enabled. This is a bounded portion of the same cold-storage case, not a new task. Calculate independently rather than import prior wrong totals. Return valid JSON only, no unsupported outside research.';
 const {novel_variant,...visible}=brief;
 const user=optTasks[key]+'\nFROZEN CASE:\n'+JSON.stringify(visible)+'\nPRIOR PLAN:\n'+JSON.stringify(plan.output);
 let result;const t=Date.now();
 try{result=await nvidiaChatCompletion({model:h.MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0,maxTokens:4096,
   timeoutMs:180000,jsonMode:true,enableThinking:true});}
 catch(e){h.log('ON_LEDGER_BLOCKED',{option:key,reason:'request_or_timeout',code:e.code||e.name,elapsed_ms:Date.now()-t});return null;}
 let out;try{out=JSON.parse(result.content);}catch{out=null;}
 if(result.model_returned!==h.MODEL||result.finish_reason!=='stop'||out?.stage!=='ledger_'+key||
    !Array.isArray(out?.source_ids)||!out.source_ids.includes('CASE42-V1')){
  h.log('ON_LEDGER_BLOCKED',{option:key,reason:'incomplete_response',finish_reason:result.finish_reason,
   model_returned:result.model_returned,elapsed_ms:Date.now()-t});return null;
 }
 const checkObj={stage:'analysis_ab',source_ids:['CASE42-V1'],option_A:key==='A'?out.option:{},option_B:key==='B'?out.option:{}};
 const expectedIssues=h.check(2,checkObj,brief,[]).issues.filter(x=>x.startsWith(key+'.'));
 const rec={agent_id:h.AGENT,model_returned:result.model_returned,source_brief_sha:sourceSha,
  condition:'thinking_on',step:2,option:key,output_sha256:h.digest(JSON.stringify(out)),
  input_sha256:h.digest(system+'\n'+user),input_chars:system.length+user.length,
  output_chars:result.content.length,reasoning_chars:String(result.reasoning_content||'').length,
  usage:result.usage||null,finish_reason:result.finish_reason,elapsed_ms:Date.now()-t,
  assessment:{passed:expectedIssues.length===0,issues:expectedIssues},output:out};
 const saved=await h.save(path,rec);
 h.log('ON_LEDGER_CHECKPOINT',{option:key,passed:rec.assessment.passed,issues:rec.assessment.issues,
  elapsed_ms:rec.elapsed_ms,output_sha256:rec.output_sha256,reasoning_tokens:rec.usage?.completion_tokens_details?.reasoning_tokens,
  checkpoint_sha:saved.blob,commit:saved.commit});
 return rec;
}
