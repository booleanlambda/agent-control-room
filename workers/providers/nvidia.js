const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_NVIDIA_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

function clean(value) {
  return String(value || '').trim();
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function envBool(name) {
  const raw = clean(process.env[name]).toLowerCase();
  if (!raw) return null;
  if (['1','true','yes','on'].includes(raw)) return true;
  if (['0','false','no','off'].includes(raw)) return false;
  return null;
}

function resolveConfig() {
  const apiKey = clean(process.env.NVIDIA_API_KEY);
  const baseUrl = trimTrailingSlash(clean(process.env.AAU_NVIDIA_BASE_URL) || DEFAULT_NVIDIA_BASE_URL);
  const configuredEndpoint = clean(process.env.AAU_NVIDIA_ENDPOINT);
  const configuredModel = clean(process.env.AAU_NVIDIA_MODEL);

  let url;
  let model = configuredModel || DEFAULT_NVIDIA_MODEL;
  let endpointKind = 'default_chat_completions';

  if (/^https?:\/\//i.test(configuredEndpoint)) {
    url = configuredEndpoint;
    endpointKind = 'absolute_url';
  } else if (configuredEndpoint && /chat\/completions/i.test(configuredEndpoint)) {
    url = `${baseUrl}/${configuredEndpoint.replace(/^\/+/, '')}`;
    endpointKind = 'relative_chat_completions';
  } else {
    url = `${baseUrl}/chat/completions`;
    if (configuredEndpoint) {
      model = configuredModel || configuredEndpoint;
      endpointKind = 'model_identifier';
    }
  }

  return { apiKey, baseUrl, url, model, endpointKind };
}

export function nvidiaConfigStatus() {
  const config = resolveConfig();
  let baseHost = null;
  let endpointHost = null;
  let endpointPath = null;
  try { baseHost = new URL(config.baseUrl).host; } catch {}
  try {
    const parsed = new URL(config.url);
    endpointHost = parsed.host;
    endpointPath = parsed.pathname;
  } catch {}

  return {
    ready: Boolean(config.apiKey && config.url && config.model),
    api_key_present: Boolean(config.apiKey),
    base_host: baseHost,
    endpoint_host: endpointHost,
    endpoint_path: endpointPath,
    endpoint_kind: config.endpointKind,
    model: config.model,
    json_mode: envBool('AAU_NVIDIA_JSON_MODE'),
    enable_thinking: envBool('AAU_NVIDIA_ENABLE_THINKING'),
    mode: 'experimental_only',
  };
}

export async function nvidiaChatCompletion({
  messages,
  model,
  maxTokens = 256,
  temperature = 0.2,
  jsonMode = null,
  enableThinking = null,
} = {}) {
  const config = resolveConfig();
  if (!config.apiKey) throw new Error('NVIDIA_API_KEY is not configured');
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages are required');

  const resolvedJsonMode = typeof jsonMode === 'boolean' ? jsonMode : envBool('AAU_NVIDIA_JSON_MODE');
  const resolvedThinking = typeof enableThinking === 'boolean' ? enableThinking : envBool('AAU_NVIDIA_ENABLE_THINKING');

  const requestBody = {
    model: clean(model) || config.model,
    messages,
    max_tokens: Math.max(1, Math.min(Number(maxTokens) || 256, 4096)),
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
    stream: false,
  };

  if (resolvedJsonMode === true) requestBody.response_format = { type: 'json_object' };
  if (typeof resolvedThinking === 'boolean') {
    requestBody.chat_template_kwargs = { enable_thinking: resolvedThinking };
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'AAU-NVIDIA-Experimental-Adapter/0.3',
    },
    body: JSON.stringify(requestBody),
  });

  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}

  if (!response.ok) {
    const detail = body?.error?.message || body?.detail || body?.message || raw.slice(0, 800) || `HTTP ${response.status}`;
    const error = new Error(`nvidia_${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }

  const choice = body?.choices?.[0]?.message || {};
  const content = typeof choice?.content === 'string' ? choice.content : '';
  const reasoningContent = typeof choice?.reasoning_content === 'string' ? choice.reasoning_content : '';

  return {
    provider: 'nvidia',
    model_requested: clean(model) || config.model,
    model_returned: typeof body?.model === 'string' ? body.model : null,
    content,
    reasoning_content: reasoningContent,
    finish_reason: body?.choices?.[0]?.finish_reason || null,
    usage: body?.usage || null,
    response_id: body?.id || null,
  };
}

export async function probeNvidia() {
  const startedAt = Date.now();
  const result = await nvidiaChatCompletion({
    messages: [{ role: 'user', content: 'Return JSON exactly as {"status":"AAU_NVIDIA_OK"}.' }],
    maxTokens: 64,
    temperature: 0,
    jsonMode: true,
    enableThinking: false,
  });

  return {
    ok: Boolean(result.content || result.reasoning_content),
    model_requested: result.model_requested,
    model_returned: result.model_returned,
    content_preview: result.content.slice(0, 120),
    finish_reason: result.finish_reason,
    usage: result.usage,
    latency_ms: Date.now() - startedAt,
    mode: 'experimental_only',
  };
}
