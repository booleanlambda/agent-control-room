// Silas-only continuation after ROUTE-V2 all-matrix timeout.
// Splits pump screening by pipe, persists each result, then asks Silas for the changed-route decision and final memo.
// No task/constraint changes; no grading, lifecycle, or AAU-wide policy mutation.
import { createHash } from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';

const REPO='booleanlambda/agent-control-room';
const BRANCH='pilot/silas-engineering-hydraulic-20260924';
const ROOT='pilots/silas-engineering-hydraulic-20260924';
const AGENT='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82';
const MODEL='google/gemma-4-31b-it';
const token=String(process.env.AAU_GITHUB_TOKEN||'').trim();
const digest=x=>createHash('sha256').update(x).digest('hex');
const log=(name,data)=>console.log('AAU_SILAS_ENGINEERING_CONT_'+name,JSON.stringify(data));

async function gh(method,path,body){
 const url='https://api.github.com/repos/'+REPO+'/contents/'+path+(method==='GET'?'?ref='+encodeURIComponent(BRANCH):'');
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
 const p=await r.json(); if(method==='GET'&&r.status===404)return null;
 if(!r.ok)throw Error('engineering_cont_github_'+r.status+':'+String(p.message||'').slice(0,80)); return p;
}
async function read(path){
 const f=await gh('GET',path); if(!f)return null;
 return {sha:f.sha,text:Buffer.from(String(f.content||'').replace(/\s/g,''),'base64').toString('utf8')};
}
async function save(path,row){
 const text=JSON.stringify(row,null,2)+'\n',old=await read(path);
 if(old){
   const prior=JSON.parse(old.text);
   if(prior.output_sha256!==row.output_sha256)throw Error('engineering_cont_checkpoint_conflict:'+path);
   return {blob:old.sha,reused:true};
 }
 const p=await gh('PUT',path,{branch:BRANCH,message:'Silas engineering continuation '+path.split('/').pop(),content:Buffer.from(text).toString('base64')});
 const back=await read(path); if(!back||back.text!==text||back.sha!==p.content.sha)throw Error('engineering_cont_readback_failed');
 return {blob:back.sha,commit:p.commit.sha,reused:false};
}
function truthForPipe(brief,route,pid){
 const pipe=brief.pipe_options.find(x=>x.id===pid),rows=[];
 for(const pump of brief.pump_options){
   const total=Number(route.output.pipe_cost_usd)+pump.cost_usd;
   const pass={
     velocity:Boolean(route.output.velocity_pass),
     calculated_power:Boolean(route.output.calculated_power_pass),
     rated_head:pump.rated_head_m_at_design_flow>=Number(route.output.metrics.required_rated_head_m),
     pump_rating:pump.max_electrical_input_kw<=brief.constants.max_continuous_electrical_kw,
     budget:total<=brief.constants.total_installed_budget_usd
   };
   rows.push({pipe:pid,pump:pump.id,total_cost_usd:total,velocity_pass:pass.velocity,calculated_power_pass:pass.calculated_power,
     rated_head_pass:pass.rated_head,pump_rating_pass:pass.pump_rating,budget_pass:pass.budget,feasible:Object.values(pass).every(Boolean)});
 }
 return rows;
}
function screenAudit(brief,route,out){
 const issues=[],truth=truthForPipe(brief,route,route.output.pipe_id);
 if(out.stage!=='route_v2_pipe_pump_screen')issues.push('stage');
 if(out.pipe_id!==route.output.pipe_id)issues.push('pipe_id');
 if(out.prior_route_output_sha256!==route.output_sha256)issues.push('prior_route_hash');
 if(!Array.isArray(out.rows)||out.rows.length!==3)issues.push('row_count');
 else for(const g of truth){
   const x=out.rows.find(r=>r.pipe===g.pipe&&r.pump===g.pump);
   if(!x){issues.push('missing_'+g.pump);continue;}
   for(const k of ['total_cost_usd'])if(Math.abs(Number(x[k])-Number(g[k]))>0.01)issues.push(g.pump+'_'+k);
   for(const k of ['velocity_pass','calculated_power_pass','rated_head_pass','pump_rating_pass','budget_pass','feasible'])
     if(x[k]!==g[k])issues.push(g.pump+'_'+k);
 }
 return {passed:issues.length===0,issues,expected:truth};
}
async function invoke(label,system,user,maxTokens=3072,timeoutMs=240000){
 const started=Date.now();let r;
 try{r=await nvidiaChatCompletion({model:MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],
   temperature:0,jsonMode:true,enableThinking:true,maxTokens,timeoutMs});}
 catch(e){log('BLOCKED',{label,reason:'model_or_timeout',code:e?.code||e?.name||'error',elapsed_ms:Date.now()-started});return null;}
 let o;try{o=JSON.parse(String(r.content||''));}catch{o=null;}
 if(r.model_returned!==MODEL||r.finish_reason!=='stop'||!o){
   log('BLOCKED',{label,reason:'invalid_or_incomplete',model_returned:r.model_returned,finish_reason:r.finish_reason,
      elapsed_ms:Date.now()-started,reasoning_chars:String(r.reasoning_content||'').length});return null;
 }
 return {o,r,elapsed_ms:Date.now()-started,reasoning_chars:String(r.reasoning_content||'').length};
}
async function persist(path,meta,call,assessment){
 const row={contract:'silas_engineering_hydraulic_design_v1',agent_id:AGENT,model_returned:call.r.model_returned,
   thinking_requested:true,...meta,output_sha256:digest(JSON.stringify(call.o)),output_chars:String(call.r.content||'').length,
   reasoning_chars:call.reasoning_chars,finish_reason:call.r.finish_reason,usage:call.r.usage||null,elapsed_ms:call.elapsed_ms,
   assessment,output:call.o};
 const s=await save(path,row);
 log('CHECKPOINT',{path,stage:meta.stage,substep:meta.substep||null,passed:assessment.passed,issues:assessment.issues,
   elapsed_ms:row.elapsed_ms,reasoning_tokens:row.usage?.completion_tokens_details?.reasoning_tokens||null,
   output_sha256:row.output_sha256,blob:s.blob,commit:s.commit||null});
 return row;
}
export async function runSilasEngineeringFeasibilityContinuation(){
 if(!token||!process.env.NVIDIA_API_KEY)throw Error('engineering_cont_credentials_missing');
 const bf=await read(ROOT+'/brief.json');if(!bf)throw Error('engineering_cont_brief_missing');
 const brief=JSON.parse(bf.text);
 if(brief.agent_id!==AGENT||brief.bound_model!==MODEL||brief.thinking!==true)throw Error('engineering_cont_scope_mismatch');
 const selectionFile=await read(ROOT+'/step_3_selection.json');if(!selectionFile)throw Error('engineering_cont_selection_missing');
 const selection=JSON.parse(selectionFile.text);
 const route=[];
 for(const pid of ['D40','D50','D63']){
   const f=await read(ROOT+'/step_4_'+pid+'_route_v2.json');if(!f)throw Error('engineering_cont_route_missing_'+pid);
   const row=JSON.parse(f.text);if(!row.assessment?.passed||row.output?.pipe_id!==pid)throw Error('engineering_cont_route_invalid_'+pid);
   route.push(row);
 }
 log('START',{agent_id:AGENT,model:MODEL,thinking:true,brief_sha:bf.sha,route_sha256:route.map(x=>x.output_sha256),
   prior_selection_sha256:selection.output_sha256,prior_selection_issues:selection.assessment?.issues||[],preserve_all_constraints:true});
 const system='You are Silas continuing an unfamiliar off-curriculum engineering exercise with thinking enabled. The hydraulic calculations supplied are saved prior work. Evaluate the pump candidates exactly against the six frozen constraints. A combination is feasible only if ALL constraints pass. Never reinterpret a failed constraint as acceptable or choose a least-worst design. Return complete JSON only.';
 const screens=[];
 for(const row of route){
   const pid=row.output.pipe_id,path=ROOT+'/step_4_screen_'+pid+'.json',old=await read(path);
   if(old){
     const rec=JSON.parse(old.text);screens.push(rec);log('RESUME',{stage:4,substep:'screen_'+pid,sha:rec.output_sha256,passed:rec.assessment?.passed});continue;
   }
   const user='Screen exactly the three pump candidates against the SAVED ROUTE-V2 calculation for pipe '+pid+'. Return JSON {"stage":"route_v2_pipe_pump_screen","source_ids":["ENG-V1","ROUTE-V2"],"pipe_id":"'+pid+'","prior_route_output_sha256":"'+row.output_sha256+'","rows":[three rows each with pipe,pump,total_cost_usd,velocity_pass,calculated_power_pass,rated_head_pass,pump_rating_pass,budget_pass,feasible],"engineering_comment":"..."}. Constraints: '+JSON.stringify(brief.constraints)+' Pump candidates: '+JSON.stringify(brief.pump_options)+' SAVED PIPE RESULT: '+JSON.stringify(row.output);
   const call=await invoke('screen_'+pid,system,user,3072,240000);if(!call)return;
   const assessment=screenAudit(brief,row,call.o);
   const rec=await persist(path,{stage:4,substep:'screen_'+pid,brief_sha:bf.sha,source_ids:['ENG-V1','ROUTE-V2'],
      prior_output_sha256:row.output_sha256,input_sha256:digest(system+'\n'+user)},call,assessment);
   screens.push(rec);
 }
 // Assemble validated changed-route matrix; preserves Silas's screen outputs.
 const matrix=screens.flatMap(x=>x.output.rows);
 const anyFeasible=matrix.some(x=>x.feasible===true);
 let summaryFile=await read(ROOT+'/step_4_feasibility.json'),summary;
 if(summaryFile){summary=JSON.parse(summaryFile.text);log('RESUME',{stage:4,substep:'feasibility',sha:summary.output_sha256,passed:summary.assessment?.passed});}
 else{
   const user='Make the changed-route engineering decision using these three saved pump-screen checkpoints. Preserve every original constraint. Because feasibility is an AND across all constraints, do not select a design if no row has feasible=true. Return JSON {"stage":"route_v2_feasibility","source_ids":["ENG-V1","ROUTE-V2"],"prior_screen_sha256":[exact D40,D50,D63 screen hashes],"constraint_matrix":[exact nine supplied screening rows],"selected_design":{"pipe":"D40|D50|D63|NONE","pump":"P1|P2|P3|NONE"},"decision":"...","constraints_preserved":[all six],"reasoning":"...","next_engineering_actions":[...]}. ORIGINAL CONSTRAINTS:'+JSON.stringify(brief.constraints)+' ORIGINAL SELECTION RECORD (including its audit status):'+JSON.stringify({output_sha256:selection.output_sha256,assessment:selection.assessment,output:selection.output})+' ROUTE-V2 SCREENS:'+JSON.stringify(screens.map(x=>({output_sha256:x.output_sha256,assessment:x.assessment,output:x.output})));
   const call=await invoke('route_v2_decision',system,user,3072,240000);if(!call)return;
   const issues=[];
   const expectedShas=screens.map(x=>x.output_sha256);
   if(call.o.stage!=='route_v2_feasibility')issues.push('stage');
   if(JSON.stringify(call.o.prior_screen_sha256)!==JSON.stringify(expectedShas))issues.push('prior_screen_hashes');
   if(!Array.isArray(call.o.constraint_matrix)||call.o.constraint_matrix.length!==9)issues.push('matrix_count');
   else for(const g of matrix){
     const x=call.o.constraint_matrix.find(r=>r.pipe===g.pipe&&r.pump===g.pump);
     if(!x||JSON.stringify(x)!==JSON.stringify(g))issues.push('matrix_'+g.pipe+'_'+g.pump);
   }
   if(anyFeasible){issues.push('unexpected_test_fixture_feasible');}
   if(call.o.selected_design?.pipe!=='NONE'||call.o.selected_design?.pump!=='NONE')issues.push('must_select_none');
   if(!Array.isArray(call.o.constraints_preserved)||call.o.constraints_preserved.length<6)issues.push('constraints_preserved');
   summary=await persist(ROOT+'/step_4_feasibility.json',{stage:4,substep:'feasibility',brief_sha:bf.sha,source_ids:['ENG-V1','ROUTE-V2'],
     prior_output_sha256:screens.at(-1).output_sha256,input_sha256:digest(system+'\n'+user)},call,{passed:issues.length===0,issues});
 }
 // Final memo: continuity, original-selection error, changed-route decision.
 let memoFile=await read(ROOT+'/step_5_engineering_memo.json');
 if(memoFile){const m=JSON.parse(memoFile.text);log('RESULT',{status:'already_complete',memo_sha256:m.output_sha256,passed:m.assessment?.passed});return;}
 const history=[
   {label:'original_selection',output_sha256:selection.output_sha256,assessment:selection.assessment,output:selection.output},
   ...route.map(x=>({label:'route_'+x.output.pipe_id,output_sha256:x.output_sha256,assessment:x.assessment,output:x.output})),
   ...screens.map(x=>({label:'screen_'+x.output.pipe_id,output_sha256:x.output_sha256,assessment:x.assessment,output:x.output})),
   {label:'route_v2_feasibility',output_sha256:summary.output_sha256,assessment:summary.assessment,output:summary.output}
 ];
 const memoSystem='You are Silas writing the final engineering memo for the same off-curriculum exercise with thinking enabled. Be technically explicit, preserve every frozen constraint, distinguish verified calculation outputs from assumptions, and acknowledge any earlier audit error instead of hiding it. Do not call a constraint-violating design feasible. Return complete JSON only.';
 const memoUser='Write a final engineering design memo of at least 1200 characters. Explain the original 180 m design and the one earlier D50/P3 constraint-matrix audit error, then explain the 260 m ROUTE-V2 results and whether any design remains feasible. Return JSON {"stage":"engineering_memo","source_ids":["ENG-V1","ROUTE-V2"],"previous_output_sha256":[all HISTORY hashes in exact order],"original_design":"...","route_v2_design":"...","memo":"...","constraint_summary":[...],"acknowledged_errors":[...],"unresolved_evidence":[...],"next_actions":[...]}. HISTORY:'+JSON.stringify(history);
 const call=await invoke('engineering_memo',memoSystem,memoUser,4096,300000);if(!call)return;
 const issues=[],expectedHistory=history.map(x=>x.output_sha256);
 if(call.o.stage!=='engineering_memo')issues.push('stage');
 if(String(call.o.memo||'').length<1200)issues.push('memo_length');
 if(JSON.stringify(call.o.previous_output_sha256)!==JSON.stringify(expectedHistory))issues.push('history_hashes');
 const noFeasible=(String(call.o.route_v2_design||'')+' '+String(call.o.memo||'')).toUpperCase().includes('NO FEASIBLE');
 if(!noFeasible)issues.push('route_v2_must_state_no_feasible');
 if(!Array.isArray(call.o.acknowledged_errors)||!call.o.acknowledged_errors.some(x=>String(x).includes('D50')&&String(x).includes('P3')))issues.push('prior_matrix_error_not_acknowledged');
 const memo=await persist(ROOT+'/step_5_engineering_memo.json',{stage:5,brief_sha:bf.sha,source_ids:['ENG-V1','ROUTE-V2'],
   prior_output_sha256:summary.output_sha256,input_sha256:digest(memoSystem+'\n'+memoUser)},call,{passed:issues.length===0,issues});
 log('RESULT',{status:'complete',thinking:true,route_v2_any_feasible:anyFeasible,final_memo_passed:memo.assessment.passed,
   memo_issues:memo.assessment.issues,original_selection_issues:selection.assessment?.issues||[]});
}
