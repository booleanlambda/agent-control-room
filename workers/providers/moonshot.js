const DEFAULT_TIMEOUT_MS = 180000;

function clean(value) {
  return String(value || '').trim();
}

function resolveEndpoint(rawValue) {
  const raw = clean(rawValue).replace(/\/+$/, '');
  if (!raw) return '';
  if (/\/chat\/completions$/i.test(raw)) return raw;
  return raw + '/chat/completions';
}

function resolveConfig() {
  const apiKey = clean(process.env.MOONSHOT_APIKEY);
  const model = clean(process.env.MOONSHOT_ID);
  const endpoint = resolveEndpoint(process.env.MOONSHOT_ENDPOINT);
  return { apiKey, model, endpoint };
}

function resolveTimeoutMs(value) {
  const n = Number(value ?? process.env.AAU_MOONSHOT_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(5000, Math.min(Math.floor(n), 900000));
}

export function moonshotConfigStatus() {
  const config = resolveConfig();
  let endpointHost = null;
  let endpointPath = null;
  try {
    const parsed = new URL(config.endpoint);
    endpointHost = parsed.host;
    endpointPath = parsed.pathname;
  } catch {}
  return {
    ready: Boolean(config.apiKey && config.model && config.endpoint),
    api_key_present: Boolean(config.apiKey),
    model: config.model || null,
    endpoint_host: endpointHost,
    endpoint_path: endpointPath,
    timeout_ms: resolveTimeoutMs(),
    mode: 'experimental_only',
    secret_values_exposed: false,
  };
}

export async function moonshotChatCompletion({
  messages,
  model,
  maxTokens = 6000,
  temperature = 0.2,
  jsonMode = null,
  enableThinking = null,
  timeoutMs = null,
} = {}) {
  const config = resolveConfig();
  if (!config.apiKey) throw new Error('MOONSHOT_APIKEY is not configured');
  if (!config.endpoint) throw new Error('MOONSHOT_ENDPOINT is not configured');
  if (!config.model && !clean(model)) throw new Error('MOONSHOT_ID is not configured');
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages are required');

  const resolvedModel = clean(model) || config.model;
  const resolvedMaxTokens = Math.max(1, Math.min(32768, Math.floor(Number(maxTokens) || 6000)));
  const requestBody = {
    model: resolvedModel,
    messages,
    max_tokens: resolvedMaxTokens,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
    stream: false,
  };

  // Moonshot's endpoint is OpenAI-compatible. JSON mode is requested when
  // AAU needs a structured cognition packet. We deliberately do not invent a
  // provider-specific thinking flag: the bound model decides its own reasoning
  // behavior unless a verified Moonshot transport contract is added later.
  if (jsonMode === true) requestBody.response_format = { type: 'json_object' };

  const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs);
  let response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'AAU-Moonshot-Direct-Experimental-Adapter/1.0',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(resolvedTimeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeoutError = new Error('moonshot_timeout_after_' + resolvedTimeoutMs + 'ms');
      timeoutError.code = 'MODEL_TIMEOUT';
      timeoutError.provider = 'moonshot_direct';
      throw timeoutError;
    }
    error.provider = 'moonshot_direct';
    throw error;
  }

  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || raw.slice(0, 1000) || ('HTTP ' + response.status);
    const error = new Error('moonshot_provider_http_' + response.status + ': ' + detail);
    error.code = 'MODEL_HTTP_ERROR';
    error.status = response.status;
    error.provider = 'moonshot_direct';
    error.providerStatusCode = response.status;
    throw error;
  }

  const message = body?.choices?.[0]?.message || {};
  const content = typeof message?.content === 'string' ? message.content : '';
  const reasoningContent = typeof message?.reasoning_content === 'string'
    ? message.reasoning_content
    : '';

  return {
    provider: 'moonshot_direct',
    model_requested: resolvedModel,
    model_returned: typeof body?.model === 'string' && body.model.trim()
      ? body.model.trim()
      : resolvedModel,
    content,
    reasoning_content: reasoningContent,
    finish_reason: body?.choices?.[0]?.finish_reason || null,
    usage: body?.usage || null,
    response_id: body?.id || null,
    runtime_contract: {
      version: 'moonshot_direct_experimental_v0_1',
      requested_output_tokens: resolvedMaxTokens,
      effective_output_tokens: resolvedMaxTokens,
      effective_timeout_ms: resolvedTimeoutMs,
      json_mode_requested: jsonMode === true,
      provider_specific_thinking_flag_sent: false,
      aau_enable_thinking_request: enableThinking === true,
    },
  };
}

export async function probeMoonshot() {
  const startedAt = Date.now();
  const result = await moonshotChatCompletion({
    messages: [{ role: 'user', content: 'Return JSON exactly as {"status":"AAU_MOONSHOT_OK"}.' }],
    maxTokens: 96,
    temperature: 0,
    jsonMode: true,
    enableThinking: false,
    timeoutMs: 120000,
  });
  return {
    ok: Boolean(result.content || result.reasoning_content),
    model_requested: result.model_requested,
    model_returned: result.model_returned,
    content_preview: String(result.content || result.reasoning_content || '').slice(0, 160),
    finish_reason: result.finish_reason,
    usage: result.usage,
    latency_ms: Date.now() - startedAt,
    mode: 'experimental_only',
  };
}
