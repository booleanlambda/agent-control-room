import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { generateFlux2Embodiment, flux2ConfigStatus } from './providers/nvidia-flux.js';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const executorId = String(process.env.AAU_EMBODIMENT_RENDERER_ID || `render:embodiment:${process.env.RENDER_INSTANCE_ID || process.pid}`).trim();
const pollMs = Math.max(1000, Number(process.env.AAU_EMBODIMENT_RENDER_POLL_MS || 2500));
const bucket = String(process.env.SUPABASE_S3_BUCKET || 'agent-embodiments').trim();

let stopped = false;
let running = false;

function requiredConfig() {
  const pairs = [
    ['AAU_SUPABASE_ANON_KEY', anon],
    ['AAU_BROKER_BRIDGE_TOKEN', bridge],
    ['NVIDIA_API_KEY', String(process.env.NVIDIA_API_KEY || '').trim()],
    ['SUPABASE_S3_ENDPOINT', String(process.env.SUPABASE_S3_ENDPOINT || '').trim()],
    ['SUPABASE_S3_ACCESS_KEY_ID', String(process.env.SUPABASE_S3_ACCESS_KEY_ID || '').trim()],
    ['SUPABASE_S3_SECRET_ACCESS_KEY', String(process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '').trim()],
    ['SUPABASE_S3_REGION', String(process.env.SUPABASE_S3_REGION || '').trim()],
    ['SUPABASE_S3_BUCKET', bucket],
  ];
  return pairs.filter(([, value]) => !value).map(([key]) => key);
}

function s3Client() {
  return new S3Client({
    endpoint: process.env.SUPABASE_S3_ENDPOINT,
    region: process.env.SUPABASE_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    },
  });
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
  });
  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}
  if (!response.ok) {
    const error = new Error(`${name}:${response.status}:${body?.message || body?.error || raw.slice(0, 500)}`);
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return body;
}

function compactJson(value) {
  try { return JSON.stringify(value || {}); } catch { return '{}'; }
}

function buildPrompt(job) {
  const requested = job.requested_changes && typeof job.requested_changes === 'object' ? { ...job.requested_changes } : {};
  const protectedTraits = job.protected_snapshot && typeof job.protected_snapshot === 'object' ? job.protected_snapshot : {};
  const direct = typeof requested.prompt === 'string' ? requested.prompt.trim() : '';
  delete requested.prompt;

  const parts = [
    'AAU embodiment reference image for a persistent synthetic agent.',
    'Render only agent-selected presentation traits; do not infer legal biography or unselected protected identity facts.',
  ];
  if (direct) parts.push(`Visual description: ${direct}`);
  if (Object.keys(requested).length) parts.push(`Additional preferences: ${compactJson(requested)}`);
  if (Object.keys(protectedTraits).length) parts.push(`Preserve these protected traits: ${compactJson(protectedTraits)}`);
  parts.push('Use a clear identity-reference composition and unobtrusive background unless otherwise requested. No text, logos, captions, watermarks, signatures, or UI.');
  return parts.join(' ').slice(0, 780);
}

function extensionForMime(mime) {
  return mime === 'image/jpeg' ? 'jpg' : 'png';
}

