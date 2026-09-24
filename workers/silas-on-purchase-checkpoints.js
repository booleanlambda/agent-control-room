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

export async function runSilasPurchaseBContinuation(){
 if(!h.token||!process.env.NVIDIA_API_KEY)throw Error('pilot_credentials_unavailable');
 const f=await h.read(R+'/brief.json'),p=await readRow(R+'/step_1.json'),a=await readRow(R+'/step_2_A.json');
 if(!f||!p||!a)throw Error('pilot_prerequisite_missing');
 const brief=JSON.parse(f.text);
 if(brief.agent_id!==h.AGENT||brief.bound_model!==h.MODEL||p.brief_sha!==f.sha||a.source_brief_sha!==f.sha||
    !a.assessment?.passed)throw Error('pilot_identity_source_or_rental_invalid');
 h.log('ON_B_START',{agent_id:h.AGENT,model:h.MODEL,thinking:true,plan:p.output_sha256,
   rental_sha:a.output_sha256,prior_B_timeout_preserved:true});
 const b1=await part('days_0_28',brief,f.sha,{plan:p.output,plan_sha:p.output_sha256});
 if(!b1?.assessment.passed){h.log('ON_B_RESULT',{status:'blocked',part:'days_0_28'});return;}
 const b2=await part('days_29_42',brief,f.sha,{plan_sha:p.output_sha256,first_half:b1.output,
   first_half_sha:b1.output_sha256});
 if(!b2?.assessment.passed){h.log('ON_B_RESULT',{status:'blocked',part:'days_29_42'});return;}
 const option={...b1.output.option,...b2.output.option,
  formula:String(b1.output.option.formula||'')+'; '+String(b2.output.option.formula||'')};
 const output={stage:'ledger_B',source_ids:['CASE42-V1'],option,
   limitations:['All collections assumed on time','Day 70 salvage unavailable inside 42-day horizon'],
   bounded_parts_sha256:{days_0_28:b1.output_sha256,days_29_42:b2.output_sha256}};
 const caseResult={stage:'analysis_ab',source_ids:['CASE42-V1'],option_A:a.output.option,option_B:option};
 const assessment=h.check(2,caseResult,brief,[p]);
 const path=R+'/step_2_B.json';
 if(await h.read(path))throw Error('pilot_B_already_exists');
 const row={agent_id:h.AGENT,model_returned:h.MODEL,source_brief_sha:f.sha,
   condition:'thinking_on',step:2,option:'B',source:'assembled_two_bounded_parts',
   output_sha256:h.digest(JSON.stringify(output)),input_sha256:h.digest(b1.input_sha256+b2.input_sha256),
   input_chars:b1.input_chars+b2.input_chars,output_chars:b1.output_chars+b2.output_chars,
   reasoning_chars:b1.reasoning_chars+b2.reasoning_chars,usage:{first:b1.usage,second:b2.usage},
   finish_reason:'assembled_complete_substeps',elapsed_ms:b1.elapsed_ms+b2.elapsed_ms,
   assessment:{passed:assessment.passed,issues:assessment.issues.filter(x=>x.startsWith('B.'))},output};
 const saved=await h.save(path,row);
 h.log('ON_B_RESULT',{status:'assembled_purchase',passed:row.assessment.passed,issues:row.assessment.issues,
   output_sha256:row.output_sha256,blob:saved.blob,commit:saved.commit});
 // Assemble transparent complete A/B checkpoint from individually saved records.
 const {runSilasThinkingOnDecomposed}=await import('./silas-thinking-on-decomposed.js');
 return runSilasThinkingOnDecomposed();
}
