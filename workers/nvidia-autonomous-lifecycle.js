import amqp from 'amqplib';
import crypto from 'node:crypto';
import { runNvidiaIntentExecution } from './nvidia-intent-execution.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const serviceRole = String(process.env.AAU_SUPABASE_SERVICE_ROLE_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const MAIN_QUEUE = 'aau.intent';
const LEGACY_QUEUE = 'aau.wake';
const ARM_POLL_MS = Math.max(1000, Number(process.env.AAU_AUTONOMOUS_INTENT_ARM_POLL_MS || process.env.AAU_AUTONOMOUS_WAKE_ARM_POLL_MS || 3000));
const HEARTBEAT_MS = Math.max(10000, Number(process.env.AAU_AUTONOMOUS_INTENT_HEARTBEAT_MS || process.env.AAU_AUTONOMOUS_WAKE_HEARTBEAT_MS || 30000));

function normalizeAmqp(raw) {
  let value = String(raw || '').trim().replace(/^AMQP(?:_URL)?\s*=\s*/i, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1).trim();
  return value;
}

const amqpUrl = normalizeAmqp(process.env.AMQP_URL || process.env.AMQP || '');
const workerId = String(process.env.AAU_AUTONOMOUS_INTENT_WORKER_ID || process.env.AAU_AUTONOMOUS_WAKE_WORKER_ID || `render:nvidia-intent-lifecycle:${process.env.RENDER_INSTANCE_ID || process.pid}`).trim();

async function rpc(name, args = {}) {
  if (!serviceRole || !bridge) throw new Error('missing_internal_scheduler_supabase_credentials');
  const response = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_bridge_token: bridge, ...args }),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const error = new Error(`${name}:${response.status}:${typeof body === 'string' ? body.slice(0,500) : JSON.stringify(body).slice(0,500)}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}

function delayQueueName(intentExecutionId) {
  return `aau.intent.delay.${String(intentExecutionId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function intentEnvelope(row, delayQueue = null) {
  return {
    schema: 'aau.next_intent.v0_1',
    type: 'autonomous_intent',
    message_id: crypto.randomUUID(),
    intent_execution_id: row.intent_execution_id,
    agent_id: row.agent_id,
    lifecycle_run_id: row.run_id,
    execute_at: row.execute_at,
    delay_queue: delayQueue,
    created_at: new Date().toISOString(),
  };
}

async function publishArmedIntent(channel, row) {
  const due = row.execute_at ? new Date(row.execute_at).getTime() : Date.now();
  const delayMs = Math.max(0, due - Date.now());
  let delayQueue = null;
  const envelope = intentEnvelope(row);

  await channel.assertQueue(MAIN_QUEUE, { durable: true });

  if (delayMs > 1000) {
    delayQueue = delayQueueName(row.intent_execution_id);
    envelope.delay_queue = delayQueue;
    await channel.assertQueue(delayQueue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': MAIN_QUEUE,
      },
    });
    channel.sendToQueue(delayQueue, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      expiration: String(Math.max(1, Math.ceil(delayMs))),
      messageId: envelope.message_id,
      contentType: 'application/json',
      type: 'autonomous_intent',
    });
  } else {
    channel.sendToQueue(MAIN_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      messageId: envelope.message_id,
      contentType: 'application/json',
      type: 'autonomous_intent',
    });
  }

  await channel.waitForConfirms();
  await rpc('aau_bridge_mark_autonomous_intent_armed', {
    p_intent_execution_id: row.intent_execution_id,
    p_worker_id: workerId,
    p_message_id: envelope.message_id,
    p_delay_queue: delayQueue,
  });

  console.log('AAU_AUTONOMOUS_INTENT_ARMED', JSON.stringify({
    intent_execution_id: row.intent_execution_id,
    agent_id: row.agent_id,
    execute_at: row.execute_at,
    delay_ms: delayMs,
    delay_queue: delayQueue,
    message_id: envelope.message_id,
  }));
}

async function armPending(channel) {
  const rows = await rpc('aau_bridge_claim_unarmed_autonomous_intents', {
    p_worker_id: workerId,
    p_limit: 12,
  });
  for (const row of Array.isArray(rows) ? rows : []) {
    try {
      await publishArmedIntent(channel, row);
    } catch (error) {
      await rpc('aau_bridge_release_autonomous_intent_arm_claim', {
        p_intent_execution_id: row.intent_execution_id,
        p_worker_id: workerId,
        p_error: String(error?.message || error).slice(0,1200),
      }).catch(() => {});
      console.error('AAU_AUTONOMOUS_INTENT_ARM_FAILED', row.intent_execution_id, String(error?.message || error));
    }
  }
}