async function claimOne() {
  const rows = await rpc('aau_bridge_claim_embodiment_render_request', {
    p_executor_id: executorId,
    p_lease_seconds: 240,
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function failJob(job, error) {
  const retryable = Boolean(error?.retryable);
  try {
    return await rpc('aau_bridge_fail_embodiment_render_request', {
      p_executor_id: executorId,
      p_render_request_id: job.embodiment_render_request_id,
      p_error_code: String(error?.code || error?.name || 'renderer_error').slice(0, 160),
      p_error_message: String(error?.message || error).slice(0, 1200),
      p_retryable: retryable,
      p_retry_after_seconds: retryable ? 30 : 0,
    });
  } catch (failError) {
    console.error('AAU_EMBODIMENT_RENDER_FAIL_RECORD_ERROR', JSON.stringify({
      render_request_id: job.embodiment_render_request_id,
      error: String(failError?.message || failError),
    }));
    return null;
  }
}

async function processJob(job) {
  if (job.request_kind !== 'candidate_generation' || job.source_asset_id) {
    const error = new Error('nvidia_hosted_flux_trial_does_not_accept_arbitrary_canonical_reference_images_for_editing');
    error.code = 'reference_edit_not_supported_on_hosted_trial';
    error.retryable = false;
    await failJob(job, error);
    console.log('AAU_EMBODIMENT_RENDER_UNSUPPORTED_EDIT', JSON.stringify({
      render_request_id: job.embodiment_render_request_id,
      request_kind: job.request_kind,
      source_asset_id: job.source_asset_id || null,
    }));
    return;
  }

  try {
    const prompt = buildPrompt(job);
    const generated = await generateFlux2Embodiment({
      prompt,
      width: 1024,
      height: 1024,
      seed: 0,
      steps: 4,
    });

    const extension = extensionForMime(generated.mime_type);
    const objectPath = `agents/${job.agent_id}/candidates/${job.embodiment_render_request_id}/flux2-klein-4b.${extension}`;
    const s3 = s3Client();

    const upload = await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectPath,
      Body: generated.buffer,
      ContentType: generated.mime_type,
      Metadata: {
        agent_id: String(job.agent_id),
        render_request_id: String(job.embodiment_render_request_id),
        provider: 'nvidia',
        model: 'flux2-klein-4b',
        sha256: generated.sha256,
      },
    }));

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectPath }));
    const storedSize = Number(head.ContentLength || 0);
    if (storedSize !== generated.size_bytes) {
      const error = new Error(`s3_size_verification_failed:${storedSize}:${generated.size_bytes}`);
      error.code = 's3_size_verification_failed';
      error.retryable = true;
      throw error;
    }

    const completed = await rpc('aau_bridge_complete_embodiment_render_request', {
      p_executor_id: executorId,
      p_render_request_id: job.embodiment_render_request_id,
      p_bucket_id: bucket,
      p_object_path: objectPath,
      p_sha256: generated.sha256,
      p_mime_type: generated.mime_type,
      p_width: generated.width,
      p_height: generated.height,
      p_size_bytes: generated.size_bytes,
      p_source_generation_id: generated.generation_id,
      p_result: {
        provider: generated.provider,
        model: generated.model,
        latency_ms: generated.latency_ms,
        seed: generated.seed,
        s3_http_status: upload?.$metadata?.httpStatusCode || null,
        s3_verified: true,
        prompt_chars: prompt.length,
        prompt_contract: 'agent_authored_embodiment_preferences_v0_2',
      },
    });

    console.log('AAU_EMBODIMENT_RENDER_COMPLETED', JSON.stringify({
      render_request_id: job.embodiment_render_request_id,
      agent_id: job.agent_id,
      asset_id: completed?.asset_id || null,
      object_path: objectPath,
      sha256: generated.sha256,
      size_bytes: generated.size_bytes,
      latency_ms: generated.latency_ms,
      prompt_chars: prompt.length,
      provider: generated.provider,
      model: generated.model,
    }));
  } catch (error) {
    await failJob(job, error);
    console.error('AAU_EMBODIMENT_RENDER_FAILED', JSON.stringify({
      render_request_id: job.embodiment_render_request_id,
      agent_id: job.agent_id,
      code: error?.code || error?.name || null,
      status: error?.status || null,
      retryable: Boolean(error?.retryable),
      message: String(error?.message || error).slice(0, 1200),
    }));
  }
}

async function loop() {
  if (stopped || running) return;
  running = true;
  try {
    const job = await claimOne();
    if (job) await processJob(job);
  } catch (error) {
    console.error('AAU_EMBODIMENT_RENDER_LOOP_ERROR', JSON.stringify({
      message: String(error?.message || error).slice(0, 1200),
    }));
  } finally {
    running = false;
    if (!stopped) setTimeout(loop, pollMs).unref?.();
  }
}

export function startEmbodimentRenderWorker() {
  const missing = requiredConfig();
  const flux = flux2ConfigStatus();
  if (missing.length) {
    console.log('AAU_EMBODIMENT_RENDERER_STATUS', JSON.stringify({
      ready: false,
      missing,
      executor_id: executorId,
      renderer: flux,
    }));
    return { ok: false, ready: false, missing };
  }

  stopped = false;
  console.log('AAU_EMBODIMENT_RENDERER_STATUS', JSON.stringify({
    ready: true,
    executor_id: executorId,
    poll_ms: pollMs,
    bucket,
    renderer: flux,
    supported_request_kinds: ['candidate_generation'],
    blocked_request_kinds: ['mutable_edit','canonical_revision'],
  }));
  setTimeout(loop, 50).unref?.();
  return { ok: true, ready: true, executor_id: executorId, poll_ms: pollMs, bucket };
}

export function stopEmbodimentRenderWorker() {
  stopped = true;
}
