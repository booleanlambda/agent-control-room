const GITHUB_API = 'https://api.github.com';
const DEFAULT_SUPABASE_URL = 'https://mgtilfgygzymxiyixjit.supabase.co';
const API_VERSION = '2022-11-28';

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
    github_token: Boolean(process.env.AAU_GITHUB_TOKEN),
    supabase_service_role: Boolean(process.env.AAU_SUPABASE_SERVICE_ROLE_KEY),
    broker_executor_secret: Boolean(process.env.AAU_BROKER_EXECUTOR_SECRET),
    github_owner: process.env.AAU_GITHUB_OWNER || null,
    supabase_url: process.env.AAU_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  };
}

function runtimeReady() {
  const state = envState();
  return state.github_token && state.supabase_service_role && state.broker_executor_secret;
}

function readBearer(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

function requireExecutorAuth(req) {
  const expected = process.env.AAU_BROKER_EXECUTOR_SECRET;
  if (!expected) {
    throw new ProvisionerError('executor_secret_not_configured', 'Broker executor secret is not configured.', { status: 503 });
  }
  const supplied = readBearer(req);
  if (!supplied || supplied !== expected) {
    throw new ProvisionerError('unauthorized_executor', 'Invalid broker executor credential.', { status: 401 });
  }
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

async function supabaseRpc(name, args) {
  const serviceKey = process.env.AAU_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new ProvisionerError('supabase_service_role_not_configured', 'Supabase service-role credential is not configured.', { status: 503 });
  }
  const base = (process.env.AAU_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  let response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
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

async function githubRaw(path, init = {}) {
  const token = process.env.AAU_GITHUB_TOKEN;
  if (!token) {
    throw new ProvisionerError('github_token_not_configured', 'GitHub machine credential is not configured.', { status: 503 });
  }
  let response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': API_VERSION,
        'user-agent': 'AAU-Agent-Construct-Provisioner/0.1',
        ...(init.headers || {}),
      },
    });
  } catch (error) {
    throw new ProvisionerError('github_network_error', String(error?.message || error), { status: 503, retryable: true });
  }
  return { response, body: await parseResponse(response) };
}

async function githubRequest(path, init = {}) {
  const { response, body } = await githubRaw(path, init);
  if (!response.ok) {
    throw new ProvisionerError('github_api_error', `GitHub API failed with ${response.status}.`, {
      status: response.status === 401 || response.status === 403 ? 503 : response.status,
      retryable: response.status === 429 || response.status >= 500,
      details: body,
    });
  }
  return body;
}

function validateOwner(owner) {
  if (!owner || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
    throw new ProvisionerError('invalid_github_owner', 'GitHub owner is missing or invalid.', { status: 400 });
  }
  return owner;
}

function validateRepoName(name) {
  if (!name || !/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') {
    throw new ProvisionerError('invalid_repository_name', 'Repository name must be 1-100 characters using letters, numbers, dot, underscore, or hyphen.', { status: 400 });
  }
  return name;
}

function buildRepoSpec(claim) {
  const config = claim?.requested_config || {};
  const owner = validateOwner(config.owner || process.env.AAU_GITHUB_OWNER);
  const name = validateRepoName(config.name || config.repo_name || claim.construct_slug);
  const ownerType = config.owner_type === 'org' ? 'org' : 'user';
  const isPrivate = config.private !== false;
  const baseDescription = String(config.description || `AAU Agent Construct: ${claim.construct_name || name}`).trim().slice(0, 260);
  const marker = `[AAU construct:${claim.construct_id}]`;
  const description = `${baseDescription}${baseDescription ? ' ' : ''}${marker}`.slice(0, 350);
  return { owner, name, ownerType, isPrivate, description, marker };
}

