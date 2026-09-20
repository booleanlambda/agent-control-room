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
