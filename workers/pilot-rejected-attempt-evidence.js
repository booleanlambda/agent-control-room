// Durable evidence for rejected pilot/model attempts.
// Stores metadata only. Rejected attempts are never continuation checkpoints and never carry reasoning content.
import { createHash } from 'node:crypto';

const REPO='booleanlambda/agent-control-room';
const token=()=>String(process.env.AAU_GITHUB_TOKEN||'').trim();
const sha=x=>createHash('sha256').update(String(x??'')).digest('hex');

async function gh(method,path,branch,body){
  const url='https://api.github.com/repos/'+REPO+'/contents/'+path+(method==='GET'?'?ref='+encodeURIComponent(branch):'');
  const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token(),Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
  const p=await r.json();
  if(method==='GET'&&r.status===404)return null;
  if(!r.ok)throw Error('rejected_attempt_github_'+r.status+':'+String(p.message||'').slice(0,100));
  return p;
}
async function nextPath({branch,root,label}){
  const safe=String(label).replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,80);
  for(let i=1;i<=99;i++){
    const n=String(i).padStart(3,'0');
    const path=root+'/rejected_attempts/'+safe+'_attempt_'+n+'.json';
    if(!(await gh('GET',path,branch)))return path;
  }
  throw Error('rejected_attempt_index_exhausted:'+safe);
}
export async function persistRejectedPilotAttempt({
  branch,root,label,agentId,testContract,modelRequested,modelReturned=null,
  rejectionReason,finishReason=null,elapsedMs=null,usage=null,
  partialOutput=null,reasoningChars=null,reasoningTokens=null,
  inputSha256=null,priorCheckpointSha256=null,sourceIds=[],
  provenance='runtime_native'
}){
  if(!token())throw Error('rejected_attempt_github_token_missing');
  if(!branch||!root||!label||!rejectionReason)throw Error('rejected_attempt_required_fields_missing');
  const path=await nextPath({branch,root,label});
  const partial=partialOutput==null?null:String(partialOutput);
  const row={
    contract:'aau_rejected_attempt_evidence_v0_1',
    test_contract:testContract||null,
    agent_id:agentId||null,
    label,
    status:'REJECTED',
    continuation_eligibility:'NOT_ELIGIBLE_FOR_CONTINUATION',
    rejection_reason:rejectionReason,
    model_requested:modelRequested||null,
    model_returned:modelReturned||null,
    finish_reason:finishReason,
    elapsed_ms:elapsedMs,
    usage:usage||null,
    reasoning_chars:reasoningChars,
    reasoning_tokens:reasoningTokens,
    input_sha256:inputSha256,
    prior_checkpoint_sha256:priorCheckpointSha256,
    source_ids:Array.isArray(sourceIds)?sourceIds:[],
    partial_output_chars:partial==null?null:partial.length,
    partial_output_sha256:partial==null?null:sha(partial),
    reasoning_content_persisted:false,
    continuation_rule:'This record is evidence only. It MUST NOT be used as a completed checkpoint or as input to later reasoning stages.',
    provenance,
    recorded_at:new Date().toISOString()
  };
  const content=JSON.stringify(row,null,2)+'\n';
  const p=await gh('PUT',path,branch,{branch,message:'Persist rejected pilot attempt '+label,content:Buffer.from(content).toString('base64')});
  return {path,blob:p.content.sha,commit:p.commit.sha,row};
}
