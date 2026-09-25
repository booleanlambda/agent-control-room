import crypto from 'node:crypto';
import { withReviewerNvidiaSlot, isReviewerModelInBackoff, noteReviewerModelTimeout, noteReviewerModelSuccess } from './reviewer-nvidia-endpoint-gate.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const nvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();
const executorId = `render:expertise:${process.env.RENDER_INSTANCE_ID || process.pid}`;
const pollMs = Math.max(2500, Number(process.env.AAU_EXPERTISE_VERIFIER_POLL_MS || 5000));

const GRADE_RE = /GRADE\s+execution=(\d{1,3})\s+method=(\d{1,3})\s+security=(\d{1,3})\s+validation=(\d{1,3})\s+communication=(\d{1,3})\s+critical=([A-Za-z0-9_-]+)\s+confidence=(0(?:\.\d+)?|1(?:\.0+)?)\s+unsupported=([A-Za-z0-9_-]+)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const academicTaskCache = new Map();
async function academicReference(run, task) {
  if (run?.metadata?.academic_standard_version !== 'aau_owned_master_us_v0_3') return null;
  const key=String(run.verification_run_id||'');
  let bank=academicTaskCache.get(key);
  if (!bank) {
    const receipt=await rpc('aau_bridge_get_expertise_assessment',{p_verification_run_id:run.verification_run_id});
    if(receipt?.status!=='approved'||!Array.isArray(receipt?.private_assessment?.tasks))
      throw new Error('approved_private_academic_assessment_unavailable');
    bank=receipt.private_assessment.tasks;
    academicTaskCache.set(key,bank);
  }
  const candidate=bank.find(x=>x?.id===task.id && x?.competency===task.competency);
  if(!candidate||!String(candidate.reference_answer||'').trim())
    throw new Error('private_reference_answer_missing:'+String(task.id||''));
  return candidate.reference_answer;
}
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

async function getVerificationCheckpoint(run) {
  return rpc('aau_bridge_get_expertise_verification_checkpoint', {
    p_verification_run_id: run.verification_run_id,
    p_executor_id: executorId,
  });
}

async function checkpointVerification(run, stage, fields = {}) {
  const args = {
    p_verification_run_id: run.verification_run_id,
    p_executor_id: executorId,
    p_stage: stage,
    p_extend_lease_seconds: 300,
  };
  if (Object.prototype.hasOwnProperty.call(fields, 'challenge_packet')) args.p_challenge_packet = fields.challenge_packet;
  if (Object.prototype.hasOwnProperty.call(fields, 'candidate_answers')) args.p_candidate_answers = fields.candidate_answers;
  if (Object.prototype.hasOwnProperty.call(fields, 'authenticator_grades')) args.p_authenticator_grades = fields.authenticator_grades;
  if (Object.prototype.hasOwnProperty.call(fields, 'adjudicator_grades')) args.p_adjudicator_grades = fields.adjudicator_grades;
  return rpc('aau_bridge_checkpoint_expertise_verification', args);
}

