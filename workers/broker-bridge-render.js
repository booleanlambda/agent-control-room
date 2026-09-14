import httpServer from 'node:http';
import process from 'node:process';
import amqp from 'amqplib';

const SB = 'https://mgtilfgygzymxiyixjit.supabase.co';
const GH = 'https://api.github.com';
const VC = 'https://api.vercel.com';

const cfg = {
  amqp: String(process.env.AMQP_URL || process.env.AMQP || '').trim(),
  sb: String(process.env.AAU_SUPABASE_URL || SB).replace(/\/$/, ''),
  anon: String(process.env.AAU_SUPABASE_ANON_KEY || '').trim(),
  bridge: String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim(),
  gh: String(process.env.AAU_GITHUB_TOKEN || '').trim(),
  ghOwner: String(process.env.AAU_GITHUB_OWNER || '').trim(),
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
    ready: Boolean(cfg.gh && cfg.ghOwner),
    missing: [
      ['AAU_GITHUB_TOKEN', cfg.gh],
      ['AAU_GITHUB_OWNER', cfg.ghOwner],
    ].filter(([, value]) => !value).map(([key]) => key),
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

async function putRepoFile(owner, repo, path, content, branch) {
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
      message: `AAU: seed React Hello World (${path})`,
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
  const owner = String(x.owner || cfg.ghOwner);
  const name = String(x.name || x.repo_name || context.construct_slug);

  if (!owner) {
    const error = new Error('github_owner_not_configured');
    error.retryable = true;
    throw error;
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new Error('invalid_repository_name');

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
    info = await gh(x.owner_type === 'org'
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

  let seed = null;
  if (x.template === 'react_hello_world') {
    seed = await seedReactHelloWorld(owner, name, info.default_branch || 'main');
  }

  return {
    created,
    repo_id: String(info.id),
    repo_full_name: info.full_name,
    repo_url: info.html_url,
    default_branch: info.default_branch,
    private: Boolean(info.private),
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
      p_result: { ...partial, adapter: 'broker_bridge_render_v0_3', executor_id: cfg.id },
    });
    return { ok: true };
  } catch (error) {
    await rpc('aau_bridge_fail_github_construct_job', {
      p_broker_job_id: job,
      p_error_code: 'github_bridge_error',
      p_error_message: String(error.message || error),
      p_retryable: Boolean(error.retryable),
      p_partial_result: partial,
    }).catch(() => {});
    return { ok: false, retryable: Boolean(error.retryable), reason: String(error.message || error) };
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
      ? await runVercel(materialized.broker_job_id)
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
      version: 'v0_3_render',
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
