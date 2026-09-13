const VERCEL_API = 'https://api.vercel.com';
const DEFAULT_SUPABASE_URL = 'https://mgtilfgygzymxiyixjit.supabase.co';

class ProvisionerError extends Error {
  constructor(code, message, { status = 500, retryable = false, details = null } = {}) {
    super(message);
    this.name = 'ProvisionerError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

function envState() {
  return {
    vercel_token: Boolean(process.env.AAU_VERCEL_TOKEN),
    vercel_team_id: Boolean(process.env.AAU_VERCEL_TEAM_ID),
    supabase_service_role: Boolean(process.env.AAU_SUPABASE_SERVICE_ROLE_KEY),
    broker_executor_secret: Boolean(process.env.AAU_BROKER_EXECUTOR_SECRET),
    supabase_url: process.env.AAU_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  };
}

function runtimeReady() {
  const state = envState();
  return state.vercel_token && state.vercel_team_id && state.supabase_service_role && state.broker_executor_secret;
}

function readBearer(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

function requireExecutorAuth(req) {
  const expected = process.env.AAU_BROKER_EXECUTOR_SECRET;
  if (!expected) throw new ProvisionerError('executor_secret_not_configured', 'Broker executor secret is not configured.', { status: 503 });
  const supplied = readBearer(req);
  if (!supplied || supplied !== expected) throw new ProvisionerError('unauthorized_executor', 'Invalid broker executor credential.', { status: 401 });
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 2000) }; }
}