async function nvidiaCall({ model, system, user, maxTokens = 1200, temperature = 0, timeoutMs = 180000, jsonMode = false }) {
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };
  if (jsonMode === true) body.response_format = { type: 'json_object' }; // glm_json_grade_mode_v0_1
  // Reasoning consumes max_tokens. Tune each model's documented knob without
  // treating reasoning_content as a final grade.
  if (model === 'meta/muse-glimmer-30b') {
    body.chat_template_kwargs = { reasoning_strength: 'low' };
    body.reasoning_effort = 'low';
    body.temperature = 0.95;
  } else if (model === 'openai/gpt-oss-20b') {
    body.reasoning_effort = 'low';
  }
  if (model === 'z-ai/glm-5.3') body.chat_template_kwargs = { enable_thinking: false }; // glm_auth_no_thinking_v0_1
  else if (String(model || '').startsWith('nvidia/nemotron')) body.chat_template_kwargs = { enable_thinking: false }; // candidate_no_thinking_v0_1
  if (model === 'deepseek-ai/deepseek-v4-flash-0731') body.chat_template_kwargs = { thinking: false, reasoning_effort: 'low' };
  return withReviewerNvidiaSlot('expertise_verification', async () => {
  const controller = new AbortController();
  const requestStarted = Date.now();
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
    noteReviewerModelSuccess(model);
    const message = parsed.body?.choices?.[0]?.message || {};
    return {
      text: String(message.content || parsed.body?.choices?.[0]?.text || '').trim(),
      model: parsed.body?.model || model,
      finish_reason: parsed.body?.choices?.[0]?.finish_reason || null,
      usage: parsed.body?.usage || null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      noteReviewerModelTimeout(model);
      console.warn('AAU_REVIEWER_ENDPOINT_TIMEOUT', JSON.stringify({
        stage:'expertise', model, duration_ms:Date.now()-requestStarted,
        request_chars:system.length+user.length, timeout_ms:timeoutMs,
      }));
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  });
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
  if (run?.metadata?.academic_standard_version === 'aau_owned_master_us_v0_3') {
    const receipt=await rpc('aau_bridge_get_expertise_assessment',{
      p_verification_run_id:run.verification_run_id
    });
    if(receipt?.status!=='approved'||!Array.isArray(receipt?.private_assessment?.tasks)
        ||receipt.private_assessment.tasks.length<4)
      throw new Error('AAU_academic_assessment_not_approved');
    if(receipt.sha256!==run.metadata?.academic_standard_sha256)
      throw new Error('AAU_academic_assessment_sha_mismatch');
    academicTaskCache.set(String(run.verification_run_id),receipt.private_assessment.tasks);
    const tasks=receipt.private_assessment.tasks.map(x=>({
      id:x.id,competency:x.competency,competency_label:x.competency_label,
      scenario:x.scenario,prompt:x.prompt,grading_anchors:x.grading_anchors,
      critical_failures:x.critical_failures
    }));
    const packet={tasks,authority:{
      provider:'aau_owned_independent_standard',
      model:'aau_owned_master_us_v0_3:'+String(receipt.standard_id),
      specification_sha256:receipt.sha256,
      contract:'reviewed_private_domain_examination_v0_3'
    }};
    packet.packet_sha256=sha256(packet);
    return packet;
  }
  const competencies = normalizeCompetencies(run.competencies);
  const taskCount = run.metadata?.operator_smoke_test ? 1 : Math.min(5, Math.max(3, competencies.length || 3)); // operator_smoke_single_task_v0_1
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
      competency_label: competency.description || String(competency.id || `C${i + 1}`),
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

async function frozenCompetencePacket(run) {
  if (!run?.metadata?.competence_packet_required) return null;
  const record = await rpc('aau_bridge_get_or_create_expertise_competence_packet',{
    p_verification_run_id:run.verification_run_id,
    p_agent_id:run.agent_id,
    p_expertise_artifact_id:run.expertise_artifact_id,
  });
  if (!record?.packet || !record?.packet_sha256) throw new Error('competence_packet_required_but_missing');
  return record;
}

function taskCompetenceSlice(record, task) {
  if (!record?.packet) return null;
  const p = record.packet;
  const id = String(task?.competency || '').trim().toLowerCase();
  const label = String(task?.competency_label || task?.grading_anchors?.[0] || '').trim().toLowerCase();
  const matches = (value) => {
    const s = String(value || '').trim().toLowerCase();
    return Boolean(s) && (s === id || s === label);
  };
  const take = (arr, predicate, limit) => (Array.isArray(arr) ? arr.filter(predicate).slice(0,limit) : []);
  return {
    packet_version:record.packet_version || p.packet_version || null,
    packet_sha256:record.packet_sha256,
    competency_id:task?.competency || null,
    competency_label:task?.competency_label || task?.grading_anchors?.[0] || null,
    validated_knowledge_units:take(p.validated_knowledge_units, x=>matches(x?.competency), 16),
    admitted_original_implementations:take(p.admitted_original_implementations, x=>matches(x?.competency), 10),
    independently_evaluated_practice:take(p.independently_evaluated_practice, x=>matches(x?.skill_component), 10),
    independent_assessment_summary:take(p.independent_assessment_summary, x=>matches(x?.skill_component), 12),
    epistemic_boundary:p.epistemic_boundary || null,
  };
}

async function answerChallenge(run, packet, existingAnswers = [], competenceRecord = null) {
  const answers = Array.isArray(existingAnswers) ? existingAnswers.filter((x) => x && x.id && x.answer) : [];
  for (const task of packet.tasks) {
    if (answers.some((x) => x.id === task.id && x.answer)) continue;
    const memorySlice = taskCompetenceSlice(competenceRecord, task);
    const system = `You are the bound inference model for an AAU agent undergoing an unseen expertise assessment in ${run.domain}. The optional PERSISTENT EXPERTISE MEMORY below is a frozen record of this agent's prior learning and work, captured before this unseen task. It is not an answer key and may contain qualified or self-authored evidence; respect its epistemic labels. Apply relevant learned principles to the novel task, but solve the task independently. Do not copy prior task answers, do not mention packet mechanics, and do not invent external evidence or claim actions you did not perform. Be concrete, state assumptions, controls, validation and failure handling.`;
    const memoryText = memorySlice ? `\n\nPERSISTENT EXPERTISE MEMORY (frozen before this task):\n${JSON.stringify(memorySlice).slice(0,18000)}` : '';
    const user = `TARGET STANDARD: ${run.target_standard}${memoryText}\n\nSCENARIO:\n${task.scenario}\n\nTASK:\n${task.prompt}\n\nAnswer with a rigorous worked derivation, concrete algorithm or counterexample as appropriate to the task. For an AAU-owned graduate assessment, use sufficient detail (up to 900 words) to make the method and assumptions assessable. Prioritize technical correctness over fluency.`;
    let result = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await nvidiaCall({ model: run.candidate_model_id, system, user, maxTokens: run?.metadata?.academic_standard_version === 'aau_owned_master_us_v0_3' ? 1800 : 700, temperature: 0.10, timeoutMs: 120000 });
        break;
      } catch (error) {
        lastError = error;
        const status = Number(error?.status || 0);
        const retryable = error?.name === 'AbortError' || status === 429 || status >= 500;
        if (!retryable || attempt === 3) throw error;
        await sleep(1500 * attempt);
      }
    }
    if (!result) throw lastError || new Error(`candidate_no_result:${task.id}`);
    if (result.finish_reason !== 'stop' || !result.text) {
      const content=String(result.text || '');
      const rejectionReason=result.finish_reason === 'length'
        ? 'TRUNCATED_RESPONSE'
        : !content.trim() ? 'EMPTY_RESPONSE' : 'INCOMPLETE_RESPONSE';
      try {
        await rpc('aau_bridge_record_cognition_rejection',{
          p_agent_id:run.agent_id,
          p_execution_context:'expertise_verification',
          p_execution_id:String(run.verification_run_id),
          p_model_id:run.candidate_model_id,
          p_phase:'candidate_answer_'+String(task.id),
          p_rejection_reason:rejectionReason,
          p_finish_reason:result.finish_reason || null,
          p_elapsed_ms:null,
          p_output_chars:content.length,
          p_output_sha256:content ? sha256(content) : null,
          p_usage:result.usage || {},
        });
      } catch (e) {
        console.warn('AAU_EXPERTISE_CANDIDATE_REJECTION_EVIDENCE_FAILED',String(e?.message || e).slice(0,500));
      }
      const error=new Error('candidate_response_rejected:'+rejectionReason+':'+task.id);
      error.code='CANDIDATE_RESPONSE_REJECTED';
      throw error;
    }
    answers.push({
      id: task.id,
      competency: task.competency || null,
      competency_label: task.competency_label || task.grading_anchors?.[0] || null,
      answer: result.text,
      model: result.model,
      output_sha256: sha256(result.text),
      candidate_memory_contract: competenceRecord ? 'persistent_expertise_retrieval_v0_1' : 'stateless_candidate_v0_1',
      competence_packet_sha256: competenceRecord?.packet_sha256 || null,
    });
    await checkpointVerification(run, 'candidate_answer_task', { candidate_answers: answers });
    console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'candidate_answer_task', task_id: task.id, answers: answers.length }));
  }
  return answers;
}

