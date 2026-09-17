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
    'user-agent': 'AAU-Control-Room-Activity-Patcher/0.1',
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

export async function patchControlRoomActivityTimeline() {
  const api = `${GH}/repos/${REPO}/contents/${PATH}`;
  const file = await gh(`${api}?ref=main`);
  const source = Buffer.from(file.content || '', 'base64').toString('utf8');
  if (source.includes('activity_timeline_schema_v0_2')) {
    return { ok: true, changed: false, contract: 'activity_timeline_schema_v0_2' };
  }

  const oldFn = `function timelineHtml(d){return (d?.recent_activity||d?.timeline||[]).slice(0,12).map(e=>\`<div class="event"><b>\${esc(e.event_type||e.action||e.kind||'Activity')}</b><div>\${esc(e.summary||e.details||e.stated_reason||'')}</div></div>\`).join('')||'<div class="empty">No recent activity supplied.</div>'}`;
  const newFn = `function timelineHtml(d){/* activity_timeline_schema_v0_2 */return (d?.recent_activity||d?.timeline||[]).slice(0,12).map(e=>{const title=e?.title||e?.event_type||e?.action||e?.kind||e?.event_kind||'Activity';const detail=e?.detail||e?.summary||e?.details||e?.stated_reason||e?.context?.stated_reason||'';const type=e?.event_kind||e?.kind||e?.event_type||'';const stamp=e?.occurred_at||e?.created_at||e?.timestamp||null;const meta=[type,stamp?when(stamp):''].filter(Boolean).join(' · ');return \`<div class="event"><b>\${esc(title)}</b>\${detail?\`<div>\${esc(detail)}</div>\`:''}\${meta?\`<div class="msgmeta">\${esc(meta)}</div>\`:''}</div>\`}).join('')||'<div class="empty">No recent activity supplied.</div>'}`;

  if (!source.includes(oldFn)) throw new Error('control_room_activity_timeline_anchor_missing');
  const next = source.replace(oldFn, newFn);
  const result = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'fix: render current activity timeline schema in Control Room',
      content: Buffer.from(next, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, contract: 'activity_timeline_schema_v0_2', commit_sha: result?.commit?.sha || null };
}
