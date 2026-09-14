import crypto from 'node:crypto';
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const sourceUrl = String(process.env.AAU_EMBODIMENT_BOOTSTRAP_URL || '').trim();
const subject = String(process.env.AAU_EMBODIMENT_BOOTSTRAP_SUBJECT || '').trim().toLowerCase();
const version = String(process.env.AAU_EMBODIMENT_BOOTSTRAP_VERSION || '').trim();
const expectedSha = String(process.env.AAU_EMBODIMENT_BOOTSTRAP_SHA256 || '').trim().toLowerCase();
const contentType = String(process.env.AAU_EMBODIMENT_BOOTSTRAP_CONTENT_TYPE || 'image/png').trim().toLowerCase();
const bucket = String(process.env.SUPABASE_S3_BUCKET || '').trim();

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function getBytes(s3, key) {
  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await got.Body.transformToByteArray());
}

async function exists(s3, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.Code === 'NotFound') return false;
    throw error;
  }
}

if (sourceUrl) {
  try {
    if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(subject)) throw new Error('invalid_subject');
    if (!/^[1-9][0-9]{0,5}$/.test(version)) throw new Error('invalid_version');
    if (!/^[a-f0-9]{64}$/.test(expectedSha)) throw new Error('invalid_sha256');
    if (!bucket) throw new Error('missing_bucket');

    const response = await fetch(sourceUrl, { redirect: 'follow' });
    if (!response.ok) throw new Error(`bootstrap_fetch:${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualSha = sha256(bytes);
    if (actualSha !== expectedSha) throw new Error(`bootstrap_hash_mismatch:${actualSha}`);

    const s3 = new S3Client({
      endpoint: process.env.SUPABASE_S3_ENDPOINT,
      region: process.env.SUPABASE_S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
      },
    });

    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp';
    const key = `agents/${subject}/canonical/v${version}/master.${ext}`;

    if (await exists(s3, key)) {
      const existing = await getBytes(s3, key);
      const existingSha = sha256(existing);
      if (existingSha !== expectedSha) throw new Error(`canonical_path_conflict:${existingSha}`);
      console.log('AAU_EMBODIMENT_BOOTSTRAP', JSON.stringify({ ok: true, idempotent: true, bucket, object_path: key, sha256: existingSha, bytes: existing.length }));
    } else {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        Metadata: {
          'aau-subject-ref': subject,
          'aau-canonical-version': version,
          'aau-sha256': expectedSha,
          'aau-object-role': 'canonical-embodiment-master',
        },
      }));
      const stored = await getBytes(s3, key);
      const storedSha = sha256(stored);
      if (storedSha !== expectedSha) throw new Error(`post_upload_hash_mismatch:${storedSha}`);
      console.log('AAU_EMBODIMENT_BOOTSTRAP', JSON.stringify({ ok: true, idempotent: false, bucket, object_path: key, sha256: storedSha, bytes: stored.length }));
    }
  } catch (error) {
    console.log('AAU_EMBODIMENT_BOOTSTRAP', JSON.stringify({ ok: false, error: String(error?.message || error) }));
  }
} else {
  console.log('AAU_EMBODIMENT_BOOTSTRAP', JSON.stringify({ ok: false, skipped: true, reason: 'no_source_url' }));
}