function parseGrade(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  let obj = null;
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) obj = JSON.parse(raw.slice(s, e + 1));
  } catch {}

  const field = (name) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
    const re = new RegExp('\\b' + name + '\\s*[:=]\\s*([A-Za-z0-9_.%-]+)', 'i');
    const m = re.exec(raw);
    return m ? m[1] : null;
  };

  const scoreField = (name) => {
    const v = field(name);
    if (v == null) return null;
    const n = Number(String(v).replace('%', ''));
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n));
  };

  const names = ['execution', 'method', 'security', 'validation', 'communication'];
  const nums = names.map(scoreField);
  if (nums.some((n) => n == null)) return null;

  let confidence = field('confidence');
  if (confidence == null) confidence = 0;
  confidence = Number(String(confidence).replace('%', ''));
  if (!Number.isFinite(confidence)) confidence = 0;
  if (confidence > 1) confidence /= 100;
  confidence = clamp01(confidence);

  const criticalRaw = String(field('critical') ?? field('critical_error') ?? 'NONE').trim();
  const criticalNone = /^(none|null|false|no|0)$/i.test(criticalRaw);
  const unsupportedRaw = String(field('unsupported') ?? field('unsupported_claim') ?? 'NONE').trim();
  const unsupported = /^(present|true|yes|1)$/i.test(unsupportedRaw);

  const weights = [0.30, 0.20, 0.20, 0.15, 0.15];
  const score = nums.reduce((sum, n, i) => sum + (n / 100) * weights[i], 0);
  return {
    components: { execution: nums[0] / 100, method: nums[1] / 100, security: nums[2] / 100, validation: nums[3] / 100, communication: nums[4] / 100 },
    score: Number(score.toFixed(4)),
    critical_error: criticalNone ? null : criticalRaw,
    confidence,
    unsupported,
    parser_contract: 'robust_grade_parser_v0_1',
  };
}

