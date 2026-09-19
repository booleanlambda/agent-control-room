import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

async function probeAgentGithubToken() {
  const token = String(process.env.AAU_AGENT_GITHUB_TOKEN || '').trim();
  if (!token) {
    console.log('AAU_AGENT_GITHUB_TOKEN_PROBE', JSON.stringify({
      present: false,
      ok: false,
      reason: 'not_configured',
    }));
    return;
  }

  try {
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'AAU-Agent-Token-Probe/0.4',
    };
    const userResponse = await fetch('https://api.github.com/user', { headers });
    let userBody = null;
    try { userBody = await userResponse.json(); } catch {}

    const configuredOwner = String(process.env.AAU_AGENT_GITHUB_OWNER || '').trim() || null;
    console.log('AAU_AGENT_GITHUB_TOKEN_PROBE', JSON.stringify({
      present: true,
      ok: userResponse.ok,
      status: userResponse.status,
      login: userBody?.login || null,
      configured_agent_owner: configuredOwner,
      message: userBody?.message || null,
      mode: 'read_only',
    }));
  } catch (error) {
    console.log('AAU_AGENT_GITHUB_TOKEN_PROBE', JSON.stringify({
      present: true,
      ok: false,
      error: String(error?.message || error),
      mode: 'read_only',
    }));
  }
}
await probeAgentGithubToken();


async function probeAgentVercelToken() {
  const token = String(process.env.VERCEL_AGENT_TOKEN || '').trim();
  if (!token) {
    console.log('AAU_AGENT_VERCEL_TOKEN_PROBE', JSON.stringify({
      present: false,
      ok: false,
      reason: 'not_configured',
    }));
    return;
  }

  try {
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'user-agent': 'AAU-Agent-Vercel-Token-Probe/0.1',
    };
    const userResponse = await fetch('https://api.vercel.com/v2/user', { headers });
    let userBody = null;
    try { userBody = await userResponse.json(); } catch {}

    const teamsResponse = userResponse.ok
      ? await fetch('https://api.vercel.com/v2/teams?limit=20', { headers })
      : null;
    let teamsBody = null;
    try { teamsBody = teamsResponse ? await teamsResponse.json() : null; } catch {}

    console.log('AAU_AGENT_VERCEL_TOKEN_PROBE', JSON.stringify({
      present: true,
      ok: userResponse.ok,
      status: userResponse.status,
      user_id: userBody?.user?.id || userBody?.id || null,
      username: userBody?.user?.username || userBody?.username || null,
      email_present: Boolean(userBody?.user?.email || userBody?.email),
      teams_status: teamsResponse?.status || null,
      team_count: Array.isArray(teamsBody?.teams) ? teamsBody.teams.length : null,
      configured_agent_team: String(process.env.VERCEL_AGENT_TEAM_ID || '').trim() || null,
      message: userBody?.error?.message || userBody?.message || null,
      mode: 'read_only',
    }));
  } catch (error) {
    console.log('AAU_AGENT_VERCEL_TOKEN_PROBE', JSON.stringify({
      present: true,
      ok: false,
      error: String(error?.message || error),
      mode: 'read_only',
    }));
  }
}
await probeAgentVercelToken();

async function probeAgentVercelWrite() {
  const enabled = ['1','true','yes'].includes(
    String(process.env.AAU_AGENT_VERCEL_WRITE_PROBE || '').trim().toLowerCase(),
  );
  if (!enabled) return;

  const token = String(process.env.VERCEL_AGENT_TOKEN || '').trim();
  if (!token) {
    console.log('AAU_AGENT_VERCEL_WRITE_PROBE', JSON.stringify({
      ok: false,
      reason: 'agent_token_not_configured',
    }));
    return;
  }

  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'content-type': 'application/json',
    'user-agent': 'AAU-Agent-Vercel-Write-Probe/0.1',
  };
  const teamId = String(process.env.VERCEL_AGENT_TEAM_ID || '').trim();
  const suffix = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const name = `aau-agent-token-write-probe-${Date.now()}`;

  let projectId = null;
  try {
    const createResponse = await fetch(`https://api.vercel.com/v11/projects${suffix}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    });
    let createBody = null;
    try { createBody = await createResponse.json(); } catch {}
    projectId = String(createBody?.id || '').trim() || null;

    let deleteStatus = null;
    if (createResponse.ok && projectId) {
      const deleteResponse = await fetch(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${suffix}`,
        { method: 'DELETE', headers },
      );
      deleteStatus = deleteResponse.status;
    }

    console.log('AAU_AGENT_VERCEL_WRITE_PROBE', JSON.stringify({
      ok: createResponse.ok && deleteStatus === 204,
      create_status: createResponse.status,
      created_project_id_present: Boolean(projectId),
      delete_status: deleteStatus,
      scope: teamId ? 'team' : 'personal',
      message: createBody?.error?.message || createBody?.message || null,
    }));
  } catch (error) {
    console.log('AAU_AGENT_VERCEL_WRITE_PROBE', JSON.stringify({
      ok: false,
      project_id_present: Boolean(projectId),
      error: String(error?.message || error),
    }));
  }
}
await probeAgentVercelWrite();


