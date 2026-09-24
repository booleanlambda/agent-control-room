// Silas-only standalone pilot: bound model, frozen fictional task, immutable checkpoints.
// No normal wake, degree grading, course submission, resource mutation, or global policy.
import { createHash } from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';
const REPO='booleanlambda/agent-control-room';
const BRANCH='pilot/silas-bounded-continuation-20260924';
const ROOT='pilots/silas-bounded-continuation-20260924';
const MODEL='google/gemma-4-31b-it';
const AGENT='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82';
const digest=t=>createHash('sha256').update(t).digest('hex');
const token=String(process.env.AAU_GITHUB_TOKEN||'').trim();
const log=(name,data)=>console.log('AAU_SILAS_PILOT_'+name,JSON.stringify(data));
async function gh(method,path,body){
 const url='https://api.github.com/repos/'+REPO+'/contents/'+path+(method==='GET'?'?ref='+encodeURIComponent(BRANCH):'');
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
 const p=await r.json();
 if(method==='GET'&&r.status===404)return null;
 if(!r.ok)throw Error('pilot_github_'+r.status+':'+String(p.message||'').slice(0,70));
 return p;
}
async function read(path){
 const f=await gh('GET',path);return f?{sha:f.sha,text:Buffer.from(f.content.replace(/\s/g,''),'base64').toString('utf8')}:null;
}
async function save(path,record){
 const text=JSON.stringify(record,null,2)+'\n';
 if(await read(path))throw Error('checkpoint_exists_no_overwrite:'+path);
 const p=await gh('PUT',path,{branch:BRANCH,message:'Silas pilot checkpoint '+path.split('/').pop(),content:Buffer.from(text).toString('base64')});
 const back=await read(path);
 if(back?.text!==text||back?.sha!==p.content.sha)throw Error('checkpoint_readback_mismatch');
 return {commit:p.commit.sha,blob:back.sha,bytes:Buffer.byteLength(text)};
}
function gold(brief,option){
 let cash=brief.initial_cash-option.setup_day0,min=cash,minimum_day=0;
 const out={day0:cash};
 for(let d=1;d<=42;d++){
  cash-=option.daily_service+option.daily_fuel;
  if([14,28,35].includes(d))out['day'+d+'_pre']=cash;
  if(cash<min){min=cash;minimum_day=d;}
  for(const e of brief.cash_events)if(e.day===d)cash+=e.amount;
  if([14,28,35].includes(d))out['day'+d+'_post']=cash;
  if(cash<min){min=cash;minimum_day=d;}
 }
 return {...out,day42:cash,minimum_cash:min,minimum_day,constraint_pass:min>=brief.minimum_cash};
}
function check(n,v,brief,prior){
 const issues=[];
 const ledger=(key,got,opt)=>{
  const expected=gold(brief,opt);
  for(const [name,value] of Object.entries(expected))
   if(name==='constraint_pass'?got?.[name]!==value:!Number.isFinite(Number(got?.[name]))||Math.abs(Number(got[name])-value)>0.01)issues.push(key+'.'+name);
 };
 if(n===1&&(!Array.isArray(v.plan)||v.plan.length<4||!Array.isArray(v.evidence_to_validate)||v.evidence_to_validate.length<3))issues.push('plan_incomplete');
 if(n===2){ledger('A',v.option_A,brief.options.A);ledger('B',v.option_B,brief.options.B);}
 if(n===3){ledger('C',v.option_C,brief.options.C);if(v.recommended_option!=='A')issues.push('decision_v1');}
 if(n===4)ledger('A_requote',v.revised_A,{...brief.options.A,...brief.novel_variant.option_A_changes});
 if(n===5){
  if(String(v.memo||'').length<900)issues.push('memo_short');
  if(!Array.isArray(v.checkpoint_sha256)||prior.some((p,i)=>v.checkpoint_sha256[i]!==p.output_sha256))issues.push('prior_hash_reference_mismatch');
 }
 const source=n>=4?['CASE42-V1','QUOTE-V2']:['CASE42-V1'];
 if(!Array.isArray(v.source_ids)||source.some(id=>!v.source_ids.includes(id)))issues.push('source_coverage');
 return {passed:issues.length===0,issues};
}
const asks=[
 null,
 'Return JSON stage=plan, source_ids=[CASE42-V1], plan (4+ steps), evidence_to_validate (3+ distinct sources), method. Do not produce a numerical verdict. Plan the day-by-day cash check.',
 'Compute options A and B. Return JSON stage=analysis_ab, source_ids=[CASE42-V1], option_A and option_B each with numeric day0,day14_pre,day14_post,day28_pre,day28_post,day35_pre,day35_post,day42,minimum_cash,minimum_day, boolean constraint_pass, string formula; limitations array. Find minimum over all days, check pre/post events; exclude day70 sale from 42-day cash.',
 'Compute option C identically, use prior A/B, decide. Return JSON stage=decision_v1, source_ids=[CASE42-V1], option_C with same numeric fields, recommended_option A|B|C|NONE, decision, critical_assumptions (3+). Only evidence in the fictional case is supported.',
 'Fresh number transfer: rental daily_service=189,daily_fuel=55,setup_day0=480; other inputs unchanged. Recompute. Return JSON stage=fresh_transfer, source_ids=[CASE42-V1,QUOTE-V2], revised_A (same fields as option_A), decision_v2, method_retained. No imaginary secured funding.',
 'Synthesize final board memo from four immutable checkpoints with original and revised decisions, numerical findings, evidentiary limits and safeguards. Return JSON stage=final_memo, source_ids=[CASE42-V1,QUOTE-V2], base_decision, fresh_decision, checkpoint_sha256 (exact four prior output hashes), memo (900+ characters), unverified_claims (3+).'
];
const stageNames=['','plan','analysis_ab','decision_v1','fresh_transfer','final_memo'];
export const pilotHelpers={REPO,BRANCH,ROOT,MODEL,AGENT,digest,token,log,read,save,check,asks,stageNames};
