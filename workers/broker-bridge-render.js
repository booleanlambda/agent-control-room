import httpServer from 'node:http';
import process from 'node:process';
import amqp from 'amqplib';

const SB = 'https://mgtilfgygzymxiyixjit.supabase.co';
const GH = 'https://api.github.com';
const VC = 'https://api.vercel.com';

const AGENT_GH = String(process.env.AAU_AGENT_GITHUB_TOKEN || '').trim();
const PLATFORM_GH = String(process.env.AAU_GITHUB_TOKEN || '').trim();

const cfg = {
  amqp: String(process.env.AMQP_URL || process.env.AMQP || '').trim(),
  sb: String(process.env.AAU_SUPABASE_URL || SB).replace(/\/$/, ''),
  anon: String(process.env.AAU_SUPABASE_ANON_KEY || '').trim(),
  bridge: String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim(),
  gh: AGENT_GH || PLATFORM_GH,
  ghCredential: AGENT_GH ? 'agent' : (PLATFORM_GH ? 'platform' : 'none'),
  ghOwner: AGENT_GH
    ? String(process.env.AAU_AGENT_GITHUB_OWNER || '').trim()
    : String(process.env.AAU_GITHUB_OWNER || '').trim(),
  vc: String(process.env.AAU_VERCEL_TOKEN || '').trim(),
  vcTeam: String(process.env.AAU_VERCEL_TEAM_ID || '').trim(),
  id: String(process.env.AAU_BROKER_PUBLISHER_ID || `render:${process.env.RENDER_INSTANCE_ID || process.pid}`),
  port: Number(process.env.PORT || 10000),
  poll: Number(process.env.AAU_OUTBOX_POLL_MS || 1500),
  prefetch: Number(process.env.AAU_BROKER_PREFETCH || 4),
};

const qs = {
  github: 'aau.infrastructure.github',
  vercel: 'aau.infrastructure.vercel',
};

const st = {
  started_at: new Date().toISOString(),
  rabbit: false,
  published: 0,
  consumed: 0,
  succeeded: 0,
  retried: 0,
  dead: 0,
  last_error: null,
};

let conn = null;
let stopping = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const missingCore = () => [
  ['AMQP_URL', cfg.amqp],
  ['AAU_SUPABASE_ANON_KEY', cfg.anon],
  ['AAU_BROKER_BRIDGE_TOKEN', cfg.bridge],
].filter(([, value]) => !value).map(([key]) => key);

const providerStatus = () => ({
  github: {
    ready: Boolean(cfg.gh),
    credential: cfg.ghCredential,
    owner_mode: cfg.ghOwner ? 'configured' : 'authenticated_identity',
    missing: cfg.gh ? [] : ['AAU_AGENT_GITHUB_TOKEN_OR_AAU_GITHUB_TOKEN'],
  },
  vercel: {
    ready: Boolean(cfg.vc && cfg.vcTeam),
    missing: [
      ['AAU_VERCEL_TOKEN', cfg.vc],
      ['AAU_VERCEL_TEAM_ID', cfg.vcTeam],
    ].filter(([, value]) => !value).map(([key]) => key),
  },
});

async function json(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

async function rpc(name, args = {}) {
  const response = await fetch(`${cfg.sb}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: cfg.anon,
      authorization: `Bearer ${cfg.anon}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_bridge_token: cfg.bridge, ...args }),
  });
  const body = await json(response);
  if (!response.ok) {
    const error = new Error(`${name}:${response.status}`);
    error.retryable = response.status === 429 || response.status >= 500;
    error.details = body;
    throw error;
  }
  return body;
}

async function http(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    error.retryable = true;
    throw error;
  }
  return { response, body: await json(response) };
}

async function claimOutbox() {
  const rows = await rpc('aau_bridge_claim_runtime_outbox', {
    p_publisher_id: cfg.id,
    p_limit: 25,
    p_lease_seconds: 60,
  });
  return Array.isArray(rows) ? rows : [];
}

