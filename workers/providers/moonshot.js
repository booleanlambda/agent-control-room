const DEFAULT_TIMEOUT_MS = 180000;

function clean(value) {
  return String(value || '').trim();
}

function resolveEndpoint(rawValue) {
  const raw = clean(rawValue).replace(/\/+$/, '');
  if (!raw) return '';
  if (/\/chat\/completions$/i.test(raw)) return raw;
  if (/\/v1$/i.test(raw)) return raw + '/chat/completions';
  try {
    const parsed = new URL(raw);
    if (!parsed.pathname || parsed.pathname === '/') return raw + '/v1/chat/completions';
  } catch {}
  return raw + '/chat/completions';
}

function modelsEndpoint(chatEndpoint) {
  return String(chatEndpoint || '').replace(/\/chat\/completions$/i, '/models');
}

function resolveConfig() {
  return {
    apiKey: clean(process.env.MOONSHOT_APIKEY),
    accessKeyId: clean(process.env.MOONSHOT_ID),
    configuredModel: clean(process.env.AAU_MOONSHOT_MODEL),
    endpoint: resolveEndpoint(process.env.MOONSHOT_ENDPOINT),
  };
}

function resolveTimeoutMs(value) {
  const n = Number(value ?? process.env.AAU_MOONSHOT_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(5000, Math.min(Math.floor(n), 900000));
}

function chooseModel(ids = []) {
  const cleanIds = [...new Set(ids.map(clean).filter(Boolean))];
  const exactPreference = [
    'kimi-k3',
    'kimi-k2.8',
    'kimi-k2.7',
    'kimi-k2.6',
    'kimi-k2.5',
  ];
  for (const preferred of exactPreference) {
    if (cleanIds.includes(preferred)) return preferred;
  }
  const generalKimi = cleanIds.find((id) => /^kimi-k/i.test(id) && !/code|vision|audio|image|embedding/i.test(id));
  if (generalKimi) return generalKimi;
  return cleanIds.find((id) => /kimi/i.test(id)) || cleanIds[0] || null;
}

async function requestJson(url, options, timeoutMs) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const timeoutError = new Error('moonshot_timeout_after_' + timeoutMs + 'ms');
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
  return { response, raw, body };
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
    ready: Boolean(config.apiKey && config.endpoint),
    api_key_present: Boolean(config.apiKey),
    access_key_id_present: Boolean(config.accessKeyId),
    configured_model: config.configuredModel || null,
    model_discovery_required: !config.configuredModel,
    endpoint_host: endpointHost,
    endpoint_path: endpointPath,
    timeout_ms: resolveTimeoutMs(),
    mode: 'experimental_only',
    secret_values_exposed: false,
  };
}

export async function discoverMoonshotModels() {
  const config = resolveConfig();
  if (!config.apiKey) throw new Error('MOONSHOT_APIKEY is not configured');
  if (!config.endpoint) throw new Error('MOONSHOT_ENDPOINT is not configured');
  const url = modelsEndpoint(config.endpoint);
  const timeoutMs = Math.min(120000, resolveTimeoutMs());
  const { response, raw, body } = await requestJson(url, {
    method: 'GET',
    headers: {
      authorization: 'Bearer ' + config.apiKey,
      accept: 'application/json',
      'user-agent': 'AAU-Moonshot-Direct-Experimental-Adapter/1.1-model-discovery',
    },
  }, timeoutMs);
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || raw.slice(0,1000) || ('HTTP ' + response.status);
    const error = new Error('moonshot_models_http_' + response.status + ': ' + detail);
    error.code = 'MODEL_DISCOVERY_HTTP_ERROR';
    error.status = response.status;
    error.provider = 'moonshot_direct';
    throw error;
  }
  const ids = Array.isArray(body?.data)
    ? body.data.map((item) => clean(item?.id)).filter(Boolean)
    : [];
  if (!ids.length) throw new Error('moonshot_models_empty');
  return {
    model_ids: ids,
    selected_model: config.configuredModel || chooseModel(ids),
    model_count: ids.length,
  };
}

