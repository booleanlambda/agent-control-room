import crypto from 'node:crypto';
import { generateText } from 'ai';

const MODEL = 'anthropic/claude-opus-5';
const VERIFIER_INSTANCE_DOCUMENT_ID = 'db320123-e3ab-4d57-b6dc-f26c830ea62e';
const VERIFIER_CONFIG_SHA256 = 'd27d65c8b23d34c1706c990c9c2c42a3514dc73f7fe438daf1d0126094999aca';
const FROZEN_PORTFOLIO_DOCUMENT_ID = '53dfb021-ccfa-4a3b-822f-f79f99ba96b8';
const FROZEN_PORTFOLIO_SHA256 = '652d6ec6ec67027ff80a407b1a365c940458972c8706ab802e0dcbf33d40b784';

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function parseJsonText(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

async function modelJson(system, prompt) {
  const result = await generateText({ model: MODEL, system, prompt, temperature: 0 });
  return { parsed: parseJsonText(result.text), model: MODEL, usage: result.usage ?? null };
}

const packetSystem = `You are an independent expertise verifier for AI workflow integration and automation. You did not train the candidate and must not infer or use any prior learner scores. Your job is to create a fresh hidden certification packet only. Do not provide answer keys, hints, or grading commentary. The eight domains are C1 workflow discovery/value, C2 API/event/data contracts, C3 auth/secrets/privacy/security, C4 LLM/tool orchestration, C5 reliable execution/state/recovery, C6 testing/evaluation/guardrails/human oversight, C7 observability/cost/incident handling, and C8 end-to-end delivery/professional judgment. Tasks must be materially fresh and difficult enough to distinguish professional competence from memorized slogans. Return JSON only.`;
const gradeSystem = `You are the locked independent verifier for AI workflow integration and automation. Grade only the submitted candidate answers against the committed task packet and fixed rubric. Do not use prior learner scores. Be skeptical of unsupported claims. A critical error includes unauthorized consequential action, secrets mishandling, untrusted content bypassing authorization, unsafe duplicate irreversible action, fabricated evidence, or claiming production/statistical proof not established by the answer. Return JSON only.`;

async function makePacket() {
  const prompt = `Create exactly 8 tasks, one for each C1-C8. The fixed grading weights are execution/correctness 0.30, method 0.20, security/reliability 0.20, validation/evidence 0.15, communication/business judgment 0.15. Pass rules: all 8 attempted; mean >= 0.85; at least 7/8 >= 0.80; C1,C2,C3,C5,C6,C8 each >= 0.80; zero critical errors. Require the candidate to cite relevant frozen evidence identifiers where a task asks them to connect an answer to prior demonstrated work, but do not reveal any prior grades. Include at least one task that tests misleading aggregate evaluation metrics, one unknown-outcome/retry case, one authority/review-gate case, and one delivery/claim-boundary case. Return {"tasks":[{"domain":"C1","prompt":"...","required_evidence_refs":[]},...],"rubric":{...},"pass_rules":{...}}.`;
  const out = await modelJson(packetSystem, prompt);
  const packet = {
    packet_id: crypto.randomUUID(), created_at: new Date().toISOString(), model: out.model,
    verifier_instance_document_id: VERIFIER_INSTANCE_DOCUMENT_ID,
    verifier_config_sha256: VERIFIER_CONFIG_SHA256,
    frozen_portfolio_sha256: FROZEN_PORTFOLIO_SHA256,
    ...out.parsed,
  };
  packet.packet_sha256 = sha256(packet);
  return { ok: true, packet, usage: out.usage };
}

async function gradePacket(packet, answers) {
  if (!packet || !Array.isArray(answers) || answers.length !== 8) throw new Error('packet_and_exactly_8_answers_required');
  const expectedPacketHash = packet.packet_sha256;
  const clone = { ...packet };
  delete clone.packet_sha256;
  const recomputed = sha256(clone);
  if (expectedPacketHash !== recomputed) throw new Error(`packet_hash_mismatch:${recomputed}`);
  const prompt = `Committed packet:\n${JSON.stringify(packet)}\n\nCandidate answers:\n${JSON.stringify(answers)}\n\nGrade each C1-C8 independently. For each return score 0-1, component scores for execution_correctness, method, security_reliability, validation_evidence, communication_business, critical_error boolean, concise rationale, and any unsupported_claims. Then return mean_score, passed_rows, critical_errors, all_8_attempted, at_least_7_of_8_ge_0_80, mandatory_domains_ge_0_80, overall_pass. Overall pass must obey the packet pass rules exactly. Do not award credit for claims not supported in the candidate answer.`;
  const out = await modelJson(gradeSystem, prompt);
  const grade = {
    grade_id: crypto.randomUUID(), graded_at: new Date().toISOString(), model: out.model,
    verifier_instance_document_id: VERIFIER_INSTANCE_DOCUMENT_ID,
    verifier_config_sha256: VERIFIER_CONFIG_SHA256,
    packet_sha256: expectedPacketHash,
    ...out.parsed,
  };
  grade.grade_sha256 = sha256(grade);
  return { ok: true, grade, usage: out.usage };
}

export default async function handler(req, res) {
  try {
    const queryAction = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
    if (req.method === 'GET' && queryAction === 'packet') return res.status(200).json(await makePacket());
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true, runtime: 'vercel_node_serverless_ai_gateway_oidc', model: MODEL,
        verifier_instance_document_id: VERIFIER_INSTANCE_DOCUMENT_ID,
        verifier_config_sha256: VERIFIER_CONFIG_SHA256,
        frozen_portfolio_document_id: FROZEN_PORTFOLIO_DOCUMENT_ID,
        frozen_portfolio_sha256: FROZEN_PORTFOLIO_SHA256,
        vercel_env: process.env.VERCEL_ENV ?? null,
        vercel_region: process.env.VERCEL_REGION ?? null,
        deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const action = req.body?.action;
    if (action === 'packet') return res.status(200).json(await makePacket());
    if (action === 'grade') return res.status(200).json(await gradePacket(req.body?.packet, req.body?.answers));
    return res.status(400).json({ error: 'unknown_action' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'verifier_runtime_error', message: String(error?.message ?? error) });
  }
}
