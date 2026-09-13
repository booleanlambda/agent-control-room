import amqp from 'amqplib';

export const OUTBOX_PUBLISHER_VERSION = 'v0_1';
export const DEFAULT_SUPABASE_URL = 'https://mgtilfgygzymxiyixjit.supabase.co';
export const DEFAULT_EXCHANGE = 'aau.events.v1';

export class OutboxPublisherError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'OutboxPublisherError';
    this.code = code;
    this.details = details;
  }
}

export function normalizeAmqpUrl(raw) {
  let value = String(raw ?? '').trim();
  value = value.replace(/^AMQP(?:_URL)?\s*=\s*/i, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

export function publisherEnvState() {
  const amqpUrl = normalizeAmqpUrl(
    process.env.AAU_AMQP_URL || process.env.AMQP_URL || process.env.AMQP || ''
  );
  return {
    supabase_service_role: Boolean(process.env.AAU_SUPABASE_SERVICE_ROLE_KEY),
    amqp_url: Boolean(amqpUrl),
    exchange: process.env.AAU_RABBITMQ_EXCHANGE || DEFAULT_EXCHANGE,
    supabase_url: process.env.AAU_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  };
}

export function publisherRuntimeReady() {
  const state = publisherEnvState();
  return state.supabase_service_role && state.amqp_url;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 2000) }; }
}

async function supabaseRpc(name, payload) {
  const serviceKey = process.env.AAU_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new OutboxPublisherError('supabase_service_role_not_configured', 'Supabase service-role credential is not configured.');
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
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new OutboxPublisherError('supabase_network_error', String(error?.message || error));
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    throw new OutboxPublisherError('supabase_rpc_failed', `${name} failed with HTTP ${response.status}.`, data);
  }
  return data;
}

