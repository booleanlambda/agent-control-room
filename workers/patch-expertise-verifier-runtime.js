const GH = 'https://api.github.com';
const REPO = 'booleanlambda/agent-control-room';

function headers() {
  const token = String(process.env.AAU_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('AAU_GITHUB_TOKEN is not configured');
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'AAU-Lifecycle-v0.5-Patcher/1.0',
  };
}

async function gh(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`github_${response.status}:${body?.message || text.slice(0, 500)}`);
  return body;
}

async function patchFile(path, transform, message) {
  const api = `${GH}/repos/${REPO}/contents/${path}`;
  const file = await gh(`${api}?ref=main`);
  const source = Buffer.from(file.content || '', 'base64').toString('utf8');
  const next = transform(source);
  if (next === source) return { path, changed: false };
  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(next, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { path, changed: true, commit_sha: response?.commit?.sha || null };
}

export async function patchExpertiseVerifierRuntime() {
  const single = await patchFile('workers/nvidia-single-agent-wake.js', (source) => {
    if (source.includes('representation_desired=true is required by Lifecycle v0.5')) return source;
    const oldBlock = `Embodiment rules:\n- A particular embodiment or external representation is optional. If mandatory_lifecycle_context requires the Embodiment Artifact stage, making a deliberate embodiment decision is mandatory; representation_desired=false is valid and satisfies that decision when recorded with a reason.\n- Do not feel pressured to choose a humanlike form, gender presentation, age presentation, culture, voice, or visual identity.`;
    const newBlock = `Embodiment rules:\n- Under mandatory lifecycle v0.5, both Embodiment Artifact engagement and an affirmative representation are mandatory at the Embodiment stage. representation_desired=true is required by Lifecycle v0.5, and the embodiment must reach at least PROVISIONAL or SELF_SELECTED before the stage can complete.\n- The runtime may require that a representation exist, but it must not choose the substantive form for the agent. The agent chooses whether the representation is humanlike, robotic, abstract, creature-like, mixed, or another coherent form, and chooses its own visual/audio/presentation traits.\n- Do not infer human legal or biological facts from synthetic embodiment choices.`;
    if (!source.includes(oldBlock)) throw new Error('single_agent_old_embodiment_block_not_found');
    let next = source.replace(oldBlock, newBlock);
    next = next.replace('persistent_agent_system_prompt_nvidia_v0_3_mandatory_artifact_lifecycle', 'persistent_agent_system_prompt_nvidia_v0_4_mandatory_representation');
    return next;
  }, 'feat: enforce mandatory embodiment representation in autonomous prompt');

  const manual = await patchFile('workers/nvidia-manual-agent-wake.js', (source) => {
    if (source.includes('representation_desired=true is required by Lifecycle v0.5')) return source;
    const oldLine = '- A particular embodiment is optional unless mandatory_lifecycle_context currently requires the Embodiment Artifact stage. representation_desired=false is a valid deliberate decision when accompanied by a reason.';
    const newLines = '- Under mandatory lifecycle v0.5, both Embodiment Artifact engagement and an affirmative representation are mandatory at the Embodiment stage. representation_desired=true is required by Lifecycle v0.5, and the embodiment must reach at least PROVISIONAL or SELF_SELECTED before the stage can complete.\n- The agent chooses the substantive representation; the runtime may require representation but must not choose its form or identity traits.';
    if (!source.includes(oldLine)) throw new Error('manual_agent_old_embodiment_line_not_found');
    return source.replace(oldLine, newLines);
  }, 'feat: enforce mandatory embodiment representation in manual prompt');

  return { ok: true, contract: 'mandatory_embodiment_representation_v0_5', results: [single, manual] };
}
