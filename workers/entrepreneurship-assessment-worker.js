import { withReviewerNvidiaSlot, noteReviewerModelTimeout, noteReviewerModelSuccess, isReviewerModelInBackoff } from './reviewer-nvidia-endpoint-gate.js';

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

async function modelCall(model,taskType,payload){
  const system=`You are an independent AAU graduate-business-school assessor. You are NOT the learner and must not continue the learner's work. Grade only the supplied durable evidence. The standard is demanding top-university graduate-level business competence, but this is not university accreditation. Do not reward verbosity, confidence, or polished prose by itself. Penalize unsupported factual claims, arithmetic errors, shallow case reasoning, missing assumptions, failure to distinguish evidence from hypothesis, and recommendations that ignore cash/resource constraints. Return strict JSON only with keys: score (0..1), critical_failure (boolean), dimensions (object of 0..1 scores), strengths (array), weaknesses (array), rationale (string), remediation (array). A critical failure means fabricated evidence, materially unsafe/illegal advice presented as acceptable, or a fundamental contradiction that invalidates the decision.`;
  const user=taskType==='course'
    ? `Independently grade this complete four-unit course record. Course pass thresholds are embedded in the payload. Evaluate conceptual accuracy, analytical/quantitative rigor, application quality, evidence discipline, and self-critique.\n\nPAYLOAD:\n${JSON.stringify(payload).slice(0,70000)}`
    : `Conduct a comprehensive independent final review of the entrepreneurship master's-equivalent record. Test integration across disciplines and whether the venture reasoning would survive an adversarial board/investment-committee discussion. A final pass requires score >=0.85 and no critical failure.\n\nPAYLOAD:\n${JSON.stringify(payload).slice(0,90000)}`;

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
      if(grade?.critical_failure===true && score>=0.80) grade.score=Math.min(score,0.69);
      return {score:Number(grade.score),grade,model:parsed.body?.model||model,latency_ms:Date.now()-begun};
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
        independent_from_bound_agent_model:true,assessment_contract:'entrepreneurship_independent_assessment_v0_1'};
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
