import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const parentPort = Number(process.env.PORT || 10000);
const childPort = parentPort + 1;
const uploadToken = String(process.env.AAU_EMBODIMENT_UPLOAD_TOKEN || '').trim();
const maxUploadBytes = 10 * 1024 * 1024;

const s3 = new S3Client({
  endpoint: process.env.SUPABASE_S3_ENDPOINT,
  region: process.env.SUPABASE_S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
  },
});

const bucket = String(process.env.SUPABASE_S3_BUCKET || '').trim();

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function cleanSubject(value) {
  const v = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,99}$/.test(v) ? v : null;
}

function cleanVersion(value) {
  const v = String(value || '').trim();
  return /^[1-9][0-9]{0,5}$/.test(v) ? Number(v) : null;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxUploadBytes) {
      const error = new Error('payload_too_large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function objectBytes(key) {
  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await got.Body.transformToByteArray();
  return Buffer.from(bytes);
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.Code === 'NotFound') return false;
    throw error;
  }
}

async function canonicalize(req, res) {
  if (!uploadToken) return json(res, 503, { ok: false, error: 'embodiment_upload_disabled' });
  const auth = String(req.headers.authorization || '');
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!safeEqual(supplied, uploadToken)) return json(res, 401, { ok: false, error: 'unauthorized' });

  const subject = cleanSubject(req.headers['x-aau-subject-ref']);
  const version = cleanVersion(req.headers['x-aau-version']);
  const expectedSha = String(req.headers['x-aau-sha256'] || '').trim().toLowerCase();
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  if (!subject || !version) return json(res, 400, { ok: false, error: 'invalid_subject_or_version' });
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) return json(res, 400, { ok: false, error: 'invalid_sha256' });
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
    return json(res, 415, { ok: false, error: 'unsupported_content_type' });
  }
  if (!bucket) return json(res, 503, { ok: false, error: 's3_bucket_missing' });

  const body = await readBody(req);
  const actualSha = crypto.createHash('sha256').update(body).digest('hex');
  if (actualSha !== expectedSha) {
    return json(res, 409, { ok: false, error: 'input_hash_mismatch', expected_sha256: expectedSha, actual_sha256: actualSha });
  }

  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp';
  const key = `agents/${subject}/canonical/v${version}/master.${ext}`;
  const existed = await objectExists(key);

  if (existed) {
    const existing = await objectBytes(key);
    const existingSha = crypto.createHash('sha256').update(existing).digest('hex');
    if (existingSha !== expectedSha) {
      return json(res, 409, { ok: false, error: 'canonical_path_conflict', object_path: key, stored_sha256: existingSha });
    }
    return json(res, 200, {
      ok: true,
      idempotent: true,
      bucket,
      object_path: key,
      sha256: existingSha,
      bytes: existing.length,
      content_type: contentType,
    });
  }

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: {
      'aau-subject-ref': subject,
      'aau-canonical-version': String(version),
      'aau-sha256': expectedSha,
      'aau-object-role': 'canonical-embodiment-master',
    },
  }));

  const stored = await objectBytes(key);
  const storedSha = crypto.createHash('sha256').update(stored).digest('hex');
  if (storedSha !== expectedSha) {
    return json(res, 500, { ok: false, error: 'post_upload_hash_mismatch', object_path: key, stored_sha256: storedSha });
  }

  console.log('AAU_EMBODIMENT_CANONICAL_STORED', JSON.stringify({
    subject,
    version,
    bucket,
    object_path: key,
    sha256: storedSha,
    bytes: stored.length,
  }));

  return json(res, 201, {
    ok: true,
    idempotent: false,
    bucket,
    object_path: key,
    sha256: storedSha,
    bytes: stored.length,
    content_type: contentType,
  });
}

const child = spawn(process.execPath, ['workers/broker-bridge-render.js'], {
  env: { ...process.env, PORT: String(childPort) },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  console.error('AAU_BROKER_CHILD_EXIT', JSON.stringify({ code, signal }));
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/internal/embodiment/canonicalize') {
      return await canonicalize(req, res);
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && (req.url === '/' || req.url === '/healthz')) {
      try {
        const response = await fetch(`http://127.0.0.1:${childPort}/healthz`);
        const text = await response.text();
        res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(req.method === 'HEAD' ? '' : text);
      } catch {
        return json(res, 503, { ok: false, service: 'AAU Broker Bridge', error: 'broker_child_unavailable' });
      }
    }

    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error('AAU_EMBODIMENT_UPLOAD_ERROR', JSON.stringify({
      name: error?.name || null,
      code: error?.Code || error?.code || null,
      status: error?.$metadata?.httpStatusCode || error?.status || null,
      message: String(error?.message || error),
    }));
    return json(res, error?.status || 500, { ok: false, error: String(error?.message || 'internal_error') });
  }
});

server.listen(parentPort, '0.0.0.0', () => {
  console.log('AAU_EMBODIMENT_WRAPPER_LISTENING', JSON.stringify({
    port: parentPort,
    broker_child_port: childPort,
    upload_enabled: Boolean(uploadToken),
  }));
});

async function stop(signal) {
  console.log('AAU_EMBODIMENT_WRAPPER_SHUTDOWN', signal);
  server.close();
  if (!child.killed) child.kill('SIGTERM');
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
