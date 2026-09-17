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
    'user-agent': 'AAU-Expertise-Verifier-Patcher/1.2',
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

function patchVerifierWorker(source) {
  if (source.includes('authenticator_fallback_chain_v0_1') && source.includes('candidate_retry_v0_1')) return source;
  let next = source;

  if (!next.includes('candidate_retry_v0_1')) {
    const oldCandidate = "    const result = await nvidiaCall({ model: run.candidate_model_id, system, user, maxTokens: 700, temperature: 0.10, timeoutMs: run.metadata?.operator_smoke_test ? 90000 : 60000 });";
    const newCandidate = `    // candidate_retry_v0_1: preserve the bound candidate model while tolerating transient provider latency/overload.\n    let result = null;\n    let lastError = null;\n    for (let attempt = 1; attempt <= 3; attempt++) {\n      try {\n        result = await nvidiaCall({ model: run.candidate_model_id, system, user, maxTokens: 700, temperature: 0.10, timeoutMs: 120000 });\n        break;\n      } catch (error) {\n        lastError = error;\n        const status = Number(error?.status || 0);\n        const retryable = error?.name === 'AbortError' || status === 429 || status >= 500;\n        if (!retryable || attempt === 3) throw error;\n        await sleep(1500 * attempt);\n      }\n    }\n    if (!result) throw lastError || new Error(\`candidate_no_result:\${task.id}\`);`;
    if (!next.includes(oldCandidate)) throw new Error('verifier_candidate_anchor_missing');
    next = next.replace(oldCandidate, newCandidate);
  }

  if (!next.includes('authenticator_fallback_chain_v0_1')) {
    const oldAuth = `  for (let attempt = 1; attempt <= 3; attempt++) {\n    const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 220, temperature: 0, timeoutMs: 60000, jsonMode: true });\n    const grade = parseGrade(result.text);\n    if (grade) return { ...grade, id: task.id, verifier_model: result.model, raw_sha256: sha256(result.text) };\n    if (attempt < 3) await sleep(1200 * attempt);\n  }\n  throw new Error(\`authenticator_unusable_grade:\${task.id}\`);`;
    const hardenedOldAuth = `  for (let attempt = 1; attempt <= 3; attempt++) {\n    try {\n      const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 220, temperature: 0, timeoutMs: 90000, jsonMode: true });\n      const grade = parseGrade(result.text);\n      if (grade) return { ...grade, id: task.id, verifier_model: result.model, raw_sha256: sha256(result.text) };\n    } catch (error) {\n      const status = Number(error?.status || 0);\n      const retryable = error?.name === 'AbortError' || status === 429 || status >= 500;\n      if (!retryable || attempt === 3) throw error;\n    }\n    if (attempt < 3) await sleep(1500 * attempt);\n  }\n  throw new Error(\`authenticator_unusable_grade:\${task.id}\`);`;
    const newAuth = `  // authenticator_fallback_chain_v0_1: Moonshot primary, Meta then NVIDIA fallback.\n  const authModels = [\n    run.authenticator_model || 'moonshotai/kimi-k3',\n    'meta/muse-glimmer-30b',\n    'nvidia/nemotron-3.5-lightning-30b-a3b',\n  ].filter((x, i, a) => x && a.indexOf(x) === i && x !== run.candidate_model_id);\n  let lastAuthError = null;\n  for (const model of authModels) {\n    for (let attempt = 1; attempt <= 2; attempt++) {\n      try {\n        const result = await nvidiaCall({ model, system, user, maxTokens: 320, temperature: 0, timeoutMs: 120000, jsonMode: false });\n        const grade = parseGrade(result.text);\n        if (grade) return { ...grade, id: task.id, verifier_model: result.model || model, verifier_requested_model: model, authenticator_fallback_used: model !== run.authenticator_model, raw_sha256: sha256(result.text) };\n        lastAuthError = new Error(\`authenticator_unusable_grade:\${task.id}:\${model}\`);\n      } catch (error) {\n        lastAuthError = error;\n        const status = Number(error?.status || 0);\n        const retryable = error?.name === 'AbortError' || status === 429 || status >= 500;\n        if (!retryable) break;\n      }\n      if (attempt < 2) await sleep(1500 * attempt);\n    }\n    console.warn('AAU_EXPERTISE_AUTHENTICATOR_MODEL_FAILED', model, String(lastAuthError?.message || lastAuthError || 'unusable_grade').slice(0, 500));\n  }\n  throw lastAuthError || new Error(\`authenticator_unusable_grade:\${task.id}\`);`;
    if (next.includes(oldAuth)) next = next.replace(oldAuth, newAuth);
    else if (next.includes(hardenedOldAuth)) next = next.replace(hardenedOldAuth, newAuth);
    else throw new Error('verifier_authenticator_anchor_missing');
  }

  const oldAdjCandidates = `  const candidates = [run.adjudicator_model, 'deepseek-ai/deepseek-v4-flash-0731', 'meta/muse-glimmer-30b']\n    .filter((x, i, a) => x && a.indexOf(x) === i && x !== run.authenticator_model && x !== run.candidate_model_id);`;
  const newAdjCandidates = `  const candidates = [run.adjudicator_model, 'nvidia/nemotron-3.5-lightning-30b-a3b', 'meta/muse-glimmer-30b']\n    .filter((x, i, a) => x && a.indexOf(x) === i && x !== run.authenticator_model && x !== prior.verifier_model && x !== run.candidate_model_id);`;
  if (next.includes(oldAdjCandidates)) next = next.replace(oldAdjCandidates, newAdjCandidates);

  const oldAdj = `  for (const model of candidates) {\n    try {\n      const result = await nvidiaCall({ model, system, user, maxTokens: 500, temperature: 0, timeoutMs: 45000 });\n      const grade = parseGrade(result.text);\n      if (grade) return { ...grade, id: task.id, adjudicator_model: result.model, supersedes_score: prior.score, raw_sha256: sha256(result.text) };\n    } catch (e) {\n      console.warn('AAU_EXPERTISE_ADJUDICATOR_MODEL_FAILED', model, String(e?.message || e).slice(0, 500));\n    }\n  }`;
  const newAdj = `  for (const model of candidates) {\n    for (let attempt = 1; attempt <= 2; attempt++) {\n      try {\n        const result = await nvidiaCall({ model, system, user, maxTokens: 650, temperature: 0, timeoutMs: 90000 });\n        const grade = parseGrade(result.text);\n        if (grade) return { ...grade, id: task.id, adjudicator_model: result.model || model, supersedes_score: prior.score, raw_sha256: sha256(result.text) };\n      } catch (e) {\n        console.warn('AAU_EXPERTISE_ADJUDICATOR_MODEL_FAILED', model, String(e?.message || e).slice(0, 500));\n      }\n      if (attempt < 2) await sleep(1500 * attempt);\n    }\n  }`;
  if (next.includes(oldAdj)) next = next.replace(oldAdj, newAdj);

  next = next.replace(
    "authenticator_model: run.authenticator_model, adjudicator_models:",
    "authenticator_model: run.authenticator_model, authenticator_models_used: [...new Set(authGrades.map((g) => g.verifier_model).filter(Boolean))], adjudicator_models:"
  );
  next = next.replace(
    "stage: 'authenticated_task', task_id: task.id, score: grade.score, confidence: grade.confidence",
    "stage: 'authenticated_task', task_id: task.id, score: grade.score, confidence: grade.confidence, verifier_model: grade.verifier_model, fallback_used: Boolean(grade.authenticator_fallback_used)"
  );
  next = next.replace(
    "authenticator: 'z-ai/glm-5.3', adjudicator: 'meta/muse-glimmer-30b'",
    "authenticator: 'moonshotai/kimi-k3', authenticator_fallbacks: ['meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b'], adjudicator: 'meta/muse-glimmer-30b'"
  );

  return next;
}

export async function patchExpertiseVerifierRuntime() {
  const verifier = await patchFile(
    'workers/expertise-verification-worker.js',
    patchVerifierWorker,
    'fix: Moonshot authenticator with Meta and NVIDIA fallbacks',
  );
  return {
    ok: true,
    contract: 'expertise_verifier_resilience_v0_2+authenticator_fallback_chain_v0_1',
    results: [verifier],
  };
}
