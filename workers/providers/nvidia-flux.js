import crypto from 'node:crypto';

const ENDPOINT = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b';
const MODEL = 'black-forest-labs/flux.2-klein-4b';

const clean = (value) => String(value || '').trim();

function detectMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'application/octet-stream';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return 'application/octet-stream';
}

function extractBase64(body) {
  const artifact = body?.artifacts?.[0] || body?.data?.[0] || null;
  if (!artifact || typeof artifact !== 'object') return { artifact: null, base64: '' };
  const base64 = typeof artifact.base64 === 'string'
    ? artifact.base64
    : typeof artifact.b64_json === 'string'
      ? artifact.b64_json
      : '';
  return { artifact, base64 };
}

function safeErrorDetail(body, raw) {
  const detail = body?.error?.message || body?.detail || body?.message;
  if (typeof detail === 'string') return detail;
  if (detail != null) {
    try { return JSON.stringify(detail).slice(0, 1200); } catch {}
  }
  return String(raw || '').slice(0, 1200);
}

export function flux2ConfigStatus() {
  return {
    ready: Boolean(clean(process.env.NVIDIA_API_KEY)),
    api_key_present: Boolean(clean(process.env.NVIDIA_API_KEY)),
    provider: 'nvidia',
    model: MODEL,
    endpoint: ENDPOINT,
    hosted_trial_generation: true,
    hosted_trial_arbitrary_reference_edit: false,
  };
}

export async function generateFlux2Embodiment({
  prompt,
  width = 1024,
  height = 1024,
  seed = 0,
  steps = 4,
} = {}) {
  const apiKey = clean(process.env.NVIDIA_API_KEY);
  const text = clean(prompt);
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not configured');
  if (!text) throw new Error('flux_prompt_required');

  const startedAt = Date.now();
  let response;
  try {
    // Keep this payload aligned with the hosted NVIDIA trial endpoint that was
    // successfully probed from this same Render service. Omitting `mode` lets
    // the endpoint default to image generation; the human-readable docs label
    // is not accepted verbatim by the current hosted validator.
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'AAU-Embodiment-FLUX2/0.2',
      },
      body: JSON.stringify({
        prompt: text.slice(0, 10000),
        width,
        height,
        samples: 1,
        seed: Math.max(0, Number(seed) || 0),
        steps: Math.max(1, Math.min(4, Number(steps) || 4)),
      }),
    });
  } catch (error) {
    error.retryable = true;
    throw error;
  }

  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}

  if (!response.ok) {
    const detail = safeErrorDetail(body, raw) || `HTTP ${response.status}`;
    const error = new Error(`nvidia_flux_${response.status}: ${detail}`);
    error.status = response.status;
    error.code = body?.error?.code || body?.code || `http_${response.status}`;
    error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw error;
  }

  const { artifact, base64 } = extractBase64(body);
  if (!base64) {
    const error = new Error('nvidia_flux_response_missing_image_payload');
    error.retryable = false;
    throw error;
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    const error = new Error('nvidia_flux_empty_image_payload');
    error.retryable = false;
    throw error;
  }

  const mimeType = detectMime(buffer);
  if (!mimeType.startsWith('image/')) {
    const error = new Error('nvidia_flux_unrecognized_image_format');
    error.retryable = false;
    throw error;
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const generationId = clean(body?.id || artifact?.id || artifact?.seed || '') || null;

  return {
    provider: 'nvidia',
    model: MODEL,
    endpoint: ENDPOINT,
    buffer,
    mime_type: mimeType,
    sha256,
    size_bytes: buffer.length,
    width,
    height,
    generation_id: generationId,
    latency_ms: Date.now() - startedAt,
    seed: artifact?.seed ?? seed,
    finish_reason: body?.finish_reason || null,
  };
}