async function gradeAnswer(run, task, answer) {
  const reference=await academicReference(run,task);
  const system = 'You are the independent AAU expertise authenticator. You did not train the candidate. Grade only the supplied answer against the fresh task and fixed anchors. Do not reward fluency without correctness. Return exactly one JSON object and no explanation with numeric fields execution, method, security, validation, communication (0-100), string critical, numeric confidence (0-1), and boolean unsupported.';
  const user = `DOMAIN: ${run.domain}\nTARGET: ${run.target_standard}\nSCENARIO: ${task.scenario}\nTASK: ${task.prompt}\nINDEPENDENT AAU REFERENCE ANSWER (private, not given to candidate): ${reference||'legacy_assessment_no_reference_answer'}\nGRADING ANCHORS: ${JSON.stringify(task.grading_anchors)}\nCRITICAL FAILURES: ${JSON.stringify(task.critical_failures || [])}\nCANDIDATE ANSWER:\n${answer.answer}\n\nRubric: execution/correctness 30%, method/system design 20%, security/reliability 20%, validation/evidence 15%, communication/professional judgment 15%.\nReturn one JSON object: {"execution":NN,"method":NN,"security":NN,"validation":NN,"communication":NN,"critical":"none","confidence":0.00,"unsupported":false}. Set unsupported=true for a material unsupported claim.`;
  // authenticator_fallback_chain_v0_1: Moonshot primary, Meta then NVIDIA fallback.
  const primaryAuthenticator = 'moonshotai/kimi-k3';
  const authModels = [
    primaryAuthenticator,
    'meta/muse-glimmer-30b',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
    'openai/gpt-oss-20b',
  ].filter((x, i, a) => x && a.indexOf(x) === i && x !== run.candidate_model_id);
  let lastAuthError = null;
  for (const model of authModels) {
    if (isReviewerModelInBackoff(model)) {
      console.warn('AAU_EXPERTISE_AUTHENTICATOR_BACKOFF_SKIP',model);
      continue;
    }
    const maxAttempts = model === primaryAuthenticator || model === 'openai/gpt-oss-20b' ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await nvidiaCall({
          model, system, user,
          maxTokens: model.startsWith('meta/') ? 2500
            : model === 'openai/gpt-oss-20b' ? (attempt === 1 ? 1800 : 3200)
            : model === primaryAuthenticator ? 1800 : 1200,
          temperature: 0,
          timeoutMs: model === primaryAuthenticator ? 65000 : model.startsWith('meta/') ? 90000 : 120000,
          jsonMode: false,
        });
        if (result.finish_reason !== 'stop') {
          console.warn('AAU_EXPERTISE_AUTHENTICATOR_INCOMPLETE',JSON.stringify({
            model,task_id:task.id,attempt,finish_reason:result.finish_reason || null,
            response_chars:String(result.text || '').length,
          }));
          lastAuthError=new Error('authenticator_incomplete_response:'+task.id+':'+model);
          continue;
        }
        const grade = parseGrade(result.text);
        if (grade) return { ...grade, id: task.id, verifier_model: result.model || model, verifier_requested_model: model, authenticator_fallback_used: model !== primaryAuthenticator, raw_sha256: sha256(result.text) };
        console.warn('AAU_EXPERTISE_AUTHENTICATOR_UNUSABLE_GRADE', JSON.stringify({
          model, task_id:task.id, attempt, raw_sha256:sha256(result.text), response_chars:result.text.length,
          finish_reason:result.finish_reason || null,
        }));
        lastAuthError = new Error(`authenticator_unusable_grade:${task.id}:${model}`);
      } catch (error) {
        lastAuthError = error;
        const status = Number(error?.status || 0);
        const retryable = error?.name === 'AbortError' || status === 429 || status >= 500;
        if (!retryable) break;
      }
      if (attempt < maxAttempts) await sleep(1500 * attempt);
    }
    console.warn('AAU_EXPERTISE_AUTHENTICATOR_MODEL_FAILED', model, String(lastAuthError?.message || lastAuthError || 'unusable_grade').slice(0, 500));
  }
  throw lastAuthError || new Error(`authenticator_unusable_grade:${task.id}`);
}

