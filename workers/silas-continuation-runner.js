import { nvidiaChatCompletion } from './providers/nvidia.js';
import { pilotHelpers as h } from './silas-continuation-pilot.js';
export async function runSilasContinuationPilot(){
 const phase=Number(process.env.AAU_SILAS_PILOT_PHASE||2);
 if(![2,5].includes(phase)||!h.token||!process.env.NVIDIA_API_KEY)throw Error('pilot_invalid_config');
 const f=await h.read(h.ROOT+'/brief.json'),brief=JSON.parse(f.text);
 if(brief.agent_id!==h.AGENT||brief.bound_model!==h.MODEL)throw Error('pilot_identity_mismatch');
 const prior=[];
 h.log('START',{agent_id:h.AGENT,model:h.MODEL,phase,brief_sha:f.sha});
 for(let n=1;n<=phase;n++){
  const path=h.ROOT+'/step_'+n+'.json',old=await h.read(path);
  if(old){
   const x=JSON.parse(old.text);
   if(x.agent_id!==h.AGENT||x.model_returned!==h.MODEL||x.brief_sha!==f.sha||
      x.step!==n||x.output_sha256!==h.digest(JSON.stringify(x.output)))throw Error('bad_checkpoint:'+n);
   prior.push(x);h.log('RESUME',{step:n,output_sha256:x.output_sha256,audit_passed:x.audit.passed});
   if(!x.audit?.passed){h.log('BLOCKED',{step:n,reason:'prior_audit_failed',issues:x.audit?.issues});return;}
   continue;
  }
  const system='You are Silas in an isolated off-curriculum test using the same bound model. Not a normal wake, grading, or degree verification. Independently reason about the fictional data; cite given source IDs; do not invent market research or secured financing. Return complete JSON only.';
  const modelBrief=n<4?(({novel_variant,...beforeQuote})=>beforeQuote)(brief):brief;
  const user=h.asks[n]+'\nFROZEN CASE AND PRIOR CHECKPOINTS:\n'+JSON.stringify({brief:modelBrief,prior:prior.map(x=>({step:x.step,output:x.output,output_sha256:x.output_sha256}))});
  const start=Date.now();
  let r;try{
   r=await nvidiaChatCompletion({model:h.MODEL,messages:[{role:'system',content:system},{role:'user',content:user}],
    maxTokens:4096,timeoutMs:120000,temperature:0,jsonMode:true,enableThinking:false});
  }catch(e){h.log('BLOCKED',{step:n,reason:'model_error',code:e.code||e.name,elapsed_ms:Date.now()-start});return;}
  let o;try{o=JSON.parse(r.content);}catch{o=null;}
  if(r.model_returned!==h.MODEL||r.finish_reason!=='stop'||!o||o.stage!==h.stageNames[n]){
   h.log('BLOCKED',{step:n,reason:'incomplete_output',finish_reason:r.finish_reason,elapsed_ms:Date.now()-start});return;
  }
  const audit=h.check(n,o,brief,prior);
  const row={agent_id:h.AGENT,model_returned:r.model_returned,brief_sha:f.sha,step:n,
   input_sha256:h.digest(system+'\n'+user),output_sha256:h.digest(JSON.stringify(o)),
   input_chars:system.length+user.length,output_chars:r.content.length,usage:r.usage,finish_reason:r.finish_reason,
   elapsed_ms:Date.now()-start,audit,output:o};
  const saved=await h.save(path,row);prior.push(row);
  h.log('CHECKPOINT',{step:n,audit_passed:audit.passed,issues:audit.issues,elapsed_ms:row.elapsed_ms,
   input_chars:row.input_chars,output_chars:row.output_chars,output_sha256:row.output_sha256,
   blob:saved.blob,commit:saved.commit,bytes:saved.bytes});
  if(!audit.passed){h.log('BLOCKED',{step:n,reason:'deterministic_audit_failed',issues:audit.issues});return;}
 }
 h.log('RESULT',{phase,status:phase===2?'durable_pause':'complete',passed:prior.map(x=>x.audit.passed)});
}