async function publishOutbox(channel) {
  for (const event of await claimOutbox()) {
    try {
      await channel.assertQueue(event.routing_key, { durable: true });
      const envelope = {
        schema: 'aau.runtime.capability_event.v0_1',
        outbox_event_id: event.outbox_event_id,
        capability_invocation_id: event.capability_invocation_id,
        agent_id: event.agent_id,
        construct_id: event.construct_id,
        event_type: event.event_type,
        routing_key: event.routing_key,
        message_id: event.message_id || event.outbox_event_id,
        payload: event.payload || {},
      };
      channel.sendToQueue(event.routing_key, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        contentType: 'application/json',
        messageId: envelope.message_id,
        type: event.event_type,
      });
      await channel.waitForConfirms();
      await rpc('aau_bridge_mark_runtime_outbox_published', {
        p_outbox_event_id: event.outbox_event_id,
        p_publisher_id: cfg.id,
        p_message_id: envelope.message_id,
      });
      st.published += 1;
      console.log('AAU_OUTBOX_PUBLISHED', envelope.message_id, event.routing_key);
    } catch (error) {
      st.last_error = String(error.message || error);
      await rpc('aau_bridge_mark_runtime_outbox_failed', {
        p_outbox_event_id: event.outbox_event_id,
        p_publisher_id: cfg.id,
        p_error: st.last_error,
        p_retry_after_seconds: null,
      }).catch(() => {});
    }
  }
}

async function gh(path, options = {}) {
  if (!cfg.gh) {
    const error = new Error('github_token_not_configured');
    error.retryable = true;
    throw error;
  }
  const { response, body } = await http(`${GH}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${cfg.gh}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'AAU-Broker-Bridge/0.3',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const error = new Error(`github:${response.status}`);
    error.retryable = response.status === 429 || response.status >= 500;
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}

let githubIdentityCache = null;

async function authenticatedGithubIdentity() {
  if (githubIdentityCache) return githubIdentityCache;
  const body = await gh('/user');
  const login = String(body?.login || '').trim();
  if (!login) throw new Error('github_authenticated_identity_missing');
  githubIdentityCache = { login, id: body?.id ? String(body.id) : null };
  return githubIdentityCache;
}

function normalizeAgentAuthoredFiles(raw) {
  const out = [];
  if (!raw) return out;

  const entries = Array.isArray(raw)
    ? raw.map((item) => [item?.path, item?.content])
    : (raw && typeof raw === 'object')
      ? Object.entries(raw)
      : [];

  let totalBytes = 0;
  for (const [rawPath, rawContent] of entries.slice(0, 32)) {
    const path = String(rawPath || '').trim().replace(/^\/+/, '');
    const content = typeof rawContent === 'string' ? rawContent : '';
    if (!path || path.includes('..') || !/^[A-Za-z0-9._\/-]{1,180}$/.test(path)) {
      throw new Error('invalid_agent_file_path');
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > 131072) throw new Error('agent_file_too_large');
    totalBytes += bytes;
    if (totalBytes > 524288) throw new Error('agent_files_total_too_large');
    out.push({ path, content });
  }
  return out;
}

async function putRepoFile(owner, repo, path, content, branch, message = null) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const api = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
  const lookup = await http(`${GH}${api}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${cfg.gh}`,
      'x-github-api-version': '2022-11-28',
    },
  });

  if (lookup.response.ok) return { created: false };
  if (lookup.response.status !== 404) {
    const error = new Error(`github_file_lookup:${lookup.response.status}`);
    error.retryable = lookup.response.status === 429 || lookup.response.status >= 500;
    throw error;
  }

  await gh(api, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: message || `AAU: write agent-authored file (${path})`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
    }),
  });
  return { created: true };
}

async function seedReactHelloWorld(owner, repo, branch) {
  const files = {
    'package.json': `{
  "name": "aau-react-hello-world",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.0.2",
    "vite": "^7.1.5"
  }
}
`,
    'vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()] })
`,
    'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AAU Hello World</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    'src/main.jsx': `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
    'src/App.jsx': `export default function App() {
  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Autonomous Agent Universe</p>
        <h1>Hello World</h1>
        <p>Built with React and deployed through an AAU Agent Construct.</p>
      </section>
    </main>
  )
}
`,
    'src/index.css': `:root {
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  color: #111827;
  background: #f8fafc;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; }
.shell { min-height: 100vh; display: grid; place-items: center; padding: 2rem; }
.card {
  width: min(680px, 100%);
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 24px;
  padding: 3rem;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
}
.eyebrow {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #64748b;
}
h1 { margin: 0.5rem 0 1rem; font-size: clamp(3rem, 10vw, 6rem); line-height: 0.95; }
p { line-height: 1.6; }
`,
  };

  let filesCreated = 0;
  for (const [path, content] of Object.entries(files)) {
    const result = await putRepoFile(owner, repo, path, content, branch);
    if (result.created) filesCreated += 1;
  }

  return { template: 'react_hello_world', files_created: filesCreated };
}