async function adjudicate(run, task, answer, prior) {
  const reference=await academicReference(run,task);
  const system = 'You are the operationally distinct AAU expertise adjudicator. Re-grade a flagged assessment independently. Do not default to the prior verifier. Return exactly one JSON object and no prose.';
  const user = `DOMAIN: ${run.domain}\nTARGET: ${run.target_standard}\nSCENARIO: ${task.scenario}\nTASK: ${task.prompt}\nINDEPENDENT AAU REFERENCE ANSWER (private, not given to candidate): ${reference||'legacy_assessment_no_reference_answer'}\nANCHORS: ${JSON.stringify(task.grading_anchors)}\nCRITICAL FAILURES: ${JSON.stringify(task.critical_failures || [])}\nANSWER:\n${answer.answer}\nPRIOR FLAGGED GRADE: ${JSON.stringify(prior)}\n\nReturn exactly: {"execution":NN,"method":NN,"security":NN,"validation":NN,"communication":NN,"critical":"none","confidence":0.00,"unsupported":false}. Scores are integers 0-100. Set unsupported=true for a material unsupported claim. Use a critical failure label only when the answer actually triggers one of the supplied critical failures.`;
  const primaryAdjudicator = 'openai/gpt-oss-20b';
  const candidates = [
    primaryAdjudicator,
    run.adjudicator_model,
    'meta/muse-glimmer-30b',
    'z-ai/glm-5.3',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
  ].filter((x, i, a) => x && a.indexOf(x) === i && x !== run.authenticator_model && x !== prior.verifier_model && x !== run.candidate_model_id);
  for (const model of candidates) {
    if (isReviewerModelInBackoff(model)) { console.warn('AAU_EXPERTISE_ADJUDICATOR_BACKOFF_SKIP', model); continue; }
    const maxAttempts = model === primaryAdjudicator ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await nvidiaCall({
          model,
          system,
          user,
          maxTokens: model.startsWith('meta/') ? 2500
            : model === 'openai/gpt-oss-20b' ? (attempt === 1 ? 1800 : 3200) : 1400,
          temperature: 0,
          timeoutMs: model === primaryAdjudicator ? 120000 : model.startsWith('meta/') ? 90000 : 110000,
        });
        if (result.finish_reason !== 'stop') {
          console.warn('AAU_EXPERTISE_ADJUDICATOR_INCOMPLETE',JSON.stringify({
            model,task_id:task.id,attempt,finish_reason:result.finish_reason || null,
            response_chars:String(result.text || '').length,
          }));
          continue;
        }
        const grade = parseGrade(result.text);
        if (grade) {
          noteReviewerModelSuccess(model);
          return { ...grade, id: task.id, adjudicator_model: result.model || model, supersedes_score: prior.score, raw_sha256: sha256(result.text) };
        }
        console.warn('AAU_EXPERTISE_ADJUDICATOR_UNUSABLE_GRADE', model, task.id, 'attempt', attempt, 'raw_sha256', sha256(result.text || ''));
      } catch (e) {
        console.warn('AAU_EXPERTISE_ADJUDICATOR_MODEL_FAILED', model, String(e?.message || e).slice(0, 500));
      }
      if (attempt < maxAttempts) await sleep(1500 * attempt);
    }
  }
  throw new Error(`adjudicator_no_usable_grade:${task.id}`);
}