async function supabaseRpc(name, args) {
  const serviceKey = process.env.AAU_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new ProvisionerError('supabase_service_role_not_configured', 'Supabase service-role credential is not configured.', { status: 503 });
  const base = (process.env.AAU_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  let response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch (error) {
    throw new ProvisionerError('supabase_network_error', String(error?.message || error), { status: 503, retryable: true });
  }
  const body = await parseResponse(response);
  if (!response.ok) {
    throw new ProvisionerError('supabase_rpc_error', `Supabase RPC ${name} failed with ${response.status}.`, {
      status: response.status >= 500 ? 503 : 500,
      retryable: response.status >= 500 || response.status === 429,
      details: body,
    });
  }
  return body;
}

async function vercelRaw(path, init = {}) {
  const token = process.env.AAU_VERCEL_TOKEN;
  if (!token) throw new ProvisionerError('vercel_token_not_configured', 'Vercel machine credential is not configured.', { status: 503 });
  let response;
  try {
    response = await fetch(`${VERCEL_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    throw new ProvisionerError('vercel_network_error', String(error?.message || error), { status: 503, retryable: true });
  }
  return { response, body: await parseResponse(response) };
}

async function vercelRequest(path, init = {}) {
  const { response, body } = await vercelRaw(path, init);
  if (!response.ok) {
    throw new ProvisionerError('vercel_api_error', `Vercel API failed with ${response.status}.`, {
      status: response.status === 401 || response.status === 403 ? 503 : response.status,
      retryable: response.status === 429 || response.status >= 500,
      details: body,
    });
  }
  return body;
}

function validateProjectName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(name)) {
    throw new ProvisionerError('invalid_vercel_project_name', 'Vercel project name must use lowercase letters, numbers, or hyphens and be at most 100 characters.', { status: 400 });
  }
  return name;
}

function validateRootDirectory(value) {
  if (value == null || value === '') return null;
  const root = String(value).trim();
  if (!root || root.length > 200 || root.startsWith('/') || root.split('/').includes('..') || root.includes('\\')) {
    throw new ProvisionerError('invalid_root_directory', 'root_directory must be a relative repository path without parent traversal.', { status: 400 });
  }
  return root;
}

function buildProjectSpec(claim) {
  const cfg = claim?.requested_config || {};
  const name = validateProjectName(cfg.project_name || claim.construct_slug);
  const repo = String(claim.github_repo_full_name || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ProvisionerError('invalid_registered_github_repository', 'Construct registry did not provide a valid GitHub repository identity.', { status: 409 });
  }
  const rootDirectory = validateRootDirectory(cfg.root_directory);
  const framework = cfg.framework == null || cfg.framework === '' ? null : String(cfg.framework).trim().slice(0, 64);
  return { name, repo, rootDirectory, framework };
}

function linkedRepoFullName(project) {
  const link = project?.link;
  if (!link || link.type !== 'github') return null;
  if (typeof link.repo === 'string' && link.repo.includes('/')) return link.repo;
  if (typeof link.org === 'string' && typeof link.repo === 'string') return `${link.org}/${link.repo}`;
  return null;
}

async function ensureProject(claim) {
  const teamId = process.env.AAU_VERCEL_TEAM_ID;
  if (!teamId) throw new ProvisionerError('vercel_team_id_not_configured', 'Vercel team ID is not configured.', { status: 503 });
  const spec = buildProjectSpec(claim);
  const query = `?teamId=${encodeURIComponent(teamId)}`;
  const lookup = await vercelRaw(`/v9/projects/${encodeURIComponent(spec.name)}${query}`);
  let project;
  let created = false;

  if (lookup.response.ok) {
    project = lookup.body;
    const linked = linkedRepoFullName(project);
    if (!linked || linked.toLowerCase() !== spec.repo.toLowerCase()) {
      throw new ProvisionerError('vercel_project_name_conflict', 'Vercel project already exists but is not linked to this Construct GitHub repository.', {
        status: 409,
        details: { project_name: spec.name, expected_repo: spec.repo, actual_repo: linked },
      });
    }
  } else if (lookup.response.status === 404) {
    const body = {
      name: spec.name,
      gitRepository: { type: 'github', repo: spec.repo },
    };
    if (spec.rootDirectory) body.rootDirectory = spec.rootDirectory;
    if (spec.framework) body.framework = spec.framework;
    project = await vercelRequest(`/v11/projects${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    created = true;
  } else {
    throw new ProvisionerError('vercel_project_lookup_failed', `Vercel project lookup failed with ${lookup.response.status}.`, {
      status: lookup.response.status >= 500 ? 503 : 500,
      retryable: lookup.response.status >= 500 || lookup.response.status === 429,
      details: lookup.body,
    });
  }

  const projectId = String(project?.id || '');
  if (!projectId) throw new ProvisionerError('vercel_project_id_missing', 'Vercel response did not contain a project ID.', { status: 502, retryable: false });
  const projectName = String(project?.name || spec.name);
  const projectUrl = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`;
  return {
    created,
    result: {
      created,
      project_id: projectId,
      project_name: projectName,
      project_url: projectUrl,
      github_repo_full_name: spec.repo,
      root_directory: spec.rootDirectory,
      framework: spec.framework,
    },
  };
}

async function recordFailure(jobId, error, partialResult = {}) {
  try {
    return await supabaseRpc('aau_fail_vercel_construct_job', {
      p_broker_job_id: jobId,
      p_error_code: error?.code || 'vercel_provisioner_error',
      p_error_message: String(error?.message || error),
      p_retryable: Boolean(error?.retryable),
      p_partial_result: partialResult,
    });
  } catch (failureError) {
    console.error('AAU Vercel failure-recording error', failureError?.code || failureError?.message || failureError);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const state = envState();
    return res.status(200).json({
      ok: true,
      adapter: 'AAU Vercel Construct Provisioner',
      version: 'v0_1',
      ready: runtimeReady(),
      credentials: {
        vercel_token_configured: state.vercel_token,
        vercel_team_id_configured: state.vercel_team_id,
        supabase_service_role_configured: state.supabase_service_role,
        broker_executor_secret_configured: state.broker_executor_secret,
      },
      vercel_env: process.env.VERCEL_ENV || null,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  let claimed = false;
  let jobId = null;
  let partialResult = {};
  try {
    if (!runtimeReady()) throw new ProvisionerError('provisioner_not_ready', 'Required machine credentials are not configured.', { status: 503 });
    requireExecutorAuth(req);
    jobId = req.body?.broker_job_id;
    if (!jobId || typeof jobId !== 'string') throw new ProvisionerError('broker_job_id_required', 'broker_job_id is required.', { status: 400 });

    const executorId = process.env.AAU_VERCEL_EXECUTOR_ID || `vercel:${process.env.VERCEL_DEPLOYMENT_ID || 'agent-control-room'}`;
    const claim = await supabaseRpc('aau_claim_vercel_construct_job', { p_broker_job_id: jobId, p_executor_id: executorId });
    claimed = true;

    const provisioned = await ensureProject(claim);
    partialResult = provisioned.result;
    const completed = await supabaseRpc('aau_complete_vercel_construct_job', {
      p_broker_job_id: jobId,
      p_project_id: provisioned.result.project_id,
      p_project_name: provisioned.result.project_name,
      p_project_url: provisioned.result.project_url,
      p_git_repo_full_name: provisioned.result.github_repo_full_name,
      p_result: { ...provisioned.result, adapter: 'vercel_construct_provisioner_v0_1', executor_id: executorId },
    });

    return res.status(200).json({
      ok: true,
      adapter: 'vercel_construct_provisioner_v0_1',
      broker_job_id: jobId,
      project: provisioned.result,
      registry: completed,
    });
  } catch (error) {
    const normalized = error instanceof ProvisionerError
      ? error
      : new ProvisionerError('vercel_provisioner_error', String(error?.message || error), { status: 500, retryable: false });
    if (claimed && jobId) await recordFailure(jobId, normalized, partialResult);
    console.error('AAU Vercel Construct Provisioner error', normalized.code, normalized.message);
    return res.status(normalized.status || 500).json({ ok: false, error: normalized.code, message: normalized.message, retryable: Boolean(normalized.retryable) });
  }
}
