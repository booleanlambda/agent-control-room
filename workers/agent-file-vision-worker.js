import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const nvidiaKey = String(process.env.NVIDIA_API_KEY || '').trim();
const model = String(process.env.AAU_NVIDIA_VISION_MODEL || 'meta/llama-3.2-11b-vision-instruct').trim();
const workerId = String(process.env.AAU_AGENT_FILE_VISION_WORKER_ID || `render:file-vision:${process.env.RENDER_INSTANCE_ID || process.pid}`).trim();
const pollMs = Math.max(1000, Number(process.env.AAU_AGENT_FILE_VISION_POLL_MS || 2500));
const maxImageBytes = Math.max(1048576, Number(process.env.AAU_AGENT_FILE_VISION_MAX_BYTES || 10485760));

let stopped = false;
let running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requiredConfig() {
  const pairs = [
    ['AAU_SUPABASE_ANON_KEY', anon],
    ['AAU_BROKER_BRIDGE_TOKEN', bridge],
    ['NVIDIA_API_KEY', nvidiaKey],
    ['SUPABASE_S3_ENDPOINT', String(process.env.SUPABASE_S3_ENDPOINT || '').trim()],
    ['SUPABASE_S3_ACCESS_KEY_ID', String(process.env.SUPABASE_S3_ACCESS_KEY_ID || '').trim()],
    ['SUPABASE_S3_SECRET_ACCESS_KEY', String(process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '').trim()],
    ['SUPABASE_S3_REGION', String(process.env.SUPABASE_S3_REGION || '').trim()],
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
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) {
    const error = new Error(`${name}:${response.status}:${typeof body === 'string' ? body.slice(0,600) : JSON.stringify(body).slice(0,600)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function parseJsonLoose(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return { description: cleaned.slice(0,12000), structured_parse_failed: true };
}

async function analyzeImage(dataUrl, job) {
  const prompt = [
    'You are an image-preprocessing tool for an autonomous agent. Describe only what is visibly present in this uploaded image.',
    'The description will be given to the agent as a tool-derived observation so the agent can appraise the file itself.',
    'Do not identify a real person, infer ethnicity, nationality, religion, health, personality, or other hidden/protected traits.',
    'You may describe visible skin tone, hair, facial expression, pose, clothing, accessories, composition, setting, colors, and readable text when clear.',
    'If this is a proposed embodiment image, objectively describe how the depicted human-presenting figure appears without deciding whether the agent should accept it.',
    'Return JSON only with keys: description (string), human_presenting (boolean|null), visible_appearance (object), clothing_and_accessories (object), pose_and_expression (object), setting (string|null), readable_text (array), notable_style_details (array), uncertainty (array).',
    `File name: ${String(job.filename || '').slice(0,255)}. Purpose: ${String(job.purpose || 'attachment').slice(0,100)}.`
  ].join(' ');

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${nvidiaKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'AAU-Agent-File-Vision/0.1',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      }],
      temperature: 0.1,
      max_tokens: 900,
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch {}
  if (!response.ok) {
    const detail = body?.error?.message || body?.detail || body?.message || raw.slice(0,1000) || `HTTP ${response.status}`;
    const error = new Error(`nvidia_vision_${response.status}:${detail}`);
    error.status = response.status;
    throw error;
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('nvidia_vision_empty_response');
  return {
    analysis: parseJsonLoose(content),
    returned_model_id: typeof body?.model === 'string' ? body.model : model,
    response_id: body?.id || null,
    usage: body?.usage || null,
  };
}

async function claimOne() {
  const rows = await rpc('aau_bridge_claim_agent_file_vision_job', {
    p_worker_id: workerId,
    p_lease_seconds: 240,
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function failJob(job, error) {
  await rpc('aau_bridge_fail_agent_file_vision_job', {
    p_worker_id: workerId,
    p_file_id: job.file_id,
    p_error: String(error?.message || error).slice(0,1600),
  }).catch(() => {});
}

async function processJob(job) {
  if (!String(job.mime_type || '').startsWith('image/')) throw new Error('vision_job_not_image');
  if (Number(job.file_size_bytes || 0) > maxImageBytes) throw new Error(`vision_image_too_large:${job.file_size_bytes}>${maxImageBytes}`);
  if (!job.storage_bucket || !job.storage_path) throw new Error('vision_job_storage_location_missing');

  const object = await s3Client().send(new GetObjectCommand({
    Bucket: job.storage_bucket,
    Key: job.storage_path,
  }));
  if (!object?.Body) throw new Error('vision_image_body_missing');
  const bytes = await object.Body.transformToByteArray();
  if (!bytes?.length) throw new Error('vision_image_empty');
  if (bytes.length > maxImageBytes) throw new Error(`vision_image_too_large:${bytes.length}>${maxImageBytes}`);

  const dataUrl = `data:${job.mime_type};base64,${Buffer.from(bytes).toString('base64')}`;
  const result = await analyzeImage(dataUrl, job);
  const completed = await rpc('aau_bridge_complete_agent_file_vision_job', {
    p_worker_id: workerId,
    p_file_id: job.file_id,
    p_model_id: result.returned_model_id || model,
    p_analysis: {
      ...result.analysis,
      vision_response_id: result.response_id,
      usage: result.usage,
    },
  });
  console.log('AAU_AGENT_FILE_VISION_COMPLETED', JSON.stringify({
    file_id: job.file_id,
    agent_id: job.agent_id,
    model_requested: model,
    model_returned: result.returned_model_id,
    scheduled_wake_request_id: completed?.wake_request_id || null,
  }));
  return completed;
}

async function loop() {
  if (running) return;
  running = true;
  while (!stopped) {
    try {
      const job = await claimOne();
      if (!job) {
        await sleep(pollMs);
        continue;
      }
      try {
        await processJob(job);
      } catch (error) {
        console.error('AAU_AGENT_FILE_VISION_JOB_FAILED', JSON.stringify({ file_id: job.file_id, agent_id: job.agent_id, error: String(error?.message || error).slice(0,1600) }));
        await failJob(job, error);
      }
    } catch (error) {
      console.error('AAU_AGENT_FILE_VISION_LOOP_ERROR', String(error?.message || error).slice(0,1600));
      await sleep(Math.max(pollMs,5000));
    }
  }
  running = false;
}

export function startAgentFileVisionWorker() {
  const missing = requiredConfig();
  if (missing.length) {
    console.error('AAU_AGENT_FILE_VISION_DISABLED', JSON.stringify({ missing }));
    return { started: false, missing, version: 'agent_file_vision_v0_1' };
  }
  stopped = false;
  void loop();
  return { started: true, worker_id: workerId, model, poll_ms: pollMs, max_image_bytes: maxImageBytes, version: 'agent_file_vision_v0_1' };
}

export function stopAgentFileVisionWorker() {
  stopped = true;
}
