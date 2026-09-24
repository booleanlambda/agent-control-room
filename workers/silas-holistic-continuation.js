// Silas-only continuation of the FROZEN off-curriculum test after the numerical gate.
// Does not change agent lifecycle, degrees, grades, policies, or previous pilot evidence.
// Numerical errors remain visible; preserve responses and evaluate quality AFTER all stages.
import { nvidiaChatCompletion } from './providers/nvidia.js';
import { pilotHelpers as h } from './silas-continuation-pilot.js';
const R=h.ROOT;
const steps={
  3:{stage:'business_decision',task:'Use the earlier study plan and BOTH original and revised stage-2 submissions. Their option A arithmetic was flagged as incorrect; you are NOT given the correct numbers. Treat them as unverified, recheck the source inputs yourself and do not silently inherit their totals. Compute outsourcing option C; evaluate liquidity, continuity of service, customer trust, supplier dependence, financial and operational risks, and identify what commercial evidence would be needed. Give a conditional decision, separately from the numerical verification status. Provide JSON keys: stage,source_ids,prior_work_reference,option_C (day0,day14_pre,day14_post,day28_pre,day28_post,day35_pre,day35_post,day42,minimum_cash,minimum_day,constraint_pass,formula),decision,reasoning,stakeholder_plan,risks,open_questions,acknowledged_error.'},
  4:{stage:'changed_conditions',task:'NEW EVIDENCE QUOTE-V2: rental setup 480, daily_service 189, daily_fuel 55; every other frozen input is unchanged. This quote is being disclosed for the FIRST time now. Independently recompute the rental option and its daily minimum; explain whether your stage-3 decision survives; discuss what you would do if no option meets the minimum $2,500 cash floor. Do not claim actual funding or real supplier quotes. Include source identifiers and clearly separate assumptions, arithmetic and decisions. JSON keys: stage,source_ids,prior_work_reference,revised_rental (day0,day14_pre,day14_post,day28_pre,day28_post,day35_pre,day35_post,day42,minimum_cash,minimum_day,constraint_pass,formula),decision_changed,reasoning,stakeholder_plan,unresolved_evidence.'},
  5:{stage:'board_memo',task:'Prepare a substantive board memo (>900 characters) synthesizing the frozen case, your earlier plan, the two preserved arithmetic attempts and their unresolved audit flags, your own stage-3 business decision, and the new rental quote. Make a coherent final recommendation conditional on liquidity; distinguish evidence from assumptions, indicate when you changed your view, describe operational mitigations and next actions, and acknowledge any unresolved arithmetic. Cite source IDs CASE42-V1 and QUOTE-V2; reproduce prior stage hashes exactly from the given checkpoint index without altering them. JSON keys: stage,source_ids,prior_work_reference,original_decision,revised_decision,previous_output_sha256 (array for plan, original calculation, revision, stage 3, stage 4),memo,open_questions,next_actions.'}
};
async function readJson(p){const f=await h.read(p);if(!f)return null;const v=JSON.parse(f.text);return {...v,blob_sha:f.sha};}
function checkStored(v,expected){
 if(v.agent_id!==h.AGENT||v.model_returned!==h.MODEL||v.step!==expected||
    v.output_sha256!==h.digest(JSON.stringify(v.output)))throw Error('pilot_checkpoint_corrupt_'+expected);
 return v;
}
function arithmetic(brief,option){
 let cash=brief.initial_cash-option.setup_day0,min=cash,day=0;const row={day0:cash};
 for(let d=1;d<=42;d++){
  cash-=option.daily_service+option.daily_fuel;
  if([14,28,35].includes(d))row['day'+d+'_pre']=cash;
  if(cash<min){min=cash;day=d;}
  for(const e of brief.cash_events)if(e.day===d)cash+=e.amount;
  if([14,28,35].includes(d))row['day'+d+'_post']=cash;
  if(cash<min){min=cash;day=d;}
 }
 return {...row,day42:cash,minimum_cash:min,minimum_day:day,constraint_pass:min>=brief.minimum_cash};
}
function evidenceCheck(n,v,brief,prior){
 const issues=[];const need=n<4?['CASE42-V1']:['CASE42-V1','QUOTE-V2'];
 if(!Array.isArray(v.source_ids)||need.some(k=>!v.source_ids.includes(k)))issues.push('source_reference_missing');
 if(v.prior_work_reference!==prior[n===3?2:n===4?3:4].output_sha256)issues.push('previous_stage_reference_incorrect');
 if(n===5){
  if(String(v.memo||'').length<900)issues.push('memo_length_insufficient');
  const needed=[prior[0],prior[1],prior[2],prior[3],prior[4]].map(x=>x.output_sha256);
  if(!Array.isArray(v.previous_output_sha256)||JSON.stringify(v.previous_output_sha256)!==JSON.stringify(needed))issues.push('history_hashes_incorrect');
 }else{
  const opt=n===3?brief.options.C:{...brief.options.A,...brief.novel_variant.option_A_changes};
  const expected=arithmetic(brief,opt),given=n===3?v.option_C:v.revised_rental;
  for(const [k,value] of Object.entries(expected)){
   if(k==='constraint_pass'?given?.[k]!==value:!Number.isFinite(Number(given?.[k]))||Math.abs(Number(given[k])-value)>0.01)issues.push('numerical_'+k);
  }
 }
 return {passed:issues.length===0,issues};
}
export async function runSilasHolisticContinuation(){
 if(!h.token||!process.env.NVIDIA_API_KEY)throw Error('pilot_credentials_unavailable');
 const limit=Number(process.env.AAU_SILAS_HOLISTIC_PHASE||3);
 if(![3,5].includes(limit))throw Error('pilot_invalid_phase');
 const frozen=await h.read(R+'/brief.json');if(!frozen)throw Error('pilot_brief_missing');
 const brief=JSON.parse(frozen.text);
 if(brief.agent_id!==h.AGENT||brief.bound_model!==h.MODEL)throw Error('pilot_identity_mismatch');
 const prev=[];
 for(const [i,path] of [[1,'step_1.json'],[2,'step_2.json'],[2,'step_2_revision_1.json']]){
  const v=await readJson(R+'/'+path);if(!v)throw Error('pilot_original_source_missing_'+path);
  checkStored(v,i);
  if(v.brief_sha!==frozen.sha)throw Error('pilot_brief_mismatch');
  prev.push(v);
 }
 h.log('HOLISTIC_START',{agent_id:h.AGENT,model:h.MODEL,limit,original_sha:prev[1].output_sha256,
    revised_sha:prev[2].output_sha256,original_arithmetic_passed:prev[1].audit.passed,
    revision_arithmetic_passed:prev[2].audit.passed,normal_brain_packet:false,
    off_curriculum:true,no_agent_state_mutation:true});
 for(let n=3;n<=limit;n++){
  const path=R+'/holistic_step_'+n+'.json',old=await readJson(path);
  if(old){
   checkStored(old,n);if(old.brief_sha!==frozen.sha)throw Error('pilot_brief_mismatch');
   prev.push(old);
   h.log('HOLISTIC_RESUME',{step:n,output_sha256:old.output_sha256,blob_sha:old.blob_sha,issues:old.assessment?.issues});
   continue;
  }
  const system='You are Silas in an off-curriculum, multi-step entrepreneurship task through your bound model. Preserve continuity with your prior work, but correct mistakes rather than copying them. Do not invent external evidence. Produce a fully valid JSON document only. You can explain assumptions and numerical work within JSON strings. Do not represent prior work as validated when an audit flagged it.';
  const visibleBrief=n===3?(({novel_variant,...b})=>b)(brief):brief;
  const input={brief:visibleBrief,history:prev.map(x=>({step:x.step,revision:x.revision||0,output_sha256:x.output_sha256,output:x.output,audit:x.audit||x.assessment}))};
  const user=steps[n].task+'\nREQUIRED stage='+steps[n].stage+
    '\nSet prior_work_reference exactly to '+prev[prev.length-1].output_sha256+
    '\nFROZEN INFORMATION:\n'+JSON.stringify(input);
  const started=Date.now();let result;
  try{result=await nvidiaChatCompletion({model:h.MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],
    maxTokens:4096,timeoutMs:120000,temperature:0.1,jsonMode:true,enableThinking:false});}
  catch(e){h.log('HOLISTIC_BLOCKED',{step:n,cause:'model_or_timeout',code:e.code||e.name||'error',elapsed_ms:Date.now()-started});return;}
  let output;try{output=JSON.parse(result.content);}catch{output=null;}
  if(result.model_returned!==h.MODEL||result.finish_reason!=='stop'||!output||output.stage!==steps[n].stage){
   h.log('HOLISTIC_BLOCKED',{step:n,cause:'incomplete_or_wrong_model',finish_reason:result.finish_reason,
      model_returned:result.model_returned,elapsed_ms:Date.now()-started});return;
  }
  const assessment=evidenceCheck(n,output,brief,prev);
  const row={contract:'silas_holistic_continuation_v0_1',agent_id:h.AGENT,model_returned:result.model_returned,
    brief_sha:frozen.sha,step:n,prior_sha256:prev[prev.length-1].output_sha256,
    input_sha256:h.digest(system+'\n'+user),input_chars:system.length+user.length,
    output_sha256:h.digest(JSON.stringify(output)),output_chars:result.content.length,
    usage:result.usage||null,finish_reason:result.finish_reason,elapsed_ms:Date.now()-started,assessment,output};
  const saved=await h.save(path,row);prev.push(row);
  h.log('HOLISTIC_CHECKPOINT',{step:n,elapsed_ms:row.elapsed_ms,output_chars:row.output_chars,input_chars:row.input_chars,
     finish_reason:row.finish_reason,output_sha256:row.output_sha256,checkpoint_sha:saved.blob,
     commit:saved.commit,evidence_checks_passed:assessment.passed,issues:assessment.issues});
  // Content errors are preserved and carried into the next stage, not silently accepted or used as a gate.
 }
 h.log('HOLISTIC_RESULT',{phase:limit,status:limit===3?'durable_boundary':'finished_with_review_required',
   assessments:prev.slice(3).map(x=>({step:x.step,passed:x.assessment.passed,issues:x.assessment.issues}))});
}