export async function moonshotChatCompletion({
  messages,
  model,
  maxTokens = 6000,
  temperature = 0.2,
  jsonMode = null,
  enableThinking = null,
  reasoningEffort = null,
  timeoutMs = null,
} = {}) {
  const config = resolveConfig();
  if (!config.apiKey) throw new Error('MOONSHOT_APIKEY is not configured');
  if (!config.endpoint) throw new Error('MOONSHOT_ENDPOINT is not configured');
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages are required');

  let resolvedModel = clean(model) || config.configuredModel;
  if (!resolvedModel) {
    const discovery = await discoverMoonshotModels();
    resolvedModel = clean(discovery.selected_model);
  }
  if (!resolvedModel) throw new Error('moonshot_model_not_resolved');

  const resolvedMaxTokens = Math.max(1, Math.min(32768, Math.floor(Number(maxTokens) || 6000)));
  const requestBody = {
    model: resolvedModel,
    messages,
    max_tokens: resolvedMaxTokens,
    stream: false,
  };

  if (jsonMode === true) requestBody.response_format = { type: 'json_object' };

  // Kimi K3 always reasons. The supported cost/latency control is the
  // top-level reasoning_effort field: low, high, or max (provider default max).
  const normalizedReasoningEffort = clean(reasoningEffort).toLowerCase();
  if (/^kimi-k3(?:$|[-_])/i.test(resolvedModel) && normalizedReasoningEffort) {
    if (!['low','high','max'].includes(normalizedReasoningEffort)) {
      const error = new Error('moonshot_invalid_reasoning_effort');
      error.code = 'MODEL_REQUEST_INVALID';
      error.provider = 'moonshot_direct';
      throw error;
    }
    requestBody.reasoning_effort = normalizedReasoningEffort;
  }

  const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs);
  let result = await requestJson(config.endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + config.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'AAU-Moonshot-Direct-Experimental-Adapter/1.1',
    },
    body: JSON.stringify(requestBody),
  }, resolvedTimeoutMs);

  // Some OpenAI-compatible models reject response_format even though they can
  // still obey AAU's JSON-only system contract. Retry once without that transport
  // hint; the cognition parser remains strict.
  if (!result.response.ok && jsonMode === true && [400, 422].includes(result.response.status)) {
    const detail = String(result.body?.error?.message || result.body?.message || result.raw || '').toLowerCase();
    if (detail.includes('response_format') || detail.includes('json')) {
      const retryBody = { ...requestBody };
      delete retryBody.response_format;
      result = await requestJson(config.endpoint, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + config.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'AAU-Moonshot-Direct-Experimental-Adapter/1.1-json-fallback',
        },
        body: JSON.stringify(retryBody),
      }, resolvedTimeoutMs);
    }
  }

  const { response, raw, body } = result;
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
      version: 'moonshot_direct_experimental_v0_2',
      requested_output_tokens: resolvedMaxTokens,
      effective_output_tokens: resolvedMaxTokens,
      effective_timeout_ms: resolvedTimeoutMs,
      json_mode_requested: jsonMode === true,
      provider_specific_thinking_flag_sent: false,
      aau_enable_thinking_request: enableThinking === true,
      reasoning_effort: requestBody.reasoning_effort || null,
      reasoning_effort_policy: requestBody.reasoning_effort ? 'explicit_k3' : 'provider_default',
      temperature_policy: 'provider_default_fixed_1',
    },
  };
}

export async function probeMoonshot() {
  const startedAt = Date.now();
  const discovery = await discoverMoonshotModels();
  const selected = discovery.selected_model;
  const result = await moonshotChatCompletion({
    model:selected,
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
    discovered_model_count: discovery.model_count,
    selected_model: selected,
    content_preview: String(result.content || result.reasoning_content || '').slice(0, 160),
    finish_reason: result.finish_reason,
    usage: result.usage,
    latency_ms: Date.now() - startedAt,
    mode: 'experimental_only',
  };
}
