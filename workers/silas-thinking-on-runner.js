// Matched case; independent Silas-only THINKING ON sequence with durable checkpoints.
// Does not wake normal agent or alter degree, grading, resources or policy.
import { nvidiaChatCompletion } from './providers/nvidia.js';
import { pilotHelpers as h } from './silas-thinking-on-helper.js';
const names=['','plan','analysis_ab','business_decision','changed_conditions','board_memo'];
const root=h.ROOT;
function frozenBrief(brief,n){if(n<4){const {novel_variant,...base}=brief;return base;}return brief;}
function ledger(brief,option){
 let cash=brief.initial_cash-option.setup_day0,min=cash,day=0;const x={day0:cash};
 for(let d=1;d<=42;d++){
  cash-=option.daily_service+option.daily_fuel;
  if([14,28,35].includes(d))x['day'+d+'_pre']=cash;
  if(cash<min){min=cash;day=d;}
  for(const ev of brief.cash_events)if(ev.day===d)cash+=ev.amount;
  if([14,28,35].includes(d))x['day'+d+'_post']=cash;
  if(cash<min){min=cash;day=d;}
 }
 return {...x,day42:cash,minimum_cash:min,minimum_day:day,constraint_pass:min>=brief.minimum_cash};
}
function inspect(brief,step,o,prior){
 const issues=[];
 const compare=(key,v,option)=>{const g=ledger(brief,option);
  for(const [k,n] of Object.entries(g)){
   if(k==='constraint_pass'?v?.[k]!==n:!Number.isFinite(Number(v?.[k]))||Math.abs(Number(v[k])-n)>0.01)issues.push(key+'.'+k);
  }
 };
 if(step===1&&(o.plan?.length<4||o.evidence_to_validate?.length<3))issues.push('plan');
 if(step===2){compare('A',o.option_A,brief.options.A);compare('B',o.option_B,brief.options.B);}
 if(step===3)compare('C',o.option_C,brief.options.C);
 if(step===4)compare('A_requote',o.revised_rental,{...brief.options.A,...brief.novel_variant.option_A_changes});
 if(step===5){
   if(String(o.memo||'').length<900)issues.push('memo_length');
   if(JSON.stringify(o.previous_output_sha256)!==JSON.stringify(prior.map(p=>p.output_sha256)))issues.push('prior_hashes');
 }
 const ids=step>=4?['CASE42-V1','QUOTE-V2']:['CASE42-V1'];
 if(!Array.isArray(o.source_ids)||ids.some(k=>!o.source_ids.includes(k)))issues.push('source_ids');
 if(step>=3&&o.prior_work_reference!==prior.at(-1)?.output_sha256)issues.push('last_checkpoint_reference');
 return {passed:issues.length===0,issues};
}
const task={
 1:'Return JSON stage=plan, source_ids=[CASE42-V1], plan (4+ steps), evidence_to_validate (3+ distinct sources), method. Do not produce a numerical verdict. Plan the day-by-day cash check.',
 2:'Compute options A and B. Return JSON stage=analysis_ab, source_ids=[CASE42-V1], option_A and option_B each with numeric day0,day14_pre,day14_post,day28_pre,day28_post,day35_pre,day35_post,day42,minimum_cash,minimum_day, boolean constraint_pass, string formula; limitations array. Find minimum over all days, check pre/post events; exclude day70 sale from 42-day cash.',
 3:'Use your prior plan and original stage-2 analysis (and revision, if present) with their explicit numerical audit flags. Do not silently treat incorrect figures as verified. Recalculate option C and make a conditional graduate-level decision considering liquidity, continuity, supplier dependency, customer trust, financing and evidence gaps. Return JSON stage=business_decision, source_ids=[CASE42-V1], prior_work_reference (exact last output SHA), option_C (same numerical fields as option_A), decision, reasoning, stakeholder_plan, risks, open_questions, acknowledged_error.',
 4:'NEW evidence QUOTE-V2 for the FIRST TIME: rental setup=480,daily_service=189,daily_fuel=55, everything else unchanged. Independently recompute revised rental day-by-day. Assess whether the prior decision survives, and what to do if no option maintains $2500. Return JSON stage=changed_conditions,source_ids=[CASE42-V1,QUOTE-V2],prior_work_reference,revised_rental (same numerical fields),decision_changed,reasoning,stakeholder_plan,unresolved_evidence. Do not invent secured financing.',
 5:'Write substantive board memo at least 900 characters joining initial plan, original numerical work and any revision, business decision, and newly disclosed quote. Preserve unresolved errors, revise recommendation when required, separate assumptions from evidence. Return JSON stage=board_memo,source_ids=[CASE42-V1,QUOTE-V2],prior_work_reference,original_decision,revised_decision,previous_output_sha256 (exact prior output hashes in order),memo,open_questions,next_actions.'
};