async function ensureRepo(context) {
  const x = context.requested_config || {};
  const identity = await authenticatedGithubIdentity();
  const ownerType = x.owner_type === 'org' ? 'org' : 'user';
  const owner = String(x.owner || cfg.ghOwner || identity.login).trim();
  const name = String(x.name || x.repo_name || context.construct_slug).trim();

  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) throw new Error('invalid_github_owner');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new Error('invalid_repository_name');

  if (ownerType === 'user' && owner.toLowerCase() !== identity.login.toLowerCase()) {
    throw new Error('github_user_owner_must_match_agent_identity');
  }

  let info;
  let created = false;
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const lookup = await http(`${GH}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${cfg.gh}`,
      'x-github-api-version': '2022-11-28',
    },
  });

  if (lookup.response.ok) {
    info = lookup.body;
    const marker = `[AAU construct:${context.construct_id}]`;
    if (!String(info.description || '').includes(marker)) throw new Error('repository_name_conflict');
  } else if (lookup.response.status === 404) {
    const marker = `[AAU construct:${context.construct_id}]`;
    const description = `${String(x.description || `AAU Agent Construct: ${context.construct_name || name}`)} ${marker}`.slice(0, 350);
    info = await gh(ownerType === 'org'
      ? `/orgs/${encodeURIComponent(owner)}/repos`
      : '/user/repos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        private: x.private !== false,
        auto_init: true,
        has_issues: true,
        has_projects: false,
        has_wiki: false,
      }),
    });
    if (String(info?.owner?.login || '').toLowerCase() !== owner.toLowerCase()) {
      throw new Error('github_owner_mismatch');
    }
    created = true;
  } else {
    const error = new Error(`github_lookup:${lookup.response.status}`);
    error.retryable = lookup.response.status === 429 || lookup.response.status >= 500;
    throw error;
  }

  const branch = info.default_branch || 'main';
  let seed = null;
  if (x.template === 'react_hello_world') {
    seed = await seedReactHelloWorld(owner, name, branch);
  }

  const authoredFiles = normalizeAgentAuthoredFiles(x.files);
  let filesWritten = 0;
  for (const file of authoredFiles) {
    const result = await putRepoFile(
      owner,
      name,
      file.path,
      file.content,
      branch,
      `AAU agent: add ${file.path}`,
    );
    if (result.created) filesWritten += 1;
  }

  return {
    created,
    repo_id: String(info.id),
    repo_full_name: info.full_name,
    repo_url: info.html_url,
    default_branch: branch,
    private: Boolean(info.private),
    credential_mode: cfg.ghCredential,
    authenticated_owner: identity.login,
    agent_authored_files_requested: authoredFiles.length,
    agent_authored_files_written: filesWritten,
    seed,
  };
}
async function runGithub(job) {
  const context = await rpc('aau_bridge_claim_github_construct_job', {
    p_broker_job_id: job,
    p_executor_id: cfg.id,
  });
  let partial = {};
  try {
    partial = await ensureRepo(context);
    await rpc('aau_bridge_complete_github_construct_job', {
      p_broker_job_id: job,
      p_repo_id: partial.repo_id,
      p_repo_full_name: partial.repo_full_name,
      p_repo_url: partial.repo_url,
      p_default_branch: partial.default_branch,
      p_private: partial.private,
      p_result: { ...partial, adapter: 'broker_bridge_render_v0_4_agent_github', executor_id: cfg.id },
    });
    return { ok: true };
  } catch (error) {
    const safeGithubError = {
      status: error.status || null,
      message: error.details?.message || null,
      documentation_url: error.details?.documentation_url || null,
      errors: Array.isArray(error.details?.errors)
        ? error.details.errors.slice(0, 5).map((item) => ({
            resource: item?.resource || null,
            field: item?.field || null,
            code: item?.code || null,
            message: item?.message || null,
          }))
        : null,
    };
    console.log('AAU_GITHUB_ERROR', JSON.stringify(safeGithubError));
    const safeMessage = [String(error.message || error), safeGithubError.message].filter(Boolean).join(': ');
    await rpc('aau_bridge_fail_github_construct_job', {
      p_broker_job_id: job,
      p_error_code: 'github_bridge_error',
      p_error_message: safeMessage,
      p_retryable: Boolean(error.retryable),
      p_partial_result: { ...partial, github_error: safeGithubError },
    }).catch(() => {});
    return { ok: false, retryable: Boolean(error.retryable), reason: safeMessage };
  }
}

