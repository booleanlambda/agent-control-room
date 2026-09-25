// Bounded continuation for Silas D63 after a complete thinking response could not fit 4096 tokens.
// No gold values are supplied to the model. Parts are independently persisted and then deterministically assembled.
import { createHash } from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';
import { runSilasEngineeringExercise } from './silas-engineering-hydraulic.js';
const REPO='booleanlambda/agent-control-room',BRANCH='pilot/silas-engineering-hydraulic-20260924',ROOT='pilots/silas-engineering-hydraulic-20260924';
const MODEL='google/gemma-4-31b-it',AGENT='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82';
const token=String(process.env.AAU_GITHUB_TOKEN||'').trim(),H=s=>createHash('sha256').update(s).digest('hex');
const log=(n,d)=>console.log('AAU_SILAS_ENGINEERING_D63_'+n,JSON.stringify(d));
async function gh(method,path,body){const u='https://api.github.com/repos/'+REPO+'/contents/'+path+(method==='GET'?'?ref='+encodeURIComponent(BRANCH):'');const r=await fetch(u,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});const p=await r.json();if(method==='GET'&&r.status===404)return null;if(!r.ok)throw Error('d63_github_'+r.status);return p;}
async function read(path){const f=await gh('GET',path);return f?{sha:f.sha,text:Buffer.from(f.content.replace(/\s/g,''),'base64').toString('utf8')}:null;}
async function save(path,row){const text=JSON.stringify(row,null,2)+'\n',old=await read(path);if(old){const prior=JSON.parse(old.text);if(prior.output_sha256!==row.output_sha256)throw Error('d63_checkpoint_conflict');return {blob:old.sha,reused:true};}const p=await gh('PUT',path,{branch:BRANCH,message:'Silas D63 bounded checkpoint '+path.split('/').pop(),content:Buffer.from(text).toString('base64')});const back=await read(path);if(back?.text!==text)throw Error('d63_readback_failed');return {blob:back.sha,commit:p.commit.sha};}
async function ask(label,system,user,maxTokens=3072){const t=Date.now();let r;try{r=await nvidiaChatCompletion({model:MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0,jsonMode:true,enableThinking:true,maxTokens,timeoutMs:240000});}catch(e){log('BLOCKED',{label,code:e.code||e.name,elapsed_ms:Date.now()-t});return null;}let o;try{o=JSON.parse(r.content);}catch{o=null;}if(r.model_returned!==MODEL||r.finish_reason!=='stop'||!o){log('BLOCKED',{label,finish_reason:r.finish_reason,reasoning_chars:String(r.reasoning_content||'').length,elapsed_ms:Date.now()-t});return null;}return {o,r,elapsed_ms:Date.now()-t,reasoning_chars:String(r.reasoning_content||'').length};}
export async function runSilasEngineeringD63Recovery(){
 if(!token||!process.env.NVIDIA_API_KEY)throw Error('d63_credentials_missing');
 const bf=await read(ROOT+'/brief.json'),p=await read(ROOT+'/step_1_plan.json'),d40=await read(ROOT+'/step_2_D40.json'),d50=await read(ROOT+'/step_2_D50.json');
 if(!bf||!p||!d40||!d50)throw Error('d63_prerequisites_missing');
 const brief=JSON.parse(bf.text),pipe=brief.pipe_options.find(x=>x.id==='D63');
 if(brief.agent_id!==AGENT||brief.bound_model!==MODEL||!pipe)throw Error('d63_scope_mismatch');
 const system='You are Silas doing one bounded part of an unfamiliar hydraulic engineering exercise with thinking ON. Use only supplied equations and data. Return concise complete JSON. Do not invent measurements or relax constraints.';
 let part1File=await read(ROOT+'/step_2_D63_hydraulics.json'),part1;
 if(part1File){part1=JSON.parse(part1File.text);log('RESUME',{part:'hydraulics',sha:part1.output_sha256});}
 else{
  const user='For pipe D63 ONLY, compute flow Q, cross-sectional area, velocity, Darcy friction head, minor-loss head, and total dynamic head for the original 180 m route. Stop there—do NOT compute power, pump selection, or cost. Return JSON {"stage":"D63_hydraulics","source_ids":["ENG-V1"],"metrics":{"Q_m3_s":number,"Q_L_s":number,"area_m2":number,"velocity_m_s":number,"hf_m":number,"hm_m":number,"TDH_m":number},"equations":["short equations"]}. INPUT:'+JSON.stringify({constants:brief.constants,pipe,formulas:brief.equations});
  const c=await ask('hydraulics',system,user,3072);if(!c)return;
  const issues=[];for(const k of ['Q_m3_s','Q_L_s','area_m2','velocity_m_s','hf_m','hm_m','TDH_m'])if(!Number.isFinite(Number(c.o.metrics?.[k])))issues.push(k);
  part1={agent_id:AGENT,model_returned:c.r.model_returned,brief_sha:bf.sha,step:2,part:'D63_hydraulics',thinking_requested:true,input_sha256:H(system+'\n'+user),output_sha256:H(JSON.stringify(c.o)),output_chars:c.r.content.length,reasoning_chars:c.reasoning_chars,usage:c.r.usage,finish_reason:c.r.finish_reason,elapsed_ms:c.elapsed_ms,assessment:{passed:issues.length===0,issues},output:c.o};
  const s=await save(ROOT+'/step_2_D63_hydraulics.json',part1);log('CHECKPOINT',{part:'hydraulics',passed:part1.assessment.passed,issues,elapsed_ms:c.elapsed_ms,reasoning_tokens:c.r.usage?.completion_tokens_details?.reasoning_tokens,sha:part1.output_sha256,blob:s.blob,commit:s.commit});
 }
 if(!part1.assessment?.passed)return;
 let part2File=await read(ROOT+'/step_2_D63_power_cost.json'),part2;
 if(part2File){part2=JSON.parse(part2File.text);log('RESUME',{part:'power_cost',sha:part2.output_sha256});}
 else{
  const user='Continue pipe D63 from the SAVED hydraulic checkpoint. Using its TDH and the frozen efficiencies, compute hydraulic power, electrical input kW, required rated head including 15% margin, installed pipe cost for 180 m, velocity pass, and calculated-power pass. Return JSON {"stage":"D63_power_cost","source_ids":["ENG-V1"],"prior_output_sha256":"'+part1.output_sha256+'","metrics":{"hydraulic_power_w":number,"electrical_input_kw":number,"required_rated_head_m":number},"pipe_cost_usd":number,"velocity_pass":boolean,"calculated_power_pass":boolean,"equations":["short equations"]}. INPUT:'+JSON.stringify({hydraulics:part1.output,constants:brief.constants,pipe,formulas:brief.equations});
  const c=await ask('power_cost',system,user,3072);if(!c)return;
  const issues=[];for(const k of ['hydraulic_power_w','electrical_input_kw','required_rated_head_m'])if(!Number.isFinite(Number(c.o.metrics?.[k])))issues.push(k);if(!Number.isFinite(Number(c.o.pipe_cost_usd)))issues.push('pipe_cost_usd');
  part2={agent_id:AGENT,model_returned:c.r.model_returned,brief_sha:bf.sha,step:2,part:'D63_power_cost',thinking_requested:true,prior_output_sha256:part1.output_sha256,input_sha256:H(system+'\n'+user),output_sha256:H(JSON.stringify(c.o)),output_chars:c.r.content.length,reasoning_chars:c.reasoning_chars,usage:c.r.usage,finish_reason:c.r.finish_reason,elapsed_ms:c.elapsed_ms,assessment:{passed:issues.length===0,issues},output:c.o};
  const s=await save(ROOT+'/step_2_D63_power_cost.json',part2);log('CHECKPOINT',{part:'power_cost',passed:part2.assessment.passed,issues,elapsed_ms:c.elapsed_ms,reasoning_tokens:c.r.usage?.completion_tokens_details?.reasoning_tokens,sha:part2.output_sha256,blob:s.blob,commit:s.commit});
 }
 if(!part2.assessment?.passed)return;
 const m1=part1.output.metrics,m2=part2.output.metrics;
 const output={stage:'pipe_calculation',source_ids:['ENG-V1'],pipe_id:'D63',metrics:{Q_m3_s:m1.Q_m3_s,Q_L_s:m1.Q_L_s,velocity_m_s:m1.velocity_m_s,hf_m:m1.hf_m,hm_m:m1.hm_m,TDH_m:m1.TDH_m,electrical_input_kw:m2.electrical_input_kw,required_rated_head_m:m2.required_rated_head_m},pipe_cost_usd:part2.output.pipe_cost_usd,velocity_pass:part2.output.velocity_pass,calculated_power_pass:part2.output.calculated_power_pass,equations:[...(part1.output.equations||[]),...(part2.output.equations||[])],engineering_comment:'Assembled from two thinking-ON bounded substeps after the initial single-response D63 attempt ended at output length.'};
 const full={agent_id:AGENT,model_returned:MODEL,brief_sha:bf.sha,stage:2,substep:'D63',thinking_requested:true,source:'assembled_bounded_substeps',input_sha256:H(part1.input_sha256+part2.input_sha256),output_sha256:H(JSON.stringify(output)),output_chars:part1.output_chars+part2.output_chars,reasoning_chars:part1.reasoning_chars+part2.reasoning_chars,usage:{hydraulics:part1.usage,power_cost:part2.usage},finish_reason:'assembled_complete_substeps',elapsed_ms:part1.elapsed_ms+part2.elapsed_ms,assessment:{passed:true,issues:[]},output};
 // Main worker will perform its own deterministic hydraulic audit when it resumes selection; preserve substep provenance.
 const s=await save(ROOT+'/step_2_D63.json',full);log('RESULT',{status:'assembled_D63',output_sha256:full.output_sha256,blob:s.blob,commit:s.commit,part_sha256:[part1.output_sha256,part2.output_sha256]});
 return runSilasEngineeringExercise();
}
