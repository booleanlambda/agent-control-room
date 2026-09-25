// Silas-only one-combination continuation after a multi-pump screening timeout.
// Produces model-authored pump/pipe rows, audits them deterministically, assembles pipe screens,
// then resumes the existing engineering feasibility continuation.
import { createHash } from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';

const REPO='booleanlambda/agent-control-room';
const BRANCH='pilot/silas-engineering-hydraulic-20260924';
const ROOT='pilots/silas-engineering-hydraulic-20260924';
const AGENT='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82';
const MODEL='google/gemma-4-31b-it';
const token=String(process.env.AAU_GITHUB_TOKEN||'').trim();
const digest=x=>createHash('sha256').update(x).digest('hex');
const log=(n,d)=>console.log('AAU_SILAS_ENGINEERING_SINGLE_'+n,JSON.stringify(d));

async function gh(method,path,body){
 const url='https://api.github.com/repos/'+REPO+'/contents/'+path+(method==='GET'?'?ref='+encodeURIComponent(BRANCH):'');
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
 const p=await r.json(); if(method==='GET'&&r.status===404)return null;
 if(!r.ok)throw Error('engineering_single_github_'+r.status+':'+String(p.message||'').slice(0,80)); return p;
}
async function read(path){const f=await gh('GET',path);return f?{sha:f.sha,text:Buffer.from(String(f.content||'').replace(/\s/g,''),'base64').toString('utf8')}:null;}
async function save(path,row){
 const text=JSON.stringify(row,null,2)+'\n',old=await read(path);
 if(old){const p=JSON.parse(old.text);if(p.output_sha256!==row.output_sha256)throw Error('engineering_single_conflict:'+path);return {blob:old.sha,reused:true};}
 const p=await gh('PUT',path,{branch:BRANCH,message:'Silas engineering single pump '+path.split('/').pop(),content:Buffer.from(text).toString('base64')});
 const back=await read(path);if(!back||back.text!==text||back.sha!==p.content.sha)throw Error('engineering_single_readback');return {blob:back.sha,commit:p.commit.sha,reused:false};
}
function truth(brief,route,pump){
 const total=Number(route.output.pipe_cost_usd)+pump.cost_usd;
 const out={
   pipe:route.output.pipe_id,pump:pump.id,total_cost_usd:total,
   velocity_pass:Boolean(route.output.velocity_pass),
   calculated_power_pass:Boolean(route.output.calculated_power_pass),
   rated_head_pass:pump.rated_head_m_at_design_flow>=Number(route.output.metrics.required_rated_head_m),
   pump_rating_pass:pump.max_electrical_input_kw<=brief.constants.max_continuous_electrical_kw,
   budget_pass:total<=brief.constants.total_installed_budget_usd
 };
 out.feasible=out.velocity_pass&&out.calculated_power_pass&&out.rated_head_pass&&out.pump_rating_pass&&out.budget_pass;
 return out;
}
function auditRow(brief,route,pump,o){
 const g=truth(brief,route,pump),issues=[];
 if(o.stage!=='route_v2_single_candidate')issues.push('stage');
 if(o.pipe!==g.pipe||o.pump!==g.pump)issues.push('identity');
 if(o.prior_route_output_sha256!==route.output_sha256)issues.push('route_hash');
 for(const k of ['total_cost_usd'])if(Math.abs(Number(o[k])-Number(g[k]))>0.01)issues.push(k);
 for(const k of ['velocity_pass','calculated_power_pass','rated_head_pass','pump_rating_pass','budget_pass','feasible'])
   if(o[k]!==g[k])issues.push(k);
 return {passed:issues.length===0,issues,expected:g};
}
async function call(label,system,user){
 const t=Date.now();let r;
 try{r=await nvidiaChatCompletion({model:MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],
   temperature:0,jsonMode:true,enableThinking:true,maxTokens:2048,timeoutMs:180000});}
 catch(e){log('BLOCKED',{label,reason:'model_or_timeout',code:e?.code||e?.name||'error',elapsed_ms:Date.now()-t});return null;}
 let o;try{o=JSON.parse(String(r.content||''));}catch{o=null;}
 if(r.model_returned!==MODEL||r.finish_reason!=='stop'||!o){
   log('BLOCKED',{label,reason:'invalid_or_incomplete',finish_reason:r.finish_reason,model_returned:r.model_returned,elapsed_ms:Date.now()-t});return null;
 }
 return {o,r,elapsed_ms:Date.now()-t,reasoning_chars:String(r.reasoning_content||'').length};
}
async function persist(path,meta,call,assessment){
 const row={contract:'silas_engineering_hydraulic_design_v1',agent_id:AGENT,model_returned:call.r.model_returned,thinking_requested:true,
   ...meta,output_sha256:digest(JSON.stringify(call.o)),output_chars:String(call.r.content||'').length,reasoning_chars:call.reasoning_chars,
   finish_reason:call.r.finish_reason,usage:call.r.usage||null,elapsed_ms:call.elapsed_ms,assessment,output:call.o};
 const s=await save(path,row);
 log('CHECKPOINT',{path,stage:meta.stage,substep:meta.substep,passed:assessment.passed,issues:assessment.issues,
   elapsed_ms:row.elapsed_ms,reasoning_tokens:row.usage?.completion_tokens_details?.reasoning_tokens||null,
   output_sha256:row.output_sha256,blob:s.blob,commit:s.commit||null});
 return row;
}
export async function runSilasEngineeringSinglePumpRecovery(){
 if(!token||!process.env.NVIDIA_API_KEY)throw Error('engineering_single_credentials_missing');
 const bf=await read(ROOT+'/brief.json');if(!bf)throw Error('engineering_single_brief_missing');
 const brief=JSON.parse(bf.text);
 if(brief.agent_id!==AGENT||brief.bound_model!==MODEL||brief.thinking!==true)throw Error('engineering_single_scope_mismatch');
 const system='You are Silas continuing the same off-curriculum hydraulic engineering exercise with thinking ON. Evaluate exactly ONE pump/pipe combination against all six frozen constraints. Feasible means every constraint passes. Do not reinterpret or relax any constraint. Return complete JSON only.';
 log('START',{agent_id:AGENT,model:MODEL,thinking:true,brief_sha:bf.sha,pipes:['D50','D63'],one_candidate_per_checkpoint:true});
 for(const pid of ['D50','D63']){
   const rf=await read(ROOT+'/step_4_'+pid+'_route_v2.json');if(!rf)throw Error('engineering_single_route_missing_'+pid);
   const route=JSON.parse(rf.text);if(!route.assessment?.passed)throw Error('engineering_single_route_unverified_'+pid);
   const rows=[];
   for(const pump of brief.pump_options){
     const partPath=ROOT+'/step_4_screen_'+pid+'_'+pump.id+'.json';
     const old=await read(partPath);
     if(old){const rec=JSON.parse(old.text);rows.push(rec);log('RESUME',{pipe:pid,pump:pump.id,sha:rec.output_sha256,passed:rec.assessment?.passed});continue;}
     const user='Evaluate this single candidate. Return JSON {"stage":"route_v2_single_candidate","source_ids":["ENG-V1","ROUTE-V2"],"pipe":"'+pid+'","pump":"'+pump.id+'","prior_route_output_sha256":"'+route.output_sha256+'","total_cost_usd":number,"velocity_pass":boolean,"calculated_power_pass":boolean,"rated_head_pass":boolean,"pump_rating_pass":boolean,"budget_pass":boolean,"feasible":boolean,"reasoning":"brief engineering explanation"}. ORIGINAL CONSTRAINTS:'+JSON.stringify(brief.constraints)+' ROUTE-V2 PIPE RESULT:'+JSON.stringify(route.output)+' PUMP:'+JSON.stringify(pump);
     const c=await call(pid+'_'+pump.id,system,user);if(!c)return;
     const assessment=auditRow(brief,route,pump,c.o);
     const rec=await persist(partPath,{stage:4,substep:'screen_'+pid+'_'+pump.id,brief_sha:bf.sha,
       source_ids:['ENG-V1','ROUTE-V2'],prior_output_sha256:route.output_sha256,input_sha256:digest(system+'\n'+user)},c,assessment);
     rows.push(rec);
   }
   const screenPath=ROOT+'/step_4_screen_'+pid+'.json';
   const prior=await read(screenPath);
   if(!prior){
     const out={stage:'route_v2_pipe_pump_screen',source_ids:['ENG-V1','ROUTE-V2'],pipe_id:pid,
       prior_route_output_sha256:route.output_sha256,rows:rows.map(x=>({
         pipe:x.output.pipe,pump:x.output.pump,total_cost_usd:x.output.total_cost_usd,
         velocity_pass:x.output.velocity_pass,calculated_power_pass:x.output.calculated_power_pass,
         rated_head_pass:x.output.rated_head_pass,pump_rating_pass:x.output.pump_rating_pass,
         budget_pass:x.output.budget_pass,feasible:x.output.feasible
       })),engineering_comment:'Assembled from three independently generated thinking-ON single-candidate checkpoints.',
       bounded_candidate_sha256:rows.map(x=>x.output_sha256)};
     const failed=rows.filter(x=>!x.assessment?.passed);
     const rec={contract:'silas_engineering_hydraulic_design_v1',agent_id:AGENT,model_returned:MODEL,thinking_requested:true,
       stage:4,substep:'screen_'+pid,brief_sha:bf.sha,source_ids:['ENG-V1','ROUTE-V2'],prior_output_sha256:route.output_sha256,
       output_sha256:digest(JSON.stringify(out)),output_chars:JSON.stringify(out).length,reasoning_chars:rows.reduce((a,x)=>a+(x.reasoning_chars||0),0),
       finish_reason:'assembled_complete_substeps',usage:{parts:rows.map(x=>x.usage)},elapsed_ms:rows.reduce((a,x)=>a+(x.elapsed_ms||0),0),
       assessment:{passed:failed.length===0,issues:failed.flatMap(x=>(x.assessment?.issues||[]).map(i=>x.output.pump+'_'+i))},output:out};
     const s=await save(screenPath,rec);log('ASSEMBLED',{pipe:pid,passed:rec.assessment.passed,issues:rec.assessment.issues,
       output_sha256:rec.output_sha256,blob:s.blob,commit:s.commit||null});
   }else{
     const rec=JSON.parse(prior.text);log('SCREEN_RESUME',{pipe:pid,sha:rec.output_sha256,passed:rec.assessment?.passed});
   }
 }
 log('RESULT',{status:'screens_ready',next:'resume_feasibility_continuation'});
 const {runSilasEngineeringFeasibilityContinuation}=await import('./silas-engineering-feasibility-continuation.js');
 return runSilasEngineeringFeasibilityContinuation();
}
