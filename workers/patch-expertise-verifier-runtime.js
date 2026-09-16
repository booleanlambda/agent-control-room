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
    'user-agent': 'AAU-Expertise-Runtime-Patcher/0.9',
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
  if (source.includes('operator_smoke_single_task_v0_1')) {
    return { ok: true, changed: false, reason: 'already_patched_operator_smoke_single_task_v0_1' };
  }
  if (!source.includes('robust_grade_parser_v0_1')) {
    throw new Error('robust_grade_parser_not_present');
  }

  const oldLine = '  const taskCount = Math.min(5, Math.max(3, competencies.length || 3));';
  const newLine = "  const taskCount = run.metadata?.operator_smoke_test ? 1 : Math.min(5, Math.max(3, competencies.length || 3)); // operator_smoke_single_task_v0_1";
  if (!source.includes(oldLine)) throw new Error('task_count_anchor_not_found');
  source = source.replace(oldLine, newLine);

  const oldCandidate = "const result = await nvidiaCall({ model: run.candidate_model_id, system, user, maxTokens: 700, temperature: 0.10, timeoutMs: 60000 });";
  const newCandidate = "const result = await nvidiaCall({ model: run.candidate_model_id, system, user, maxTokens: 700, temperature: 0.10, timeoutMs: run.metadata?.operator_smoke_test ? 90000 : 60000 });";
  if (!source.includes(oldCandidate)) throw new Error('candidate_timeout_anchor_not_found');
  source = source.replace(oldCandidate, newCandidate);

  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'test: use one challenge for expertise operator smoke',
      content: Buffer.from(source, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, commit_sha: response?.commit?.sha || null, contract: 'operator_smoke_single_task_v0_1' };
}
