// One deterministic classification boundary for semantic-budget rollover replies.
// Policy is intentionally fail-closed: a refusal never mints a new epoch or
// resumes the exhausted semantic assignment. No model call belongs here.
export const SEMANTIC_BUCKET_DISPOSITION = Object.freeze({
  CONTINUE: 'continue',
  BUDGET_HOLD: 'budget_hold',
  STALE_WAKE: 'stale_wake',
  FAULT_HOLD: 'fault_hold',
});

export function classifySemanticBucketRollover(response) {
  const status = response && typeof response === 'object' && !Array.isArray(response)
    ? response.status : null;
  switch (status) {
    case 'renewed':
    case 'superseded':
      return SEMANTIC_BUCKET_DISPOSITION.CONTINUE;
    case 'denied':
      return SEMANTIC_BUCKET_DISPOSITION.BUDGET_HOLD;
    case 'not_running':
    case 'not_found':
      return SEMANTIC_BUCKET_DISPOSITION.STALE_WAKE;
    default:
      // Missing/invalid transport result is not evidence of a budget refusal.
      return SEMANTIC_BUCKET_DISPOSITION.FAULT_HOLD;
  }
}
