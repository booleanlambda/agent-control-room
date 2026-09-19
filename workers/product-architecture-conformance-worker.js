const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const nvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();
const githubToken = String(process.env.AAU_AGENT_GITHUB_TOKEN || '').trim();
const executorId = `render:product-architecture-conformance:${process.env.RENDER_INSTANCE_ID || process.pid}`;
const pollMs = Math.max(2500, Number(process.env.AAU_PRODUCT_ARCH_CONFORMANCE_POLL_MS || 5000));
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
    const error = new Error(`${name}:${response.status}:${body?.message || raw.slice(0,800)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${githubToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'AAU-Product-Architecture-Conformance/0.1',
      'x-github-api-version': '2022-11-28',
    },
  });
  const { raw, body } = await jsonResponse(response);
  if (!response.ok) {
    const error = new Error(`github_${response.status}:${body?.message || raw.slice(0,800)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function safeTextPath(path) {
  const p = String(path || '').toLowerCase();
  if (!p || p.includes('/.git/') || p.startsWith('.git/')) return false;
  if (/(^|\/)(\.env|id_rsa|id_ed25519|credentials|secrets?)(\.|$|\/)/i.test(p)) return false;
  if (/(token|secret|private[-_]?key|credential)/i.test(p)) return false;
  return /\.(md|txt|json|ya?ml|py|js|mjs|cjs|ts|tsx|jsx|go|rs|java|kt|rb|php|cs|toml|ini|cfg|sh|sql)$/i.test(p)
    || ['dockerfile','procfile','requirements.txt','package.json','readme'].some((x) => p.endsWith(x));
}

async function repositorySnapshot(repoFullName, branch) {
  const [owner, repo] = String(repoFullName || '').split('/');
  if (!owner || !repo) throw new Error('repo_full_name_invalid');
  const ref = encodeURIComponent(branch || 'main');
  const tree = await github(`/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`);
  const blobs = Array.isArray(tree?.tree) ? tree.tree
    .filter((x) => x?.type === 'blob' && safeTextPath(x?.path) && Number(x?.size || 0) <= 120000)
    .sort((a,b) => String(a.path).localeCompare(String(b.path)))
    .slice(0,60) : [];

  const files = [];
  let totalChars = 0;
  for (const blob of blobs) {
    if (totalChars >= 260000) break;
    const content = await github(`/repos/${owner}/${repo}/contents/${blob.path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
    if (!content || content.type !== 'file' || content.encoding !== 'base64') continue;
    let text = '';
    try { text = Buffer.from(String(content.content || '').replace(/\n/g,''), 'base64').toString('utf8'); } catch { continue; }
    const remain = 260000 - totalChars;
    const clipped = text.slice(0, Math.max(0, remain));
    files.push({ path: blob.path, size: Number(blob.size || clipped.length), content: clipped });
    totalChars += clipped.length;
  }
  return { repo_full_name: repoFullName, branch: branch || 'main', files };
}

async function modelCall(model, system, user) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const body = {
      model,
      messages: [{ role:'system', content:system }, { role:'user', content:user }],
      max_tokens: 4200,
      temperature: 0,
      stream: false,
    };
    if (String(model).startsWith('nvidia/nemotron')) body.chat_template_kwargs = { enable_thinking:false };
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method:'POST',
      signal:controller.signal,
      headers:{
        authorization:`Bearer ${nvidiaKey}`,
        'content-type':'application/json',
        accept:'application/json',
        'user-agent':'AAU-Product-Architecture-Conformance/0.1',
      },
      body:JSON.stringify(body),
    });
    const { raw, body:parsed } = await jsonResponse(response);
    if (!response.ok) {
      const error = new Error(`nvidia_${response.status}:${parsed?.error?.message || parsed?.detail || raw.slice(0,800)}`);
      error.status = response.status;
      throw error;
    }
    const message = parsed?.choices?.[0]?.message || {};
    return {
      model: parsed?.model || model,
      text: String(message.content || message.reasoning_content || parsed?.choices?.[0]?.text || '').trim(),
      usage: parsed?.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('conformance_json_missing');
  return JSON.parse(raw.slice(start,end+1));
}

function validate(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('conformance_object_required');
  const status = String(result.status || '').toUpperCase();
  if (!['VERIFIED_PASS','VERIFIED_FAIL'].includes(status)) throw new Error('conformance_status_invalid');
  if (!result.implementation_manifest || typeof result.implementation_manifest !== 'object') throw new Error('implementation_manifest_required');
  if (typeof result.implementation_manifest.explicit_manifest_present !== 'boolean') throw new Error('explicit_manifest_flag_required');
  if (!result.evidence || typeof result.evidence !== 'object') throw new Error('conformance_evidence_required');
  if (!result.report || typeof result.report !== 'object') throw new Error('conformance_report_required');
  if (!Array.isArray(result.report.deviations)) throw new Error('conformance_deviations_array_required');
  if (!Array.isArray(result.report.satisfied_requirements)) throw new Error('conformance_satisfied_array_required');
  if (!String(result.report.summary || '').trim()) throw new Error('conformance_summary_required');
  if (status === 'VERIFIED_PASS') {
    if (result.implementation_manifest.explicit_manifest_present !== true) throw new Error('pass_requires_explicit_manifest');
    if (result.report.deviations.length > 0) throw new Error('pass_requires_zero_deviations');
  }
  return { ...result, status };
}

async function review(job) {
  const snapshot = await repositorySnapshot(job.repo_full_name, job.default_branch || 'main');
  const system = [
    'You are the independent AAU Product/Service Architecture Conformance Reviewer.',
    'The autonomous agent owns product and implementation choices. Do not redesign the product.',
    'Judge only whether the repository implements the supplied frozen architecture.',
    'The architecture intentionally leaves programming language, framework, endpoint path, module names, and persistence choices open unless explicitly required.',
    'Conformance happens before canonical deployment. Do NOT require a live URL, deployment, load test, latency result, or production HTTP probe.',
    'Require an explicit agent-authored architecture-to-implementation manifest somewhere in repository content. It may be in any file or documentation section; do not prescribe a filename.',
    'The manifest must intentionally map frozen architecture requirements to concrete files/components/interfaces. Do not count a mapping invented only by you.',
    'Use repository evidence only. If a required behavior cannot be established from source/docs, mark a deviation.',
    'Return a compact JSON object only, no markdown.'
  ].join(' ');

  const user = `FROZEN PRODUCT/SERVICE ARCHITECTURE:
${JSON.stringify(job.architecture_specification)}

REPOSITORY SNAPSHOT:
${JSON.stringify(snapshot)}

Return:
{
  "status":"VERIFIED_PASS|VERIFIED_FAIL",
  "implementation_manifest":{
    "explicit_manifest_present":true,
    "source_files":["..."],
    "mappings":[
      {"architecture_requirement":"...","implementation":"...","evidence_files":["..."]}
    ]
  },
  "evidence":{
    "repo_full_name":"...",
    "branch":"...",
    "files_reviewed":["..."],
    "notes":["..."]
  },
  "report":{
    "summary":"...",
    "satisfied_requirements":[
      {"requirement":"...","evidence":["..."]}
    ],
    "deviations":[
      {"id":"ARCH-...","severity":"critical|major|minor","requirement":"...","observed":"...","effect":"..."}
    ]
  }
}

VERIFIED_PASS is allowed only when every required architecture behavior/component is materially represented and an explicit agent-authored implementation manifest is present. Advisory preferences that are not architecture requirements must not cause failure.`;

  const models = ['moonshotai/kimi-k3','meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b'];
  let lastError = null;
  for (const model of models) {
    try {
      const res = await modelCall(model, system, user);
      return {
        result: validate(parseJsonObject(res.text)),
        modelRequested:model,
        modelUsed:res.model || model,
        fallbackUsed:model !== models[0],
      };
    } catch (error) {
      lastError = error;
      console.warn('AAU_PRODUCT_ARCH_CONFORMANCE_MODEL_FAILED', JSON.stringify({
        run_id:job.product_architecture_conformance_run_id,
        model,
        status:error?.status || null,
        message:String(error?.message || error).slice(0,800),
      }));
    }
  }
  throw lastError || new Error('conformance_no_usable_model');
}

async function processOne(job) {
  try {
    if (!job.repo_full_name) throw new Error('conformance_repo_missing');
    const reviewed = await review(job);
    const r = reviewed.result;
    const completed = await rpc('aau_bridge_complete_product_architecture_conformance', {
      p_product_architecture_conformance_run_id:job.product_architecture_conformance_run_id,
      p_executor_id:executorId,
      p_status:r.status,
      p_implementation_manifest:r.implementation_manifest,
      p_evidence:r.evidence,
      p_report:r.report,
      p_model_requested:reviewed.modelRequested,
      p_model_used:reviewed.modelUsed,
      p_fallback_used:reviewed.fallbackUsed,
    });
    console.log('AAU_PRODUCT_ARCH_CONFORMANCE_COMPLETED', JSON.stringify({
      run_id:job.product_architecture_conformance_run_id,
      agent_id:job.agent_id,
      status:r.status,
      model_used:reviewed.modelUsed,
      fallback_used:reviewed.fallbackUsed,
      db_status:completed?.status || null,
    }));
  } catch (error) {
    console.error('AAU_PRODUCT_ARCH_CONFORMANCE_FAILED', JSON.stringify({
      run_id:job.product_architecture_conformance_run_id,
      agent_id:job.agent_id,
      message:String(error?.message || error).slice(0,1500),
    }));
    await rpc('aau_bridge_fail_product_architecture_conformance', {
      p_product_architecture_conformance_run_id:job.product_architecture_conformance_run_id,
      p_executor_id:executorId,
      p_error_code:'product_architecture_conformance_error',
      p_error_message:String(error?.message || error),
      p_retryable:true,
    }).catch(() => {});
  }
}

async function loop() {
  while (running) {
    try {
      const rows = await rpc('aau_bridge_claim_product_architecture_conformance', {
        p_executor_id:executorId,
        p_lease_seconds:900,
      });
      const job = Array.isArray(rows) ? rows[0] : null;
      if (job) {
        await processOne(job);
        continue;
      }
    } catch (error) {
      console.error('AAU_PRODUCT_ARCH_CONFORMANCE_LOOP_ERROR', String(error?.message || error).slice(0,1500));
    }
    await sleep(pollMs);
  }
}

export function startProductArchitectureConformanceWorker() {
  const missing = [
    ['AAU_SUPABASE_ANON_KEY',anon],
    ['AAU_BROKER_BRIDGE_TOKEN',bridge],
    ['NVIDIA_API_KEY',nvidiaKey],
    ['AAU_AGENT_GITHUB_TOKEN',githubToken],
  ].filter(([,v]) => !v).map(([k]) => k);
  if (missing.length) return { ok:false, ready:false, missing };
  if (!running) {
    running = true;
    loop().catch((error) => console.error('AAU_PRODUCT_ARCH_CONFORMANCE_FATAL', error));
  }
  return {
    ok:true,
    ready:true,
    executor_id:executorId,
    poll_ms:pollMs,
    version:'product_architecture_conformance_v0_1',
    authenticator:'moonshotai/kimi-k3',
    fallbacks:['meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b'],
  };
}
