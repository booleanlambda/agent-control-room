// Silas-only off-curriculum engineering exercise with thinking ON and durable bounded steps.
// No normal wake, academic grading, lifecycle, or AAU-wide policy mutation.
import { createHash } from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';
const REPO='booleanlambda/agent-control-room';
const EVIDENCE_BRANCH='pilot/silas-engineering-hydraulic-20260924';
const ROOT='pilots/silas-engineering-hydraulic-20260924';
const MODEL='google/gemma-4-31b-it';
const AGENT='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82';
const token=String(process.env.AAU_GITHUB_TOKEN||'').trim();
const hash=s=>createHash('sha256').update(s).digest('hex');
const log=(n,d)=>console.log('AAU_SILAS_ENGINEERING_'+n,JSON.stringify(d));
async function gh(method,path,body){
 const url='https://api.github.com/repos/'+REPO+'/contents/'+path+(method==='GET'?'?ref='+encodeURIComponent(EVIDENCE_BRANCH):'');
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
 const p=await r.json();
 if(method==='GET'&&r.status===404)return null;
 if(!r.ok)throw Error('engineering_github_'+r.status+':'+String(p.message||'').slice(0,80));
 return p;
}
async function read(path){
 const f=await gh('GET',path);if(!f)return null;
 return {sha:f.sha,text:Buffer.from(String(f.content||'').replace(/\s/g,''),'base64').toString('utf8')};
}
async function save(path,row){
 const text=JSON.stringify(row,null,2)+'\n';
 const old=await read(path);
 if(old){
  if(old.text!==text)throw Error('engineering_checkpoint_conflict:'+path);
  return {blob:old.sha,reused:true};
 }
 const p=await gh('PUT',path,{branch:EVIDENCE_BRANCH,message:'Silas engineering checkpoint '+path.split('/').pop(),content:Buffer.from(text).toString('base64')});
 const back=await read(path);
 if(!back||back.text!==text||back.sha!==p.content.sha)throw Error('engineering_checkpoint_readback_failed');
 return {blob:back.sha,commit:p.commit.sha,reused:false,bytes:Buffer.byteLength(text)};
}
function expectedPipe(brief,diameter,length){
 const c=brief.constants,Q=c.daily_water_m3/c.pump_run_hours_per_day/3600;
 const area=Math.PI*diameter*diameter/4;
 const v=Q/area;
 const hf=c.darcy_f*(length/diameter)*(v*v/(2*c.g_m_s2));
 const hm=c.minor_loss_K*(v*v/(2*c.g_m_s2));
 const tdh=c.static_head_m+hf+hm;
 const hydraulic=c.rho_kg_m3*c.g_m_s2*Q*tdh;
 const inputW=hydraulic/(c.pump_efficiency*c.motor_efficiency*c.inverter_efficiency);
 return {Q_m3_s:Q,Q_L_s:Q*1000,velocity_m_s:v,hf_m:hf,hm_m:hm,TDH_m:tdh,electrical_input_kw:inputW/1000,required_rated_head_m:tdh*(1+c.head_margin_fraction)};
}
function near(a,b,tol=0.02){return Number.isFinite(Number(a))&&Math.abs(Number(a)-Number(b))<=tol;}
function pipeAudit(brief,pipe,output,length){
 const e=expectedPipe(brief,pipe.internal_diameter_m,length),issues=[];
 const checks={Q_m3_s:0.000002,Q_L_s:0.005,velocity_m_s:0.005,hf_m:0.03,hm_m:0.02,TDH_m:0.04,electrical_input_kw:0.005,required_rated_head_m:0.05};
 for(const [k,t] of Object.entries(checks))if(!near(output?.metrics?.[k],e[k],t))issues.push(k);
 const cost=length*pipe.installed_cost_usd_per_m;
 if(!near(output?.pipe_cost_usd,cost,0.01))issues.push('pipe_cost_usd');
 if(output?.velocity_pass!==(e.velocity_m_s<=brief.constants.max_pipe_velocity_m_s))issues.push('velocity_pass');
 if(output?.calculated_power_pass!==(e.electrical_input_kw<=brief.constants.max_continuous_electrical_kw))issues.push('calculated_power_pass');
 return {passed:issues.length===0,issues,expected:e,expected_pipe_cost_usd:cost};
}
function candidateMatrix(brief,length){
 const rows=[];
 for(const pipe of brief.pipe_options){
  const e=expectedPipe(brief,pipe.internal_diameter_m,length);
  for(const pump of brief.pump_options){
   const pipeCost=length*pipe.installed_cost_usd_per_m,total=pipeCost+pump.cost_usd;
   const pass={
    velocity:e.velocity_m_s<=brief.constants.max_pipe_velocity_m_s,
    calculated_power:e.electrical_input_kw<=brief.constants.max_continuous_electrical_kw,
    rated_head:pump.rated_head_m_at_design_flow>=e.required_rated_head_m,
    pump_rating:pump.max_electrical_input_kw<=brief.constants.max_continuous_electrical_kw,
    budget:total<=brief.constants.total_installed_budget_usd
   };
   rows.push({pipe:pipe.id,pump:pump.id,total_cost_usd:total,passes:pass,feasible:Object.values(pass).every(Boolean)});
  }
 }
 return rows;
}
async function modelCall({label,system,user,maxTokens=4096}){
 const started=Date.now();let r;
 try{r=await nvidiaChatCompletion({model:MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0,jsonMode:true,enableThinking:true,maxTokens,timeoutMs:300000});}
 catch(e){log('BLOCKED',{label,reason:'model_or_timeout',code:e?.code||e?.name||'error',elapsed_ms:Date.now()-started});return null;}
 let out;try{out=JSON.parse(String(r.content||''));}catch{out=null;}
 if(r.model_returned!==MODEL||r.finish_reason!=='stop'||!out){
  log('BLOCKED',{label,reason:'invalid_response',model_returned:r.model_returned,finish_reason:r.finish_reason,elapsed_ms:Date.now()-started,reasoning_chars:String(r.reasoning_content||'').length});
  return null;
 }
 return {out,r,elapsed_ms:Date.now()-started,reasoning_chars:String(r.reasoning_content||'').length};
}
async function persistModel(path,meta,call,assessment){
 const row={contract:'silas_engineering_hydraulic_design_v1',agent_id:AGENT,model_returned:call.r.model_returned,thinking_requested:true,
  ...meta,output_sha256:hash(JSON.stringify(call.out)),output_chars:String(call.r.content||'').length,
  reasoning_chars:call.reasoning_chars,finish_reason:call.r.finish_reason,usage:call.r.usage||null,elapsed_ms:call.elapsed_ms,
  assessment,output:call.out};
 const saved=await save(path,row);
 log('CHECKPOINT',{path,stage:meta.stage,substep:meta.substep||null,passed:assessment.passed,issues:assessment.issues,
  elapsed_ms:row.elapsed_ms,reasoning_tokens:row.usage?.completion_tokens_details?.reasoning_tokens||null,
  output_sha256:row.output_sha256,blob:saved.blob,commit:saved.commit||null});
 return row;
}
export async function runSilasEngineeringExercise(){
 if(!token||!process.env.NVIDIA_API_KEY)throw Error('engineering_credentials_missing');
 const briefFile=await read(ROOT+'/brief.json');if(!briefFile)throw Error('engineering_brief_missing');
 const brief=JSON.parse(briefFile.text);
 if(brief.agent_id!==AGENT||brief.bound_model!==MODEL||brief.thinking!==true)throw Error('engineering_scope_or_model_mismatch');
 log('START',{agent_id:AGENT,model:MODEL,thinking:true,brief_sha:briefFile.sha,off_curriculum:true,no_agent_state_mutation:true});
 const system='You are Silas completing an unfamiliar off-curriculum engineering design exercise with thinking enabled. Use the supplied engineering equations and constraints exactly. Preserve all constraints across steps; a feasible design must satisfy ALL constraints. Show enough equations and engineering reasoning to audit your work. Return complete JSON only. Do not invent external measurements, standards, supplier claims, or relax a constraint unless the source explicitly changes it.';
 // Stage 1
 let p1=await read(ROOT+'/step_1_plan.json'),plan;
 if(p1){plan=JSON.parse(p1.text);log('RESUME',{stage:1,sha:plan.output_sha256});}
 else{
  const user='Create the engineering calculation plan before computing a recommendation. Return JSON {"stage":"engineering_plan","source_ids":["ENG-V1"],"constraints":[all six constraints paraphrased without changing them],"calculation_sequence":[at least 6 concrete steps],"failure_modes":[at least 3],"assumptions":[at least 3]}. FROZEN CASE:'+JSON.stringify(brief);
  const call=await modelCall({label:'plan',system,user});if(!call)return;
  const issues=[];if(call.out.stage!=='engineering_plan')issues.push('stage');if(!Array.isArray(call.out.constraints)||call.out.constraints.length<6)issues.push('constraints');if(!Array.isArray(call.out.calculation_sequence)||call.out.calculation_sequence.length<6)issues.push('sequence');if(!Array.isArray(call.out.failure_modes)||call.out.failure_modes.length<3)issues.push('failure_modes');
  plan=await persistModel(ROOT+'/step_1_plan.json',{stage:1,brief_sha:briefFile.sha,input_sha256:hash(system+'\n'+user)},call,{passed:issues.length===0,issues});
 }
 // Stage 2 pipe calculations: three bounded independent substeps
 const pipeRows=[];
 for(const pipe of brief.pipe_options){
  const path=ROOT+'/step_2_'+pipe.id+'.json';const old=await read(path);
  if(old){const row=JSON.parse(old.text);pipeRows.push(row);log('RESUME',{stage:2,substep:pipe.id,sha:row.output_sha256,passed:row.assessment?.passed});continue;}
  const visible={source_id:'ENG-V1',constants:brief.constants,pipe,formulas:brief.equations};
  const user='Compute ONLY pipe '+pipe.id+' for the original 180 m route. Return JSON {"stage":"pipe_calculation","source_ids":["ENG-V1"],"pipe_id":"'+pipe.id+'","metrics":{"Q_m3_s":number,"Q_L_s":number,"velocity_m_s":number,"hf_m":number,"hm_m":number,"TDH_m":number,"electrical_input_kw":number,"required_rated_head_m":number},"pipe_cost_usd":number,"velocity_pass":boolean,"calculated_power_pass":boolean,"equations":["running equations"],"engineering_comment":"..."}. INPUT:'+JSON.stringify(visible);
  const call=await modelCall({label:'pipe_'+pipe.id,system,user,maxTokens:3072});if(!call)return;
  const assessment=pipeAudit(brief,pipe,call.out,brief.constants.route_length_m);
  const row=await persistModel(path,{stage:2,substep:pipe.id,brief_sha:briefFile.sha,prior_output_sha256:plan.output_sha256,input_sha256:hash(system+'\n'+user)},call,assessment);
  pipeRows.push(row);
 }
 // Stage 3 pump selection and constraint matrix
 let p3=await read(ROOT+'/step_3_selection.json'),selection;
 if(p3){selection=JSON.parse(p3.text);log('RESUME',{stage:3,sha:selection.output_sha256,passed:selection.assessment?.passed});}
 else{
  const prior=pipeRows.map(r=>({pipe_id:r.output.pipe_id,output_sha256:r.output_sha256,output:r.output,assessment:r.assessment}));
  const user='Using the three saved pipe calculations, evaluate every pipe/pump combination against ALL six original constraints. Return JSON {"stage":"design_selection","source_ids":["ENG-V1"],"prior_pipe_sha256":[exact three pipe output hashes in D40,D50,D63 order],"constraint_matrix":[9 rows each with pipe,pump,total_cost_usd,velocity_pass,calculated_power_pass,rated_head_pass,pump_rating_pass,budget_pass,feasible],"selected_design":{"pipe":"D40|D50|D63|NONE","pump":"P1|P2|P3|NONE"},"reasoning":"engineering rationale","unresolved_evidence":[...]}. Do not call a failed combination feasible. INPUT:'+JSON.stringify({constants:brief.constants,pumps:brief.pump_options,prior});
  const call=await modelCall({label:'selection',system,user});if(!call)return;
  const gold=candidateMatrix(brief,brief.constants.route_length_m),issues=[];
  if(call.out.stage!=='design_selection')issues.push('stage');
  if(call.out.selected_design?.pipe!=='D50'||call.out.selected_design?.pump!=='P2')issues.push('selected_design');
  if(!Array.isArray(call.out.constraint_matrix)||call.out.constraint_matrix.length!==9)issues.push('matrix_length');
  else for(const g of gold){const x=call.out.constraint_matrix.find(r=>r.pipe===g.pipe&&r.pump===g.pump);if(!x){issues.push('missing_'+g.pipe+'_'+g.pump);continue;}if(!near(x.total_cost_usd,g.total_cost_usd,0.01)||x.feasible!==g.feasible)issues.push('matrix_'+g.pipe+'_'+g.pump);}
  const shas=pipeRows.map(r=>r.output_sha256);if(JSON.stringify(call.out.prior_pipe_sha256)!==JSON.stringify(shas))issues.push('prior_hashes');
  selection=await persistModel(ROOT+'/step_3_selection.json',{stage:3,brief_sha:briefFile.sha,prior_output_sha256:pipeRows.at(-1).output_sha256,input_sha256:hash(system+'\n'+user)},call,{passed:issues.length===0,issues});
 }
 // Stage 4 changed route: recompute all three pipe hydraulics as bounded substeps
 const routeRows=[];
 for(const pipe of brief.pipe_options){
  const path=ROOT+'/step_4_'+pipe.id+'_route_v2.json';const old=await read(path);
  if(old){const row=JSON.parse(old.text);routeRows.push(row);log('RESUME',{stage:4,substep:pipe.id,sha:row.output_sha256,passed:row.assessment?.passed});continue;}
  const user='NEW SOURCE ROUTE-V2: route length changes from 180 m to 260 m; every other frozen input and EVERY ORIGINAL CONSTRAINT is unchanged. Recompute ONLY pipe '+pipe.id+'. Return JSON {"stage":"route_v2_pipe","source_ids":["ENG-V1","ROUTE-V2"],"pipe_id":"'+pipe.id+'","metrics":{"Q_m3_s":number,"Q_L_s":number,"velocity_m_s":number,"hf_m":number,"hm_m":number,"TDH_m":number,"electrical_input_kw":number,"required_rated_head_m":number},"pipe_cost_usd":number,"velocity_pass":boolean,"calculated_power_pass":boolean,"equations":["..."],"engineering_comment":"..."}. INPUT:'+JSON.stringify({constants:{...brief.constants,route_length_m:260},pipe,formulas:brief.equations});
  const call=await modelCall({label:'route_v2_'+pipe.id,system,user,maxTokens:3072});if(!call)return;
  const assessment=pipeAudit(brief,pipe,call.out,260);
  const row=await persistModel(path,{stage:4,substep:pipe.id,brief_sha:briefFile.sha,source_ids:['ENG-V1','ROUTE-V2'],prior_output_sha256:selection.output_sha256,input_sha256:hash(system+'\n'+user)},call,assessment);
  routeRows.push(row);
 }
 // Stage 4b changed-route final feasibility
 let changedFile=await read(ROOT+'/step_4_feasibility.json'),changed;
 if(changedFile){changed=JSON.parse(changedFile.text);log('RESUME',{stage:'4b',sha:changed.output_sha256,passed:changed.assessment?.passed});}
 else{
  const prior=routeRows.map(r=>({pipe_id:r.output.pipe_id,output_sha256:r.output_sha256,output:r.output,assessment:r.assessment}));
  const user='Using ROUTE-V2 recalculations, re-evaluate every pipe/pump combination against the unchanged six original constraints. Return JSON {"stage":"route_v2_feasibility","source_ids":["ENG-V1","ROUTE-V2"],"prior_route_sha256":[exact D40,D50,D63 hashes],"constraint_matrix":[9 rows with pipe,pump,total_cost_usd,velocity_pass,calculated_power_pass,rated_head_pass,pump_rating_pass,budget_pass,feasible],"selected_design":{"pipe":"...|NONE","pump":"...|NONE"},"decision":"...","constraints_preserved":[all six],"next_engineering_actions":[...]}. If nothing passes every constraint, selected_design MUST be NONE/NONE; do not choose least-worst. INPUT:'+JSON.stringify({constants:{...brief.constants,route_length_m:260},pumps:brief.pump_options,prior});
  const call=await modelCall({label:'route_v2_feasibility',system,user});if(!call)return;
  const gold=candidateMatrix(brief,260),issues=[];
  if(call.out.selected_design?.pipe!=='NONE'||call.out.selected_design?.pump!=='NONE')issues.push('must_select_none');
  if(!Array.isArray(call.out.constraint_matrix)||call.out.constraint_matrix.length!==9)issues.push('matrix_length');
  else for(const g of gold){const x=call.out.constraint_matrix.find(r=>r.pipe===g.pipe&&r.pump===g.pump);if(!x){issues.push('missing_'+g.pipe+'_'+g.pump);continue;}if(!near(x.total_cost_usd,g.total_cost_usd,0.01)||x.feasible!==g.feasible)issues.push('matrix_'+g.pipe+'_'+g.pump);}
  if(gold.some(g=>g.feasible))issues.push('gold_unexpected_feasible');
  changed=await persistModel(ROOT+'/step_4_feasibility.json',{stage:4,substep:'feasibility',brief_sha:briefFile.sha,source_ids:['ENG-V1','ROUTE-V2'],prior_output_sha256:routeRows.at(-1).output_sha256,input_sha256:hash(system+'\n'+user)},call,{passed:issues.length===0,issues});
 }
 // Stage 5 memo
 let memoFile=await read(ROOT+'/step_5_engineering_memo.json');
 if(!memoFile){
  const history=[plan,...pipeRows,selection,...routeRows,changed].map(r=>({stage:r.stage,substep:r.substep||null,output_sha256:r.output_sha256,assessment:r.assessment,output:r.output}));
  const user='Write the final engineering design memo. Preserve the original six constraints, explain the original 180 m recommendation, explain what ROUTE-V2 changed, and state whether a feasible design still exists. Do not call a constraint breach acceptable. Return JSON {"stage":"engineering_memo","source_ids":["ENG-V1","ROUTE-V2"],"previous_output_sha256":[all preceding checkpoint output hashes in exact supplied order],"original_design":"...","route_v2_design":"...","memo":"at least 1200 characters with equations/results/engineering interpretation","constraint_summary":[...],"unresolved_evidence":[...],"next_actions":[...]}. HISTORY:'+JSON.stringify(history);
  const call=await modelCall({label:'memo',system,user});if(!call)return;
  const issues=[];if(call.out.stage!=='engineering_memo')issues.push('stage');if(String(call.out.memo||'').length<1200)issues.push('memo_length');
  const shas=history.map(h=>h.output_sha256);if(JSON.stringify(call.out.previous_output_sha256)!==JSON.stringify(shas))issues.push('history_hashes');
  if(!String(call.out.route_v2_design||'').toUpperCase().includes('NO FEASIBLE')&&!String(call.out.memo||'').toUpperCase().includes('NO FEASIBLE'))issues.push('route_v2_conclusion');
  await persistModel(ROOT+'/step_5_engineering_memo.json',{stage:5,brief_sha:briefFile.sha,source_ids:['ENG-V1','ROUTE-V2'],prior_output_sha256:changed.output_sha256,input_sha256:hash(system+'\n'+user)},call,{passed:issues.length===0,issues});
 }
 log('RESULT',{status:'complete',thinking:true,original_expected_design:'D50+P2',route_v2_expected_design:'NONE',no_agent_state_mutation:true});
}
