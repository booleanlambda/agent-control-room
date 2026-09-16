import crypto from 'node:crypto';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const nvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();
const executorId = `render:expertise:${process.env.RENDER_INSTANCE_ID || process.pid}`;
const pollMs = Math.max(2500, Number(process.env.AAU_EXPERTISE_VERIFIER_POLL_MS || 5000));

const GRADE_RE = /GRADE\s+execution=(\d{1,3})\s+method=(\d{1,3})\s+security=(\d{1,3})\s+validation=(\d{1,3})\s+communication=(\d{1,3})\s+critical=([A-Za-z0-9_-]+)\s+confidence=(0(?:\.\d+)?|1(?:\.0+)?)\s+unsupported=([A-Za-z0-9_-]+)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

async function jsonResponse(response) {
  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}
  return { raw, body };
}

async function rpc(name, args = {}) {
  const response = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      authorization: `Bearer ${anon}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_bridge_token: bridge, ...args }),
  });
  const { raw, body } = await jsonResponse(response);
  if (!response.ok) {
    const e = new Error(`${name}:${response.status}:${body?.message || raw.slice(0, 500)}`);
    e.status = response.status;
    throw e;
  }
  return body;
}

async function nvidiaCall({ model, system, user, maxTokens = 1200, temperature = 0, timeoutMs = 180000 }) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };
  if (model === 'z-ai/glm-5.3') body.chat_template_kwargs = { clear_thinking: true };
  else if (String(model || '').startsWith('nvidia/nemotron')) body.chat_template_kwargs = { enable_thinking: false }; // candidate_no_thinking_v0_1
  if (model === 'deepseek-ai/deepseek-v4-flash-0731') body.chat_template_kwargs = { thinking: false, reasoning_effort: 'low' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(15000, Number(timeoutMs) || 180000));
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${nvidiaKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'AAU-Expertise-Verifier/0.2',
      },
      body: JSON.stringify(body),
    });
    const parsed = await jsonResponse(response);
    if (!response.ok) {
      const e = new Error(`nvidia_${response.status}:${parsed.body?.error?.message || parsed.body?.detail || parsed.raw.slice(0, 700)}`);
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

function parseJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model_json_object_missing');
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeCompetencies(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((x, i) => {
    if (typeof x === 'string') return { id: `C${i + 1}`, description: x.slice(0, 800) };
    if (x && typeof x === 'object') return {
      id: String(x.id || x.key || `C${i + 1}`).slice(0, 50),
      description: String(x.description || x.name || x.competency || JSON.stringify(x)).slice(0, 1000),
    };
    return null;
  }).filter(Boolean);
}

async function createChallenge(run) {
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
    const scenario = `You are responsible for a production-grade outcome in ${run.domain}. A stakeholder requires you to apply the competency "${competency.description}" while balancing reliability, security, cost, time pressure, incomplete information, and reversibility. The assessment style is ${style}. You may state reasonable assumptions, but you may not invent evidence or actions already performed.`;
    const prompt = `Produce an expert-level response for this ${style} scenario. Make the decision process explicit. Cover the technically correct approach, assumptions and constraints, likely failure modes, security/reliability controls, validation or evidence needed before confidence is warranted, monitoring/rollback where relevant, and what you would refuse to claim without evidence.`;
    tasks.push({
      id: `T${i + 1}`,
      competency: competency.id || `C${i + 1}`,
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

async function answerChallenge(run, packet) {
  const answers = [];
  for (const task of packet.tasks) {
    const system = `You are the bound inference model for an AAU agent undergoing an unseen expertise assessment in ${run.domain}. Solve the task from first principles. Be concrete, state assumptions, controls, validation and failure handling. Do not invent external evidence or claim actions you did not perform.`;
    const user = `TARGET STANDARD: ${run.target_standard}\nSCENARIO:\n${task.scenario}\n\nTASK:\n${task.prompt}\n\nAnswer in 180-350 words. Prioritize concrete technical decisions over exposition.`;
    const result = await nvidiaCall({ model: run.candidate_model_id, system, user, maxTokens: 700, temperature: 0.10, timeoutMs: 60000 });
    if (!result.text) throw new Error(`candidate_empty_answer:${task.id}`);
    answers.push({ id: task.id, competency: task.competency || null, answer: result.text, model: result.model, output_sha256: sha256(result.text) });
  }
  return answers;
}

function parseGrade(text) {
  const m = GRADE_RE.exec(text || '');
  if (!m) return null;
  const nums = m.slice(1, 6).map((x) => Math.max(0, Math.min(100, Number(x))));
  const weights = [0.30, 0.20, 0.20, 0.15, 0.15];
  const score = nums.reduce((sum, n, i) => sum + (n / 100) * weights[i], 0);
  return {
    components: { execution: nums[0] / 100, method: nums[1] / 100, security: nums[2] / 100, validation: nums[3] / 100, communication: nums[4] / 100 },
    score: Number(score.toFixed(4)),
    critical_error: m[6].toUpperCase() === 'NONE' ? null : m[6],
    confidence: clamp01(m[7]),
    unsupported: m[8].toUpperCase() === 'PRESENT',
  };
}

async function gradeAnswer(run, task, answer) {
  const system = 'You are the independent AAU expertise authenticator. You did not train the candidate. Grade only the supplied answer against the fresh task and fixed anchors. Do not reward fluency without correctness. Return one GRADE line; reasoning may precede it.';
  const user = `DOMAIN: ${run.domain}\nTARGET: ${run.target_standard}\nSCENARIO: ${task.scenario}\nTASK: ${task.prompt}\nGRADING ANCHORS: ${JSON.stringify(task.grading_anchors)}\nCRITICAL FAILURES: ${JSON.stringify(task.critical_failures || [])}\nCANDIDATE ANSWER:\n${answer.answer}\n\nRubric: execution/correctness 30%, method/system design 20%, security/reliability 20%, validation/evidence 15%, communication/professional judgment 15%.\nReturn: GRADE execution=NN method=NN security=NN validation=NN communication=NN critical=NONE confidence=0.00 unsupported=NONE. If a material unsupported claim exists use unsupported=PRESENT.`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 500, temperature: 0, timeoutMs: 60000 });
    const grade = parseGrade(result.text);
    if (grade) return { ...grade, id: task.id, verifier_model: result.model, raw_sha256: sha256(result.text) };
    if (attempt < 3) await sleep(1200 * attempt);
  }
  throw new Error(`authenticator_unusable_grade:${task.id}`);
}

async function adjudicate(run, task, answer, prior) {
  const system = 'You are the operationally distinct AAU expertise adjudicator. Re-grade a flagged assessment independently. Do not default to the prior verifier. Return one GRADE line; reasoning may precede it.';
  const user = `DOMAIN: ${run.domain}\nTARGET: ${run.target_standard}\nSCENARIO: ${task.scenario}\nTASK: ${task.prompt}\nANCHORS: ${JSON.stringify(task.grading_anchors)}\nANSWER:\n${answer.answer}\nPRIOR FLAGGED GRADE: ${JSON.stringify(prior)}\n\nReturn: GRADE execution=NN method=NN security=NN validation=NN communication=NN critical=NONE confidence=0.00 unsupported=NONE`;
  const candidates = [run.adjudicator_model, 'deepseek-ai/deepseek-v4-flash-0731', 'meta/muse-glimmer-30b']
    .filter((x, i, a) => x && a.indexOf(x) === i && x !== run.authenticator_model && x !== run.candidate_model_id);
  for (const model of candidates) {
    try {
      const result = await nvidiaCall({ model, system, user, maxTokens: 500, temperature: 0, timeoutMs: 45000 });
      const grade = parseGrade(result.text);
      if (grade) return { ...grade, id: task.id, adjudicator_model: result.model, supersedes_score: prior.score, raw_sha256: sha256(result.text) };
    } catch (e) {
      console.warn('AAU_EXPERTISE_ADJUDICATOR_MODEL_FAILED', model, String(e?.message || e).slice(0, 500));
    }
  }
  throw new Error(`adjudicator_no_usable_grade:${task.id}`);
}

function deterministicDecision(run, packet, authGrades, adjGrades) {
  const adj = new Map(adjGrades.map((g) => [g.id, g]));
  const final = authGrades.map((g) => ({ ...(adj.get(g.id) || g), decision_source: adj.has(g.id) ? 'adjudicator' : 'authenticator' }));
  const scores = final.map((g) => Number(g.score));
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const plan = run.verification_plan || {};
  const meanMin = Number(plan.mean_score_min ?? plan.pass_score ?? 0.85);
  const taskMin = Number(plan.task_score_min ?? 0.80);
  const requiredFraction = Number(plan.required_task_fraction ?? 0.80);
  const countMin = Math.ceil(final.length * Math.max(0, Math.min(1, requiredFraction)));
  const countPassed = final.filter((g) => g.score >= taskMin).length;
  const critical = final.filter((g) => g.critical_error);
  const unsupported = final.filter((g) => g.unsupported);
  const passed = final.length === packet.tasks.length && mean >= meanMin && countPassed >= countMin && critical.length === 0 && unsupported.length === 0;
  return {
    overall_result: passed ? 'verified_pass' : 'verified_fail',
    overall_score: Number(mean.toFixed(6)),
    gate: { task_count: final.length, mean_score: Number(mean.toFixed(6)), mean_score_min: meanMin, task_score_min: taskMin, required_task_count: countMin, passed_task_count: countPassed, critical_error_count: critical.length, unsupported_claim_count: unsupported.length },
    final_grades: final,
    provenance: { provider: 'nvidia_direct', candidate_model: run.candidate_model_id, task_authority_model: packet.authority?.model || run.task_authority_model, authenticator_model: run.authenticator_model, adjudicator_models: [...new Set(adjGrades.map((g) => g.adjudicator_model).filter(Boolean))], deterministic_gate: true },
  };
}

async function processRun(run) {
  const packet = await createChallenge(run);
  console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'challenge_ready', tasks: packet.tasks.length, authority: packet.authority?.model || null, contract: 'expertise_verifier_latency_v0_1' }));
  const answers = await answerChallenge(run, packet);
  console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'candidate_answers_ready', answers: answers.length }));
  const authGrades = [];
  const adjGrades = [];
  for (const task of packet.tasks) {
    const answer = answers.find((a) => a.id === task.id);
    const grade = await gradeAnswer(run, task, answer);
    authGrades.push(grade);
    console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'authenticated_task', task_id: task.id, score: grade.score, confidence: grade.confidence }));
    const flagged = (grade.score >= 0.75 && grade.score <= 0.85) || grade.critical_error || grade.unsupported || grade.confidence < 0.70;
    if (flagged) adjGrades.push(await adjudicate(run, task, answer, grade));
  }
  const report = deterministicDecision(run, packet, authGrades, adjGrades);
  report.report_sha256 = sha256(report);
  await rpc('aau_bridge_complete_expertise_verification', {
    p_verification_run_id: run.verification_run_id,
    p_executor_id: executorId,
    p_overall_result: report.overall_result,
    p_overall_score: report.overall_score,
    p_challenge_packet: packet,
    p_candidate_answers: answers,
    p_authenticator_grades: authGrades,
    p_adjudicator_grades: adjGrades,
    p_final_report: report,
  });
  console.log('AAU_EXPERTISE_VERIFICATION_COMPLETED', JSON.stringify({ verification_run_id: run.verification_run_id, agent_id: run.agent_id, artifact_id: run.expertise_artifact_id, result: report.overall_result, score: report.overall_score, authenticator_model: run.authenticator_model, adjudications: adjGrades.length }));
}

let running = false;
async function loop() {
  while (running) {
    try {
      const rows = await rpc('aau_bridge_claim_expertise_verification', { p_executor_id: executorId, p_lease_seconds: 1200 });
      const run = Array.isArray(rows) ? rows[0] : null;
      if (!run) { await sleep(pollMs); continue; }
      console.log('AAU_EXPERTISE_VERIFICATION_CLAIMED', JSON.stringify({ verification_run_id: run.verification_run_id, agent_id: run.agent_id, domain: run.domain, candidate_model: run.candidate_model_id }));
      try {
        await processRun(run);
      } catch (error) {
        const status = Number(error?.status || 0);
        const retryable = status === 429 || status >= 500 || error?.name === 'AbortError';
        await rpc('aau_bridge_fail_expertise_verification', {
          p_verification_run_id: run.verification_run_id,
          p_executor_id: executorId,
          p_error_code: status ? `http_${status}` : String(error?.name || 'verification_error'),
          p_error_message: String(error?.message || error).slice(0, 1800),
          p_retry_after_seconds: retryable ? 120 : null,
        }).catch(() => {});
        console.error('AAU_EXPERTISE_VERIFICATION_FAILED', JSON.stringify({ verification_run_id: run.verification_run_id, status, retryable, message: String(error?.message || error).slice(0, 1200) }));
      }
    } catch (error) {
      console.error('AAU_EXPERTISE_VERIFIER_LOOP_ERROR', String(error?.message || error).slice(0, 1200));
      await sleep(Math.max(5000, pollMs));
    }
  }
}

export function startExpertiseVerificationWorker() {
  const missing = [['AAU_SUPABASE_ANON_KEY', anon], ['AAU_BROKER_BRIDGE_TOKEN', bridge], ['NVIDIA_API_KEY', nvidiaKey]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { ok: false, ready: false, missing };
  if (!running) { running = true; loop().catch((e) => console.error('AAU_EXPERTISE_VERIFIER_FATAL', e)); }
  return { ok: true, ready: true, executor_id: executorId, poll_ms: pollMs, provider: 'nvidia_direct', task_authority: 'openai/gpt-oss-20b', authenticator: 'z-ai/glm-5.3', adjudicator: 'meta/muse-glimmer-30b' };
}
