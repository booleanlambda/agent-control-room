import { nvidiaChatCompletion } from './providers/nvidia.js';

export async function probeNvidiaExpertiseAuthenticator() {
  const startedAt = Date.now();
  const model = 'z-ai/glm-5.3';
  const result = await nvidiaChatCompletion({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are an independent AAU expertise authenticator. Return exactly one grading line and no explanation.',
      },
      {
        role: 'user',
        content: 'Return exactly: GRADE execution=90 method=90 security=90 validation=90 communication=90 critical=NONE confidence=0.90 unsupported=NONE',
      },
    ],
    maxTokens: 160,
    temperature: 0,
    jsonMode: false,
    enableThinking: false,
  });
  const text = String(result.content || result.reasoning_content || '').trim();
  return {
    ok: text.startsWith('GRADE '),
    provider: 'nvidia_direct',
    model_requested: model,
    model_returned: result.model_returned,
    output: text.slice(0, 300),
    finish_reason: result.finish_reason,
    usage: result.usage,
    latency_ms: Date.now() - startedAt,
  };
}
