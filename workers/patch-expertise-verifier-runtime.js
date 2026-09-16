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
    'user-agent': 'AAU-Expertise-Runtime-Patcher/0.2',
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
  if (source.includes('challenge_authority_retry_v0_3_full_body_timeout')) {
    return { ok: true, changed: false, reason: 'already_patched_v0_3' };
  }

  const callStart = source.indexOf('async function nvidiaCall(');
  const callEnd = source.indexOf('\nfunction parseJsonObject(', callStart);
  if (callStart < 0 || callEnd < 0) throw new Error('nvidiaCall_anchor_not_found');

  const nvidiaCall = `async function nvidiaCall({ model, system, user, maxTokens = 1200, temperature = 0, timeoutMs = 180000 }) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };
  if (model === 'z-ai/glm-5.3') body.chat_template_kwargs = { clear_thinking: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(15000, Number(timeoutMs) || 180000));
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: \`Bearer \${nvidiaKey}\`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'AAU-Expertise-Verifier/0.2',
      },
      body: JSON.stringify(body),
    });
    const parsed = await jsonResponse(response);
    if (!response.ok) {
      const e = new Error(\`nvidia_\${response.status}:\${parsed.body?.error?.message || parsed.body?.detail || parsed.raw.slice(0, 700)}\`);
      e.status = response.status;
      throw e;
    }
    const message = parsed.body?.choices?.[0]?.message || {};
    return {
      text: String(message.content || message.reasoning_content || parsed.body?.choices?.[0]?.text || '').trim(),
      model: parsed.body?.model || model,
      usage: parsed.body?.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}
`;
  source = source.slice(0, callStart) + nvidiaCall + source.slice(callEnd);

  const start = source.indexOf('async function createChallenge(run) {');
  const end = source.indexOf('\nasync function answerChallenge(run, packet) {', start);
  if (start < 0 || end < 0) throw new Error('createChallenge_anchor_not_found');

  const replacement = `async function createChallenge(run) {
  const competencies = normalizeCompetencies(run.competencies);
  const taskCount = Math.min(8, Math.max(3, competencies.length || 3));
  const system = 'You are the independent AAU expertise task authority. Create a fresh, closed-book professional assessment. Test applied judgment and transfer, not trivia. Do not reveal answers. Output one valid JSON object only: no markdown, commentary, or code fences.';
  const baseUser = \`DOMAIN: \${run.domain}\\nTARGET STANDARD: \${run.target_standard}\\nSCOPE: \${JSON.stringify(run.scope || {})}\\nCOMPETENCIES: \${JSON.stringify(competencies)}\\nEVIDENCE REQUIREMENTS: \${JSON.stringify(run.evidence_requirements || {})}\\nVERIFICATION PLAN: \${JSON.stringify(run.verification_plan || {})}\\n\\nCreate exactly \${taskCount} distinct tasks. Return {"tasks":[{"id":"T1","competency":"...","scenario":"...","prompt":"...","grading_anchors":["..."],"critical_failures":["..."]}]}. Each task must have 4-8 grading_anchors and 0-3 critical_failures. JSON strings must be properly escaped.\`;
  const candidates = [run.task_authority_model, 'mistralai/mistral-nemotron', 'google/gemma-4-31b-it']
    .filter((x, i, a) => x && a.indexOf(x) === i && x !== run.candidate_model_id && x !== run.authenticator_model);
  let lastError = null;
  for (const model of candidates) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const user = attempt === 1 ? baseUser : baseUser + '\\n\\nIMPORTANT RETRY: your previous response was invalid. Return syntactically valid JSON only. Do not truncate.';
        const result = await nvidiaCall({ model, system, user, maxTokens: 1800, temperature: attempt === 1 ? 0.10 : 0, timeoutMs: 90000 });
        const packet = parseJsonObject(result.text);
        if (!Array.isArray(packet.tasks) || packet.tasks.length !== taskCount) throw new Error('invalid_challenge_task_count');
        for (const [i, task] of packet.tasks.entries()) {
          task.id = String(task.id || \`T\${i + 1}\`).slice(0, 50);
          if (!task.scenario || !task.prompt || !Array.isArray(task.grading_anchors) || task.grading_anchors.length < 4) throw new Error(\`invalid_challenge_task:\${task.id}\`);
        }
        packet.authority = { provider: 'nvidia_direct', model: result.model, attempt, contract: 'challenge_authority_retry_v0_3_full_body_timeout' };
        packet.packet_sha256 = sha256(packet);
        return packet;
      } catch (error) {
        lastError = error;
        console.warn('AAU_EXPERTISE_TASK_AUTHORITY_RETRY', JSON.stringify({ model, attempt, message: String(error?.message || error).slice(0, 600) }));
        if (attempt < 2) await sleep(1000 * attempt);
      }
    }
  }
  throw new Error(\`task_authority_no_valid_packet:\${String(lastError?.message || lastError || 'unknown').slice(0, 700)}\`);
}
`;

  source = source.slice(0, start) + replacement + source.slice(end);
  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'fix: bound NVIDIA expertise response time and add Gemma authority fallback',
      content: Buffer.from(source, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, commit_sha: response?.commit?.sha || null, contract: 'challenge_authority_retry_v0_3_full_body_timeout' };
}