async function callStep(brief,briefSha,step,prior,{revision=false}={}){
 const oldPath=root+(revision?'/step_2_revision_1.json':'/step_'+step+'.json');
 const old=await h.read(oldPath);
 if(old){
  const rec=JSON.parse(old.text);
  if(rec.agent_id!==h.AGENT||rec.step!==step||rec.revision!==(revision?1:0)||rec.model_returned!==h.MODEL||
     rec.brief_sha!==briefSha||rec.output_sha256!==h.digest(JSON.stringify(rec.output)))throw Error('invalid_on_checkpoint_'+step);
  h.log('ON_RESUME',{step,revision,output_sha256:rec.output_sha256,assessment:rec.assessment,sha:old.sha});
  return rec;
 }
 const system='You are Silas in a separate off-curriculum graduate entrepreneurship test using your existing bound model. Respond independently, track assumptions, and maintain coherence with previous saved work. This test has thinking enabled. Return one complete JSON object; do not invent outside verification or pretend erroneous figures passed.';
 const original=revision?prior.at(-1):null;
 const ask=revision?
  'Your saved stage-2 arithmetic had errors in these named fields: '+JSON.stringify(original?.assessment?.issues||[])+
  '. Original response: '+JSON.stringify(original?.output)+
  '. Recalculate A and B from original input without inheriting wrong values. Provide identical JSON stage=analysis_ab, source_ids=["CASE42-V1"], option_A, option_B, limitations. Show running cash expressions. No correct values are supplied.':
  task[step];
 const priorPayload=prior.map(p=>({step:p.step,revision:p.revision,output:p.output,output_sha256:p.output_sha256,assessment:p.assessment}));
 const user=ask+'\nFROZEN CASE AND DURABLE CHECKPOINTS:\n'+JSON.stringify({brief:frozenBrief(brief,step),prior:priorPayload});
 const start=Date.now();let r;
 try{r=await nvidiaChatCompletion({model:h.MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],
   temperature:0,jsonMode:true,enableThinking:true,maxTokens:4096,timeoutMs:300000});}
 catch(e){h.log('ON_BLOCKED',{step,revision,reason:'model_or_timeout',code:e.code||e.name||'error',elapsed_ms:Date.now()-start});return null;}
 let o;try{o=JSON.parse(String(r.content||''));}catch{o=null;}
 if(r.model_returned!==h.MODEL||r.finish_reason!=='stop'||!o||o.stage!==names[step]){
  h.log('ON_BLOCKED',{step,revision,reason:'incomplete_response',model_returned:r.model_returned,
      finish_reason:r.finish_reason,output_chars:String(r.content||'').length,reasoning_chars:String(r.reasoning_content||'').length,
      elapsed_ms:Date.now()-start});return null;
 }
 const assessment=inspect(brief,step,o,prior);
 const rec={contract:'model_cognition_continuity_arithmetic_thinking_on_v1',agent_id:h.AGENT,step,
  revision:revision?1:0,model_returned:r.model_returned,brief_sha:briefSha,thinking_requested:true,
  previous_output_sha256:prior.at(-1)?.output_sha256||null,input_sha256:h.digest(system+'\n'+user),
  input_chars:system.length+user.length,output_sha256:h.digest(JSON.stringify(o)),output_chars:String(r.content||'').length,
  reasoning_chars:String(r.reasoning_content||'').length,finish_reason:r.finish_reason,usage:r.usage||null,
  elapsed_ms:Date.now()-start,assessment,output:o};
 const saved=await h.save(oldPath,rec);
 h.log('ON_CHECKPOINT',{step,revision:rec.revision,elapsed_ms:rec.elapsed_ms,input_chars:rec.input_chars,
  output_chars:rec.output_chars,reasoning_chars:rec.reasoning_chars,finish_reason:rec.finish_reason,usage:rec.usage,
  passed:assessment.passed,issues:assessment.issues,output_sha256:rec.output_sha256,
  checkpoint_sha:saved.blob,commit:saved.commit,bytes:saved.bytes});
 return rec;
}
export async function runSilasThinkingOn(){
 if(!h.token||!process.env.NVIDIA_API_KEY)throw Error('on_pilot_credentials_missing');
 const phase=Number(process.env.AAU_SILAS_THINKING_ON_PHASE||2);
 if(![2,5].includes(phase))throw Error('invalid_on_pilot_phase');
 const f=await h.read(root+'/brief.json');if(!f)throw Error('on_pilot_brief_missing');
 const brief=JSON.parse(f.text);
 if(brief.agent_id!==h.AGENT||brief.bound_model!==h.MODEL||
   brief.scope!=='standalone_read_only_cognition_pilot_not_curriculum_or_grading')throw Error('on_pilot_scope_mismatch');
 h.log('ON_START',{agent_id:h.AGENT,model:h.MODEL,phase,brief_sha:f.sha,thinking_requested:true,
   off_curriculum:true,no_agent_state_mutation:true,normal_brain_packet:false});
 const prior=[];
 for(let n=1;n<=phase;n++){
  const row=await callStep(brief,f.sha,n,prior);
  if(!row){h.log('ON_RESULT',{status:'blocked',step:n});return;}
  prior.push(row);
  if(n===2&&!row.assessment.passed){
    const revised=await callStep(brief,f.sha,2,prior,{revision:true});
    if(revised)prior.push(revised);
  }
 }
 h.log('ON_RESULT',{status:phase===2?'durable_boundary':'complete_for_comparison',
  phase,step_count:prior.length,steps:prior.map(p=>({step:p.step,revision:p.revision,
     passed:p.assessment.passed,issues:p.assessment.issues,output_sha256:p.output_sha256}))});
}