async function vc(path, options = {}) {
  if (!cfg.vc) {
    const error = new Error('vercel_token_not_configured');
    error.retryable = true;
    throw error;
  }
  if (!cfg.vcTeam) {
    const error = new Error('vercel_team_not_configured');
    error.retryable = true;
    throw error;
  }
  const { response, body } = await http(`${VC}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${cfg.vc}`,
      accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const error = new Error(`vercel:${response.status}`);
    error.retryable = response.status === 429 || response.status >= 500;
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}

function linked(project) {
  const link = project?.link;
  if (!link || link.type !== 'github') return null;
  if (typeof link.repo === 'string' && link.repo.includes('/')) return link.repo;
  if (link.org && link.repo) return `${link.org}/${link.repo}`;
  return null;
}

async function ensureProject(context) {
  const x = context.requested_config || {};
  const name = String(x.project_name || context.construct_slug).toLowerCase();
  const repo = String(context.github_repo_full_name || '');

  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(name)) throw new Error('invalid_project_name');
  if (!repo.includes('/')) {
    const error = new Error('github_repository_required');
    error.retryable = true;
    throw error;
  }

  const query = `?teamId=${encodeURIComponent(cfg.vcTeam)}`;
  const lookup = await http(`${VC}/v9/projects/${encodeURIComponent(name)}${query}`, {
    headers: { authorization: `Bearer ${cfg.vc}`, accept: 'application/json' },
  });

  let project;
  let created = false;
  if (lookup.response.ok) {
    project = lookup.body;
    if (String(linked(project) || '').toLowerCase() !== repo.toLowerCase()) {
      throw new Error('vercel_project_name_conflict');
    }
  } else if (lookup.response.status === 404) {
    const body = { name, gitRepository: { type: 'github', repo } };
    if (x.root_directory) body.rootDirectory = x.root_directory;
    if (x.framework) body.framework = x.framework;
    project = await vc(`/v11/projects${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    created = true;
  } else {
    const error = new Error(`vercel_lookup:${lookup.response.status}`);
    error.retryable = lookup.response.status === 429 || lookup.response.status >= 500;
    throw error;
  }

  if (!project?.id) throw new Error('vercel_project_id_missing');
  return {
    created,
    project_id: String(project.id),
    project_name: String(project.name || name),
    project_url: `https://api.vercel.com/v9/projects/${encodeURIComponent(project.id)}`,
    github_repo_full_name: repo,
  };
}

async function ensureDeployment(context) {
  const x = context.requested_config || {};
  const projectId = String(context.vercel_project_id || '');
  const projectName = String(context.vercel_project_name || context.construct_slug || '');
  const repoFullName = String(context.github_repo_full_name || '');
  const ref = String(x.ref || context.github_default_branch || 'main');
  const target = String(x.target || 'production');

  if (!projectId) throw new Error('vercel_project_id_required');
  if (!projectName) throw new Error('vercel_project_name_required');
  if (!repoFullName.includes('/')) throw new Error('github_repository_required');
  if (target !== 'production') throw new Error('deployment_target_not_supported_v0_1');

  const [org, ...repoParts] = repoFullName.split('/');
  const repo = repoParts.join('/');
  if (!org || !repo) throw new Error('github_repository_invalid');

  const query = `?teamId=${encodeURIComponent(cfg.vcTeam)}&skipAutoDetectionConfirmation=1`;
  const body = {
    name: projectName,
    project: projectId,
    target: 'production',
    gitSource: {
      type: 'github',
      org,
      repo,
      ref,
    },
    meta: {
      aauConstructId: String(context.construct_id || ''),
      aauBrokerJobId: String(context.broker_job_id || ''),
    },
  };

  const created = await vc(`/v13/deployments${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const deploymentId = String(created?.id || created?.uid || '');
  if (!deploymentId) throw new Error('vercel_deployment_id_missing');

  let current = created;
  let status = String(current?.status || current?.readyState || '').toUpperCase();
  const terminalFailure = new Set(['ERROR', 'CANCELED', 'CANCELLED']);

  for (let i = 0; i < 120 && !['READY', ...terminalFailure].includes(status); i += 1) {
    await sleep(3000);
    current = await vc(`/v13/deployments/${encodeURIComponent(deploymentId)}${query}`);
    status = String(current?.status || current?.readyState || '').toUpperCase();
  }

  if (status !== 'READY') {
    const error = new Error(status ? `vercel_deployment_terminal_status:${status}` : 'vercel_deployment_poll_timeout');
    error.retryable = !terminalFailure.has(status);
    error.details = current;
    throw error;
  }

  const rawDeploymentHost = String(current?.url || created?.url || '');
  const deploymentUrl = rawDeploymentHost
    ? (rawDeploymentHost.startsWith('http') ? rawDeploymentHost : `https://${rawDeploymentHost}`)
    : null;
  if (!deploymentUrl) throw new Error('vercel_deployment_url_missing');

  let aliases = [];
  try {
    const aliasBody = await vc(`/v2/deployments/${encodeURIComponent(deploymentId)}/aliases${query}`);
    aliases = Array.isArray(aliasBody?.aliases) ? aliasBody.aliases : [];
  } catch (error) {
    console.log('AAU_VERCEL_ALIAS_LOOKUP_WARN', String(error.message || error));
  }

  const preferredAlias = aliases.find((item) => String(item?.alias || '').toLowerCase() === `${projectName}.vercel.app`.toLowerCase())
    || aliases.find((item) => String(item?.alias || '').endsWith('.vercel.app'))
    || aliases[0]
    || null;
  const aliasHost = String(preferredAlias?.alias || '');
  const productionUrl = aliasHost
    ? (aliasHost.startsWith('http') ? aliasHost : `https://${aliasHost}`)
    : deploymentUrl;

  let siteHttpStatus = null;
  if (x.verify_http !== false) {
    for (let i = 0; i < 12; i += 1) {
      try {
        const probe = await fetch(productionUrl, { redirect: 'follow' });
        siteHttpStatus = probe.status;
        if (probe.status >= 200 && probe.status < 400) break;
      } catch {
        siteHttpStatus = 0;
      }
      await sleep(2500);
    }
  }

  if (context.construct_visibility === 'public' && x.verify_http !== false && !(siteHttpStatus >= 200 && siteHttpStatus < 400)) {
    const error = new Error(`deployment_http_verification_failed:${siteHttpStatus}`);
    error.retryable = siteHttpStatus === 0 || siteHttpStatus === 404 || siteHttpStatus >= 500;
    throw error;
  }

  const gitSha = String(
    current?.meta?.githubCommitSha
    || current?.gitSource?.sha
    || created?.meta?.githubCommitSha
    || created?.gitSource?.sha
    || ''
  ) || null;

  return {
    deployment_id: deploymentId,
    deployment_url: deploymentUrl,
    production_url: productionUrl,
    deployment_status: status,
    production_alias: aliasHost || null,
    git_ref: ref,
    git_sha: gitSha,
    site_http_status: siteHttpStatus,
    vercel_project_id: projectId,
    vercel_project_name: projectName,
    github_repo_full_name: repoFullName,
  };
}

async function runVercelDeployment(job) {
  const context = await rpc('aau_bridge_claim_vercel_deployment_job', {
    p_broker_job_id: job,
    p_executor_id: cfg.id,
  });
  let partial = {};
  try {
    partial = await ensureDeployment(context);
    await rpc('aau_bridge_complete_vercel_deployment_job', {
      p_broker_job_id: job,
      p_deployment_id: partial.deployment_id,
      p_deployment_url: partial.deployment_url,
      p_production_url: partial.production_url,
      p_deployment_status: partial.deployment_status,
      p_git_ref: partial.git_ref,
      p_git_sha: partial.git_sha,
      p_result: { ...partial, adapter: 'broker_bridge_render_v0_4', executor_id: cfg.id },
    });
    return { ok: true };
  } catch (error) {
    const providerError = error?.details?.error || null;
    const safeMessage = [
      String(error.message || error),
      providerError?.code ? `code=${providerError.code}` : null,
      providerError?.message || null,
    ].filter(Boolean).join(': ');
    console.log('AAU_VERCEL_DEPLOYMENT_ERROR', safeMessage);
    await rpc('aau_bridge_fail_vercel_deployment_job', {
      p_broker_job_id: job,
      p_error_code: 'vercel_deployment_bridge_error',
      p_error_message: safeMessage,
      p_retryable: Boolean(error.retryable),
      p_partial_result: partial,
    }).catch(() => {});
    return { ok: false, retryable: Boolean(error.retryable), reason: safeMessage };
  }
}

async function runVercel(job) {
  const context = await rpc('aau_bridge_claim_vercel_construct_job', {
    p_broker_job_id: job,
    p_executor_id: cfg.id,
  });
  let partial = {};
  try {
    partial = await ensureProject(context);
    await rpc('aau_bridge_complete_vercel_construct_job', {
      p_broker_job_id: job,
      p_project_id: partial.project_id,
      p_project_name: partial.project_name,
      p_project_url: partial.project_url,
      p_git_repo_full_name: partial.github_repo_full_name,
      p_result: { ...partial, adapter: 'broker_bridge_render_v0_3', executor_id: cfg.id },
    });
    return { ok: true };
  } catch (error) {
    await rpc('aau_bridge_fail_vercel_construct_job', {
      p_broker_job_id: job,
      p_error_code: 'vercel_bridge_error',
      p_error_message: String(error.message || error),
      p_retryable: Boolean(error.retryable),
      p_partial_result: partial,
    }).catch(() => {});
    return { ok: false, retryable: Boolean(error.retryable), reason: String(error.message || error) };
  }
}

async function dead(channel, queue, message, why) {
  const deadQueue = `${queue}.dead`;
  await channel.assertQueue(deadQueue, { durable: true });
  channel.sendToQueue(deadQueue, message.content, {
    persistent: true,
    contentType: 'application/json',
    messageId: message.properties.messageId,
    type: 'aau.broker.dead_letter',
    headers: {
      ...(message.properties.headers || {}),
      'x-aau-dead-letter-reason': String(why).slice(0, 1000),
    },
  });
  await channel.waitForConfirms();
  channel.ack(message);
  st.dead += 1;
}

async function retry(channel, queue, message, why) {
  const next = Number(message.properties.headers?.['x-aau-bridge-retry'] || 0) + 1;
  if (next > 5) return dead(channel, queue, message, `retry_exhausted:${why}`);

  const retryQueue = `${queue}.retry`;
  const delay = Math.min(300000, 15000 * (2 ** Math.min(next - 1, 4)));
  await channel.assertQueue(retryQueue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': queue,
    },
  });
  channel.sendToQueue(retryQueue, message.content, {
    persistent: true,
    contentType: 'application/json',
    messageId: message.properties.messageId,
    expiration: String(delay),
    headers: {
      ...(message.properties.headers || {}),
      'x-aau-bridge-retry': next,
    },
  });
  await channel.waitForConfirms();
  channel.ack(message);
  st.retried += 1;
}