async function readMarker(owner, repo, defaultBranch) {
  const branchQuery = defaultBranch ? `?ref=${encodeURIComponent(defaultBranch)}` : '';
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.aau/construct.json${branchQuery}`;
  const { response, body } = await githubRaw(path);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ProvisionerError('github_marker_read_failed', `Could not read AAU provenance marker (${response.status}).`, {
      status: response.status >= 500 ? 503 : 409,
      retryable: response.status >= 500 || response.status === 429,
      details: body,
    });
  }
  if (!body?.content || body.encoding !== 'base64') return null;
  try {
    const decoded = Buffer.from(String(body.content).replace(/\n/g, ''), 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    throw new ProvisionerError('invalid_aau_marker', 'Existing repository has an unreadable AAU provenance marker.', { status: 409 });
  }
}

async function writeMarker(repoInfo, claim) {
  const markerPayload = {
    schema: 'aau.agent_construct.github_repository.v0_1',
    construct_id: claim.construct_id,
    broker_request_id: claim.broker_request_id,
    broker_job_id: claim.broker_job_id,
    created_by: 'AAU GitHub Construct Provisioner v0.1',
  };
  const content = Buffer.from(`${JSON.stringify(markerPayload, null, 2)}\n`, 'utf8').toString('base64');
  await githubRequest(`/repos/${encodeURIComponent(repoInfo.owner.login)}/${encodeURIComponent(repoInfo.name)}/contents/.aau/construct.json`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'chore: register AAU construct provenance',
      content,
      branch: repoInfo.default_branch,
    }),
  });
  return markerPayload;
}

async function ensureRepository(claim) {
  const spec = buildRepoSpec(claim);
  const repoPath = `/repos/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.name)}`;
  const existingLookup = await githubRaw(repoPath);

  let repoInfo;
  let created = false;

  if (existingLookup.response.ok) {
    repoInfo = existingLookup.body;
    const marker = await readMarker(spec.owner, spec.name, repoInfo.default_branch);
    if (marker) {
      if (marker.construct_id !== claim.construct_id || marker.broker_request_id !== claim.broker_request_id) {
        throw new ProvisionerError('repository_name_conflict', 'Repository already exists but belongs to a different AAU Construct or broker request.', { status: 409 });
      }
    } else {
      const description = String(repoInfo.description || '');
      if (!description.includes(spec.marker)) {
        throw new ProvisionerError('repository_name_conflict', 'Repository already exists without matching AAU provenance.', { status: 409 });
      }
      await writeMarker(repoInfo, claim);
    }
  } else if (existingLookup.response.status === 404) {
    const createPath = spec.ownerType === 'org'
      ? `/orgs/${encodeURIComponent(spec.owner)}/repos`
      : '/user/repos';

    repoInfo = await githubRequest(createPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: spec.name,
        description: spec.description,
        private: spec.isPrivate,
        auto_init: true,
        has_issues: true,
        has_projects: false,
        has_wiki: false,
      }),
    });

    if (repoInfo?.owner?.login?.toLowerCase() !== spec.owner.toLowerCase()) {
      throw new ProvisionerError('github_owner_mismatch', 'GitHub created the repository under an unexpected owner.', {
        status: 409,
        details: { expected_owner: spec.owner, actual_owner: repoInfo?.owner?.login || null },
      });
    }

    created = true;
    await writeMarker(repoInfo, claim);
  } else {
    throw new ProvisionerError('github_repository_lookup_failed', `Repository lookup failed with ${existingLookup.response.status}.`, {
      status: existingLookup.response.status >= 500 ? 503 : 500,
      retryable: existingLookup.response.status >= 500 || existingLookup.response.status === 429,
      details: existingLookup.body,
    });
  }

  return {
    repoInfo,
    created,
    result: {
      created,
      repo_id: String(repoInfo.id),
      repo_full_name: repoInfo.full_name,
      repo_url: repoInfo.html_url,
      default_branch: repoInfo.default_branch,
      private: Boolean(repoInfo.private),
    },
  };
}

async function recordFailure(jobId, error, partialResult = {}) {
  try {
    return await supabaseRpc('aau_fail_github_construct_job', {
      p_broker_job_id: jobId,
      p_error_code: error?.code || 'github_provisioner_error',
      p_error_message: String(error?.message || error),
      p_retryable: Boolean(error?.retryable),
      p_partial_result: partialResult,
    });
  } catch (failureError) {
    console.error('AAU failure-recording error', failureError?.code || failureError?.message || failureError);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const state = envState();
    return res.status(200).json({
      ok: true,
      adapter: 'AAU GitHub Construct Provisioner',
      version: 'v0_1',
      ready: runtimeReady(),
      credentials: {
        github_token_configured: state.github_token,
        supabase_service_role_configured: state.supabase_service_role,
        broker_executor_secret_configured: state.broker_executor_secret,
        github_owner_configured: Boolean(state.github_owner),
      },
      vercel_env: process.env.VERCEL_ENV || null,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let claimed = false;
  let jobId = null;
  let partialResult = {};

  try {
    if (!runtimeReady()) {
      throw new ProvisionerError('provisioner_not_ready', 'Required machine credentials are not configured.', { status: 503 });
    }

    requireExecutorAuth(req);

    jobId = req.body?.broker_job_id;
    if (!jobId || typeof jobId !== 'string') {
      throw new ProvisionerError('broker_job_id_required', 'broker_job_id is required.', { status: 400 });
    }

    const executorId = process.env.AAU_GITHUB_EXECUTOR_ID
      || `vercel:${process.env.VERCEL_DEPLOYMENT_ID || 'agent-control-room'}`;

    const claim = await supabaseRpc('aau_claim_github_construct_job', {
      p_broker_job_id: jobId,
      p_executor_id: executorId,
    });
    claimed = true;

    const provisioned = await ensureRepository(claim);
    partialResult = provisioned.result;

    const completed = await supabaseRpc('aau_complete_github_construct_job', {
      p_broker_job_id: jobId,
      p_repo_id: provisioned.result.repo_id,
      p_repo_full_name: provisioned.result.repo_full_name,
      p_repo_url: provisioned.result.repo_url,
      p_default_branch: provisioned.result.default_branch,
      p_private: provisioned.result.private,
      p_result: {
        ...provisioned.result,
        adapter: 'github_construct_provisioner_v0_1',
        executor_id: executorId,
      },
    });

    return res.status(200).json({
      ok: true,
      adapter: 'github_construct_provisioner_v0_1',
      broker_job_id: jobId,
      repository: provisioned.result,
      registry: completed,
    });
  } catch (error) {
    const normalized = error instanceof ProvisionerError
      ? error
      : new ProvisionerError('github_provisioner_error', String(error?.message || error), { status: 500, retryable: false });

    if (claimed && jobId) {
      await recordFailure(jobId, normalized, partialResult);
    }

    console.error('AAU GitHub Construct Provisioner error', normalized.code, normalized.message);
    return res.status(normalized.status || 500).json({
      ok: false,
      error: normalized.code,
      message: normalized.message,
      retryable: Boolean(normalized.retryable),
    });
  }
}
