import http from 'node:http';
import process from 'node:process';
import amqp from 'amqplib';

const DEFAULT_SUPABASE_URL = 'https://mgtilfgygzymxiyixjit.supabase.co';
const DEFAULT_CONTROL_ROOM_BASE_URL = 'https://agent-control-room-ruddy.vercel.app';

const config = {
  amqpUrl: String(process.env.AMQP_URL || process.env.AMQP || '').trim(),
  supabaseUrl: String(process.env.AAU_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, ''),
  supabaseServiceRole: String(process.env.AAU_SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  executorSecret: String(process.env.AAU_BROKER_EXECUTOR_SECRET || '').trim(),
  controlRoomBaseUrl: String(process.env.AAU_CONTROL_ROOM_BASE_URL || DEFAULT_CONTROL_ROOM_BASE_URL).replace(/\/$/, ''),
  publisherId: String(process.env.AAU_BROKER_PUBLISHER_ID || `broker-bridge:${process.env.RENDER_INSTANCE_ID || process.pid}`),
  pollMs: Math.max(250, Number(process.env.AAU_OUTBOX_POLL_MS || 1500)),
  claimLimit: Math.min(100, Math.max(1, Number(process.env.AAU_OUTBOX_CLAIM_LIMIT || 25))),
  claimLeaseSeconds: Math.min(600, Math.max(10, Number(process.env.AAU_OUTBOX_LEASE_SECONDS || 60))),
  prefetch: Math.min(32, Math.max(1, Number(process.env.AAU_BROKER_PREFETCH || 4))),
  maxBridgeRetries: Math.min(10, Math.max(1, Number(process.env.AAU_BRIDGE_MAX_RETRIES || 5))),
  port: Math.max(1, Number(process.env.PORT || 10000)),
};

const queues = {
  github: 'aau.infrastructure.github',
  vercel: 'aau.infrastructure.vercel',
};

const state = {
  startedAt: new Date().toISOString(),
  rabbitConnected: false,
  sessionStartedAt: null,
  lastPublishAt: null,
  lastConsumeAt: null,
  lastError: null,
  publishedCount: 0,
  consumedCount: 0,
  succeededCount: 0,
  retryCount: 0,
  deadLetterCount: 0,
};

let shuttingDown = false;
let activeConnection = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredConfigMissing() {
  const missing = [];
  if (!config.amqpUrl) missing.push('AMQP_URL');
  if (!config.supabaseServiceRole) missing.push('AAU_SUPABASE_SERVICE_ROLE_KEY');
  if (!config.executorSecret) missing.push('AAU_BROKER_EXECUTOR_SECRET');
  return missing;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 4000) }; }
}

async function supabaseRpc(name, args) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseServiceRole,
      authorization: `Bearer ${config.supabaseServiceRole}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const body = await parseResponse(response);
  if (!response.ok) {
    const error = new Error(`Supabase RPC ${name} failed with ${response.status}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}

async function claimOutbox() {
  const rows = await supabaseRpc('aau_claim_runtime_outbox', {
    p_publisher_id: config.publisherId,
    p_limit: config.claimLimit,
    p_lease_seconds: config.claimLeaseSeconds,
  });
  return Array.isArray(rows) ? rows : [];
}

async function markOutboxPublished(event) {
  return supabaseRpc('aau_mark_runtime_outbox_published', {
    p_outbox_event_id: event.outbox_event_id,
    p_publisher_id: config.publisherId,
    p_message_id: event.message_id || event.outbox_event_id,
  });
}

async function markOutboxFailed(event, error) {
  try {
    await supabaseRpc('aau_mark_runtime_outbox_failed', {
      p_outbox_event_id: event.outbox_event_id,
      p_publisher_id: config.publisherId,
      p_error: String(error?.message || error).slice(0, 3500),
      p_retry_after_seconds: null,
    });
  } catch (recordError) {
    console.error('OUTBOX_FAILURE_RECORD_ERROR', String(recordError?.message || recordError));
  }
}

function eventEnvelope(event) {
  return {
    schema: 'aau.runtime.capability_event.v0_1',
    outbox_event_id: event.outbox_event_id,
    capability_invocation_id: event.capability_invocation_id,
    agent_id: event.agent_id,
    construct_id: event.construct_id,
    event_type: event.event_type,
    routing_key: event.routing_key,
    message_id: event.message_id || event.outbox_event_id,
    published_by: config.publisherId,
    published_at: new Date().toISOString(),
    payload: event.payload || {},
  };
}

async function publishClaimedEvents(channel) {
  const events = await claimOutbox();
  for (const event of events) {
    try {
      if (!event.routing_key || typeof event.routing_key !== 'string') throw new Error('outbox routing_key missing');
      await channel.assertQueue(event.routing_key, { durable: true });
      const envelope = eventEnvelope(event);
      channel.sendToQueue(event.routing_key, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        contentType: 'application/json',
        type: event.event_type || 'capability.requested',
        messageId: envelope.message_id,
        timestamp: Date.now(),
      });
      await channel.waitForConfirms();
      await markOutboxPublished(event);
      state.publishedCount += 1;
      state.lastPublishAt = new Date().toISOString();
      console.log('OUTBOX_PUBLISHED', envelope.message_id, event.routing_key);
    } catch (error) {
      state.lastError = String(error?.message || error);
      console.error('OUTBOX_PUBLISH_ERROR', event.outbox_event_id, state.lastError);
      await markOutboxFailed(event, error);
    }
  }
}

