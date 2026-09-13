const DEFAULT_SUPABASE_URL = 'https://mgtilfgygzymxiyixjit.supabase.co';

class RouterError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(message);
    this.name = 'RouterError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function readBearer(req) {
  const value = req.headers?.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  return value.slice(7);
}

function envState() {
  return {
    supabase_service_role: Boolean(process.env.AAU_SUPABASE_SERVICE_ROLE_KEY),
    router_secret: Boolean(process.env.AAU_CAPABILITY_ROUTER_SECRET),
    supabase_url: process.env.AAU_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  };
}

function runtimeReady() {
  const state = envState();
  return state.supabase_service_role && state.router_secret;
}

function requireAuth(req) {
  const expected = process.env.AAU_CAPABILITY_ROUTER_SECRET;
  if (!expected) throw new RouterError('router_secret_not_configured', 'Capability Router secret is not configured.', 503);
  if (readBearer(req) !== expected) throw new RouterError('unauthorized_router_caller', 'Invalid Capability Router credential.', 401);
}

const SECRETISH_KEYS = /(?:^|_)(?:password|passwd|secret|token|private_key|service_role|api_key|access_key|refresh_token)(?:$|_)/i;
const SAFE_REFERENCE_KEYS = new Set(['credential_binding_ref','secret_ref','vault_secret_id']);

function payloadContainsSecretishKey(value, depth = 0) {
  if (depth > 12 || value == null) return false;
  if (Array.isArray(value)) return value.some((item) => payloadContainsSecretishKey(item, depth + 1));
  if (typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (!SAFE_REFERENCE_KEYS.has(key) && SECRETISH_KEYS.test(key)) return true;
    if (payloadContainsSecretishKey(child, depth + 1)) return true;
  }
  return false;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 2000) }; }
}

async function routeViaSupabase(body) {
  const serviceKey = process.env.AAU_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new RouterError('supabase_service_role_not_configured', 'Supabase service-role credential is not configured.', 503);
  const base = (process.env.AAU_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');

  let response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/aau_route_capability_request`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_agent_id: body.agent_id,
        p_capability_code: body.capability_code,
        p_payload: body.payload || {},
        p_construct_id: body.construct_id || null,
        p_idempotency_key: body.idempotency_key || null,
      }),
    });
  } catch (error) {
    throw new RouterError('supabase_network_error', String(error?.message || error), 503);
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    throw new RouterError('capability_route_failed', `Capability routing failed with ${response.status}.`, response.status >= 500 ? 503 : 400, data);
  }
  return data;
}

function validateBody(body) {
  if (!body || typeof body !== 'object') throw new RouterError('request_body_required', 'JSON body is required.', 400);
  if (typeof body.agent_id !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(body.agent_id)) throw new RouterError('invalid_agent_id', 'agent_id must be a UUID string.', 400);
  if (typeof body.capability_code !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,127}$/.test(body.capability_code)) throw new RouterError('invalid_capability_code', 'capability_code is invalid.', 400);
  if (body.construct_id != null && (typeof body.construct_id !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(body.construct_id))) throw new RouterError('invalid_construct_id', 'construct_id must be a UUID string.', 400);
  if (body.idempotency_key != null && (typeof body.idempotency_key !== 'string' || body.idempotency_key.length > 240)) throw new RouterError('invalid_idempotency_key', 'idempotency_key must be a string up to 240 characters.', 400);
  if (payloadContainsSecretishKey(body.payload || {})) throw new RouterError('secret_material_not_allowed', 'Capability payload appears to contain secret material. Pass a credential binding reference instead.', 400);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const state = envState();
    return res.status(200).json({
      ok: true,
      router: 'AAU Capability Router',
      version: 'v0_1',
      ready: runtimeReady(),
      contract: {
        sync_modes: ['sync_db','sync_runtime'],
        async_modes: ['async_queue','async_broker'],
        async_system_of_record: 'postgresql',
        async_transport: 'rabbitmq',
      },
      credentials: {
        supabase_service_role_configured: state.supabase_service_role,
        router_secret_configured: state.router_secret,
      },
      vercel_env: process.env.VERCEL_ENV || null,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  try {
    if (!runtimeReady()) throw new RouterError('capability_router_not_ready', 'Required router credentials are not configured.', 503);
    requireAuth(req);
    validateBody(req.body);

    const decision = await routeViaSupabase(req.body);
    return res.status(decision?.ok === false ? 403 : 200).json({
      ok: Boolean(decision?.ok),
      router: 'capability_router_v0_1',
      decision,
    });
  } catch (error) {
    const normalized = error instanceof RouterError ? error : new RouterError('capability_router_error', String(error?.message || error), 500);
    console.error('AAU Capability Router error', normalized.code, normalized.message);
    return res.status(normalized.status).json({
      ok: false,
      error: normalized.code,
      message: normalized.message,
    });
  }
}
