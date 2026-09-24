import { withReviewerNvidiaSlot, noteReviewerModelTimeout, noteReviewerModelSuccess, isReviewerModelInBackoff } from './reviewer-nvidia-endpoint-gate.js';
import { createHash } from 'node:crypto';

const SB=String(process.env.AAU_SUPABASE_URL||'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/,'');
const anon=String(process.env.AAU_SUPABASE_ANON_KEY||'').trim();
const bridge=String(process.env.AAU_BROKER_BRIDGE_TOKEN||'').trim();
const nvidiaKey=String(process.env.NVIDIA_API_KEY||'').trim();
const executorId=`render:entrepreneurship-assessor:${process.env.RENDER_INSTANCE_ID||process.pid}`;
const pollMs=Math.max(3000,Number(process.env.AAU_ENTREPRENEURSHIP_ASSESSOR_POLL_MS||7000));
let timer=null,working=false;

const MODELS={
  kimi:'moonshotai/kimi-k3',
  meta:'meta/llama-3.1-70b-instruct',
  nemotron:'nvidia/nemotron-3.5-lightning-30b-a3b',
};

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function jsonResponse(r){
  const raw=await r.text(); let body=null; try{body=JSON.parse(raw);}catch{}
  return {raw,body};
}
async function rpc(name,args={}){
  const r=await fetch(`${SB}/rest/v1/rpc/${name}`,{
    method:'POST',headers:{apikey:anon,authorization:`Bearer ${anon}`,'content-type':'application/json'},
    body:JSON.stringify({p_bridge_token:bridge,...args})
  });
  const {raw,body}=await jsonResponse(r);
  if(!r.ok) throw new Error(`${name}:${r.status}:${body?.message||raw.slice(0,700)}`);
  return body;
}

// Final reviews receive all 15 course outcomes and the complete four-unit capstone.
// Omit the CAP515 *assessor's prose* to avoid inviting a new assessor to copy it.
// Other course reports are field-selected, never string-sliced or cut mid-JSON.
const FINAL_INPUT_LIMIT=90000;
const COURSE_INPUT_LIMIT=70000;
const REQUIRED_DIMENSIONS=[
  'conceptual_accuracy','analytical_rigor','quantitative_or_structured_reasoning',
  'application_quality','evidence_and_assumption_discipline',
  'self_critique_and_limits','clarity_and_epistemic_discipline'
];

export function prepareEntrepreneurshipReviewInput(taskType,payload){
  let evidence=payload;
  let courseCount=null,unitCount=null;
  if(taskType==='final'){
    const courses=payload?.course_assessments;
    const units=payload?.capstone?.submission_artifact?.unit_submissions;
    if(!Array.isArray(courses)||courses.length!==15 ||
       new Set(courses.map(c=>c?.course_code)).size!==15 ||
       !courses.some(c=>c.course_code==='CAP515') ||
       !Array.isArray(units)||units.length!==4 ||
       units.some((u,i)=>Number(u?.unit_order)!==i+1) ||
       !Number.isFinite(Number(payload?.capstone?.score))){
      throw new Error('final_review_source_coverage_incomplete');
    }
    courseCount=courses.length; unitCount=units.length;
    evidence={
      program_version:payload.program_version,
      assessor_slot:payload.assessor_slot,
      instruction:payload.instruction,
      course_assessments:courses.map(c=>({
        course_code:c.course_code,score:c.score,assessor_id:c.assessor_id,
        // The complete capstone submission is included below. Its earlier assessor
        // rationale/dimensions are intentionally excluded to prevent answer copying.
        ...(c.course_code==='CAP515'?{}:{rubric_report:{
          critical_failure:c.rubric_report?.critical_failure,
          dimensions:c.rubric_report?.dimensions,
          rationale:c.rubric_report?.rationale,
          strengths:c.rubric_report?.strengths,
          weaknesses:c.rubric_report?.weaknesses
        }})
      })),
      capstone:{score:payload.capstone.score,submission_artifact:payload.capstone.submission_artifact}
    };
  }else if(taskType!=='course'){
    throw new Error('unknown_entrepreneurship_review_type');
  }
  const serialized=JSON.stringify(evidence);
  const limit=taskType==='final'?FINAL_INPUT_LIMIT:COURSE_INPUT_LIMIT;
  if(serialized.length>limit){
    // Fail closed: never silently feed an incomplete or malformed record to a model.
    throw new Error('entrepreneurship_review_input_too_large:'+serialized.length+':'+limit);
  }
  return {
    serialized,
    audit:{
      review_input_contract:'entrepreneurship_review_input_v0_2',
      review_input_complete:true,
      review_input_chars:serialized.length,
      review_input_sha256:createHash('sha256').update(serialized).digest('hex'),
      ...(taskType==='final'?{
        source_course_count:courseCount,source_capstone_unit_count:unitCount,
        capstone_prior_assessment_excluded:true
      }:{})
    }
  };
}

async function modelCall(model,taskType,payload){
  const system=`You are an independent AAU graduate-business-school assessor. You are NOT the learner and must not continue the learner's work. Grade only the supplied durable evidence. The standard is demanding top-university graduate-level business competence, but this is not university accreditation. Do not reward verbosity, confidence, or polished prose by itself. Penalize unsupported factual claims, arithmetic errors, shallow case reasoning, missing assumptions, failure to distinguish evidence from hypothesis, and recommendations that ignore cash/resource constraints. For CAP515, treat all four units as ONE venture case: explicitly compare venture identity, customer segment, pricing, CAC, gross-margin definition, churn/retention, discounting, LTV/CAC, revenue ramp, financing/runway and the final BUILD/REVISE/KILL decision across units. Recompute material arithmetic. Do not call CAC, general R&D, or sales expense gross-margin COGS unless directly attributable to delivering the service; distinguish gross margin from operating margin. A REVISE decision is valid when customer, regulatory or market validation is missing; never require fabricated interviews, pilots, LOIs or regulator acceptance. Evidence called verified must have traceable provenance, and agent-authored calculations are not independent market evidence. Return strict JSON only with keys: score (0..1), critical_failure (boolean), dimensions (object of 0..1 scores), strengths (array), weaknesses (array), rationale (string), remediation (array). For CAP515 dimensions MUST contain numeric conceptual_accuracy, analytical_rigor, quantitative_or_structured_reasoning, application_quality, evidence_and_assumption_discipline, self_critique_and_limits, clarity_and_epistemic_discipline. CAP515 passes only if score >=0.85, critical_failure=false, and EVERY required dimension >=0.75. A critical failure means fabricated evidence, materially unsafe/illegal advice presented as acceptable, or a fundamental contradiction that invalidates the decision.`;
  const reviewInput=prepareEntrepreneurshipReviewInput(taskType,payload);
  const user=taskType==='course'
    ? `Independently grade this complete four-unit course record. Course pass thresholds are embedded in the payload. Evaluate conceptual accuracy, analytical/quantitative rigor, application quality, evidence discipline, and self-critique.\n\nPAYLOAD:\n${reviewInput.serialized}`
    : `Conduct a comprehensive independent final review of the entrepreneurship master's-equivalent record. Test integration across disciplines and whether the venture reasoning would survive an adversarial board/investment-committee discussion. A final pass requires score >=0.85 and no critical failure.\n\nPAYLOAD:\n${reviewInput.serialized}`;

  return withReviewerNvidiaSlot('entrepreneurship_assessment',async()=>{
    const controller=new AbortController(); const begun=Date.now();
    const timeout=setTimeout(()=>controller.abort(),180000);
    try{
      const body={
        model,messages:[{role:'system',content:system},{role:'user',content:user}],
        temperature:0,max_tokens:1800,stream:false,response_format:{type:'json_object'}
      };
      if(model.startsWith('nvidia/nemotron')) body.chat_template_kwargs={enable_thinking:false};
      const r=await fetch('https://integrate.api.nvidia.com/v1/chat/completions',{
        method:'POST',signal:controller.signal,
        headers:{authorization:`Bearer ${nvidiaKey}`,'content-type':'application/json',accept:'application/json','user-agent':'AAU-Entrepreneurship-Assessor/0.1'},
        body:JSON.stringify(body)
      });
      const parsed=await jsonResponse(r);
      if(!r.ok) throw new Error(`nvidia_${r.status}:${parsed.body?.error?.message||parsed.raw.slice(0,500)}`);
      noteReviewerModelSuccess(model);
      const txt=String(parsed.body?.choices?.[0]?.message?.content||'').trim();
      let grade; try{grade=JSON.parse(txt);}catch{
        const s=txt.indexOf('{'),e=txt.lastIndexOf('}'); if(s<0||e<=s) throw new Error('assessor_json_missing');
        grade=JSON.parse(txt.slice(s,e+1));
      }
      const score=Number(grade?.score);
      if(!Number.isFinite(score)||score<0||score>1) throw new Error('assessor_score_invalid');
      const strict = taskType==='final' ||
        (taskType==='course' && String(payload?.course?.course_code||'')==='CAP515');
      if(strict){
        const dims=(grade?.dimensions&&typeof grade.dimensions==='object'&&!Array.isArray(grade.dimensions))
          ? grade.dimensions : {};
        const missing=REQUIRED_DIMENSIONS.filter((key)=>
          typeof dims[key]!=='number'||!Number.isFinite(dims[key])||dims[key]<0||dims[key]>1);
        if(missing.length) throw new Error('assessor_dimensions_invalid:'+missing.join(','));
        if(typeof grade?.critical_failure!=='boolean') throw new Error('assessor_critical_failure_not_boolean');
        if(typeof grade?.rationale!=='string'||grade.rationale.trim().length<80 ||
           !Array.isArray(grade?.strengths)||!grade.strengths.length ||
           !Array.isArray(grade?.weaknesses)||!grade.weaknesses.length ||
           !Array.isArray(grade?.remediation)||!grade.remediation.length){
          throw new Error('assessor_review_incomplete');
        }
        grade.pass_rule={
          score_floor:0.85,dimension_floor:0.75,critical_failure_must_be_false:true,
          minimum_dimension:Math.min(...REQUIRED_DIMENSIONS.map((key)=>dims[key]))
        };
      }
      if(grade?.critical_failure===true && score>=0.80) grade.score=Math.min(score,0.69);
      return {score:Number(grade.score),grade,model:parsed.body?.model||model,latency_ms:Date.now()-begun,reviewAudit:reviewInput.audit};
    }catch(error){
      if(error?.name==='AbortError'){noteReviewerModelTimeout(model); throw new Error('entrepreneurship_assessor_timeout');}
      throw error;
    }finally{clearTimeout(timeout);}
  });
}

function modelOrder(task){
  if(task.task_type==='final' && Number(task.assessor_slot)===2) return [MODELS.meta,MODELS.nemotron,MODELS.kimi];
  return [MODELS.kimi,MODELS.meta,MODELS.nemotron];
}

async function gradeClaim(task){
  let lastError=null;
  for(const model of modelOrder(task)){
    if(isReviewerModelInBackoff(model)){
      console.warn('AAU_ENTREPRENEURSHIP_ASSESSOR_MODEL_SKIPPED_BACKOFF',JSON.stringify({
        task_type:task.task_type,assessment_id:task.assessment_id||task.final_assessment_id,model
      }));
      continue;
    }
    try{
      const result=await modelCall(model,task.task_type,task.payload);
      const assessorId=`nvidia_direct/${result.model}`;
      const report={...result.grade,review_model:result.model,review_provider:'nvidia_direct',latency_ms:result.latency_ms,
        independent_from_bound_agent_model:true,assessment_contract:'entrepreneurship_independent_assessment_v0_1',...result.reviewAudit};
      if(task.task_type==='course'){
        return await rpc('aau_bridge_complete_entrepreneurship_course_assessment',{
          p_assessment_id:task.assessment_id,p_score:result.score,p_assessor_id:assessorId,p_report:report
        });
      }
      return await rpc('aau_bridge_complete_entrepreneurship_final_assessment',{
        p_final_assessment_id:task.final_assessment_id,p_score:result.score,p_assessor_id:assessorId,p_report:report
      });
    }catch(error){
      lastError=error;
      console.warn('AAU_ENTREPRENEURSHIP_ASSESSOR_MODEL_FAILED',JSON.stringify({
        task_type:task.task_type,assessment_id:task.assessment_id||task.final_assessment_id,
        model,error:String(error?.message||error).slice(0,700)
      }));
      await sleep(500);
    }
  }
  throw lastError||new Error('all_assessor_models_failed');
}

async function tick(){
  if(working||!anon||!bridge||!nvidiaKey) return;
  working=true;
  let task=null;
  try{
    task=await rpc('aau_bridge_claim_entrepreneurship_assessment',{p_executor_id:executorId});
    if(task?.status!=='claimed') return;
    const result=await gradeClaim(task);
    console.log('AAU_ENTREPRENEURSHIP_ASSESSMENT_COMPLETED',JSON.stringify({
      task_type:task.task_type,assessment_id:task.assessment_id||task.final_assessment_id,result
    }));
  }catch(error){
    const message=String(error?.message||error).slice(0,1200);
    console.error('AAU_ENTREPRENEURSHIP_ASSESSOR_TICK_FAILED',message);
    if(task?.status==='claimed'){
      try{
        const released=await rpc('aau_bridge_release_entrepreneurship_assessment',{
          p_task_type:task.task_type,
          p_assessment_id:task.assessment_id||task.final_assessment_id,
          p_executor_id:executorId,
          p_error:message,
        });
        console.warn('AAU_ENTREPRENEURSHIP_ASSESSMENT_RELEASED',JSON.stringify({
          task_type:task.task_type,
          assessment_id:task.assessment_id||task.final_assessment_id,
          released,
        }));
      }catch(releaseError){
        console.error('AAU_ENTREPRENEURSHIP_ASSESSMENT_RELEASE_FAILED',
          String(releaseError?.message||releaseError).slice(0,1200));
      }
    }
  }finally{working=false;}
}

export function startEntrepreneurshipAssessmentWorker(){
  if(timer) return {started:true,already_running:true,poll_ms:pollMs};
  if(!anon||!bridge||!nvidiaKey) return {started:false,reason:'required_runtime_credentials_missing'};
  timer=setInterval(()=>void tick(),pollMs);
  void tick();
  return {started:true,poll_ms:pollMs,models:[MODELS.kimi,MODELS.meta,MODELS.nemotron],
    contract:'entrepreneurship_independent_assessment_v0_1'};
}
