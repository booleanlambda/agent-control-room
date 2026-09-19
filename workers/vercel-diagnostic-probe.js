import process from 'node:process';

const VC='https://api.vercel.com';

function redact(value){
  return String(value||'')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/ig,'$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*)[^\s,;]+/ig,'$1[REDACTED]')
    .slice(0,8000);
}

async function getJson(path){
  const token=String(process.env.VERCEL_AGENT_TOKEN||process.env.AAU_VERCEL_TOKEN||'').trim();
  if(!token) throw new Error('vercel_token_not_configured');
  const res=await fetch(VC+path,{headers:{authorization:`Bearer ${token}`,accept:'application/json'}});
  const text=await res.text();
  let body=null;
  try{body=JSON.parse(text);}catch{
    const rows=text.split('\n').map(x=>x.trim()).filter(Boolean);
    try{body=rows.map(x=>JSON.parse(x));}catch{body={raw:redact(text)}}
  }
  if(!res.ok){
    const e=new Error(`vercel:${res.status}`);
    e.details=body;
    throw e;
  }
  return body;
}

function qs(obj){
  const p=new URLSearchParams();
  for(const [k,v] of Object.entries(obj)) if(v!==null&&v!==undefined&&String(v)!=='') p.set(k,String(v));
  return p.toString()?`?${p.toString()}`:'';
}

export async function probeLatestVercelDeployment(){
  const projectId=String(process.env.AAU_VERCEL_DIAGNOSTIC_PROJECT_ID||'').trim();
  if(!projectId) throw new Error('AAU_VERCEL_DIAGNOSTIC_PROJECT_ID_missing');
  const teamId=String(process.env.VERCEL_AGENT_TEAM_ID||process.env.AAU_VERCEL_TEAM_ID||'').trim();

  const list=await getJson('/v7/deployments'+qs({projectId,limit:10,teamId}));
  const deployments=Array.isArray(list?.deployments)?list.deployments:(Array.isArray(list)?list:[]);
  if(!deployments.length) return {ok:false,project_id:projectId,reason:'no_deployments'};

  const latest=deployments[0];
  const id=String(latest?.uid||latest?.id||'');
  if(!id) return {ok:false,project_id:projectId,reason:'latest_deployment_id_missing'};

  const detail=await getJson('/v13/deployments/'+encodeURIComponent(id)+qs({teamId}));
  let events=[];
  try{
    const raw=await getJson('/v3/deployments/'+encodeURIComponent(id)+'/events'+qs({direction:'backward',limit:100,builds:1,teamId}));
    const rows=Array.isArray(raw)?raw:(Array.isArray(raw?.events)?raw.events:[]);
    events=rows.slice(0,40).map(e=>({
      type:e?.type||e?.payload?.type||null,
      created:e?.created||e?.date||e?.payload?.created||null,
      text:redact(e?.text||e?.payload?.text||''),
      status_code:e?.statusCode||e?.payload?.statusCode||null
    }));
  }catch(error){
    events=[{type:'events_fetch_error',text:redact(error?.details?.error?.message||error?.message||error)}];
  }

  return {
    ok:true,
    project_id:projectId,
    deployment:{
      id,
      name:detail?.name||latest?.name||null,
      url:detail?.url||latest?.url||null,
      status:detail?.status||latest?.status||null,
      ready_state:detail?.readyState||latest?.readyState||latest?.state||null,
      error_code:detail?.errorCode||detail?.error?.code||null,
      error_message:redact(detail?.errorMessage||detail?.error?.message||''),
      created_at:detail?.createdAt||latest?.createdAt||latest?.created||null,
      git_sha:detail?.gitSource?.sha||detail?.meta?.githubCommitSha||latest?.meta?.githubCommitSha||null,
      git_ref:detail?.gitSource?.ref||detail?.meta?.githubCommitRef||latest?.meta?.githubCommitRef||null
    },
    build_events:events
  };
}
