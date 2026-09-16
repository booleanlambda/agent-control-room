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
    'user-agent': 'AAU-Expertise-Runtime-Patcher/0.5',
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
  if (source.includes('expertise_verifier_latency_v0_1')) {
    return { ok: true, changed: false, reason: 'already_patched_latency_v0_1' };
  }
  if (!source.includes('deterministic_task_authority_v0_1')) {
    throw new Error('deterministic_authority_not_present');
  }

  source = source.replace(
    'Answer in 300-700 words.',
    'Answer in 180-350 words. Prioritize concrete technical decisions over exposition.'
  );
  source = source.replace(
    "const result = await nvidiaCall({ model: run.candidate_model_id, system, user, maxTokens: 1600, temperature: 0.15 });",
    "const result = await nvidiaCall({ model: run.candidate_model_id, system, user, maxTokens: 700, temperature: 0.10, timeoutMs: 60000 });"
  );
  source = source.replace(
    "const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 1000, temperature: 0, timeoutMs: 90000 });",
    "const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 500, temperature: 0, timeoutMs: 60000 });"
  );
  source = source.replace(
    "const result = await nvidiaCall({ model, system, user, maxTokens: 700, temperature: 0, timeoutMs: 60000 });",
    "const result = await nvidiaCall({ model, system, user, maxTokens: 500, temperature: 0, timeoutMs: 45000 });"
  );

  const needle = "async function processRun(run) {\n  const packet = await createChallenge(run);\n  const answers = await answerChallenge(run, packet);";
  const replacement = "async function processRun(run) {\n  const packet = await createChallenge(run);\n  console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'challenge_ready', tasks: packet.tasks.length, authority: packet.authority?.model || null, contract: 'expertise_verifier_latency_v0_1' }));\n  const answers = await answerChallenge(run, packet);\n  console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'candidate_answers_ready', answers: answers.length }));";
  if (!source.includes(needle)) throw new Error('process_run_anchor_not_found');
  source = source.replace(needle, replacement);

  source = source.replace(
    "authGrades.push(grade);",
    "authGrades.push(grade);\n    console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'authenticated_task', task_id: task.id, score: grade.score, confidence: grade.confidence }));"
  );

  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'fix: bound expertise verifier stage latency',
      content: Buffer.from(source, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, commit_sha: response?.commit?.sha || null, contract: 'expertise_verifier_latency_v0_1' };
}
