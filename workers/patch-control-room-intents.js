const GH='https://api.github.com';
const REPO='booleanlambda/agent-control-room';
const PATH='index.html';

function headers(){
  const token=String(process.env.AAU_GITHUB_TOKEN||'').trim();
  if(!token) throw new Error('AAU_GITHUB_TOKEN is not configured');
  return {authorization:`Bearer ${token}`,accept:'application/vnd.github+json','content-type':'application/json','x-github-api-version':'2022-11-28','user-agent':'AAU-Control-Room-Intent-Patcher/1.0'};
}
async function gh(url,options={}){
  const r=await fetch(url,{...options,headers:{...headers(),...(options.headers||{})}});
  const t=await r.text();let b=null;try{b=JSON.parse(t)}catch{}
  if(!r.ok) throw new Error(`github_${r.status}:${b?.message||t.slice(0,500)}`);
  return b;
}
function replaceOnce(src,oldText,newText,label){
  if(!src.includes(oldText)) throw new Error(`control_room_intent_patch_anchor_missing:${label}`);
  return src.replace(oldText,newText);
}
function patch(src){
  if(src.includes('intent_visibility_v0_1')) return src;
  let next=src;

  const timelineFn=`function timelineHtml(d){/* activity_timeline_schema_v0_2 */return (d?.recent_activity||d?.timeline||[]).slice(0,12).map(e=>{const title=e?.title||e?.event_type||e?.action||e?.kind||e?.event_kind||'Activity';const detail=e?.detail||e?.summary||e?.details||e?.stated_reason||e?.context?.stated_reason||'';const type=e?.event_kind||e?.kind||e?.event_type||'';const stamp=e?.occurred_at||e?.created_at||e?.timestamp||null;const meta=[type,stamp?when(stamp):''].filter(Boolean).join(' · ');return \`<div class="event"><b>\${esc(title)}</b>\${detail?\`<div>\${esc(detail)}</div>\`:''}\${meta?\`<div class="msgmeta">\${esc(meta)}</div>\`:''}</div>\`}).join('')||'<div class="empty">No recent activity supplied.</div>'}`;
  const visibilityFns=`${timelineFn}\n/* intent_visibility_v0_1 */\nfunction intentReason(i){return i?.intent_reason||i?.payload?.reason||i?.reason||'No intent reason recorded.'}\nfunction nextIntentHtml(d){const intents=Array.isArray(d?.next_intents)?d.next_intents:[];const i=intents.find(x=>x?.status==='active')||intents[0];if(!i)return '<div class="empty">No active next intent.</div>';const execs=Array.isArray(d?.intent_executions)?d.intent_executions:[];const q=execs.find(x=>x?.next_intent_id===i.next_intent_id&&['queued','claimed','running'].includes(x?.status));const meta=[i.status||'active',i.intent_kind||'',i.execute_at?when(i.execute_at):'',i.execute_at?rel(i.execute_at):'',q?.status?('execution '+q.status):'',Number.isFinite(Number(q?.attempts))?('attempts '+q.attempts):''].filter(Boolean).join(' · ');return \`<div class="event"><b>\${esc(intentReason(i))}</b><div class="msgmeta">\${esc(meta)}</div>\${q?.last_error?\`<div class="badtext">Last error: \${esc(q.last_error)}</div>\`:''}</div>\`}\nfunction intentHistoryHtml(d){const xs=Array.isArray(d?.intent_executions)?d.intent_executions:[];if(!xs.length)return '<div class="empty">No intent execution history supplied.</div>';return xs.slice(0,14).map(x=>{const reason=intentReason(x);const times=[x.created_at?('created '+when(x.created_at)):'',x.execute_at?('due '+when(x.execute_at)):'',x.started_at?('started '+when(x.started_at)):'',x.completed_at?('completed '+when(x.completed_at)):''].filter(Boolean).join(' · ');const meta=[x.status||'',x.source_kind||'',x.trigger_type||'',Number.isFinite(Number(x.attempts))?('attempts '+x.attempts):''].filter(Boolean).join(' · ');const preserved=x?.metadata?.semantic_intent_preserved===true?'Intent preserved during attention interruption.':'';const suspended=x?.last_error==='suspended_by_attention_arbiter'?'Suspended by Attention Arbiter.':'';return \`<div class="event"><b>\${esc(reason)}</b>\${meta?\`<div class="msgmeta">\${esc(meta)}</div>\`:''}\${times?\`<div>\${esc(times)}</div>\`:''}\${preserved?\`<div class="accent">\${esc(preserved)}</div>\`:''}\${suspended?\`<div class="warn">\${esc(suspended)}</div>\`:''}\${x?.last_error&&x.last_error!=='suspended_by_attention_arbiter'?\`<div class="badtext">\${esc(x.last_error)}</div>\`:''}</div>\`}).join('')}\n`;
  next=replaceOnce(next,timelineFn,visibilityFns,'intent_functions');

  const updateAnchor=` const timeline=$('#drawerTimeline');if(timeline)timeline.innerHTML=timelineHtml(d);`;
  const updateReplacement=` const nextIntent=$('#drawerNextIntent');if(nextIntent)nextIntent.innerHTML=nextIntentHtml(d);\n const intentHistory=$('#drawerIntentHistory');if(intentHistory)intentHistory.innerHTML=intentHistoryHtml(d);\n${updateAnchor}`;
  next=replaceOnce(next,updateAnchor,updateReplacement,'drawer_dynamic');

  const recentAnchor=`<h3>Recent Activity</h3><div class="timeline" id="drawerTimeline">\${timelineHtml(d)}</div>`;
  const recentReplacement=`<h3>Next Intent</h3><div class="timeline" id="drawerNextIntent">\${nextIntentHtml(d)}</div>\n<h3>Intent History</h3><div class="timeline" id="drawerIntentHistory">\${intentHistoryHtml(d)}</div>\n${recentAnchor}`;
  next=replaceOnce(next,recentAnchor,recentReplacement,'drawer_sections');

  const experimentOld=`if(cur.agent_id){$('#experiment').innerHTML=\`<div class="identity">\${avatar(cur,'lg')}<div><div class="focus-name">\${esc(displayName(cur))}</div><div class="focus-label">\${esc(cur.internal_label||'')}</div><div class="focus-model">\${esc(cur.primary_model_id||'')}</div><span class="stage">\${esc(nice(cur.current_stage||'—'))}</span></div></div><div class="reason">\${esc(cur.last_action||cur.selected_action||cur.stated_reason||'No recent action summary.')}</div><div class="actionrow">\${controlsHtml(cur,'current')}</div>\`;bindControls(cur,'current')}else $('#experiment').innerHTML='<div class="empty">No current agent.</div>';`;
  const experimentNew=`if(cur.agent_id){const ni=cur.next_intent||null;$('#experiment').innerHTML=\`<div class="identity">\${avatar(cur,'lg')}<div><div class="focus-name">\${esc(displayName(cur))}</div><div class="focus-label">\${esc(cur.internal_label||'')}</div><div class="focus-model">\${esc(cur.primary_model_id||'')}</div><span class="stage">\${esc(nice(cur.current_stage||'—'))}</span></div></div><div class="reason">\${esc(cur.last_action||cur.selected_action||cur.stated_reason||'No recent action summary.')}</div>\${ni?\`<div class="nextline"><b>Next intent:</b> \${esc(intentReason(ni))}<br><span class="msgmeta">\${esc(when(ni.execute_at))} · \${esc(rel(ni.execute_at))}</span></div>\`:''}<div class="actionrow">\${controlsHtml(cur,'current')}</div>\`;bindControls(cur,'current')}else $('#experiment').innerHTML='<div class="empty">No current agent.</div>';`;
  next=replaceOnce(next,experimentOld,experimentNew,'current_agent_next_intent');
  return next;
}

export async function patchControlRoomIntentVisibility(){
  const api=`${GH}/repos/${REPO}/contents/${PATH}`;
  const file=await gh(`${api}?ref=main`);
  const source=Buffer.from(file.content||'','base64').toString('utf8');
  const out=patch(source);
  if(out===source)return{ok:true,changed:false,contract:'intent_visibility_v0_1'};
  const result=await gh(api,{method:'PUT',body:JSON.stringify({message:'fix: show next intent and intent history in control room',content:Buffer.from(out,'utf8').toString('base64'),sha:file.sha,branch:'main'})});
  return{ok:true,changed:true,contract:'intent_visibility_v0_1',commit_sha:result?.commit?.sha||null};
}
