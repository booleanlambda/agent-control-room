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
    'user-agent': 'AAU-Expertise-Runtime-Patcher/0.8',
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
  if (source.includes('robust_grade_parser_v0_1')) {
    return { ok: true, changed: false, reason: 'already_patched_robust_grade_parser_v0_1' };
  }
  if (!source.includes('glm_auth_no_thinking_v0_1')) {
    throw new Error('glm_no_thinking_patch_not_present');
  }

  const start = source.indexOf('function parseGrade(text) {');
  const end = source.indexOf('\nasync function gradeAnswer(', start);
  if (start < 0 || end < 0) throw new Error('parse_grade_anchor_not_found');

  const replacement = `function parseGrade(text) {
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
    const re = new RegExp('\\\\b' + name + '\\s*[:=]\\s*([A-Za-z0-9_.%-]+)', 'i');
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
`;

  source = source.slice(0, start) + replacement + source.slice(end);

  const response = await gh(api, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'fix: accept equivalent GLM expertise grade formats',
      content: Buffer.from(source, 'utf8').toString('base64'),
      sha: file.sha,
      branch: 'main',
    }),
  });
  return { ok: true, changed: true, commit_sha: response?.commit?.sha || null, contract: 'robust_grade_parser_v0_1' };
}