async function handle(channel, queue, message) {
  if (!message) return;
  st.consumed += 1;

  let envelope;
  try {
    envelope = JSON.parse(message.content.toString('utf8'));
  } catch {
    return dead(channel, queue, message, 'invalid_json');
  }

  const invocationId = envelope?.payload?.capability_invocation_id || envelope?.capability_invocation_id;
  if (!invocationId) return dead(channel, queue, message, 'invocation_missing');

  let materialized;
  try {
    materialized = await rpc('aau_bridge_materialize_infrastructure_broker_job', {
      p_capability_invocation_id: invocationId,
      p_message_id: envelope.message_id || message.properties.messageId || null,
    });
  } catch (error) {
    return error.retryable
      ? retry(channel, queue, message, error.message)
      : dead(channel, queue, message, error.message);
  }

  if (materialized.job_status === 'succeeded') {
    channel.ack(message);
    st.succeeded += 1;
    return;
  }
  if (materialized.job_status !== 'queued') {
    return ['failed', 'dead_lettered', 'cancelled'].includes(materialized.job_status)
      ? dead(channel, queue, message, materialized.job_status)
      : retry(channel, queue, message, materialized.job_status);
  }

  const outcome = materialized.provider === 'github'
    ? await runGithub(materialized.broker_job_id)
    : materialized.provider === 'vercel'
      ? materialized.capability_code === 'vercel.deployment.create'
        ? await runVercelDeployment(materialized.broker_job_id)
        : await runVercel(materialized.broker_job_id)
      : { ok: false, retryable: false, reason: 'unsupported_provider' };

  if (outcome.ok) {
    channel.ack(message);
    st.succeeded += 1;
  } else if (outcome.retryable) {
    await retry(channel, queue, message, outcome.reason);
  } else {
    await dead(channel, queue, message, outcome.reason);
  }
}

