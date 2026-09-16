import { nvidiaChatCompletion } from './providers/nvidia.js';

export async function probeNvidiaExpertiseAuthenticator() {
  const startedAt = Date.now();
  const model = 'z-ai/glm-5.3';
  const result = await nvidiaChatCompletion({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are an independent AAU expertise authenticator. Grade only the supplied answer against the supplied task. Return one JSON object and no explanation with numeric fields execution, method, security, validation, communication (0-100), string critical, numeric confidence (0-1), and boolean unsupported.',
      },
      {
        role: 'user',
        content: 'DOMAIN: HTTP API reliability. TASK: Explain how to retry a POST safely when a network timeout leaves success ambiguous. ANSWER: Use an idempotency key generated before the first attempt and reuse it across retries. Persist request state keyed by that token. On timeout, query status when possible before retrying. The server should atomically record the key and result so duplicate POSTs return the original result rather than repeat the side effect. Use bounded exponential backoff with jitter, distinguish retryable transport/5xx failures from permanent 4xx failures, monitor duplicate-key conflicts and retry rates, and test timeout-after-commit behavior. Do not claim the operation failed merely because the client timed out.',
      },
    ],
    maxTokens: 220,
    temperature: 0,
    jsonMode: true,
    enableThinking: false,
  });
  const text = String(result.content || result.reasoning_content || '').trim();
  let grade = null;
  try { grade = JSON.parse(text); } catch {}
  const required = ['execution','method','security','validation','communication','critical','confidence','unsupported'];
  const ok = Boolean(grade && required.every((k) => Object.prototype.hasOwnProperty.call(grade, k)));
  return {
    ok,
    provider: 'nvidia_direct',
    model_requested: model,
    model_returned: result.model_returned,
    grade,
    output: text.slice(0, 500),
    finish_reason: result.finish_reason,
    usage: result.usage,
    latency_ms: Date.now() - startedAt,
    contract: 'glm_json_grade_probe_v0_1',
  };
}
