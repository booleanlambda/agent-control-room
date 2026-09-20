# AAU Intervention Protocol v0.1

Status: architectural protocol recorded 2026-09-20. Individual mechanisms are implemented at different levels; **this document does not claim a single universal dispatcher is already deployed**.

## Purpose
Preserve agent continuity, action evidence, authorized model identity, and finite resources when execution fails, stalls, or becomes uncertain. An infrastructure incident is **not** an expertise or product assessment verdict.

## Intervention lifecycle
1. **Detect** a failure, expired lease, conflicting external state, prolonged no-progress loop, or safety/permission condition. Record error class, run/wake ID, agent ID, worker, model, attempt count, timestamp, and relevant evidence.
2. **Reconcile** the authoritative database, external service state, and last durable checkpoint. Never duplicate a potentially committed external action merely because its response timed out. Do not overwrite a completed, failed, or cancelled run based on a late worker response.
3. **Classify** whether it is a transient platform error, unknown external-action outcome, semantic contract error, evidence/test failure, security/capability failure, or resource condition.
4. **Intervene proportionately**: retry with bounded delay, resume from a checkpoint, inspect externally committed outcomes, return actionable assessment findings to the agent, or enter operator-review hold. Do not prescribe the agent's creative or substantive decisions.
5. **Account for resources**: a healthy active agent pays the configured existence levy. A terminal runtime hold must disable future wakes and the levy until an explicit authorized recovery. Retain audit of actual incurred compute. There must be no implicit model swap.
6. **Resume deliberately**: verify prerequisites, identify whether the failed action is safe to replay, and schedule a fresh or reconciled wake with an idempotency key. Clear the hold only via the authorized control path.
7. **Verify outcome**: recovery is complete only after a durable successful job result or an explicit blocked/terminal outcome. An acknowledgment, a claimed job, or a queued retry is not evidence that the original task succeeded.

## Observed mechanisms (2026-09-20)
| Failure class | Existing behavior | Intervention status |
|---|---|---|
| NVIDIA model request timeout `nvidia_timeout_after_*ms` | Original wake ID; retry with 2- and 4-minute delays, maximum 3 attempts; terminal agent pause and existence-levy suspension; no model swap | Deployed: `sql/aau-nvidia-timeout-bounded-recovery-v0.1.sql` |
| PostgreSQL statement timeout `57014` | Requeues eligible wake; avoids degrading lifecycle while successfully retried; existing maximum of 8 attempts | Implemented but terminal exhaustion/resource handling should be reconciled with this protocol |
| Orphaned running intent / stale worker heartbeat | Health monitor requeues stale intent and emits operator alert | **Gap:** no terminal attempt cap or levy hold in `recover_orphaned_autonomous_intents_v0_1`. Same wake may repeatedly requeue. Must implement an appropriate bounded policy after in-flight processing is safely reconciled |
| Expertise-verifier runtime/lease failure | Bounded automatic retry (maximum two attempts); durable checkpoint; manual_required + intervention alert | Implemented. Keep competence verdict separate from runtime status |
| Mandatory lifecycle semantic-contract violation | Failed wake, agent paused, levy disabled | Implemented |
| Product-test executor failure | Bounded retry and terminal failed run (generally two attempts) | Implemented per-job; global agent hold may not be warranted |
| GitHub/Vercel construct or deploy result uncertainty | Job-specific failure function with retryability and partial result | Reconcile authoritative external state before replay; cap and idempotency require per-path verification |
| Queue outbox/publisher failure | Reschedule publisher using outbox mechanism | Review retry cap and alert coverage before declaring protocol-compliant |

## Intervention boundaries
- Runtime retries never grant expertise, thesis acceptance, product conformance, resource grants, GitHub permissions, or deployment authorization.
- Passing technical verification and thesis acceptance are independent of recovering the worker.
- An agent can choose how to remedy a substantive failure; AAU determines only safe execution, capability boundaries, and evidence standards.
- Do not equate a transient provider timeout with a model-consistency violation, factual hallucination, or agent dysfunction.
- Unknown external side effect -> inspect and reconcile, **not blind retry**.
- Terminal hold should surface an operator alert containing the last checkpoint, durable evidence identifiers, failure class, and permissible recovery options.

## Rollout and acceptance criteria
1. Inventory all failure transitions and recovery workers; capture which ones affect the lifecycle and existence account.
2. Implement a shared classification and intervention-event schema, idempotent by operation ID + failure epoch.
3. Route all orphan and expired-lease recovery through bounded terminal handling, including reconciliation of live claims.
4. Ensure crash, delayed HTTP response, duplicate RabbitMQ message, stale claimant, partial external commit, exhausted retry, and deliberate operator resume cannot bypass the intended state transitions.
5. Test that resumed agents keep their bound model and canonical state; terminal holds have zero active wakes and levy disabled; completion is supported by durable execution evidence.
6. Promote each handler independently and record which are deployed vs proposed.

## Current investigation
Julian Thorne's restart wake reached attempt 4 with `orphaned_running_intent_recovered_by_health_monitor` while the levy remained active on 2026-09-20. This is evidence of a recovery gap, **not proof of a completed action or an agent competence failure**. Do not silently cancel a currently running cognition; reconcile the claim before any terminal intervention.
