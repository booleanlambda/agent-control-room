import crypto from 'node:crypto';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const nvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();
const githubToken = String(process.env.AAU_AGENT_GITHUB_TOKEN || '').trim();
const executorId = `render:product-test-executor:${process.env.RENDER_INSTANCE_ID || process.pid}`;
const pollMs = Math.max(3000, Number(process.env.AAU_PRODUCT_TEST_EXECUTOR_POLL_MS || 5000));
let running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

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
    const error = new Error(`${name}:${response.status}:${body?.message || raw.slice(0, 900)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function modelCall(model, system, user, maxTokens = 3200, timeoutMs = 150000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
      temperature: 0,
      stream: false,
    };
    if (String(model).startsWith('nvidia/nemotron')) body.chat_template_kwargs = { enable_thinking: false };
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${nvidiaKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'AAU-Product-Test-Executor/0.1',
      },
      body: JSON.stringify(body),
    });
    const { raw, body: parsed } = await jsonResponse(response);
    if (!response.ok) {
      const error = new Error(`nvidia_${response.status}:${parsed?.error?.message || parsed?.detail || raw.slice(0, 800)}`);
      error.status = response.status;
      throw error;
    }
    const message = parsed?.choices?.[0]?.message || {};
    return {
      model: parsed?.model || model,
      text: String(message.content || message.reasoning_content || parsed?.choices?.[0]?.text || '').trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('json_object_missing');
  return JSON.parse(raw.slice(start, end + 1));
}

async function modelWithFallback(system, user, maxTokens) {
  const models = ['moonshotai/kimi-k3', 'meta/muse-glimmer-30b', 'nvidia/nemotron-3.5-lightning-30b-a3b'];
  let lastError = null;
  for (const model of models) {
    try {
      const result = await modelCall(model, system, user, maxTokens);
      return { ...result, requested_model: model, fallback_used: model !== models[0] };
    } catch (error) {
      lastError = error;
      console.warn('AAU_PRODUCT_TEST_EXECUTOR_MODEL_FAILED', JSON.stringify({
        model,
        status: error?.status || null,
        message: String(error?.message || error).slice(0, 800),
      }));
    }
  }
  throw lastError || new Error('no_usable_authenticator_model');
}

function safeBaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('production_url_must_be_https');
  if (!url.hostname) throw new Error('production_url_host_missing');
  url.hash = '';
  return url;
}

async function boundedFetch(url, options = {}, timeoutMs = 12000, maxBytes = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
    const raw = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latency_ms: Math.round((performance.now() - started) * 100) / 100,
      content_type: response.headers.get('content-type') || null,
      body: raw.slice(0, maxBytes),
      body_sha256: sha256(raw),
      final_url: response.url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latency_ms: Math.round((performance.now() - started) * 100) / 100,
      error: String(error?.message || error).slice(0, 600),
      body: '',
      body_sha256: null,
      final_url: String(url),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverHttp(base) {
  const paths = ['/', '/.well-known/aau-test-manifest.json', '/openapi.json', '/swagger.json', '/api/openapi.json'];
  const out = [];
  for (const path of paths) {
    const target = new URL(path, base);
    if (target.origin !== base.origin) continue;
    const result = await boundedFetch(target, { method: 'GET', headers: { accept: 'application/json,text/plain,text/html' } }, 10000, 100000);
    out.push({ path, ...result });
  }
  return out;
}

function repoFullName(repoUrl) {
  try {
    const url = new URL(String(repoUrl || ''));
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
  } catch {
    return null;
  }
}

async function githubGet(path) {
  if (!githubToken) return null;
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${githubToken}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'AAU-Product-Test-Executor/0.1',
    },
  });
  if (!response.ok) return null;
  return response.json();
}

async function collectRepoEvidence(repoUrl) {
  const full = repoFullName(repoUrl);
  if (!full) return { available: false, reason: 'repo_url_not_supported' };
  const repo = await githubGet(`/repos/${full}`);
  if (!repo) return { available: false, reason: 'repo_fetch_failed', repo_full_name: full };
  const branch = repo.default_branch || 'main';
  const tree = await githubGet(`/repos/${full}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const files = Array.isArray(tree?.tree)
    ? tree.tree.filter((x) => x.type === 'blob').slice(0, 80).map((x) => ({ path: x.path, size: x.size, sha: x.sha }))
    : [];
  const textCandidates = files
    .filter((x) => Number(x.size || 0) <= 80000 && /\.(py|js|ts|tsx|jsx|json|md|txt|yaml|yml)$/i.test(x.path))
    .slice(0, 12);
  const contents = [];
  let budget = 180000;
  for (const file of textCandidates) {
    if (budget <= 0) break;
    const data = await githubGet(`/repos/${full}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
    if (!data?.content || data.encoding !== 'base64') continue;
    const text = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
    const clipped = text.slice(0, Math.min(40000, budget));
    budget -= clipped.length;
    contents.push({ path: file.path, sha: file.sha, content: clipped });
  }
  return {
    available: true,
    repo_full_name: full,
    private: Boolean(repo.private),
    default_branch: branch,
    file_count: files.length,
    files,
    sampled_contents: contents,
  };
}

function validatePlan(plan, base, gateIds) {
  if (!plan || typeof plan !== 'object') throw new Error('execution_plan_object_required');
  if (plan.executable !== true) return { ...plan, requests: [] };
  const requests = Array.isArray(plan.requests) ? plan.requests.slice(0, 16) : [];
  const normalized = requests.map((req, index) => {
    const method = String(req?.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new Error('unsupported_http_method');
    const path = String(req?.path || '/');
    const target = new URL(path, base);
    if (target.origin !== base.origin) throw new Error('cross_origin_test_request_blocked');
    const ids = Array.isArray(req?.gate_ids) ? req.gate_ids.map(String) : [];
    if (ids.some((id) => !gateIds.has(id))) throw new Error('execution_plan_unknown_gate_id');
    const headers = {};
    if (method === 'POST') headers['content-type'] = 'application/json';
    return {
      id: String(req?.id || `R${index + 1}`).slice(0, 80),
      gate_ids: ids,
      method,
      path: target.pathname + target.search,
      headers,
      body: method === 'POST' ? (req?.body ?? {}) : null,
      safe_for_load: Boolean(req?.safe_for_load),
      load_rationale: String(req?.load_rationale || '').slice(0, 1200),
    };
  });
  return { ...plan, requests: normalized };
}

async function makeExecutionPlan(job, discovery, repoEvidence) {
  const gateIds = new Set((job.specification?.deterministic_gates || []).map((x) => String(x?.id || '')).filter(Boolean));
  const system = [
    'You are the AAU independent Product Test Execution Planner.',
    'A Product Test Specification is already frozen; you may only map its existing gates to observable tests. Do not add or relax requirements.',
    'Use only endpoints actually evidenced by the supplied discovery material. Never invent an endpoint.',
    'All HTTP requests must be same-origin relative paths. Methods are limited to GET or POST.',
    'Choose at most 16 functional requests.',
    'Mark safe_for_load=true only for an operation that is clearly non-destructive/idempotent or a pure computation. Never load-test payments, messaging, deletion, account creation, external side effects, or ambiguous mutations.',
    'If a frozen gate cannot be independently tested from the available interface/repository evidence, leave it unmapped and list it in unexecutable_gate_ids.',
    'Agent-authored tests are supporting evidence only, not proof by themselves.',
    'Return one compact JSON object only.',
  ].join(' ');

  const compactDiscovery = discovery.map((x) => ({
    path: x.path,
    status: x.status,
    content_type: x.content_type,
    body: String(x.body || '').slice(0, 30000),
  }));
  const compactRepo = {
    available: repoEvidence.available,
    repo_full_name: repoEvidence.repo_full_name,
    private: repoEvidence.private,
    default_branch: repoEvidence.default_branch,
    files: repoEvidence.files,
    sampled_contents: repoEvidence.sampled_contents,
  };

  const user = `FROZEN SPECIFICATION:
${JSON.stringify(job.specification)}

SERVICE DISCOVERY:
${JSON.stringify(compactDiscovery)}

REPOSITORY EVIDENCE:
${JSON.stringify(compactRepo)}

Return:
{
  "executable": true,
  "requests":[
    {
      "id":"R1",
      "gate_ids":["G1"],
      "method":"GET|POST",
      "path":"/documented-path",
      "body":{},
      "safe_for_load":false,
      "load_rationale":"..."
    }
  ],
  "load_request_id":"R1 or null",
  "unexecutable_gate_ids":[],
  "notes":"..."
}
If the service exposes no documented/testable core operation, set executable=false and explain why.`;

  const result = await modelWithFallback(system, user, 3200);
  const parsed = parseJsonObject(result.text);
  const plan = validatePlan(parsed, safeBaseUrl(job.production_url), gateIds);
  return { plan, planner_model: result.model, planner_requested_model: result.requested_model, planner_fallback_used: result.fallback_used };
}

async function executeFunctional(base, plan) {
  const results = [];
  for (const req of plan.requests || []) {
    const target = new URL(req.path, base);
    const options = {
      method: req.method,
      headers: req.headers || {},
    };
    if (req.method === 'POST') options.body = JSON.stringify(req.body ?? {});
    const result = await boundedFetch(target, options, 20000, 60000);
    results.push({
      request_id: req.id,
      gate_ids: req.gate_ids,
      method: req.method,
      path: req.path,
      status: result.status,
      ok: result.ok,
      latency_ms: result.latency_ms,
      body: String(result.body || '').slice(0, 12000),
      body_sha256: result.body_sha256,
      error: result.error || null,
    });
  }
  return results;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

async function executeLoad(base, plan, spec) {
  const required = Boolean(spec?.load_test?.required);
  const desired = Math.max(0, Number(spec?.load_test?.virtual_users || 0));
  if (!required) return { required: false, completed: true, virtual_users: 0 };
  if (desired < 1) return { required: true, completed: false, virtual_users: 0, reason: 'virtual_users_missing' };
  if (desired > 1000) return { required: true, completed: false, virtual_users: 0, reason: 'executor_v0_1_caps_at_1000_virtual_users' };

  const req = (plan.requests || []).find((x) => x.id === plan.load_request_id);
  if (!req) return { required: true, completed: false, virtual_users: 0, reason: 'load_request_not_mapped' };
  if (!req.safe_for_load) return { required: true, completed: false, virtual_users: 0, reason: 'load_operation_not_proven_safe' };

  const target = new URL(req.path, base);
  const task = async () => {
    const options = { method: req.method, headers: req.headers || {} };
    if (req.method === 'POST') options.body = JSON.stringify(req.body ?? {});
    const result = await boundedFetch(target, options, 25000, 3000);
    return {
      status: result.status,
      ok: result.ok,
      latency_ms: result.latency_ms,
      body_sha256: result.body_sha256,
      error: result.error || null,
    };
  };

  const started = Date.now();
  const settled = await Promise.allSettled(Array.from({ length: desired }, () => task()));
  const results = settled.map((entry) => entry.status === 'fulfilled'
    ? entry.value
    : { status: null, ok: false, latency_ms: null, body_sha256: null, error: String(entry.reason || 'rejected') });
  const latencies = results.map((x) => Number(x.latency_ms)).filter(Number.isFinite);
  const success = results.filter((x) => x.ok).length;
  const statusCounts = {};
  for (const row of results) {
    const key = row.status == null ? 'transport_error' : String(row.status);
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }

  return {
    required: true,
    completed: true,
    virtual_users: desired,
    operation_request_id: req.id,
    operation_method: req.method,
    operation_path: req.path,
    elapsed_ms: Date.now() - started,
    success_count: success,
    failure_count: desired - success,
    success_rate: desired ? success / desired : 0,
    error_rate: desired ? (desired - success) / desired : 1,
    p50_ms: percentile(latencies, 50),
    p95_ms: percentile(latencies, 95),
    p99_ms: percentile(latencies, 99),
    status_counts: statusCounts,
    distinct_response_hashes: new Set(results.map((x) => x.body_sha256).filter(Boolean)).size,
    sample_errors: results.filter((x) => !x.ok).slice(0, 20).map((x) => x.error || `HTTP ${x.status}`),
  };
}

async function judgeEvidence(job, planBundle, repoEvidence, functional, load) {
  const system = [
    'You are the independent AAU Product Test Authenticator.',
    'Judge only the frozen gates against the supplied runtime evidence.',
    'Never infer a pass from deployment, HTTP 200 alone, agent-authored tests, comments, or intention.',
    'A gate is PASS only if the evidence actually reaches the quantity and condition required by its frozen pass_condition.',
    'If evidence is missing, too small, indirect, or ambiguous, mark UNVERIFIED, not PASS.',
    'Repository evidence may prove repository/file existence but code comments do not prove runtime behavior.',
    'For load requirements, use the runtime load metrics exactly; do not invent users or requests.',
    'Return one compact JSON object only.',
  ].join(' ');

  const user = `FROZEN SPECIFICATION:
${JSON.stringify(job.specification)}

EXECUTION PLAN:
${JSON.stringify(planBundle.plan)}

REPOSITORY EVIDENCE:
${JSON.stringify(repoEvidence)}

FUNCTIONAL HTTP EVIDENCE:
${JSON.stringify(functional)}

LOAD EVIDENCE:
${JSON.stringify(load)}

Return:
{
  "gate_results":[
    {"gate_id":"G1","status":"PASS|FAIL|UNVERIFIED","evidence_refs":["R1"],"reason":"..."}
  ],
  "adversarial_summary":{"status":"PASS|FAIL|UNVERIFIED","reason":"..."},
  "overall_assessment":"...",
  "unsupported_or_missing_evidence":[]
}
Every deterministic gate in the frozen specification must appear exactly once.`;

  const result = await modelWithFallback(system, user, 3200);
  const report = parseJsonObject(result.text);
  const expected = new Set((job.specification?.deterministic_gates || []).map((x) => String(x?.id || '')).filter(Boolean));
  const rows = Array.isArray(report?.gate_results) ? report.gate_results : [];
  const seen = new Set();
  for (const row of rows) {
    const id = String(row?.gate_id || '');
    if (!expected.has(id)) throw new Error('judge_unknown_gate_id');
    if (seen.has(id)) throw new Error('judge_duplicate_gate_id');
    seen.add(id);
    if (!['PASS', 'FAIL', 'UNVERIFIED'].includes(String(row?.status || ''))) throw new Error('judge_gate_status_invalid');
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length) {
    for (const id of missing) rows.push({ gate_id: id, status: 'UNVERIFIED', evidence_refs: [], reason: 'No independent evidence result was returned for this frozen gate.' });
  }
  return {
    report: { ...report, gate_results: rows },
    judge_model: result.model,
    judge_requested_model: result.requested_model,
    judge_fallback_used: result.fallback_used,
  };
}

async function processRun(job) {
  const base = safeBaseUrl(job.production_url);
  const discovery = await discoverHttp(base);
  const repoEvidence = await collectRepoEvidence(job.repo_url);
  const planBundle = await makeExecutionPlan(job, discovery, repoEvidence);
  const functional = planBundle.plan.executable ? await executeFunctional(base, planBundle.plan) : [];
  const load = planBundle.plan.executable
    ? await executeLoad(base, planBundle.plan, job.specification)
    : { required: Boolean(job.specification?.load_test?.required), completed: false, virtual_users: 0, reason: 'execution_plan_not_executable' };

  const judged = await judgeEvidence(job, planBundle, repoEvidence, functional, load);
  const gateResults = Array.isArray(judged.report?.gate_results) ? judged.report.gate_results : [];
  const allRequiredGatesVerified = gateResults.length > 0 && gateResults.every((x) => x.status === 'PASS');
  const requiredLoad = Boolean(job.specification?.load_test?.required);
  const requiredUsers = Math.max(0, Number(job.specification?.load_test?.virtual_users || 0));
  const loadSatisfied = !requiredLoad || (load.completed === true && Number(load.virtual_users || 0) >= requiredUsers);
  const verdict = allRequiredGatesVerified && loadSatisfied ? 'verified_pass' : 'verified_fail';

  const evidence = {
    service_discovery: discovery.map((x) => ({
      path: x.path, status: x.status, latency_ms: x.latency_ms,
      content_type: x.content_type, body_sha256: x.body_sha256,
      body_excerpt: String(x.body || '').slice(0, 12000),
      error: x.error || null,
    })),
    repository: repoEvidence,
    execution_plan: planBundle.plan,
    functional_results: functional,
  };
  const metrics = { load };
  const finalReport = {
    ...judged.report,
    all_required_gates_verified: allRequiredGatesVerified,
    load_requirement_satisfied: loadSatisfied,
    planner_model: planBundle.planner_model,
    planner_requested_model: planBundle.planner_requested_model,
    planner_fallback_used: planBundle.planner_fallback_used,
    judge_model: judged.judge_model,
    judge_requested_model: judged.judge_requested_model,
    judge_fallback_used: judged.judge_fallback_used,
    executor_version: 'product_test_executor_v0_1_http_service',
  };

  const completed = await rpc('aau_bridge_complete_product_test_run', {
    p_product_test_run_id: job.product_test_run_id,
    p_executor_id: executorId,
    p_verdict: verdict,
    p_evidence: evidence,
    p_metrics: metrics,
    p_final_report: finalReport,
  });

  console.log('AAU_PRODUCT_TEST_RUN_COMPLETED', JSON.stringify({
    product_test_run_id: job.product_test_run_id,
    agent_id: job.agent_id,
    verdict: completed?.verdict || verdict,
    gate_count: gateResults.length,
    all_required_gates_verified: allRequiredGatesVerified,
    load_required: requiredLoad,
    load_virtual_users: load.virtual_users || 0,
    load_completed: Boolean(load.completed),
    executor_version: 'product_test_executor_v0_1_http_service',
  }));
}

async function loop() {
  while (running) {
    try {
      const rows = await rpc('aau_bridge_claim_product_test_run', { p_executor_id: executorId });
      const job = Array.isArray(rows) ? rows[0] : null;
      if (job) {
        try {
          await processRun(job);
        } catch (error) {
          console.error('AAU_PRODUCT_TEST_RUN_FAILED', JSON.stringify({
            product_test_run_id: job.product_test_run_id,
            agent_id: job.agent_id,
            error_name: error?.name || null,
            message: String(error?.message || error).slice(0, 1800),
          }));
          await rpc('aau_bridge_fail_product_test_run', {
            p_product_test_run_id: job.product_test_run_id,
            p_executor_id: executorId,
            p_error_code: 'product_test_executor_error',
            p_error_message: String(error?.message || error),
            p_retryable: true,
          }).catch(() => {});
        }
        continue;
      }
    } catch (error) {
      console.error('AAU_PRODUCT_TEST_EXECUTOR_LOOP_ERROR', String(error?.message || error).slice(0, 1500));
    }
    await sleep(pollMs);
  }
}

export function startProductTestExecutorWorker() {
  const missing = [
    ['AAU_SUPABASE_ANON_KEY', anon],
    ['AAU_BROKER_BRIDGE_TOKEN', bridge],
    ['NVIDIA_API_KEY', nvidiaKey],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length) return { ok: false, ready: false, missing };
  if (!running) {
    running = true;
    loop().catch((error) => console.error('AAU_PRODUCT_TEST_EXECUTOR_FATAL', error));
  }
  return {
    ok: true,
    ready: true,
    executor_id: executorId,
    poll_ms: pollMs,
    version: 'product_test_executor_v0_1_http_service',
    max_virtual_users: 1000,
    same_origin_only: true,
    authenticator: 'moonshotai/kimi-k3',
    fallbacks: ['meta/muse-glimmer-30b', 'nvidia/nemotron-3.5-lightning-30b-a3b'],
  };
}
