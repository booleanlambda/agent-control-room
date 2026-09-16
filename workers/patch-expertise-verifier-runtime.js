const GH = 'https://api.github.com';
const REPO = 'booleanlambda/agent-control-room';
const PATH = 'workers/expertise-verification-worker.js';

function headers() {
  const token = String(process.env.AAU_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('AAU_GITHUB_TOKEN is not configured');
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'AAU-Expertise-Runtime-Patcher/0.6',
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

export async function patchExpertiseVerifierRuntime() {
  const api = `${GH}/repos/${REPO}/contents/${PATH}`;
  const file = await gh(`${api}?ref=main`);
  let source = Buffer.from(file.content || '', 'base64').toString('utf8');
  if (source.includes('candidate_no_thinking_v0_1')) {
    return { ok: true, changed: false, reason: 'already_patched_candidate_no_thinking_v0_1' };
  }
  if (!source.includes('expertise_verifier_latency_v0_1')) {
    throw new Error('latency_patch_not_present');
  }

  const oldLine = "  if (model === 'z-ai/glm-5.3') body.chat_template_kwargs = { clear_thinking: true };";
  const newLines = "  if (model === 'z-ai/glm-5.3') body.chat_template_kwargs = { clear_thinking: true };\n  else if (String(model || '').startsWith('nvidia/nemotron')) body.chat_template_kwargs = { enable_thinking: false }; // candidate_no_thinking_v0_1";
  if (!source.includes(oldLine)) throw new Error('nvidia_thinking_anchor_not_found');
  source = source.replace(oldLine, newLines);

  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'fix: disable Nemotron thinking in expertise verifier',
      content: Buffer.from(source, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, commit_sha: response?.commit?.sha || null, contract: 'candidate_no_thinking_v0_1' };
}
