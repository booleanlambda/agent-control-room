import { qda601BootstrapMessage, qda601RequiredForAgent, buildQda601Context } from './qda601-runtime.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const serviceRole = String(process.env.AAU_SUPABASE_SERVICE_ROLE_KEY || '').trim();

async function serviceRpc(name,args={}) {
  if (!serviceRole) throw new Error('qda601_bootstrap_service_role_missing');
  const response=await fetch(`${SB}/rest/v1/rpc/${name}`,{
    method:'POST',
    headers:{apikey:serviceRole,authorization:`Bearer ${serviceRole}`,'content-type':'application/json'},
    body:JSON.stringify(args),
  });
  const text=await response.text();
  let body=null; try{body=text?JSON.parse(text):null;}catch{body=text;}
  if(!response.ok)throw new Error(`${name}:${response.status}:${typeof body==='string'?body.slice(0,800):JSON.stringify(body).slice(0,800)}`);
  return body;
}

export async function runConfiguredQda601Bootstrap() {
  const enabled=['1','true','yes','on'].includes(String(process.env.AAU_QDA601_BOOTSTRAP_ON_START || '').trim().toLowerCase());
  const agentId=String(process.env.AAU_QDA601_BOOTSTRAP_AGENT_ID || '').trim();
  if(!enabled)return {skipped:true,reason:'disabled'};
  if(!agentId)return {skipped:true,reason:'agent_id_missing'};
  if(!qda601RequiredForAgent(agentId))throw new Error('qda601_bootstrap_agent_not_in_required_allowlist');

  const ctx=await buildQda601Context(agentId);
  if(ctx.completed_units>0 || ctx.final_submission?.exists){
    const resume=await serviceRpc('aau_control_room_admin_unpause',{p_agent_id:agentId}).catch(error=>({status:'unpause_failed',error:String(error?.message||error).slice(0,800)}));
    return {skipped:true,reason:'course_already_started',agent_id:agentId,progress:{completed_units:ctx.completed_units,total_units:ctx.total_units},resume};
  }

  const chat=await serviceRpc('aau_control_room_admin_chat_send',{
    p_agent_id:agentId,
    p_message:qda601BootstrapMessage(),
  });
  const resume=await serviceRpc('aau_control_room_admin_unpause',{p_agent_id:agentId});
  return {ok:true,agent_id:agentId,chat,resume,qda_context:ctx};
}