const brokerDisabled = ['1', 'true', 'yes'].includes(
  String(process.env.AAU_BROKER_DISABLED || '').trim().toLowerCase(),
);

if (brokerDisabled) {
  const { default: httpServer } = await import('node:http');
  const port = Number(process.env.PORT || 10000);
  const service = httpServer.createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'AAU Broker Bridge',
      mode: 'disabled_inert',
      broker_connected: false,
      credentials_required: false,
    }));
  });
  service.listen(port, '0.0.0.0', () => {
    console.log('AAU_BROKER_DISABLED_INERT', JSON.stringify({ port }));
  });
  await new Promise(() => {});
}

const required = [
  'AMQP_URL',
  'AAU_SUPABASE_ANON_KEY',
  'AAU_BROKER_BRIDGE_TOKEN',
  'AAU_GITHUB_TOKEN',
  'AAU_GITHUB_OWNER',
  // Vercel provider credentials are validated separately. Agent token is preferred
  // by the runtime and may operate in personal scope without a team id.
];

const missing = required.filter((key) => !String(process.env[key] || '').trim());
console.log('AAU_BROKER_CONFIG_STATUS', JSON.stringify({ ready: missing.length === 0, missing }));

const s3Required = [
  'SUPABASE_S3_ENDPOINT',
  'SUPABASE_S3_ACCESS_KEY_ID',
  'SUPABASE_S3_SECRET_ACCESS_KEY',
  'SUPABASE_S3_REGION',
  'SUPABASE_S3_BUCKET',
];
const s3Missing = s3Required.filter((key) => !String(process.env[key] || '').trim());

let endpointHost = null;
try {
  endpointHost = process.env.SUPABASE_S3_ENDPOINT
    ? new URL(process.env.SUPABASE_S3_ENDPOINT).host
    : null;
} catch {}

console.log('AAU_S3_CONFIG_STATUS', JSON.stringify({
  ready: s3Missing.length === 0,
  missing: s3Missing,
  endpoint_host: endpointHost,
  region: process.env.SUPABASE_S3_REGION || null,
  bucket: process.env.SUPABASE_S3_BUCKET || null,
  access_key_present: Boolean(String(process.env.SUPABASE_S3_ACCESS_KEY_ID || '').trim()),
  secret_key_present: Boolean(String(process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '').trim()),
}));

if (s3Missing.length === 0) {
  try {
    const s3 = new S3Client({
      endpoint: process.env.SUPABASE_S3_ENDPOINT,
      region: process.env.SUPABASE_S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
      },
    });

    const response = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.SUPABASE_S3_BUCKET,
      MaxKeys: 1,
    }));

    console.log('AAU_S3_CREDENTIAL_PROBE', JSON.stringify({
      ok: true,
      bucket: process.env.SUPABASE_S3_BUCKET,
      endpoint_host: endpointHost,
      region: process.env.SUPABASE_S3_REGION,
      http_status: response?.$metadata?.httpStatusCode || null,
      key_count: Array.isArray(response?.Contents) ? response.Contents.length : 0,
    }));
  } catch (error) {
    console.log('AAU_S3_CREDENTIAL_PROBE', JSON.stringify({
      ok: false,
      bucket: process.env.SUPABASE_S3_BUCKET || null,
      endpoint_host: endpointHost,
      region: process.env.SUPABASE_S3_REGION || null,
      error_name: error?.name || null,
      error_code: error?.Code || error?.code || null,
      http_status: error?.$metadata?.httpStatusCode || null,
      message: String(error?.message || error),
    }));
  }
}

if (process.env.AAU_GITHUB_TOKEN) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${process.env.AAU_GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'AAU-Broker-Bridge/0.3',
      },
    });
    let body = null;
    try { body = await response.json(); } catch {}
    console.log('AAU_GITHUB_TOKEN_PROBE', JSON.stringify({
      ok: response.ok,
      status: response.status,
      login: body?.login || null,
      configured_owner: process.env.AAU_GITHUB_OWNER || null,
      oauth_scopes: response.headers.get('x-oauth-scopes') || null,
      message: body?.message || null,
    }));
  } catch (error) {
    console.log('AAU_GITHUB_TOKEN_PROBE', JSON.stringify({ ok: false, error: String(error?.message || error) }));
  }
}



await import('./broker-bridge-render.js');
