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
    'user-agent': 'AAU-Expertise-Runtime-Patcher/1.0',
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
  if (source.includes('glm_json_grade_mode_v0_1')) {
    return { ok: true, changed: false, reason: 'already_patched_glm_json_grade_mode_v0_1' };
  }
  if (!source.includes('operator_smoke_single_task_v0_1') || !source.includes('robust_grade_parser_v0_1')) {
    throw new Error('required_expertise_patches_not_present');
  }

  source = source.replace(
    'async function nvidiaCall({ model, system, user, maxTokens = 1200, temperature = 0, timeoutMs = 180000 }) {',
    'async function nvidiaCall({ model, system, user, maxTokens = 1200, temperature = 0, timeoutMs = 180000, jsonMode = false }) {'
  );

  const bodyAnchor = '    stream: false,\n  };';
  const bodyReplacement = "    stream: false,\n  };\n  if (jsonMode === true) body.response_format = { type: 'json_object' }; // glm_json_grade_mode_v0_1";
  if (!source.includes(bodyAnchor)) throw new Error('nvidia_body_anchor_not_found');
  source = source.replace(bodyAnchor, bodyReplacement);

  source = source.replace(
    "const system = 'You are the independent AAU expertise authenticator. You did not train the candidate. Grade only the supplied answer against the fresh task and fixed anchors. Do not reward fluency without correctness. Return exactly one GRADE line and no explanation.';",
    "const system = 'You are the independent AAU expertise authenticator. You did not train the candidate. Grade only the supplied answer against the fresh task and fixed anchors. Do not reward fluency without correctness. Return exactly one JSON object and no explanation with numeric fields execution, method, security, validation, communication (0-100), string critical, numeric confidence (0-1), and boolean unsupported.';"
  );

  const oldUserTail = 'Return: GRADE execution=NN method=NN security=NN validation=NN communication=NN critical=NONE confidence=0.00 unsupported=NONE. If a material unsupported claim exists use unsupported=PRESENT.`;';
  const newUserTail = 'Return one JSON object: {"execution":NN,"method":NN,"security":NN,"validation":NN,"communication":NN,"critical":"none","confidence":0.00,"unsupported":false}. Set unsupported=true for a material unsupported claim.`;';
  if (!source.includes(oldUserTail)) throw new Error('grade_user_contract_anchor_not_found');
  source = source.replace(oldUserTail, newUserTail);

  const oldCall = 'const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 160, temperature: 0, timeoutMs: 60000 });';
  const newCall = 'const result = await nvidiaCall({ model: run.authenticator_model, system, user, maxTokens: 220, temperature: 0, timeoutMs: 60000, jsonMode: true });';
  if (!source.includes(oldCall)) throw new Error('authenticator_call_anchor_not_found');
  source = source.replace(oldCall, newCall);

  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'fix: use NVIDIA JSON mode for GLM expertise grading',
      content: Buffer.from(source, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, commit_sha: response?.commit?.sha || null, contract: 'glm_json_grade_mode_v0_1' };
}