async function heartbeat() {
  try {
    const result = await rpc('aau_bridge_autonomous_worker_heartbeat', {
      p_worker_id: workerId,
      p_queue_name: MAIN_QUEUE,
    });
    console.log('AAU_AUTONOMOUS_INTENT_HEARTBEAT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_AUTONOMOUS_INTENT_HEARTBEAT_FAILED', String(error?.message || error));
  }
}

function normalizeEnvelope(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'autonomous_intent' && event.intent_execution_id && event.agent_id) {
    return {
      intent_execution_id: event.intent_execution_id,
      agent_id: event.agent_id,
      delay_queue: event.delay_queue || null,
      legacy: false,
    };
  }
  if (event.type === 'autonomous_wake' && event.wake_request_id && event.agent_id) {
    return {
      intent_execution_id: event.wake_request_id,
      agent_id: event.agent_id,
      delay_queue: event.delay_queue || null,
      legacy: true,
    };
  }
  return null;
}

async function handleIntent(channel, msg) {
  if (!msg) return;
  let raw = null;
  try { raw = JSON.parse(msg.content.toString('utf8')); } catch {}
  const event = normalizeEnvelope(raw);

  if (!event) {
    console.warn('AAU_AUTONOMOUS_INTENT_UNSUPPORTED_MESSAGE', JSON.stringify({
      message_id: msg.properties?.messageId || null,
      type: raw?.type || msg.properties?.type || null,
    }));
    channel.ack(msg);
    return;
  }

  try {
    const report = await runNvidiaIntentExecution({
      intentExecutionId: event.intent_execution_id,
      agentId: event.agent_id,
      workerId,
    });

    if (event.delay_queue) await channel.deleteQueue(event.delay_queue).catch(() => {});
    channel.ack(msg);
    console.log('AAU_AUTONOMOUS_INTENT_CONSUMED', JSON.stringify({
      intent_execution_id: event.intent_execution_id,
      agent_id: event.agent_id,
      selected_action: report?.selected_action || null,
      next_intents: report?.next_intents || [],
      legacy_envelope: event.legacy,
    }));
  } catch (error) {
    const message = String(error?.message || error);
    await rpc('aau_bridge_reset_autonomous_intent_arm', {
      p_intent_execution_id: event.intent_execution_id,
      p_worker_id: workerId,
      p_error: message.slice(0,1200),
    }).catch(() => {});
    if (event.delay_queue) await channel.deleteQueue(event.delay_queue).catch(() => {});
    channel.ack(msg);
    console.error('AAU_AUTONOMOUS_INTENT_CONSUME_FAILED', event.intent_execution_id, message);
  }
}

export async function startNvidiaAutonomousLifecycle() {
  if (!amqpUrl) throw new Error('AMQP_URL is not configured');
  if (!serviceRole || !bridge) throw new Error('AAU internal scheduler Supabase credentials are not configured');

  const connection = await amqp.connect(amqpUrl, { timeout: 10000 });
  const channel = await connection.createConfirmChannel();
  await channel.assertQueue(MAIN_QUEUE, { durable: true });
  await channel.assertQueue(LEGACY_QUEUE, { durable: true });
  await channel.prefetch(1);

  connection.on('error', (error) => console.error('AAU_AUTONOMOUS_INTENT_RABBIT_ERROR', String(error?.message || error)));
  connection.on('close', () => console.error('AAU_AUTONOMOUS_INTENT_RABBIT_CLOSED'));

  await heartbeat();
  await armPending(channel);

  await channel.consume(MAIN_QUEUE, (msg) => {
    void handleIntent(channel, msg);
  }, { noAck: false });

  await channel.consume(LEGACY_QUEUE, (msg) => {
    void handleIntent(channel, msg);
  }, { noAck: false });

  console.log('AAU_AUTONOMOUS_INTENT_CONSUMER_BOUND', JSON.stringify({
    queue: MAIN_QUEUE,
    legacy_drain_queue: LEGACY_QUEUE,
    worker_id: workerId,
    protocol: 'next_intent_protocol_v0_1',
  }));

  const armTimer = setInterval(() => void armPending(channel).catch((e) => console.error('AAU_AUTONOMOUS_INTENT_ARM_SCAN_FAILED', String(e?.message || e))), ARM_POLL_MS);
  const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_MS);

  const stop = async () => {
    clearInterval(armTimer);
    clearInterval(heartbeatTimer);
    await rpc('aau_bridge_autonomous_worker_offline', { p_worker_id: workerId }).catch(() => {});
    try { await channel.close(); } catch {}
    try { await connection.close(); } catch {}
  };

  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());

  return { ok: true, queue: MAIN_QUEUE, legacy_drain_queue: LEGACY_QUEUE, worker_id: workerId, protocol: 'next_intent_protocol_v0_1', supabase_rpc_role: 'service_role' };
}