function deterministicDecision(run, packet, authGrades, adjGrades, competenceRecord = null) {
  const adj = new Map(adjGrades.map((g) => [g.id, g]));
  const final = authGrades.map((g) => ({ ...(adj.get(g.id) || g), decision_source: adj.has(g.id) ? 'adjudicator' : 'authenticator' }));
  const scores = final.map((g) => Number(g.score));
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const plan = run.verification_plan || {};
  const meanMin = Number(plan.mean_score_min ?? plan.pass_score ?? 0.85);
  const taskMin = Number(plan.task_score_min ?? 0.80);
  const requiredFraction = run?.metadata?.academic_standard_version === 'aau_owned_master_us_v0_3' ? 1 : Number(plan.required_task_fraction ?? 0.80);
  const countMin = Math.ceil(final.length * Math.max(0, Math.min(1, requiredFraction)));
  const countPassed = final.filter((g) => g.score >= taskMin).length;
  const critical = final.filter((g) => g.critical_error);
  const unsupported = final.filter((g) => g.unsupported);
  const passed = final.length === packet.tasks.length && mean >= Math.max(0.85,meanMin) && countPassed >= countMin && critical.length === 0 && unsupported.length === 0;
  const manuallyReviewed = [...authGrades,...adjGrades].some((g) => g?.source === 'operator_attested_model_review_v0_1');
  return {
    overall_result: passed ? 'verified_pass' : 'verified_fail',
    overall_score: Number(mean.toFixed(6)),
    gate: { task_count: final.length, mean_score: Number(mean.toFixed(6)), mean_score_min: meanMin, task_score_min: taskMin, required_task_count: countMin, passed_task_count: countPassed, critical_error_count: critical.length, unsupported_claim_count: unsupported.length },
    final_grades: final,
    provenance: {
      provider: manuallyReviewed ? 'nvidia_direct_and_operator_attested_review' : 'nvidia_direct',
      manual_review_used: manuallyReviewed,
      candidate_model: run.candidate_model_id,
      task_authority_model: packet.authority?.model || run.task_authority_model,
      authenticator_model: run.authenticator_model,
      authenticator_models_used: [...new Set(authGrades.map((g) => g.verifier_model).filter(Boolean))],
      adjudicator_models: [...new Set(adjGrades.map((g) => g.adjudicator_model).filter(Boolean))],
      deterministic_gate: true,
      candidate_memory_contract: competenceRecord ? 'persistent_expertise_retrieval_v0_1' : 'stateless_candidate_v0_1',
      competence_packet_version: competenceRecord?.packet_version || competenceRecord?.packet?.packet_version || null,
      competence_packet_sha256: competenceRecord?.packet_sha256 || null,
      competence_packet_frozen_before_candidate_answers: Boolean(competenceRecord),
      prior_candidate_answers_in_packet: false,
      fresh_challenge_isolation: true,
      academic_standard_version: run?.metadata?.academic_standard_version || null,
      academic_standard_sha256: run?.metadata?.academic_standard_sha256 || null,
      independent_approved_hidden_domain_tasks: run?.metadata?.academic_standard_version === 'aau_owned_master_us_v0_3',
    },
  };
}

