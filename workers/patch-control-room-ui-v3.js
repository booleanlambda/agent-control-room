const GH = 'https://api.github.com';
const REPO = 'booleanlambda/agent-control-room';
const PATH = 'index.html';

function headers() {
  const token = String(process.env.AAU_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('AAU_GITHUB_TOKEN is not configured');
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'AAU-Control-Room-UI-Patcher/3.0',
  };
}

async function gh(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`github_${response.status}:${body?.message || text.slice(0,500)}`);
  return body;
}

function patch(source) {
  if (source.includes('control_room_ui_v3')) return source;
  let next = source;

  const css = `
/* control_room_ui_v3 */
.dashboard-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.72fr);gap:12px;align-items:start}
.runtime-fold{margin:0}.runtime-fold>summary,.fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.runtime-fold>summary::-webkit-details-marker,.fold>summary::-webkit-details-marker{display:none}.runtime-fold>summary:after,.fold>summary:after{content:'▾';font-size:12px;color:var(--muted);transition:.15s}.runtime-fold[open]>summary:after,.fold[open]>summary:after{transform:rotate(180deg)}.runtime-fold .kv{margin-top:10px}
.drawer{padding:0;overflow:hidden;display:flex;flex-direction:column}.drawer-shell{display:flex;flex-direction:column;height:100vh;min-height:0}.drawer-top{padding:16px 18px 12px;border-bottom:1px solid var(--line);background:#090e15;flex:none}.drawer-topline{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.drawer-top .close{float:none;flex:none}.drawer-headmeta{min-width:0;flex:1}.drawer-headmeta .identity{align-items:flex-start}.drawer-controls-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px}.drawer-controls-row .controls{margin:0}
.drawer-nav{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;padding:8px 10px;border-bottom:1px solid var(--line);background:#080c12;flex:none}.navbtn{appearance:none;border:1px solid transparent;background:transparent;color:var(--muted);border-radius:9px;padding:8px 5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;font-size:10px;white-space:nowrap}.navbtn .ico{font-size:15px;line-height:1}.navbtn:hover{background:#0e1722;color:var(--text)}.navbtn.active{background:#101d2b;border-color:#28415b;color:var(--accent)}
.drawer-content{overflow:auto;min-height:0;flex:1;padding:14px 18px 22px}.drawer-tab{display:none}.drawer-tab.active{display:block}.drawer-tab h3:first-child{margin-top:2px}.drawer-tab h3{margin-top:16px}.overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.overview-card{background:#0d141e;border:1px solid #1b2a3d;border-radius:10px;padding:10px;min-width:0}.overview-card.wide{grid-column:1/-1}.overview-card .ov{font-size:12px;line-height:1.45;margin-top:4px;overflow-wrap:anywhere}.overview-card .big{font-size:15px;font-weight:700}.sectionbar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}.sectionbar h3{margin:0}.countbadge{font-size:9px;border:1px solid #2a3b50;border-radius:999px;padding:3px 6px;color:var(--muted)}
.fold{background:#0a1018;border:1px solid #1b2a3d;border-radius:10px;padding:10px;margin-top:9px}.fold>div{margin-top:9px}.compact-list .event{padding:8px}.intent-current .event{border-color:#294b65;background:#0d1823}.chatlog{max-height:calc(100vh - 340px);min-height:220px}.filelist{max-height:calc(100vh - 350px);overflow:auto}.timeline{gap:6px}.event{padding:8px 9px}.event div{line-height:1.4}
.mobile-label{display:none}
@media(max-width:900px){.dashboard-main{grid-template-columns:1fr}.runtime-fold{order:2}.drawer{width:min(760px,100vw)}}
@media(max-width:650px){.drawer-top{padding:12px}.drawer-content{padding:12px}.drawer-nav{gap:2px;padding:6px}.navbtn{padding:8px 2px}.navbtn .label{display:none}.navbtn .ico{font-size:18px}.overview-grid{grid-template-columns:1fr}.overview-card.wide{grid-column:auto}.chatlog{max-height:calc(100vh - 310px)}}
`;
  if (!next.includes('</style>')) throw new Error('ui_v3_style_anchor_missing');
  next = next.replace('</style>', `${css}</style>`);

  const oldMain = `  <div class="system"><section class="panel"><h2>Runtime</h2><div id="runtime" class="kv"></div></section><section class="panel"><h2>Current agent</h2><div id="experiment"></div></section></div>`;
  const newMain = `  <div class="dashboard-main"><section class="panel"><h2>Current agent</h2><div id="experiment"></div></section><details class="panel runtime-fold"><summary><span>Runtime details</span><span class="muted">system</span></summary><div id="runtime" class="kv"></div></details></div>`;
  if (!next.includes(oldMain)) throw new Error('ui_v3_main_anchor_missing');
  next = next.replace(oldMain, newMain);

  const helperAnchor = `function timelineHtml(d){/* activity_timeline_schema_v0_2 */`;
  if (!next.includes(helperAnchor)) throw new Error('ui_v3_helper_anchor_missing');
  const helpers = `function overviewHtml(d,a){const ni=(Array.isArray(d?.next_intents)?d.next_intents:[]).find(x=>x?.status==='active')||(Array.isArray(d?.next_intents)?d.next_intents[0]:null);const r=a?.resources||{};const compute=r?.compute?.balance??a?.compute_balance??a?.compute_credits;const state=a?.sleeping?'Sleeping':(a?.awake?'Awake':'Idle');const reason=a?.last_stated_reason||a?.last_action||a?.current_focus||'No recent action summary.';return \`<div class="overview-grid"><div class="overview-card"><div class="k">State</div><div class="ov big">\${esc(state)}</div><div class="msgmeta">\${esc(nice(a?.current_focus||a?.lifecycle_stage||'—'))}</div></div><div class="overview-card"><div class="k">Compute</div><div class="ov big">\${esc(fmt(compute))}</div><div class="msgmeta">existence account \${esc(a?.existence_account_state||'—')}</div></div><div class="overview-card wide"><div class="k">Current work</div><div class="ov">\${esc(reason)}</div></div><div class="overview-card wide"><div class="k">Next intent</div><div class="ov">\${esc(ni?intentReason(ni):'No active next intent.')}</div>\${ni?.execute_at?\`<div class="msgmeta">\${esc(when(ni.execute_at))} · \${esc(rel(ni.execute_at))}</div>\`:''}</div></div>\`}
function tabButton(tab,icon,label){return \`<button class="navbtn" type="button" data-tab="\${tab}" aria-label="\${esc(label)}"><span class="ico" aria-hidden="true">\${icon}</span><span class="label">\${esc(label)}</span></button>\`}
function bindDrawerTabs(preferred){const root=$('#drawerbody');if(!root)return;const buttons=[...root.querySelectorAll('.navbtn[data-tab]')],tabs=[...root.querySelectorAll('.drawer-tab[data-panel]')];const activate=name=>{buttons.forEach(b=>{const on=b.dataset.tab===name;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});tabs.forEach(p=>p.classList.toggle('active',p.dataset.panel===name));root.dataset.activeTab=name};buttons.forEach(b=>b.onclick=()=>activate(b.dataset.tab));activate(preferred||root.dataset.activeTab||'overview')}
`;
  next = next.replace(helperAnchor, `${helpers}${helperAnchor}`);

  const dynamicOld = ` const fileList=$('#drawerFileList');if(fileList){fileList.innerHTML=filesHtml(files);bindFileButtons(fileList)}\n const nextIntent=$('#drawerNextIntent');if(nextIntent)nextIntent.innerHTML=nextIntentHtml(d);`;
  const dynamicNew = ` const fileList=$('#drawerFileList');if(fileList){fileList.innerHTML=filesHtml(files);bindFileButtons(fileList)}\n const overview=$('#drawerOverview');if(overview)overview.innerHTML=overviewHtml(d,a);\n const nextIntent=$('#drawerNextIntent');if(nextIntent)nextIntent.innerHTML=nextIntentHtml(d);`;
  if (!next.includes(dynamicOld)) throw new Error('ui_v3_dynamic_anchor_missing');
  next = next.replace(dynamicOld, dynamicNew);

  const start = next.indexOf('function renderDrawer(d,c,fdata){');
  const end = next.indexOf('async function openAgent(id,silent=false)', start);
  if (start < 0 || end < 0) throw new Error('ui_v3_drawer_function_anchor_missing');
  const renderDrawer = `function renderDrawer(d,c,fdata){const a=d?.status||d?.agent||d||{},messages=c?.messages||[],files=fdata?.files||[];const prior=$('#drawerbody')?.dataset?.activeTab||'overview';$('#drawerbody').innerHTML=\`
<div class="drawer-shell">
  <div class="drawer-top">
    <div class="drawer-topline"><div id="drawerHeader" class="drawer-headmeta"><div class="identity">\${avatar(a,'lg')}<div><div class="focus-name">\${esc(displayName(a))}</div><div class="focus-label">\${esc(a.internal_label||'')}</div><div class="focus-model">\${esc(a.primary_model_id||'')}</div><span class="stage">\${esc(nice(a.current_stage||a.lifecycle_stage||'—'))}</span></div></div></div><button id="closeInner" class="close" aria-label="Close">&times;</button></div>
    <div class="drawer-controls-row"><div id="drawerControls">\${controlsHtml(a,'drawer')}</div><span class="msgmeta">Auto refresh · 5 sec</span></div>
  </div>
  <nav class="drawer-nav" aria-label="Agent navigation">\${tabButton('overview','&#8962;','Overview')}\${tabButton('chat','&#9993;','Chat')}\${tabButton('files','&#128206;','Files')}\${tabButton('intents','&#8644;','Intents')}\${tabButton('activity','&#9776;','Activity')}</nav>
  <div class="drawer-content">
    <section class="drawer-tab" data-panel="overview"><div id="drawerOverview">\${overviewHtml(d,a)}</div><details class="fold"><summary>Lifecycle & identity details</summary><div class="overview-grid"><div class="overview-card"><div class="k">Lifecycle</div><div class="ov">\${esc(nice(a.lifecycle_stage||a.current_stage||'—'))}</div></div><div class="overview-card"><div class="k">Identity</div><div class="ov">\${esc(a.identity_status||'—')}</div></div><div class="overview-card"><div class="k">Embodiment</div><div class="ov">\${esc(a.embodiment_status||'—')}</div></div><div class="overview-card"><div class="k">Expertise</div><div class="ov">\${esc(a.expertise_status||'—')}</div></div></div></details></section>
    <section class="drawer-tab" data-panel="chat"><div class="sectionbar"><h3>Admin ↔ Agent</h3><span class="countbadge">\${messages.length} messages</span></div><div class="chat"><div class="chatlog" id="chatlog">\${messagesHtml(messages)}</div><div class="composer"><textarea id="chatText" placeholder="Message this agent…"></textarea><button id="sendBtn" class="sendbtn">Send</button></div></div></section>
    <section class="drawer-tab" data-panel="files"><div class="sectionbar"><h3>Files</h3><span class="countbadge">\${files.length}</span></div><div class="filelist" id="drawerFileList">\${filesHtml(files)}</div><details class="fold"><summary>Send a file</summary><div class="uploadbox"><div class="uploadgrid"><input id="fileInput" type="file"><select id="filePurpose"><option value="attachment">General attachment</option><option value="embodiment_candidate">Embodiment candidate image</option></select><input id="fileCaption" placeholder="Caption (optional)"><input id="fileMessage" placeholder="Message to accompany file (optional)"></div><div class="actionrow"><button id="uploadBtn" class="filebtn">Upload & send</button><span class="uploadstatus" id="uploadStatus">Private storage · max 25 MB</span></div></div></details></section>
    <section class="drawer-tab" data-panel="intents"><h3>Next Intent</h3><div class="timeline intent-current" id="drawerNextIntent">\${nextIntentHtml(d)}</div><details class="fold"><summary>Intent history <span class="countbadge">\${Array.isArray(d?.intent_executions)?d.intent_executions.length:0}</span></summary><div class="timeline compact-list" id="drawerIntentHistory">\${intentHistoryHtml(d)}</div></details></section>
    <section class="drawer-tab" data-panel="activity"><div class="sectionbar"><h3>Recent Activity</h3><span class="countbadge">latest</span></div><div class="timeline" id="drawerTimeline">\${timelineHtml(d)}</div></section>
  </div>
</div>\`;
 st.drawerMountedFor=a.agent_id||st.drawerAgentId;bindControls(a,'drawer');bindDrawerTabs(prior);const closeInner=$('#closeInner');if(closeInner)closeInner.onclick=closeDrawer;const send=$('#sendBtn');if(send){send.onclick=()=>sendChat(a.agent_id);$('#chatText').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();sendChat(a.agent_id)}})}const upload=$('#uploadBtn');if(upload)upload.onclick=()=>uploadFile(a.agent_id);bindFileButtons($('#drawerbody'));const log=$('#chatlog');if(log)log.scrollTop=log.scrollHeight}
`;
  next = next.slice(0,start) + renderDrawer + next.slice(end);

  // Outer close button is redundant once the drawer has an integrated header close control.
  next = next.replace(`<div id="drawerbg" class="drawerbg"></div><aside id="drawer" class="drawer"><button id="close" class="close">×</button><div id="drawerbody"></div></aside>`, `<div id="drawerbg" class="drawerbg"></div><aside id="drawer" class="drawer"><div id="drawerbody"></div></aside>`);
  next = next.replace(`$('#close').onclick=closeDrawer;`, ``);

  return next;
}

export async function patchControlRoomUiV3() {
  const api = `${GH}/repos/${REPO}/contents/${PATH}`;
  const file = await gh(`${api}?ref=main`);
  const source = Buffer.from(file.content || '', 'base64').toString('utf8');
  const next = patch(source);
  if (next === source) return { ok: true, changed: false, version: 'control_room_ui_v3' };
  const result = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'ui: simplify Control Room navigation and grouping',
      content: Buffer.from(next,'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, version: 'control_room_ui_v3', commit_sha: result?.commit?.sha || null };
}
