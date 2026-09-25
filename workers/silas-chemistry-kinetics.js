// Silas-only off-curriculum Master's physical chemistry test.
// Parallel first-order kinetics, Thinking ON, one bounded candidate per checkpoint.
// No normal wake, grades, credentials, lifecycle, or AAU-wide policy mutation.
import { createHash } from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';
import { persistRejectedPilotAttempt } from './pilot-rejected-attempt-evidence.js';

const REPO='booleanlambda/agent-control-room';
const EVIDENCE_BRANCH='pilot/silas-chemistry-kinetics-20260925';
const ROOT='pilots/silas-chemistry-kinetics-20260925';
const MODEL='google/gemma-4-31b-it';
const AGENT='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82';
const token=String(process.env.AAU_GITHUB_TOKEN||'').trim();
const digest=x=>createHash('sha256').update(x).digest('hex');
const log=(name,data)=>console.log('AAU_SILAS_CHEM_'+name,JSON.stringify(data));

async function gh(method,path,body){
 const url='https://api.github.com/repos/'+REPO+'/contents/'+path+(method==='GET'?'?ref='+encodeURIComponent(EVIDENCE_BRANCH):'');
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
 const p=await r.json();
 if(method==='GET'&&r.status===404)return null;
 if(!r.ok)throw Error('chem_github_'+r.status+':'+String(p.message||'').slice(0,80));
 return p;
}
async function read(path){
 const f=await gh('GET',path);if(!f)return null;
 return {sha:f.sha,text:Buffer.from(String(f.content||'').replace(/\s/g,''),'base64').toString('utf8')};
}
async function save(path,row){
 const text=JSON.stringify(row,null,2)+'\n',old=await read(path);
 if(old){
  const prior=JSON.parse(old.text);
  if(prior.output_sha256!==row.output_sha256)throw Error('chem_checkpoint_conflict:'+path);
  return {blob:old.sha,reused:true};
 }
 const p=await gh('PUT',path,{branch:EVIDENCE_BRANCH,message:'Silas chemistry checkpoint '+path.split('/').pop(),content:Buffer.from(text).toString('base64')});
 const back=await read(path);
 if(!back||back.text!==text||back.sha!==p.content.sha)throw Error('chem_checkpoint_readback_failed');
 return {blob:back.sha,commit:p.commit.sha,reused:false};
}
function expected(brief,T,aged=false){
 const R=brief.system.gas_constant_J_mol_K,t=brief.system.batch_time_min*60,A0=brief.system.initial_A_M;
 const d=brief.system.desired,u=brief.system.undesired;
 const Ac=aged?brief.changed_condition.undesired_pre_exponential_s_1:u.pre_exponential_s_1;
 const kB=d.pre_exponential_s_1*Math.exp(-d.activation_energy_J_mol/(R*T));
 const kC=Ac*Math.exp(-u.activation_energy_J_mol/(R*T));
 const kt=kB+kC,X=1-Math.exp(-kt*t),S=kB/kt,Y=X*S;
 const A=A0*(1-X),B=A0*Y,C=A0*X*(1-S),mass=A+B+C;
 const pass={
  conversion:X>=0.95,selectivity:S>=0.86,yield:Y>=0.85,temperature:T<=350,
  nonnegative_and_mass_balance:A>=0&&B>=0&&C>=0&&Math.abs(mass-A0)<=0.0005
 };
 return {temperature_K:T,k_B_s_1:kB,k_C_s_1:kC,k_total_s_1:kt,conversion_X:X,selectivity_B:S,yield_B:Y,
   final_A_M:A,final_B_M:B,final_C_M:C,mass_balance_M:mass,passes:pass,feasible:Object.values(pass).every(Boolean)};
}
function close(a,b,t){return Number.isFinite(Number(a))&&Math.abs(Number(a)-Number(b))<=t;}
function auditCandidate(brief,T,o,aged){
 const g=expected(brief,T,aged),issues=[];
 if(o.temperature_K!==T)issues.push('temperature_K');
 const tol={k_B_s_1:0.000003,k_C_s_1:0.000003,k_total_s_1:0.000004,conversion_X:0.0005,selectivity_B:0.0005,yield_B:0.0005,
  final_A_M:0.0003,final_B_M:0.0003,final_C_M:0.0003,mass_balance_M:0.0005};
 for(const [k,t] of Object.entries(tol))if(!close(o[k],g[k],t))issues.push(k);
 for(const k of ['conversion','selectivity','yield','temperature','nonnegative_and_mass_balance'])if(o.passes?.[k]!==g.passes[k])issues.push('pass_'+k);
 if(o.feasible!==g.feasible)issues.push('feasible');
 return {passed:issues.length===0,issues,expected:g};
}
async function recordRejectedAttempt({label,rejectionReason,modelReturned=null,finishReason=null,elapsedMs=null,usage=null,partialOutput=null,reasoningChars=null,reasoningTokens=null,inputSha256=null}){
 try{
  const ev=await persistRejectedPilotAttempt({
   branch:EVIDENCE_BRANCH,root:ROOT,label,agentId:AGENT,
   testContract:'silas_masters_physical_chemistry_parallel_kinetics_v1',
   modelRequested:MODEL,modelReturned,rejectionReason,finishReason,elapsedMs,usage,
   partialOutput,reasoningChars,reasoningTokens,inputSha256,sourceIds:[],
   provenance:'runtime_native'
  });
  log('REJECTED_ATTEMPT_PERSISTED',{label,path:ev.path,rejection_reason:rejectionReason,finish_reason:finishReason,
   continuation_eligibility:'NOT_ELIGIBLE_FOR_CONTINUATION',blob:ev.blob,commit:ev.commit});
 }catch(e){
  log('REJECTION_EVIDENCE_FAILED',{label,rejection_reason:rejectionReason,code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,160)});
 }
}
async function invoke(label,system,user,{maxTokens=2048,timeoutMs=180000}={}){
 const start=Date.now(),inputSha256=digest(system+'\n'+user);let r;
 try{r=await nvidiaChatCompletion({model:MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],
  temperature:0,jsonMode:true,enableThinking:true,maxTokens,timeoutMs});}
 catch(e){
  const elapsedMs=Date.now()-start;
  const rejectionReason=e?.code==='NVIDIA_TIMEOUT'?'MODEL_TIMEOUT':'MODEL_ERROR';
  await recordRejectedAttempt({label,rejectionReason,elapsedMs,inputSha256});
  log('BLOCKED',{label,reason:'model_or_timeout',code:e?.code||e?.name||'error',elapsed_ms:elapsedMs,
   continuation_eligibility:'NOT_ELIGIBLE_FOR_CONTINUATION'});
  return null;
 }
 const elapsedMs=Date.now()-start;
 const reasoningChars=String(r.reasoning_content||'').length;
 const reasoningTokens=r.usage?.completion_tokens_details?.reasoning_tokens??null;
 let o;try{o=JSON.parse(String(r.content||''));}catch{o=null;}
 if(r.model_returned!==MODEL||r.finish_reason!=='stop'||!o){
  const rejectionReason=r.finish_reason==='length'?'TRUNCATED_RESPONSE':(!o?'INVALID_OR_INCOMPLETE_RESPONSE':'MODEL_OR_COMPLETION_MISMATCH');
  await recordRejectedAttempt({label,rejectionReason,modelReturned:r.model_returned,finishReason:r.finish_reason,
   elapsedMs,usage:r.usage||null,partialOutput:r.content||null,reasoningChars,reasoningTokens,inputSha256});
  log('BLOCKED',{label,reason:'invalid_or_incomplete',rejection_reason:rejectionReason,model_returned:r.model_returned,
   finish_reason:r.finish_reason,elapsed_ms:elapsedMs,reasoning_chars:reasoningChars,reasoning_tokens:reasoningTokens,
   continuation_eligibility:'NOT_ELIGIBLE_FOR_CONTINUATION'});
  return null;
 }
 return {o,r,elapsed_ms:elapsedMs,reasoning_chars:reasoningChars};
}
async function persist(path,meta,c,assessment){
 const row={contract:'silas_masters_physical_chemistry_parallel_kinetics_v1',agent_id:AGENT,model_returned:c.r.model_returned,
  thinking_requested:true,...meta,output_sha256:digest(JSON.stringify(c.o)),output_chars:String(c.r.content||'').length,
  reasoning_chars:c.reasoning_chars,finish_reason:c.r.finish_reason,usage:c.r.usage||null,elapsed_ms:c.elapsed_ms,assessment,output:c.o};
 const s=await save(path,row);
 log('CHECKPOINT',{path,stage:meta.stage,substep:meta.substep||null,passed:assessment.passed,issues:assessment.issues,
   elapsed_ms:row.elapsed_ms,reasoning_tokens:row.usage?.completion_tokens_details?.reasoning_tokens||null,
   output_sha256:row.output_sha256,blob:s.blob,commit:s.commit||null});
 return row;
}
function candidatePrompt(brief,T,aged){
 const Ac=aged?brief.changed_condition.undesired_pre_exponential_s_1:brief.system.undesired.pre_exponential_s_1;
 const source=aged?['CHEM-KIN-V1','CAT-AGE-V2']:['CHEM-KIN-V1'];
 return 'Compute exactly ONE candidate temperature for the parallel first-order network A→B and A→C. Use t=600 s. Return JSON {"stage":"kinetics_candidate","source_ids":'+JSON.stringify(source)+',"temperature_K":'+T+',"k_B_s_1":number,"k_C_s_1":number,"k_total_s_1":number,"conversion_X":number,"selectivity_B":number,"yield_B":number,"final_A_M":number,"final_B_M":number,"final_C_M":number,"mass_balance_M":number,"passes":{"conversion":boolean,"selectivity":boolean,"yield":boolean,"temperature":boolean,"nonnegative_and_mass_balance":boolean},"feasible":boolean,"equations":["running calculations"],"chemistry_comment":"..."}. Inputs: R='+brief.system.gas_constant_J_mol_K+' J mol^-1 K^-1; [A]0='+brief.system.initial_A_M+' M; desired A_B='+brief.system.desired.pre_exponential_s_1+' s^-1, Ea_B='+brief.system.desired.activation_energy_J_mol+' J/mol; undesired A_C='+Ac+' s^-1, Ea_C='+brief.system.undesired.activation_energy_J_mol+' J/mol. Frozen constraints: '+JSON.stringify(brief.constraints);
}
export async function runSilasChemistryKinetics(){
 if(!token||!process.env.NVIDIA_API_KEY)throw Error('chem_credentials_missing');
 const bf=await read(ROOT+'/brief.json');if(!bf)throw Error('chem_brief_missing');
 const brief=JSON.parse(bf.text);
 if(brief.agent_id!==AGENT||brief.bound_model!==MODEL||brief.thinking!==true)throw Error('chem_scope_mismatch');
 log('START',{agent_id:AGENT,model:MODEL,thinking:true,brief_sha:bf.sha,off_curriculum:true,no_agent_state_mutation:true});
 const system='You are Silas completing an unfamiliar Master’s-level physical chemistry kinetics exercise with thinking enabled. Use the supplied Arrhenius and parallel first-order equations exactly. Keep units consistent, preserve all frozen constraints, and never redefine feasibility as least-worst. Return complete JSON only. Do not invent experimental observations or external literature.';
 // Stage 1 plan
 let planFile=await read(ROOT+'/step_1_plan.json'),plan;
 if(planFile){plan=JSON.parse(planFile.text);log('RESUME',{stage:1,sha:plan.output_sha256});}
 else{
  const user='Before calculating any candidate, return JSON {"stage":"chemistry_plan","source_ids":["CHEM-KIN-V1"],"reaction_model":"...","calculation_sequence":[at least 7 steps],"unit_checks":[at least 3],"constraints":[all six constraints without weakening them],"assumptions":[at least 3],"failure_modes":[at least 3]}. CASE:'+JSON.stringify(brief);
  const c=await invoke('plan',system,user,{maxTokens:2048,timeoutMs:180000});if(!c)return;
  const issues=[];if(c.o.stage!=='chemistry_plan')issues.push('stage');if(c.o.calculation_sequence?.length<7)issues.push('sequence');if(c.o.constraints?.length<6)issues.push('constraints');if(c.o.unit_checks?.length<3)issues.push('unit_checks');
  plan=await persist(ROOT+'/step_1_plan.json',{stage:1,brief_sha:bf.sha,input_sha256:digest(system+'\n'+user)},c,{passed:issues.length===0,issues});
 }
 // Baseline one temperature per checkpoint
 const baseline=[];
 for(const T of brief.system.candidate_temperatures_K){
  const path=ROOT+'/step_2_baseline_'+T+'K.json',old=await read(path);
  if(old){const row=JSON.parse(old.text);baseline.push(row);log('RESUME',{stage:2,substep:T+'K',sha:row.output_sha256,passed:row.assessment?.passed});continue;}
  const user=candidatePrompt(brief,T,false);
  const c=await invoke('baseline_'+T,system,user,{maxTokens:2048,timeoutMs:180000});if(!c)return;
  const assessment=auditCandidate(brief,T,c.o,false);
  const row=await persist(path,{stage:2,substep:T+'K',brief_sha:bf.sha,source_ids:['CHEM-KIN-V1'],prior_output_sha256:plan.output_sha256,input_sha256:digest(system+'\n'+user)},c,assessment);
  baseline.push(row);
 }
 // Baseline decision
 let decFile=await read(ROOT+'/step_3_baseline_decision.json'),decision;
 if(decFile){decision=JSON.parse(decFile.text);log('RESUME',{stage:3,sha:decision.output_sha256,passed:decision.assessment?.passed});}
 else{
  const user='Use the three saved baseline candidate records to make the chemistry decision. Return JSON {"stage":"baseline_decision","source_ids":["CHEM-KIN-V1"],"prior_candidate_sha256":[exact 330,345,360 hashes],"constraint_matrix":[three rows with temperature_K,conversion_pass,selectivity_pass,yield_pass,temperature_pass,mass_balance_pass,feasible],"selected_temperature_K":330|345|360|"NONE","reasoning":"...","unresolved_evidence":[...]}. A candidate is feasible only if all six frozen constraints pass. SAVED:'+JSON.stringify(baseline.map(x=>({output_sha256:x.output_sha256,assessment:x.assessment,output:x.output})));
  const c=await invoke('baseline_decision',system,user,{maxTokens:2560,timeoutMs:210000});if(!c)return;
  const issues=[],shas=baseline.map(x=>x.output_sha256);
  if(c.o.stage!=='baseline_decision')issues.push('stage');if(JSON.stringify(c.o.prior_candidate_sha256)!==JSON.stringify(shas))issues.push('hashes');
  if(c.o.selected_temperature_K!==345)issues.push('selected_temperature');
  if(!Array.isArray(c.o.constraint_matrix)||c.o.constraint_matrix.length!==3)issues.push('matrix_length');
  decision=await persist(ROOT+'/step_3_baseline_decision.json',{stage:3,brief_sha:bf.sha,source_ids:['CHEM-KIN-V1'],prior_output_sha256:baseline.at(-1).output_sha256,input_sha256:digest(system+'\n'+user)},c,{passed:issues.length===0,issues});
 }
 // Changed condition candidate calculations
 const aged=[];
 for(const T of brief.system.candidate_temperatures_K){
  const path=ROOT+'/step_4_aged_'+T+'K.json',old=await read(path);
  if(old){const row=JSON.parse(old.text);aged.push(row);log('RESUME',{stage:4,substep:T+'K',sha:row.output_sha256,passed:row.assessment?.passed});continue;}
  const user='NEW SOURCE CAT-AGE-V2: only A_C changes from 1.0e8 s^-1 to 1.5e8 s^-1; all equations, activation energies, batch time, temperatures and ALL SIX constraints remain unchanged. '+candidatePrompt(brief,T,true);
  const c=await invoke('aged_'+T,system,user,{maxTokens:2048,timeoutMs:180000});if(!c)return;
  const assessment=auditCandidate(brief,T,c.o,true);
  const row=await persist(path,{stage:4,substep:T+'K',brief_sha:bf.sha,source_ids:['CHEM-KIN-V1','CAT-AGE-V2'],prior_output_sha256:decision.output_sha256,input_sha256:digest(system+'\n'+user)},c,assessment);
  aged.push(row);
 }
 // Changed decision
 let changeFile=await read(ROOT+'/step_5_aged_decision.json'),changed;
 if(changeFile){changed=JSON.parse(changeFile.text);log('RESUME',{stage:5,sha:changed.output_sha256,passed:changed.assessment?.passed});}
 else{
  const user='Make the catalyst-aged feasibility decision from the three saved CAT-AGE-V2 candidate records. Preserve all six original constraints. Return JSON {"stage":"aged_decision","source_ids":["CHEM-KIN-V1","CAT-AGE-V2"],"prior_candidate_sha256":[exact 330,345,360 aged hashes],"constraint_matrix":[three rows with temperature_K,conversion_pass,selectivity_pass,yield_pass,temperature_pass,mass_balance_pass,feasible],"selected_temperature_K":330|345|360|"NONE","decision":"...","reasoning":"...","constraints_preserved":[all six],"next_chemistry_actions":[...]}. If no temperature satisfies every constraint, select NONE. SAVED:'+JSON.stringify(aged.map(x=>({output_sha256:x.output_sha256,assessment:x.assessment,output:x.output})));
  const c=await invoke('aged_decision',system,user,{maxTokens:2560,timeoutMs:210000});if(!c)return;
  const issues=[],shas=aged.map(x=>x.output_sha256);
  if(c.o.stage!=='aged_decision')issues.push('stage');if(JSON.stringify(c.o.prior_candidate_sha256)!==JSON.stringify(shas))issues.push('hashes');
  if(c.o.selected_temperature_K!=='NONE')issues.push('must_select_none');if(c.o.constraints_preserved?.length<6)issues.push('constraints');
  changed=await persist(ROOT+'/step_5_aged_decision.json',{stage:5,brief_sha:bf.sha,source_ids:['CHEM-KIN-V1','CAT-AGE-V2'],prior_output_sha256:aged.at(-1).output_sha256,input_sha256:digest(system+'\n'+user)},c,{passed:issues.length===0,issues});
 }
 // Final chemistry memo
 if(!(await read(ROOT+'/step_6_chemistry_memo.json'))){
  const history=[plan,...baseline,decision,...aged,changed].map(x=>({stage:x.stage,substep:x.substep||null,output_sha256:x.output_sha256,assessment:x.assessment,output:x.output}));
  const memoSystem='You are Silas writing the final technical chemistry memo for the same Master’s-level off-curriculum kinetics exercise. Preserve the frozen reaction model and constraints, distinguish calculations from assumptions, and acknowledge any checkpoint audit errors. Do not call an infeasible condition acceptable. Return complete JSON only.';
  const user='Return JSON {"stage":"chemistry_memo","source_ids":["CHEM-KIN-V1","CAT-AGE-V2"],"previous_output_sha256":[all HISTORY hashes in exact order],"baseline_condition":"...","aged_condition":"...","memo":"at least 1300 characters","constraint_summary":[all six],"acknowledged_errors":[...],"unresolved_evidence":[...],"next_actions":[...]}. Explain why the baseline choice was or was not feasible and what catalyst aging changed in kinetic competition. HISTORY:'+JSON.stringify(history);
  const c=await invoke('chemistry_memo',memoSystem,user,{maxTokens:4096,timeoutMs:300000});if(!c)return;
  const issues=[],shas=history.map(x=>x.output_sha256);
  if(c.o.stage!=='chemistry_memo')issues.push('stage');if(String(c.o.memo||'').length<1300)issues.push('memo_length');if(JSON.stringify(c.o.previous_output_sha256)!==JSON.stringify(shas))issues.push('history_hashes');
  const t=(String(c.o.aged_condition||'')+' '+String(c.o.memo||'')).toUpperCase();if(!t.includes('NO FEASIBLE')&&!t.includes('NONE'))issues.push('aged_conclusion');
  await persist(ROOT+'/step_6_chemistry_memo.json',{stage:6,brief_sha:bf.sha,source_ids:['CHEM-KIN-V1','CAT-AGE-V2'],prior_output_sha256:changed.output_sha256,input_sha256:digest(memoSystem+'\n'+user)},c,{passed:issues.length===0,issues});
 }
 log('RESULT',{status:'complete',thinking:true,baseline_expected_temperature_K:345,aged_expected_temperature:'NONE',no_agent_state_mutation:true});
}