function provisionerUrl(provider) {
  if (provider === 'github') {
    return process.env.AAU_GITHUB_PROVISIONER_URL || `${config.controlRoomBaseUrl}/api/github-provisioner`;
  }
  if (provider === 'vercel') {
    return process.env.AAU_VERCEL_PROVISIONER_URL || `${config.controlRoomBaseUrl}/api/vercel-provisioner`;
  }
  throw new Error(`unsupported provider:${provider}`);
}

async function materializeBrokerJob(capabilityInvocationId, messageId) {
  return supabaseRpc('aau_materialize_infrastructure_broker_job', {
    p_capability_invocation_id: capabilityInvocationId,
    p_message_id: messageId || null,
  });
}

async function callProvisioner(provider, brokerJobId) {
  const response = await fetch(provisionerUrl(provider), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.executorSecret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ broker_job_id: brokerJobId }),
  });
  const body = await parseResponse(response);
  return { response, body };
}

function readRetryCount(msg) {
  const raw = msg?.properties?.headers?.['x-aau-bridge-retry'];
  const value = Number(raw || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

async function scheduleRetry(channel, sourceQueue, msg, reason) {
  const current = readRetryCount(msg);
  const next = current + 1;
  if (next > config.maxBridgeRetries) {
    await sendDeadLetter(channel, sourceQueue, msg, `bridge_retry_exhausted:${reason}`);
    return;
  }

  const retryQueue = `${sourceQueue}.retry`;
  const delayMs = Math.min(300_000, 15_000 * (2 ** Math.min(current, 4)));
  await channel.assertQueue(retryQueue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': sourceQueue,
    },
  });
  channel.sendToQueue(retryQueue, msg.content, {
    persistent: true,
    contentType: msg.properties.contentType || 'application/json',
    type: msg.properties.type || 'capability.requested',
    messageId: msg.properties.messageId,
    expiration: String(delayMs),
    headers: {
      ...(msg.properties.headers || {}),
      'x-aau-bridge-retry': next,
      'x-aau-last-error': String(reason || 'retry').slice(0, 500),
    },
  });
  await channel.waitForConfirms();
  channel.ack(msg);
  state.retryCount += 1;
  console.warn('BROKER_RETRY_SCHEDULED', msg.properties.messageId || '-', sourceQueue, next, delayMs);
}

async function sendDeadLetter(channel, sourceQueue, msg, reason) {
  const deadQueue = `${sourceQueue}.dead`;
  await channel.assertQueue(deadQueue, { durable: true });
  channel.sendToQueue(deadQueue, msg.content, {
    persistent: true,
    contentType: msg.properties.contentType || 'application/json',
    type: 'aau.broker.dead_letter',
    messageId: msg.properties.messageId,
    headers: {
      ...(msg.properties.headers || {}),
      'x-aau-dead-letter-reason': String(reason || 'unknown').slice(0, 1000),
      'x-aau-dead-lettered-at': new Date().toISOString(),
    },
  });
  await channel.waitForConfirms();
  channel.ack(msg);
  state.deadLetterCount += 1;
  console.error('BROKER_DEAD_LETTER', msg.properties.messageId || '-', sourceQueue, reason);
}

function capabilityInvocationIdFrom(envelope) {
  return envelope?.payload?.capability_invocation_id
    || envelope?.capability_invocation_id
    || null;
}