async function processRun(run) {
  const checkpoint = await getVerificationCheckpoint(run);
  let packet = checkpoint?.challenge_packet;
  if (!packet || !Array.isArray(packet.tasks) || packet.tasks.length === 0) {
    packet = await createChallenge(run);
    await checkpointVerification(run, 'challenge_ready', { challenge_packet: packet });
  }
  console.log('AAU_EXPERTISE_STAGE', JSON.stringify({
    verification_run_id: run.verification_run_id,
    stage: 'challenge_ready',
    tasks: packet.tasks.length,
    authority: packet.authority?.model || null,
    contract: 'expertise_verifier_checkpoint_v0_1',
    resumed: Boolean(checkpoint?.challenge_packet?.tasks?.length),
  }));

  const competenceRecord = await frozenCompetencePacket(run);
  if (competenceRecord) {
    console.log('AAU_EXPERTISE_COMPETENCE_PACKET', JSON.stringify({
      verification_run_id:run.verification_run_id,
      packet_version:competenceRecord.packet_version || competenceRecord.packet?.packet_version || null,
      packet_sha256:competenceRecord.packet_sha256,
      knowledge_units:Array.isArray(competenceRecord.packet?.validated_knowledge_units) ? competenceRecord.packet.validated_knowledge_units.length : 0,
      portfolio_items:Array.isArray(competenceRecord.packet?.admitted_original_implementations) ? competenceRecord.packet.admitted_original_implementations.length : 0,
      independent_practice:Array.isArray(competenceRecord.packet?.independently_evaluated_practice) ? competenceRecord.packet.independently_evaluated_practice.length : 0,
      assessment_summaries:Array.isArray(competenceRecord.packet?.independent_assessment_summary) ? competenceRecord.packet.independent_assessment_summary.length : 0,
    }));
  }

  const answers = await answerChallenge(run, packet, checkpoint?.candidate_answers || [], competenceRecord);
  await checkpointVerification(run, 'candidate_answers_ready', { candidate_answers: answers });
  console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'candidate_answers_ready', answers: answers.length }));

  const authGrades = Array.isArray(checkpoint?.authenticator_grades) ? checkpoint.authenticator_grades.filter((x) => x && x.id) : [];
  const adjGrades = Array.isArray(checkpoint?.adjudicator_grades) ? checkpoint.adjudicator_grades.filter((x) => x && x.id) : [];

  if (answers.length || authGrades.length || adjGrades.length) {
    console.log('AAU_EXPERTISE_CHECKPOINT_RESUMED', JSON.stringify({
      verification_run_id: run.verification_run_id,
      answers: answers.length,
      authenticator_grades: authGrades.length,
      adjudicator_grades: adjGrades.length,
      previous_stage: checkpoint?.stage || null,
    }));
  }

  for (const task of packet.tasks) {
    const answer = answers.find((a) => a.id === task.id);
    if (!answer) throw new Error(`candidate_answer_missing:${task.id}`);

    let grade = authGrades.find((g) => g.id === task.id);
    if (!grade) {
      grade = await gradeAnswer(run, task, answer);
      authGrades.push(grade);
      await checkpointVerification(run, 'authenticated_task', {
        candidate_answers: answers,
        authenticator_grades: authGrades,
        adjudicator_grades: adjGrades,
      });
      console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'authenticated_task', task_id: task.id, score: grade.score, confidence: grade.confidence, verifier_model: grade.verifier_model, fallback_used: Boolean(grade.authenticator_fallback_used) }));
    }

    const flagged = (grade.score >= 0.75 && grade.score <= 0.85) || grade.critical_error || grade.unsupported || grade.confidence < 0.70;
    if (flagged && !adjGrades.some((g) => g.id === task.id)) {
      const adjudicated = await adjudicate(run, task, answer, grade);
      adjGrades.push(adjudicated);
      await checkpointVerification(run, 'adjudicated_task', {
        candidate_answers: answers,
        authenticator_grades: authGrades,
        adjudicator_grades: adjGrades,
      });
      console.log('AAU_EXPERTISE_STAGE', JSON.stringify({ verification_run_id: run.verification_run_id, stage: 'adjudicated_task', task_id: task.id, score: adjudicated.score, adjudicator_model: adjudicated.adjudicator_model }));
    }
  }

  const report = deterministicDecision(run, packet, authGrades, adjGrades, competenceRecord);
  report.report_sha256 = sha256(report);
  await checkpointVerification(run, 'decision_ready', {
    challenge_packet: packet,
    candidate_answers: answers,
    authenticator_grades: authGrades,
    adjudicator_grades: adjGrades,
  });
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
      const rows = await rpc('aau_bridge_claim_expertise_verification', { p_executor_id: executorId, p_lease_seconds: 300 });
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
        }).then((failure) => {
          if (failure?.status === 'manual_required') {
            console.error('AAU_MANUAL_VERIFICATION_INTERVENTION_REQUIRED', JSON.stringify({
              verification_run_id: run.verification_run_id,
              agent_id: run.agent_id,
              failed_stage: failure?.failed_stage || null,
              attempts: failure?.attempt_count || null,
              error_code: status ? `http_${status}` : String(error?.name || 'verification_error'),
              action: 'operator_inspection_required_no_auto_retry',
            }));
          }
        }).catch((failError) => {
          console.error('AAU_EXPERTISE_FAILURE_CHECKPOINT_ERROR', String(failError?.message || failError).slice(0,1000));
        });
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
  return { ok: true, ready: true, executor_id: executorId, poll_ms: pollMs, provider: 'nvidia_direct', task_authority: 'deterministic:aau-task-authority-v0.1', authenticator: 'moonshotai/kimi-k3', authenticator_fallbacks: ['meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b','openai/gpt-oss-20b'], adjudicator: 'openai/gpt-oss-20b', adjudicator_fallbacks: ['z-ai/glm-5.3','meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b'] };
}
