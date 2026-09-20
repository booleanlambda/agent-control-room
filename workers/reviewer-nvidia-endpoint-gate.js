// Shared in-process gate for independent-review NVIDIA calls.
// Both verifier workers import this module inside the same Render process.
// It does not throttle autonomous cognition, alter models, or suppress errors.
let previous = Promise.resolve();
let enqueued = 0;
let active = 0;

export async function withReviewerNvidiaSlot(label, run) {
  if (typeof run !== 'function') throw new TypeError('reviewer_task_required');
  const before = previous;
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  previous = current;
  enqueued += 1;
  const requestedAt = Date.now();
  await before;
  enqueued -= 1;
  active += 1;
  try {
    const waitMs = Date.now() - requestedAt;
    if (waitMs > 250) console.log('AAU_REVIEWER_ENDPOINT_WAIT', JSON.stringify({ label, wait_ms: waitMs, queued: enqueued }));
    return await run();
  } finally {
    active -= 1;
    release();
  }
}

export function reviewerEndpointSlotState() {
  return { active, queued: enqueued };
}

const modelBackoffUntil = new Map();
const BACKOFF_MS = 10 * 60_000;

// Runtime-only: a timeout here does not change an agent's bound model or
// independent-verification policy. A later successful request clears the backoff.
export function noteReviewerModelTimeout(model, reason = 'timeout') {
  const key = String(model || '');
  if (!key) return;
  const until = Date.now() + BACKOFF_MS;
  modelBackoffUntil.set(key, until);
  console.warn('AAU_REVIEWER_MODEL_BACKOFF', JSON.stringify({
    model:key, reason, duration_ms:BACKOFF_MS
  }));
}

export function noteReviewerModelSuccess(model) {
  modelBackoffUntil.delete(String(model || ''));
}

export function isReviewerModelInBackoff(model) {
  const key=String(model || '');
  const until=modelBackoffUntil.get(key)||0;
  if(until && until<=Date.now()) {modelBackoffUntil.delete(key);return false;}
  return until>Date.now();
}
