import crypto from 'node:crypto';
import { nvidiaChatCompletion } from './providers/nvidia.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const nvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();
const executorId = `render:product-test-designer:${process.env.RENDER_INSTANCE_ID || process.pid}`;
const pollMs = Math.max(2500, Number(process.env.AAU_PRODUCT_TEST_DESIGNER_POLL_MS || 5000));
let running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const error = new Error(`${name}:${response.status}:${body?.message || raw.slice(0, 800)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function modelCall(model, system, user) {
  const result=await nvidiaChatCompletion({
    model,
    messages:[{role:'system',content:system},{role:'user',content:user}],
    maxTokens:4200,
    temperature:0,
    jsonMode:false,
    enableThinking:String(model).startsWith('nvidia/nemotron')?false:null,
    timeoutMs:60000,
    runtimeRole:'planner',
  });
  return {
    model:result.model_returned||model,
    text:String(result.content||result.reasoning_content||'').trim(),
    usage:result.usage||null,
    finish_reason:result.finish_reason||null,
    runtime_contract:result.runtime_contract||null,
  };
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('product_test_spec_json_missing');
  return JSON.parse(raw.slice(start, end + 1));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function validateSpec(spec, claimManifest) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('spec_object_required');
  if (!spec.test_profile || typeof spec.test_profile !== 'object') throw new Error('test_profile_required');
  if (!Array.isArray(spec.deterministic_gates) || spec.deterministic_gates.length < 1) throw new Error('deterministic_gates_required');
  if (!Array.isArray(spec.adversarial_tests)) throw new Error('adversarial_tests_required');
  if (!String(spec.approval_rule || '').trim()) throw new Error('approval_rule_required');
  if (spec?.load_test?.required === true) {
    if (spec.load_test.mode !== 'concurrent_wave') throw new Error('load_test_mode_must_be_concurrent_wave');
    if (Number(spec.load_test.virtual_users) < 1 || Number(spec.load_test.virtual_users) > 1000) throw new Error('load_test_virtual_users_invalid');
    const t = spec.load_test.thresholds;
    if (!t || typeof t !== 'object') throw new Error('load_test_thresholds_required');
    const minSuccess = Number(t.min_success_rate);
    const maxError = Number(t.max_error_rate);
    if (!Number.isFinite(minSuccess) || minSuccess < 0 || minSuccess > 1) throw new Error('load_min_success_rate_invalid');
    if (!Number.isFinite(maxError) || maxError < 0 || maxError > 1) throw new Error('load_max_error_rate_invalid');
    if (typeof t.require_correctness_under_load !== 'boolean') throw new Error('load_correctness_flag_required');
    if (typeof t.require_cross_user_isolation !== 'boolean') throw new Error('load_isolation_flag_required');
  }

  const claimsById = new Map(asArray(claimManifest).map((x) => [String(x?.id || ''), String(x?.text || '')]).filter(([id]) => id));
  const known = new Set(claimsById.keys());
  for (const gate of spec.deterministic_gates) {
    if (!['explicit_claim', 'usage_model'].includes(String(gate?.basis || ''))) throw new Error('gate_basis_invalid');
    if (!String(gate?.test || '').trim() || !String(gate?.pass_condition || '').trim() ||
        !String(gate?.evidence || '').trim() || !String(gate?.rationale || '').trim()) {
      throw new Error('gate_fields_incomplete');
    }
    const ids = asArray(gate.claim_ids).map(String);
    if (gate.basis === 'explicit_claim' && ids.length === 0) throw new Error('explicit_claim_gate_requires_claim_ids');
    if (ids.some((id) => !known.has(id))) throw new Error('unknown_claim_id_in_gate');

    if (gate.basis === 'explicit_claim') {
      const sourceClaims = ids.map((id) => claimsById.get(id) || '').join(' ');
      const pass = String(gate.pass_condition || '');
      const hasTimingThreshold = /\b(?:within\s+)?\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|minutes?)\b/i.test(pass);
      const claimHasTiming = /\b(?:latency|response\s*time|sla)\b/i.test(sourceClaims) || /\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|minutes?)\b/i.test(sourceClaims);
      if (hasTimingThreshold && !claimHasTiming) throw new Error('unclaimed_performance_threshold');
    }
  }

  const serialized = JSON.stringify(spec).toLowerCase();
  const unrelatedRepoRules = [
    'tagged release',
    '5+ commits',
    'five commits',
    'commit count',
    'publicly accessible repository',
    'repository must be public',
  ];
  if (unrelatedRepoRules.some((term) => serialized.includes(term))) {
    throw new Error('unrelated_repository_maturity_requirement');
  }

  return {
    ...spec,
    frozen_claims: claimManifest,
  };
}

async function design(job) {
  const system = [
    'You are the independent AAU Product Test Designer.',
    'The autonomous agent alone chooses the product/service, problem, architecture and implementation.',
    'Your job is to freeze a proportional acceptance test specification from the agent-authored claims and a reasonable inferred usage model.',
    'You may NOT redesign the offering or add unrelated quality conventions.',
    'Every deterministic gate must declare basis=explicit_claim or basis=usage_model.',
    'explicit_claim gates must reference only the supplied claim IDs.',
    'usage_model gates must be necessary to demonstrate the offering under its inferred real usage; explain the rationale.',
    'Do not require public source code, a commit count, tagged releases, branding, documentation volume, or other conventions unless the agent explicitly claimed them.',
    'Do not prescribe endpoint paths, request field names, payload schemas, frameworks, providers, or other implementation/interface choices. Phrase the frozen test behaviorally; the later execution planner maps it to the agent-built documented interface.',
    'For explicit_claim gates, never add a timing/latency/SLA pass threshold unless that threshold exists in the referenced agent claim.',
    'Do not treat deployment, HTTP 200, or the agent\'s own test suite as proof of substantive correctness.',
    'For a remotely consumed service/API, normally include a 1000-virtual-user concurrent-wave stress characterization unless clearly disproportionate; distinguish realistic operating concurrency from stress concurrency.',
    'When load_test.required=true, provide machine-readable thresholds: min_success_rate (0..1), max_error_rate (0..1), require_correctness_under_load boolean, and require_cross_user_isolation boolean. Do not hide load pass criteria only in prose.',
    'Performance metrics such as p50/p95/p99 should be measured. A usage-model load test may set reliability/correctness expectations with rationale, but an explicit-claim gate may not invent a latency threshold absent from the claim.',
    'Prefer adversarial/property tests that could falsify the agent\'s strongest claims.',
    'Return one compact JSON object only, with no markdown.',
  ].join(' ');

  const user = `AGENT SUBMISSION SNAPSHOT:
${JSON.stringify(job.submission_snapshot)}

AUTHORITATIVE FROZEN CLAIM MANIFEST:
${JSON.stringify(job.claim_manifest)}

Return:
{
  "test_profile":{
    "product_class":"...",
    "assumed_usage_model":"...",
    "assumed_userbase":1000,
    "realistic_concurrency":0,
    "stress_concurrency":0,
    "rationale":"..."
  },
  "deterministic_gates":[
    {
      "id":"G1",
      "basis":"explicit_claim|usage_model",
      "claim_ids":["C1"],
      "test":"...",
      "pass_condition":"...",
      "evidence":"runtime-generated evidence only",
      "rationale":"..."
    }
  ],
  "load_test":{
    "required":true,
    "mode":"concurrent_wave",
    "virtual_users":1000,
    "workflow":"realistic complete user operation(s), not health pings",
    "metrics":["success_rate","error_rate","p50_ms","p95_ms","p99_ms","correctness_under_load","cross_user_isolation"],
    "thresholds":{
      "min_success_rate":0.99,
      "max_error_rate":0.01,
      "require_correctness_under_load":true,
      "require_cross_user_isolation":false
    },
    "rationale":"..."
  },
  "adversarial_tests":[
    {"id":"A1","basis":"explicit_claim|usage_model","claim_ids":["VP1"],"test":"...","purpose":"...","pass_condition":"..."}
  ],
  "independent_test_rules":[
    "Agent-authored tests may be evidence but are not the judge.",
    "Runtime must generate independent inputs and preserve raw results."
  ],
  "approval_rule":"..."
}

If a 1000-user stress test is not relevant, set load_test.required=false and explain exactly why. Do not invent completed evidence.`;

  const models = [
    'moonshotai/kimi-k3',
    'meta/muse-glimmer-30b',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
  ];
  let lastError = null;

  for (const model of models) {
    try {
      const result = await modelCall(model, system, user);
      const parsed = parseJsonObject(result.text);
      return {
        specification: validateSpec(parsed, job.claim_manifest),
        modelRequested: model,
        modelUsed: result.model || model,
        fallbackUsed: model !== models[0],
        usage: result.usage,
      };
    } catch (error) {
      lastError = error;
      console.warn('AAU_PRODUCT_TEST_DESIGNER_MODEL_FAILED', JSON.stringify({
        product_test_design_id: job.product_test_design_id,
        model,
        status: error?.status || null,
        message: String(error?.message || error).slice(0, 800),
      }));
    }
  }

  throw lastError || new Error('product_test_designer_no_usable_model');
}

async function processOne(job) {
  try {
    const result = await design(job);
    const completed = await rpc('aau_bridge_complete_product_test_design', {
      p_product_test_design_id: job.product_test_design_id,
      p_executor_id: executorId,
      p_model_requested: result.modelRequested,
      p_model_used: result.modelUsed,
      p_fallback_used: result.fallbackUsed,
      p_specification: result.specification,
    });
    console.log('AAU_PRODUCT_TEST_DESIGN_FROZEN', JSON.stringify({
      product_test_design_id: job.product_test_design_id,
      agent_id: job.agent_id,
      model_requested: result.modelRequested,
      model_used: result.modelUsed,
      fallback_used: result.fallbackUsed,
      gate_count: asArray(result.specification?.deterministic_gates).length,
      adversarial_count: asArray(result.specification?.adversarial_tests).length,
      load_required: Boolean(result.specification?.load_test?.required),
      virtual_users: result.specification?.load_test?.virtual_users ?? null,
      db_status: completed?.status || null,
    }));
  } catch (error) {
    console.error('AAU_PRODUCT_TEST_DESIGN_FAILED', JSON.stringify({
      product_test_design_id: job.product_test_design_id,
      agent_id: job.agent_id,
      error_name: error?.name || null,
      message: String(error?.message || error).slice(0, 1500),
    }));
    try {
      await rpc('aau_bridge_fail_product_test_design', {
        p_product_test_design_id: job.product_test_design_id,
        p_executor_id: executorId,
        p_error_code: 'product_test_designer_error',
        p_error_message: String(error?.message || error),
        p_retryable: true,
      });
    } catch (failError) {
      console.error('AAU_PRODUCT_TEST_DESIGN_FAIL_RECORD_FAILED', String(failError?.message || failError));
    }
  }
}

async function loop() {
  while (running) {
    try {
      const rows = await rpc('aau_bridge_claim_product_test_design', {
        p_executor_id: executorId,
        p_lease_seconds: 900,
      });
      const job = Array.isArray(rows) ? rows[0] : null;
      if (job) {
        await processOne(job);
        continue;
      }
    } catch (error) {
      console.error('AAU_PRODUCT_TEST_DESIGNER_LOOP_ERROR', String(error?.message || error).slice(0, 1500));
    }
    await sleep(pollMs);
  }
}

export function startProductTestDesignerWorker() {
  const missing = [
    ['AAU_SUPABASE_ANON_KEY', anon],
    ['AAU_BROKER_BRIDGE_TOKEN', bridge],
    ['NVIDIA_API_KEY', nvidiaKey],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) return { ok: false, ready: false, missing };
  if (!running) {
    running = true;
    loop().catch((error) => console.error('AAU_PRODUCT_TEST_DESIGNER_FATAL', error));
  }
  return {
    ok: true,
    ready: true,
    executor_id: executorId,
    poll_ms: pollMs,
    version: 'product_test_designer_v0_2',
    authenticator: 'moonshotai/kimi-k3',
    fallbacks: ['meta/muse-glimmer-30b', 'nvidia/nemotron-3.5-lightning-30b-a3b'],
  };
}
