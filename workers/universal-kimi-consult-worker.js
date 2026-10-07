import { moonshotChatCompletion, moonshotConfigStatus } from './providers/moonshot.js';

const SB = String(
  process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co'
).replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();

const executorId =
  `render:universal-kimi-consult:${process.env.RENDER_INSTANCE_ID || process.pid}`;
const pollMs = Math.max(
  1500,
  Math.min(60000, Number(process.env.AAU_KIMI_CONSULT_POLL_MS || 3000)),
);
const timeoutMs = Math.max(
  30000,
  Math.min(300000, Number(process.env.AAU_KIMI_CONSULT_TIMEOUT_MS || 180000)),
);

let running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function jsonResponse(response) {
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch {}
  return { raw, body };
}

async function rpc(name, args = {}) {
  const response = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      authorization: `Bearer ${anon}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_bridge_token: bridge, ...args }),
    signal: AbortSignal.timeout(30000),
  });

  const { raw, body } = await jsonResponse(response);
  if (!response.ok) {
    const error = new Error(
      `${name}:${response.status}:${body?.message || raw.slice(0,800)}`,
    );
    error.status = response.status;
    throw error;
  }
  return body;
}

function retryableModelError(error) {
  const status = Number(error?.providerStatusCode || error?.status || 0);
  if (error?.code === 'MODEL_TIMEOUT') return true;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true;
  if (status === 429 || status >= 500) return true;
  if (/network|fetch|socket|timeout|temporar/i.test(String(error?.message || error))) return true;
  return false;
}

async function askKimi(job) {
  const started = Date.now();
  const result = await moonshotChatCompletion({
    model: 'kimi-k3',
    messages: [
      { role: 'system', content: String(job.system_prompt || '') },
      { role: 'user', content: String(job.user_prompt || '') },
    ],
    maxTokens: Math.max(128, Math.min(8192, Number(job.max_tokens || 2400))),
    jsonMode: job.json_mode === true,
    reasoningEffort: ['low','high','max'].includes(String(job.reasoning_effort || '').toLowerCase())
      ? String(job.reasoning_effort).toLowerCase()
      : 'low',
    timeoutMs,
    idempotencyKey: `aau-kimi-consult:${job.kimi_consult_request_id}`,
  });

  const finalText = String(result.content || '').trim();
  if (!finalText) {
    const error = new Error('kimi_consult_empty_final_content');
    error.code = 'KIMI_CONSULT_EMPTY_FINAL';
    throw error;
  }
  if (result.finish_reason && result.finish_reason !== 'stop') {
    const error = new Error(`kimi_consult_incomplete_finish_reason:${result.finish_reason}`);
    error.code = 'KIMI_CONSULT_INCOMPLETE';
    throw error;
  }

  return {
    responseText: finalText,
    modelUsed: result.model_returned || result.model_requested || 'kimi-k3',
    finishReason: result.finish_reason || null,
    usage: result.usage || null,
    latencyMs: Date.now() - started,
  };
}

async function processOne(job) {
  try {
    const result = await askKimi(job);
    await rpc('aau_bridge_complete_kimi_consult', {
      p_kimi_consult_request_id: job.kimi_consult_request_id,
      p_executor_id: executorId,
      p_response_text: result.responseText,
      p_model_used: result.modelUsed,
      p_finish_reason: result.finishReason,
      p_usage: result.usage,
      p_latency_ms: result.latencyMs,
    });

    console.log('AAU_KIMI_CONSULT_COMPLETE', JSON.stringify({
      request_id: job.kimi_consult_request_id,
      label: job.label || null,
      requester: job.requester || null,
      model_used: result.modelUsed,
      finish_reason: result.finishReason,
      latency_ms: result.latencyMs,
      usage: result.usage || null,
    }));
  } catch (error) {
    const retryable = retryableModelError(error);
    console.error('AAU_KIMI_CONSULT_FAILED', JSON.stringify({
      request_id: job.kimi_consult_request_id,
      label: job.label || null,
      attempt_count: job.attempt_count || null,
      retryable,
      code: error?.code || error?.name || 'error',
      status: error?.status || error?.providerStatusCode || null,
      message: String(error?.message || error).slice(0,1200),
    }));

    await rpc('aau_bridge_fail_kimi_consult', {
      p_kimi_consult_request_id: job.kimi_consult_request_id,
      p_executor_id: executorId,
      p_error_code: error?.code || error?.name || 'kimi_consult_error',
      p_error_message: String(error?.message || error),
      p_retryable: retryable,
    }).catch((recordError) => {
      console.error(
        'AAU_KIMI_CONSULT_FAILURE_RECORD_ERROR',
        String(recordError?.message || recordError).slice(0,800),
      );
    });
  }
}

async function loop() {
  while (running) {
    try {
      const rows = await rpc('aau_bridge_claim_kimi_consult', {
        p_executor_id: executorId,
        p_lease_seconds: Math.ceil(timeoutMs / 1000) + 60,
      });
      const job = Array.isArray(rows) ? rows[0] : null;
      if (job) {
        await processOne(job);
        continue;
      }
    } catch (error) {
      console.error(
        'AAU_KIMI_CONSULT_LOOP_ERROR',
        String(error?.message || error).slice(0,1200),
      );
    }
    await sleep(pollMs);
  }
}

export function universalKimiConsultStatus() {
  let moonshot = null;
  try { moonshot = moonshotConfigStatus(); } catch {}
  const missing = [
    ['AAU_SUPABASE_ANON_KEY', anon],
    ['AAU_BROKER_BRIDGE_TOKEN', bridge],
    ['MOONSHOT_RUNTIME', moonshot?.ready ? 'ready' : ''],
  ].filter(([, value]) => !value).map(([name]) => name);

  return {
    ok: missing.length === 0,
    ready: missing.length === 0,
    running,
    missing,
    executor_id: executorId,
    poll_ms: pollMs,
    timeout_ms: timeoutMs,
    model: 'kimi-k3',
    provider: 'moonshot_direct',
    protocol_version: 'universal_kimi_consult_v0_1',
    hidden_reasoning_persisted: false,
  };
}

export function startUniversalKimiConsultWorker() {
  const status = universalKimiConsultStatus();
  if (!status.ready) return status;

  if (!running) {
    running = true;
    loop().catch((error) => {
      running = false;
      console.error(
        'AAU_KIMI_CONSULT_FATAL',
        String(error?.stack || error).slice(0,2000),
      );
    });
  }

  return universalKimiConsultStatus();
}
