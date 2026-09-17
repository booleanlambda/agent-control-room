import { nvidiaChatCompletion } from './providers/nvidia.js';

const MODELS = [
  'moonshotai/kimi-k3',
  'meta/muse-glimmer-30b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
];

function parseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  return null;
}

export async function probeNvidiaExpertiseAuthenticator() {
  const required = ['execution','method','security','validation','communication','critical','confidence','unsupported'];
  const messages = [
    {
      role: 'system',
      content: 'You are an independent AAU expertise authenticator. Grade only the supplied answer against the supplied task. Return exactly one JSON object and no explanation with numeric fields execution, method, security, validation, communication (0-100), string critical, numeric confidence (0-1), and boolean unsupported.',
    },
    {
      role: 'user',
      content: 'DOMAIN: HTTP API reliability. TASK: Explain how to retry a POST safely when a network timeout leaves success ambiguous. ANSWER: Use an idempotency key generated before the first attempt and reuse it across retries. Persist request state keyed by that token. On timeout, query status when possible before retrying. The server should atomically record the key and result so duplicate POSTs return the original result rather than repeat the side effect. Use bounded exponential backoff with jitter, distinguish retryable transport/5xx failures from permanent 4xx failures, monitor duplicate-key conflicts and retry rates, and test timeout-after-commit behavior. Do not claim the operation failed merely because the client timed out.',
    },
  ];

  const attempts = [];
  for (const model of MODELS) {
    const startedAt = Date.now();
    try {
      const result = await nvidiaChatCompletion({
        model,
        messages,
        maxTokens: 320,
        temperature: 0,
        jsonMode: false,
        enableThinking: null,
      });
      const text = String(result.content || result.reasoning_content || '').trim();
      const grade = parseJson(text);
      const ok = Boolean(grade && required.every((k) => Object.prototype.hasOwnProperty.call(grade, k)));
      attempts.push({
        ok,
        model_requested: model,
        model_returned: result.model_returned,
        grade,
        output: text.slice(0, 500),
        finish_reason: result.finish_reason,
        usage: result.usage,
        latency_ms: Date.now() - startedAt,
      });
      if (ok) break;
    } catch (error) {
      attempts.push({
        ok: false,
        model_requested: model,
        error_name: error?.name || null,
        http_status: error?.status || null,
        message: String(error?.message || error).slice(0, 800),
        latency_ms: Date.now() - startedAt,
      });
    }
  }

  const winner = attempts.find((x) => x.ok) || null;
  return {
    ok: Boolean(winner),
    provider: 'nvidia_direct',
    primary: MODELS[0],
    fallbacks: MODELS.slice(1),
    selected_model: winner?.model_returned || winner?.model_requested || null,
    attempts,
    contract: 'aau_authenticator_fallback_probe_v0_1',
  };
}
