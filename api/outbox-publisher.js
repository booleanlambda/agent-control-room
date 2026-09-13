import { randomUUID } from 'node:crypto';
import { publishOutboxBatch, publisherEnvState, publisherRuntimeReady, OUTBOX_PUBLISHER_VERSION } from '../lib/outbox-publisher.js';

function readBearer(req) {
  const value = req.headers?.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  return value.slice(7);
}

function requireAuth(req) {
  const expected = process.env.AAU_OUTBOX_PUBLISHER_SECRET;
  if (!expected) return { ok: false, status: 503, error: 'publisher_secret_not_configured' };
  if (readBearer(req) !== expected) return { ok: false, status: 401, error: 'unauthorized_publisher_caller' };
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const state = publisherEnvState();
    return res.status(200).json({
      ok: true,
      publisher: 'AAU Outbox Publisher',
      version: OUTBOX_PUBLISHER_VERSION,
      ready: publisherRuntimeReady() && Boolean(process.env.AAU_OUTBOX_PUBLISHER_SECRET),
      semantics: 'at-least-once',
      source_of_truth: 'postgresql',
      transport: 'rabbitmq',
      exchange: state.exchange,
      credentials: {
        supabase_service_role_configured: state.supabase_service_role,
        amqp_configured: state.amqp_url,
        publisher_secret_configured: Boolean(process.env.AAU_OUTBOX_PUBLISHER_SECRET),
      },
      vercel_env: process.env.VERCEL_ENV || null,
      deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const auth = requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
  if (!publisherRuntimeReady()) return res.status(503).json({ ok: false, error: 'outbox_publisher_not_ready' });

  const publisherId = `vercel:${process.env.VERCEL_DEPLOYMENT_ID || 'local'}:${randomUUID()}`;
  try {
    const result = await publishOutboxBatch({
      publisherId,
      limit: req.body?.limit ?? 25,
      leaseSeconds: req.body?.lease_seconds ?? 60,
    });
    return res.status(200).json({ ok: true, publisher_id: publisherId, ...result });
  } catch (error) {
    console.error('AAU Outbox Publisher error', error?.code || 'publisher_error', error?.message || error);
    return res.status(503).json({ ok: false, error: error?.code || 'publisher_error', message: String(error?.message || error) });
  }
}