async function claimBatch(publisherId, limit, leaseSeconds) {
  const data = await supabaseRpc('aau_claim_runtime_outbox', {
    p_publisher_id: publisherId,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  return Array.isArray(data) ? data : [];
}

async function markPublished(event, publisherId) {
  return supabaseRpc('aau_mark_runtime_outbox_published', {
    p_outbox_event_id: event.outbox_event_id,
    p_publisher_id: publisherId,
    p_message_id: event.message_id || event.outbox_event_id,
  });
}

async function markFailed(event, publisherId, errorMessage, retryAfterSeconds = null) {
  try {
    return await supabaseRpc('aau_mark_runtime_outbox_failed', {
      p_outbox_event_id: event.outbox_event_id,
      p_publisher_id: publisherId,
      p_error: String(errorMessage || 'publish failed').slice(0, 4000),
      p_retry_after_seconds: retryAfterSeconds,
    });
  } catch {
    // If Postgres cannot be reached, keep the lease. It will expire and become reclaimable.
    return 'lease_retained';
  }
}

function buildEnvelope(event, publisherId) {
  return {
    schema: 'aau.event.v1',
    outbox_event_id: event.outbox_event_id,
    message_id: event.message_id || event.outbox_event_id,
    capability_invocation_id: event.capability_invocation_id,
    agent_id: event.agent_id,
    construct_id: event.construct_id || null,
    event_type: event.event_type,
    routing_key: event.routing_key,
    attempt: event.attempt_count,
    payload: event.payload || {},
    publisher_id: publisherId,
    emitted_at: new Date().toISOString(),
  };
}

export async function publishOutboxBatch({
  publisherId,
  limit = 25,
  leaseSeconds = 60,
  connectTimeoutMs = 10000,
} = {}) {
  if (!publisherRuntimeReady()) {
    throw new OutboxPublisherError('outbox_publisher_not_ready', 'Required Supabase and RabbitMQ credentials are not configured.');
  }
  if (!publisherId || typeof publisherId !== 'string') {
    throw new OutboxPublisherError('publisher_id_required', 'publisherId is required.');
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const safeLease = Math.max(10, Math.min(600, Number(leaseSeconds) || 60));
  const claimed = await claimBatch(publisherId, safeLimit, safeLease);
  if (!claimed.length) {
    return { claimed: 0, published: 0, failed: 0, dead_or_failed: [], message_ids: [] };
  }

  const amqpUrl = normalizeAmqpUrl(
    process.env.AAU_AMQP_URL || process.env.AMQP_URL || process.env.AMQP || ''
  );
  const exchange = process.env.AAU_RABBITMQ_EXCHANGE || DEFAULT_EXCHANGE;
  const returned = new Set();
  const publishedIds = [];
  const failed = [];
  let connection;
  let channel;

  try {
    connection = await amqp.connect(amqpUrl, { timeout: connectTimeoutMs });
    channel = await connection.createConfirmChannel();
    await channel.assertExchange(exchange, 'topic', { durable: true });
    channel.on('return', (msg) => {
      const id = msg?.properties?.messageId;
      if (id) returned.add(String(id));
    });

    for (let index = 0; index < claimed.length; index += 1) {
      const event = claimed[index];
      const messageId = event.message_id || event.outbox_event_id;
      try {
        const envelope = buildEnvelope(event, publisherId);
        channel.publish(
          exchange,
          event.routing_key,
          Buffer.from(JSON.stringify(envelope)),
          {
            persistent: true,
            mandatory: true,
            contentType: 'application/json',
            contentEncoding: 'utf-8',
            messageId,
            type: event.event_type,
            timestamp: Math.floor(Date.now() / 1000),
            headers: {
              'x-aau-agent-id': event.agent_id,
              'x-aau-invocation-id': event.capability_invocation_id,
              'x-aau-construct-id': event.construct_id || '',
              'x-aau-attempt': event.attempt_count,
            },
          }
        );
        await channel.waitForConfirms();
        await new Promise((resolve) => setImmediate(resolve));

        if (returned.has(String(messageId))) {
          throw new OutboxPublisherError('rabbitmq_unroutable', `No RabbitMQ queue accepted routing key ${event.routing_key}.`);
        }

        const marked = await markPublished(event, publisherId);
        if (marked !== true) {
          throw new OutboxPublisherError('publish_mark_rejected', 'RabbitMQ confirmed the event but Postgres did not accept the publish acknowledgement.');
        }
        publishedIds.push(messageId);
      } catch (error) {
        const errorMessage = `${error?.code || 'publish_error'}: ${error?.message || error}`;
        const state = await markFailed(event, publisherId, errorMessage);
        failed.push({ outbox_event_id: event.outbox_event_id, state, error: errorMessage.slice(0, 500) });

        // A broken AMQP channel makes subsequent confirms unsafe. Release the remaining leases.
        if (!channel || channel.connection?.connection?.stream?.destroyed) {
          for (const remainder of claimed.slice(index + 1)) {
            const remainderState = await markFailed(remainder, publisherId, 'publisher_aborted_after_broker_error', 5);
            failed.push({ outbox_event_id: remainder.outbox_event_id, state: remainderState, error: 'publisher_aborted_after_broker_error' });
          }
          break;
        }
      }
    }
  } catch (error) {
    const errorMessage = `${error?.code || 'rabbitmq_connection_error'}: ${error?.message || error}`;
    for (const event of claimed) {
      if (publishedIds.includes(event.message_id || event.outbox_event_id)) continue;
      if (failed.some((item) => item.outbox_event_id === event.outbox_event_id)) continue;
      const state = await markFailed(event, publisherId, errorMessage, 5);
      failed.push({ outbox_event_id: event.outbox_event_id, state, error: errorMessage.slice(0, 500) });
    }
  } finally {
    try { if (channel) await channel.close(); } catch {}
    try { if (connection) await connection.close(); } catch {}
  }

  return {
    claimed: claimed.length,
    published: publishedIds.length,
    failed: failed.length,
    dead_or_failed: failed,
    message_ids: publishedIds,
  };
}
