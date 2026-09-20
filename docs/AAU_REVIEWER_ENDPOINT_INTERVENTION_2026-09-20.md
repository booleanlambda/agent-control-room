# AAU Independent Reviewer Endpoint Intervention — 2026-09-20

## Scope
Targeted repair for Julian Thorne expertise verification and Kaelen Voss Product/Service Architecture Conformance. Preserves the agents' bound `google/gemma-4-31b-it` models, evidence, all verification thresholds, independent source assessment, resource ledgers, and autonomous wake schedule. **Does not resume either held verifier or change a verdict.**

## Evidence and diagnosis
- Julian's verification `7d2a052f-c1ae-4567-90cf-626f442a3457` became `manual_required` after the second operator-authorized checkpoint resume. Four candidate answers, three authenticator grades, and one adjudicator grade are saved; no final grade or independent result was produced. NVIDIA-hosted Moonshot and Nemotron requests aborted; Meta returned an unusable grade on one task.
- Kaelen's new architecture conformance run `34d7c118-b70d-4c34-a630-fd3b0afd03b3` returned `ERROR` after Moonshot and Nemotron aborted and Meta returned malformed JSON. It was **not** a conformance failure. The prior `VERIFIED_PASS` refers to an earlier Git snapshot.
- These are model-specific calls through **one** NVIDIA-hosted endpoint, not independent provider failover. The existing workers previously used 120-second (authenticator) and 110-second (conformance) request timeouts and could overlap.
- Live synthetic probe on Render 19:05 UTC: Moonshot exceeded 30 seconds; Nemotron returned HTTP 200 in 750 ms. After the backoff code was deployed, a repeat at 19:08 UTC recorded Moonshot timeout, Nemotron HTTP 200 in 542 ms, and a ten-minute Moonshot model-specific runtime backoff. A tiny successful probe is **not** proof a full grading workload will complete.

## Changes deployed
- `workers/reviewer-nvidia-endpoint-gate.js`: one asynchronous in-process request slot shared by the two **independent reviewer** workers; no concurrent access from these two reviewer flows. Not a cross-service/global provider rate limiter.
- `workers/expertise-verification-worker.js`: checkpoint-preserving request gate, bounded primary/fallback budgets (45/60/110 seconds for Moonshot/Meta/Nemotron authenticator), timeout telemetry, and expiring model-backoff skip. Actual verifier-model identity remains attached to each accepted grade.
- `workers/product-architecture-conformance-worker.js`: same slot and time budgets, bounded maximum source context (32,000 characters, 11,000 per file), concise evidence-output instructions, reject truncated outputs, and Nemotron JSON mode with post-output validation. A malformed model response can never become `VERIFIED_PASS`.
- `workers/reviewer-endpoint-smoke.js`: one minimal model request at service startup, fallback only if primary fails; no agent data or verdict mutation. On observed timeout, backoff persists ten minutes *within that process* and expires automatically.
- `workers/broker-bridge-start.js`: starts the smoke alongside existing worker processes without creating a wake.
- Render service `srv-dajkd0h5efls73996ppg`, branch `main`, last live deploy commit `3329d20cb46020da5653e440b458381bf8a115e9`, deployment `dep-dao2tmgae00c73aisl80`. Workers started and RabbitMQ consumer bound with fresh heartbeat.

## Open limitations
- The initial primary/fallback models still share NVIDIA's provider endpoint. **There is no verified second-provider credential or endpoint failover in this patch.**
- The request gate covers expertise and architecture-conformance reviewer calls on this one Render Node process; other service workers may still call NVIDIA concurrently. Do not represent this as a global rate limit.
- The review endpoints have **not yet completed an entire resumed expertise/conformance run after this deployment**. Julian remains manual-required (3 + 1 stored partial grades), Kaelen conformance remains ERROR. Do not silently requeue either, overwrite the historical test or mark as passed. A fresh operator decision is required for Julian's further resume; Kaelen must use the existing appropriate conformance trigger after authenticating its current repository snapshot.
- A 30-second short probe indicates degraded Moonshot latency but cannot prove its performance with the full prompt or future availability.
- Record provider status, successful endpoint identity, waits/backoffs, final independently graded result, and separate product 1,000-user load-test evidence in subsequent interventions.
