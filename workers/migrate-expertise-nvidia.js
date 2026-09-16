import crypto from 'node:crypto';

const GH = 'https://api.github.com';
const OWNER = 'booleanlambda';
const REPO = 'agent-control-room';
const BRANCH = 'main';

function reqHeaders() {
  const token = String(process.env.AAU_GITHUB_TOKEN || '').trim();
  if (!token) throw new Error('AAU_GITHUB_TOKEN is not configured');
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'AAU-NVIDIA-Expertise-Migrator/0.1',
  };
}

async function gh(path, options = {}) {
  const response = await fetch(`${GH}${path}`, {
    ...options,
    headers: { ...reqHeaders(), ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`github_${response.status}:${body?.message || text.slice(0, 500)}`);
  return body;
}

async function readFile(path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const body = await gh(`/repos/${OWNER}/${REPO}/contents/${encoded}?ref=${encodeURIComponent(BRANCH)}`);
  return {
    sha: body.sha,
    content: Buffer.from(body.content || '', 'base64').toString('utf8'),
  };
}

async function writeFile(path, sha, content, message) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return gh(`/repos/${OWNER}/${REPO}/contents/${encoded}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha,
      branch: BRANCH,
    }),
  });
}

function replaceRequired(source, oldValue, newValue, label) {
  if (!source.includes(oldValue)) throw new Error(`migration_anchor_missing:${label}`);
  return source.replace(oldValue, newValue);
}

function patchVerifier(source) {
  if (source.includes("AUTHENTICATOR_MODEL = 'z-ai/glm-5.3'") || source.includes('AUTHENTICATOR_MODEL = "z-ai/glm-5.3"')) {
    return source;
  }

  const startCall = source.indexOf('def openrouter_call(');
  const endCall = source.indexOf('\ndef xkiro_call(', startCall);
  if (startCall < 0 || endCall < 0) throw new Error('migration_anchor_missing:openrouter_call');
  const nvidiaCall = `def nvidia_call(key, model, system, user, max_tokens=800, temperature=0, timeout=210):\n    body = {\n        "model": model,\n        "temperature": temperature,\n        "max_tokens": max_tokens,\n        "stream": False,\n        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],\n    }\n    if model == "z-ai/glm-5.3":\n        body["chat_template_kwargs"] = {"clear_thinking": True}\n    payload = json.dumps(body).encode()\n    headers = {\n        "Authorization": f"Bearer {key}",\n        "Content-Type": "application/json",\n        "Accept": "application/json",\n        "User-Agent": "AAU-Expertise-Verification/0.4",\n    }\n    _, obj = http_json("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, payload=payload, timeout=timeout)\n    msg = obj.get("choices", [{}])[0].get("message", {}) or {}\n    text = msg.get("content") or msg.get("reasoning_content") or obj.get("choices", [{}])[0].get("text") or ""\n    return obj, text\n`;
  source = source.slice(0, startCall) + nvidiaCall + source.slice(endCall);

  const startList = source.indexOf('def list_openrouter_models():');
  const endList = source.indexOf('\ndef parse_grade(', startList);
  if (startList < 0 || endList < 0) throw new Error('migration_anchor_missing:list_openrouter_models');
  const modelsFn = `def nvidia_candidate_models():\n    return {\n        "openai/gpt-oss-20b",\n        "meta/muse-glimmer-30b",\n        "z-ai/glm-5.3",\n    }\n`;
  source = source.slice(0, startList) + modelsFn + source.slice(endList);

  source = source.replaceAll('os.environ.get("OPENROUTER_API_KEY")', 'os.environ.get("NVIDIA_API_KEY")');
  source = source.replaceAll('openrouter_call(', 'nvidia_call(');
  source = source.replaceAll('list_openrouter_models()', 'nvidia_candidate_models()');

  const oldTask = `    preferred = [\n        "cohere/north-mini-code:free",\n        "thinkingmachines/inkling:free",\n        "thinkingmachines/inkling-small:free",\n        "poolside/laguna-s-2.1:free",\n        "google/gemma-4-31b-it:free",\n        "google/gemma-4-26b-a4b-it:free",\n    ]\n    candidates = [m for m in preferred if m in available]\n    if not candidates:\n        candidates = [\n            m for m in sorted(available)\n            if m.endswith(":free") and not m.startswith("nvidia/") and not m.startswith("deepseek/")\n        ][:12]\n`;
  const newTask = `    preferred = [\n        "openai/gpt-oss-20b",\n        "meta/muse-glimmer-30b",\n    ]\n    candidates = [m for m in preferred if m in available]\n`;
  source = replaceRequired(source, oldTask, newTask, 'task_models');

  source = source.replace('result["task_authority"] = {"provider": "OpenRouter", "model": used}', 'result["task_authority"] = {"provider": "NVIDIA Direct", "model": used}');
  source = source.replace('model = "nvidia/nemotron-3-ultra-550b-a55b:free"', 'model = "z-ai/glm-5.3"');
  source = source.replace('nvidia_call(key, model, system, user, max_tokens=260, temperature=0, reasoning_exclude=True, timeout=210)', 'nvidia_call(key, model, system, user, max_tokens=1200, temperature=0, timeout=240)');
  source = source.replace('"authenticator_provider": "OpenRouter"', '"authenticator_provider": "NVIDIA Direct"');

  const oldAdj = `    preferred = [\n        "thinkingmachines/inkling:free",\n        "thinkingmachines/inkling-small:free",\n        "poolside/laguna-s-2.1:free",\n        "google/gemma-4-31b-it:free",\n        "cohere/north-mini-code:free",\n        "nex-agi/nex-n2.5-pro:free",\n        "nex-agi/nex-n2.5-mini:free",\n    ]\n    candidates = [\n        m for m in preferred\n        if m in avail and m != task_model and not m.startswith("nvidia/") and not m.startswith("deepseek/")\n    ]\n    if not candidates:\n        candidates = [\n            m for m in sorted(avail)\n            if m.endswith(":free") and m != task_model and not m.startswith("nvidia/") and not m.startswith("deepseek/")\n        ][:12]\n`;
  const newAdj = `    preferred = [\n        "meta/muse-glimmer-30b",\n        "openai/gpt-oss-20b",\n    ]\n    candidates = [m for m in preferred if m in avail and m != task_model]\n`;
  source = replaceRequired(source, oldAdj, newAdj, 'adjudicator_models');
  source = source.replace('nvidia_call(key, model, system, user, max_tokens=260, temperature=0, timeout=180)', 'nvidia_call(key, model, system, user, max_tokens=900, temperature=0, timeout=210)');

  source = source.replace('"authenticator_runtime": "OpenRouter via separate GitHub Actions job"', '"authenticator_runtime": "NVIDIA direct API via separate GitHub Actions job"');
  source = source.replace('"adjudicator_runtime": "OpenRouter via separate GitHub Actions job when flagged"', '"adjudicator_runtime": "NVIDIA direct API via separate GitHub Actions job when flagged"');

  const marker = 'SIM_AGENT_ID = os.environ.get("SIM_AGENT_ID", "e854982e-baf4-4b23-81e0-148babe66378")\n';
  source = replaceRequired(source, marker, `${marker}\nAUTHENTICATOR_MODEL = "z-ai/glm-5.3"\n`, 'authenticator_constant');

  return source;
}

function patchWorkflow(source) {
  const nvidiaRef = '${{ secrets.NVIDIA_API_KEY }}';
  source = source.replace(/^\s*OPENROUTER_API_KEY:\s*\$\{\{\s*secrets\.OPEN_ROUTER_(?:AUTHENTICATOR|ADJUDICATOR)\s*\}\}\s*$/gm, `      NVIDIA_API_KEY: ${nvidiaRef}`);
  source = source.replaceAll('${OPENROUTER_API_KEY:-}', '${NVIDIA_API_KEY:-}');
  return source;
}

export async function migrateExpertiseVerificationToNvidia() {
  const verifierPath = 'scripts/aau_expertise_final_verification.py';
  const workflows = [
    '.github/workflows/expertise-final-verification.yml',
    '.github/workflows/expertise-final-verification-resume.yml',
    '.github/workflows/expertise-final-grading-resume.yml',
  ];

  const verifier = await readFile(verifierPath);
  const patchedVerifier = patchVerifier(verifier.content);
  const legacy = /openrouter\.ai|OPENROUTER_API_KEY|OPEN_ROUTER_AUTHENTICATOR|OPEN_ROUTER_ADJUDICATOR|nvidia\/nemotron-3-ultra-550b-a55b:free/;
  if (legacy.test(patchedVerifier)) throw new Error('legacy_openrouter_reference_remains_in_verifier');
  if (!patchedVerifier.includes('z-ai/glm-5.3')) throw new Error('glm_authenticator_missing');
  if (!patchedVerifier.includes('meta/muse-glimmer-30b')) throw new Error('muse_adjudicator_missing');
  if (!patchedVerifier.includes('openai/gpt-oss-20b')) throw new Error('gpt_oss_task_authority_missing');

  if (patchedVerifier !== verifier.content) {
    await writeFile(verifierPath, verifier.sha, patchedVerifier, 'feat: migrate expertise verifier to NVIDIA direct');
  }

  for (const path of workflows) {
    const file = await readFile(path);
    const patched = patchWorkflow(file.content);
    if (/OPENROUTER_API_KEY|OPEN_ROUTER_AUTHENTICATOR|OPEN_ROUTER_ADJUDICATOR/.test(patched)) {
      throw new Error(`legacy_openrouter_reference_remains:${path}`);
    }
    if (patched !== file.content) {
      await writeFile(path, file.sha, patched, 'feat: use NVIDIA direct for expertise verification');
    }
  }

  return {
    ok: true,
    verifier_sha256: crypto.createHash('sha256').update(patchedVerifier).digest('hex'),
    authenticator_model: 'z-ai/glm-5.3',
    task_authority_models: ['openai/gpt-oss-20b', 'meta/muse-glimmer-30b'],
    adjudicator_models: ['meta/muse-glimmer-30b', 'openai/gpt-oss-20b'],
    provider: 'nvidia_direct',
  };
}