async function handleBrokerMessage(channel, sourceQueue, msg) {
  if (!msg) return;
  state.consumedCount += 1;
  state.lastConsumeAt = new Date().toISOString();

  let envelope;
  try {
    envelope = JSON.parse(msg.content.toString('utf8'));
  } catch (error) {
    await sendDeadLetter(channel, sourceQueue, msg, 'invalid_json');
    return;
  }

  const invocationId = capabilityInvocationIdFrom(envelope);
  const messageId = envelope?.message_id || msg.properties.messageId || null;
  if (!invocationId) {
    await sendDeadLetter(channel, sourceQueue, msg, 'capability_invocation_id_missing');
    return;
  }

  let materialized;
  try {
    materialized = await materializeBrokerJob(invocationId, messageId);
  } catch (error) {
    const status = Number(error?.status || 0);
    const detailText = JSON.stringify(error?.details || {});
    if (status >= 400 && status < 500 && !/timeout|temporar|network/i.test(detailText)) {
      await sendDeadLetter(channel, sourceQueue, msg, `materialize_nonretryable:${error.message}`);
    } else {
      await scheduleRetry(channel, sourceQueue, msg, `materialize:${error.message}`);
    }
    return;
  }

  const jobStatus = materialized?.job_status;
  if (jobStatus === 'succeeded') {
    channel.ack(msg);
    state.succeededCount += 1;
    console.log('BROKER_DUPLICATE_ALREADY_SUCCEEDED', messageId, materialized.broker_job_id);
    return;
  }
  if (['failed', 'dead_lettered', 'cancelled'].includes(jobStatus)) {
    await sendDeadLetter(channel, sourceQueue, msg, `terminal_job_status:${jobStatus}`);
    return;
  }
  if (jobStatus !== 'queued') {
    await scheduleRetry(channel, sourceQueue, msg, `job_not_ready:${jobStatus}`);
    return;
  }

  const provider = materialized?.provider;
  const brokerJobId = materialized?.broker_job_id;
  if (!provider || !brokerJobId) {
    await sendDeadLetter(channel, sourceQueue, msg, 'materialized_job_incomplete');
    return;
  }

  try {
    const { response, body } = await callProvisioner(provider, brokerJobId);
    if (response.ok && body?.ok === true) {
      channel.ack(msg);
      state.succeededCount += 1;
      console.log('BROKER_JOB_SUCCEEDED', messageId, provider, brokerJobId);
      return;
    }

    const retryable = Boolean(body?.retryable) || response.status === 429 || response.status >= 500;
    const reason = `provisioner_${response.status}:${body?.error || body?.message || 'failed'}`;
    if (retryable) await scheduleRetry(channel, sourceQueue, msg, reason);
    else await sendDeadLetter(channel, sourceQueue, msg, reason);
  } catch (error) {
    await scheduleRetry(channel, sourceQueue, msg, `provisioner_network:${error.message}`);
  }
}

async function setupConsumers(channel) {
  await channel.prefetch(config.prefetch);
  for (const queue of Object.values(queues)) {
    await channel.assertQueue(queue, { durable: true });
    await channel.assertQueue(`${queue}.dead`, { durable: true });
    await channel.consume(queue, (msg) => {
      void handleBrokerMessage(channel, queue, msg).catch(async (error) => {
        state.lastError = String(error?.message || error);
        console.error('BROKER_HANDLER_UNCAUGHT', queue, state.lastError);
        if (msg) {
          try { await scheduleRetry(channel, queue, msg, state.lastError); }
          catch { try { channel.nack(msg, false, true); } catch {} }
        }
      });
    }, { noAck: false });
  }
}

async function runRabbitSession() {
  const connection = await amqp.connect(config.amqpUrl, { timeout: 10_000 });
  activeConnection = connection;
  state.rabbitConnected = true;
  state.sessionStartedAt = new Date().toISOString();
  state.lastError = null;
  console.log('RABBITMQ_CONNECTED', state.sessionStartedAt);

  const publishChannel = await connection.createConfirmChannel();
  const consumeChannel = await connection.createConfirmChannel();
  await setupConsumers(consumeChannel);

  let sessionClosed = false;
  const closePromise = new Promise((resolve) => {
    connection.once('close', () => {
      sessionClosed = true;
      resolve();
    });
    connection.on('error', (error) => {
      state.lastError = String(error?.message || error);
      console.error('RABBITMQ_ERROR', state.lastError);
    });
  });

  const publisherLoop = (async () => {
    while (!shuttingDown && !sessionClosed) {
      try {
        await publishClaimedEvents(publishChannel);
      } catch (error) {
        state.lastError = String(error?.message || error);
        console.error('OUTBOX_LOOP_ERROR', state.lastError);
      }
      await sleep(config.pollMs);
    }
  })();

  await closePromise;
  state.rabbitConnected = false;
  activeConnection = null;
  await publisherLoop.catch(() => {});
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not_found' }));
      return;
    }
    const missing = requiredConfigMissing();
    const healthy = missing.length === 0 && state.rabbitConnected;
    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: healthy,
      service: 'AAU Broker Bridge',
      version: 'v0_1',
      rabbit_connected: state.rabbitConnected,
      config_ready: missing.length === 0,
      missing_config: missing,
      queues,
      state,
    }));
  });
  server.listen(config.port, '0.0.0.0', () => console.log('HEALTH_SERVER_LISTENING', config.port));
  return server;
}

async function main() {
  const healthServer = startHealthServer();
  const missing = requiredConfigMissing();
  if (missing.length) {
    console.error('BROKER_BRIDGE_CONFIG_MISSING', missing.join(','));
  }

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('BROKER_BRIDGE_SHUTDOWN', signal);
    try { await activeConnection?.close(); } catch {}
    healthServer.close();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  while (!shuttingDown) {
    const nowMissing = requiredConfigMissing();
    if (nowMissing.length) {
      await sleep(10_000);
      continue;
    }
    try {
      await runRabbitSession();
    } catch (error) {
      state.rabbitConnected = false;
      state.lastError = String(error?.message || error);
      console.error('BROKER_SESSION_ERROR', state.lastError);
    }
    if (!shuttingDown) await sleep(5_000);
  }
}

main().catch((error) => {
  console.error('BROKER_BRIDGE_FATAL', String(error?.stack || error));
  process.exitCode = 1;
});
