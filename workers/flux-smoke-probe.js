export async function probeNvidiaFlux2() {
  const startedAt = Date.now();
  const apiKey = String(process.env.NVIDIA_API_KEY || '').trim();
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not configured');

  const response = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'AAU-FLUX-Credit-Probe/0.1',
    },
    body: JSON.stringify({
      prompt: 'A minimal studio test image of a single blue circle centered on a plain white background.',
      width: 1024,
      height: 1024,
      samples: 1,
      seed: 1,
      steps: 1,
    }),
  });

  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}

  const artifact = body?.artifacts?.[0] || body?.data?.[0] || null;
  const imagePayload = typeof artifact?.base64 === 'string'
    ? artifact.base64
    : typeof artifact?.b64_json === 'string'
      ? artifact.b64_json
      : '';

  const quotaHeaders = {};
  for (const [key, value] of response.headers.entries()) {
    if (/(rate|quota|credit|limit|remaining|reset)/i.test(key)) quotaHeaders[key] = value;
  }

  return {
    ok: response.ok,
    model: 'black-forest-labs/flux.2-klein-4b',
    http_status: response.status,
    latency_ms: Date.now() - startedAt,
    artifact_present: Boolean(artifact),
    image_payload_present: Boolean(imagePayload),
    image_payload_chars: imagePayload.length,
    quota_headers: quotaHeaders,
    error_code: body?.error?.code || body?.code || null,
    error_message: response.ok ? null : String(body?.error?.message || body?.detail || body?.message || raw).slice(0, 800),
  };
}
