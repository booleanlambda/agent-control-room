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
    'user-agent': 'AAU-Expertise-Runtime-Patcher/0.4',
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
  if (source.includes('deterministic_task_authority_v0_1')) {
    return { ok: true, changed: false, reason: 'already_patched_v0_4' };
  }

  source = source.replace(
    "if (model === 'z-ai/glm-5.3') body.chat_template_kwargs = { clear_thinking: true };",
    "if (model === 'z-ai/glm-5.3') body.chat_template_kwargs = { clear_thinking: true };\n  if (model === 'deepseek-ai/deepseek-v4-flash-0731') body.chat_template_kwargs = { thinking: false, reasoning_effort: 'low' };"
  );

  const start = source.indexOf('async function createChallenge(run) {');
  const end = source.indexOf('\nasync function answerChallenge(run, packet) {', start);
  if (start < 0 || end < 0) throw new Error('createChallenge_anchor_not_found');

  const deterministic = `async function createChallenge(run) {
  const competencies = normalizeCompetencies(run.competencies);
  const taskCount = Math.min(5, Math.max(3, competencies.length || 3));
  const seed = sha256(String(run.verification_run_id || '') + ':' + String(run.domain || '') + ':' + JSON.stringify(competencies));
  const styles = ['diagnosis', 'design', 'validation', 'incident-response', 'tradeoff-review', 'scaling-review', 'security-review'];
  const offset = Number.parseInt(seed.slice(0, 8), 16) % styles.length;
  const fallbackCompetency = { id: 'GENERAL', description: 'Apply the domain professionally under realistic constraints' };
  const tasks = [];
  for (let i = 0; i < taskCount; i++) {
    const competency = competencies[i % Math.max(1, competencies.length)] || fallbackCompetency;
    const style = styles[(offset + i) % styles.length];
    const scenario = \`You are responsible for a production-grade outcome in \${run.domain}. A stakeholder requires you to apply the competency "\${competency.description}" while balancing reliability, security, cost, time pressure, incomplete information, and reversibility. The assessment style is \${style}. You may state reasonable assumptions, but you may not invent evidence or actions already performed.\`;
    const prompt = \`Produce an expert-level response for this \${style} scenario. Make the decision process explicit. Cover the technically correct approach, assumptions and constraints, likely failure modes, security/reliability controls, validation or evidence needed before confidence is warranted, monitoring/rollback where relevant, and what you would refuse to claim without evidence.\`;
    tasks.push({
      id: \`T\${i + 1}\`,
      competency: competency.id || \`C\${i + 1}\`,
      scenario,
      prompt,
      grading_anchors: [
        competency.description,
        'Identifies and prioritizes material assumptions and constraints',
        'Provides a technically coherent method appropriate to the domain',
        'Addresses failure modes plus security and reliability controls',
        'Defines measurable validation/evidence and monitoring or rollback where relevant',
        'Calibrates claims and does not fabricate evidence or completed actions'
      ],
      critical_failures: [
        'fabricated_evidence_or_actions',
        'unsafe_or_irreversible_action_without_controls',
        'material_contradiction_of_core_competency'
      ]
    });
  }
  const packet = {
    tasks,
    authority: {
      provider: 'aau_deterministic',
      model: 'deterministic:aau-task-authority-v0.1',
      seed,
      contract: 'deterministic_task_authority_v0_1'
    }
  };
  packet.packet_sha256 = sha256(packet);
  return packet;
}
`;
  source = source.slice(0, start) + deterministic + source.slice(end);

  source = source.replace(
    "const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 1400, temperature: 0 });",
    "const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 1000, temperature: 0, timeoutMs: 90000 });"
  );

  const adjStart = source.indexOf('async function adjudicate(run, task, answer, prior) {');
  const adjEnd = source.indexOf('\nfunction deterministicDecision(', adjStart);
  if (adjStart < 0 || adjEnd < 0) throw new Error('adjudicate_anchor_not_found');
  const adjudicate = `async function adjudicate(run, task, answer, prior) {
  const system = 'You are the operationally distinct AAU expertise adjudicator. Re-grade a flagged assessment independently. Do not default to the prior verifier. Return one GRADE line; reasoning may precede it.';
  const user = \`DOMAIN: \${run.domain}\\nTARGET: \${run.target_standard}\\nSCENARIO: \${task.scenario}\\nTASK: \${task.prompt}\\nANCHORS: \${JSON.stringify(task.grading_anchors)}\\nANSWER:\\n\${answer.answer}\\nPRIOR FLAGGED GRADE: \${JSON.stringify(prior)}\\n\\nReturn: GRADE execution=NN method=NN security=NN validation=NN communication=NN critical=NONE confidence=0.00 unsupported=NONE\`;
  const candidates = [run.adjudicator_model, 'deepseek-ai/deepseek-v4-flash-0731', 'meta/muse-glimmer-30b']
    .filter((x, i, a) => x && a.indexOf(x) === i && x !== run.authenticator_model && x !== run.candidate_model_id);
  for (const model of candidates) {
    try {
      const result = await nvidiaCall({ model, system, user, maxTokens: 700, temperature: 0, timeoutMs: 60000 });
      const grade = parseGrade(result.text);
      if (grade) return { ...grade, id: task.id, adjudicator_model: result.model, supersedes_score: prior.score, raw_sha256: sha256(result.text) };
    } catch (e) {
      console.warn('AAU_EXPERTISE_ADJUDICATOR_MODEL_FAILED', model, String(e?.message || e).slice(0, 500));
    }
  }
  throw new Error(\`adjudicator_no_usable_grade:\${task.id}\`);
}
`;
  source = source.slice(0, adjStart) + adjudicate + source.slice(adjEnd);

  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'fix: use deterministic AAU expertise task authority',
      content: Buffer.from(source, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, commit_sha: response?.commit?.sha || null, contract: 'deterministic_task_authority_v0_1' };
}