async function session() {
  conn = await amqp.connect(cfg.amqp, { timeout: 10000 });
  st.rabbit = true;
  st.last_error = null;
  console.log('AAU_BROKER_RABBIT_CONNECTED');

  const publisher = await conn.createConfirmChannel();
  const consumer = await conn.createConfirmChannel();
  await consumer.prefetch(cfg.prefetch);

  for (const queue of Object.values(qs)) {
    await consumer.assertQueue(queue, { durable: true });
    await consumer.assertQueue(`${queue}.dead`, { durable: true });
    await consumer.consume(queue, (message) => void handle(consumer, queue, message).catch(async (error) => {
      st.last_error = String(error.message || error);
      if (message) {
        try {
          await retry(consumer, queue, message, st.last_error);
        } catch {
          consumer.nack(message, false, true);
        }
      }
    }), { noAck: false });
  }

  let closed = false;
  const closePromise = new Promise((resolve) => {
    conn.once('close', () => {
      closed = true;
      resolve();
    });
    conn.on('error', (error) => {
      st.last_error = String(error.message || error);
    });
  });

  const publisherLoop = (async () => {
    while (!stopping && !closed) {
      try {
        await publishOutbox(publisher);
      } catch (error) {
        st.last_error = String(error.message || error);
      }
      await sleep(cfg.poll);
    }
  })();

  await closePromise;
  st.rabbit = false;
  conn = null;
  await publisherLoop.catch(() => {});
}

function server() {
  const service = httpServer.createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false }));
    }
    const missing = missingCore();
    const ok = !missing.length && st.rabbit;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok,
      service: 'AAU Broker Bridge',
      version: 'v0_4_render',
      rabbit_connected: st.rabbit,
      core_config_ready: !missing.length,
      missing_core_config: missing,
      providers: providerStatus(),
      queues: qs,
      state: st,
    }));
  });
  service.listen(cfg.port, '0.0.0.0');
  return service;
}

async function main() {
  const service = server();
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log('shutdown', signal);
    try { await conn?.close(); } catch {}
    service.close();
  };

  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));

  while (!stopping) {
    const missing = missingCore();
    if (missing.length) {
      st.last_error = `missing_core_config:${missing.join(',')}`;
      await sleep(10000);
      continue;
    }
    try {
      await session();
    } catch (error) {
      st.rabbit = false;
      st.last_error = String(error.message || error);
      console.error('AAU_BROKER_SESSION_ERROR', st.last_error);
    }
    if (!stopping) await sleep(5000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
