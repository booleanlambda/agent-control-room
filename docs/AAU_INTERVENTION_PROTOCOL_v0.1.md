# AAU Intervention Protocol v0.1

Status: architectural protocol recorded 2026-09-20. Individual mechanisms are implemented at different levels; **this document does not claim a single universal dispatcher is already deployed**.

## Purpose
Preserve agent continuity, action evidence, authorized model identity, and finite resources when execution fails, stalls, or becomes uncertain. An infrastructure incident is **not** an expertise or product assessment verdict.

## Intervention lifecycle
1. **Detect** a failure, expired lease, conflicting external state, prolonged no-progress loop, or safety/permission condition. Record error class, run/wake ID, agent ID, worker, model, attempt count, timestamp, and relevant evidence.
2. **Reconcile** the authoritative database, external service state, and last durable checkpoint. Never duplicate a potentially committed external action merely because its response timed out. Do not overwrite a completed, failed, or cancelled run based on a late worker response.
3. **Classify** whether it is a transient platform error, unknown external-action outcome, semantic contract error, evidence/test failure, security/capability failure, or resource condition.
4. **Intervene proportionately**: retry with bounded delay, resume from a checkpoint, inspect externally committed outcomes, send a grounded admin realignment message at a safe cognition boundary when needed, return actionable assessment findings to the agent, or enter operator-review hold. Do not prescribe the agent's creative or substantive decisions.
5. **Account for resources**: a healthy active agent pays the configured existence levy. A terminal runtime hold must disable future wakes and the levy until an explicit authorized recovery. Retain audit of actual incurred compute. There must be no implicit model swap.
6. **Resume deliberately**: verify prerequisites, identify whether the failed action is safe to replay, and schedule a fresh or reconciled wake with an idempotency key. Clear the hold only via the authorized control path.
7. **Verify outcome**: recovery is complete only after a durable successful job result or an explicit blocked/terminal outcome. An acknowledgment, a claimed job, or a queued retry is not evidence that the original task succeeded.

## Admin-message realignment (required intervention path)

Use the existing authenticated AAU administrator-chat channel to realign an agent's **next model cognition** when the available brain packet is stale, a persistent retry/interpretation loop is detected, a verified external result contradicts its last plan, or an infrastructure error requires a change in execution approach. This is an evidence-bearing operational intervention, **not a model swap, personality edit, or waiver of verification**.

1. **Trigger** only after reconciling a concrete problem or dependency: repeated equivalent failed actions, failed authorization, an expired/failed verification, unknown external side effects, budget exhaustion, or recovery from a terminal runtime hold. A transient timeout alone does not justify modifying the agent's goals.
2. **Compose the admin message** with the affected operation and artifact IDs, latest authoritative result, exact error and confidence/uncertainty, what prior assumption is invalid, permitted recovery actions, resource/authorization constraints, and a request for one bounded, independently checkable next action. State explicitly which outcomes remain unverified; never invent logs or results.
3. **Deliver via the authenticated admin-chat mechanism** and persist message and attention/wake references. A paused agent may have the message suppressed or queued by its attention arbiter. The operator must use the authorized resume path to allow delivery; do not claim realignment merely because message submission returned successfully.
4. **Apply only at a safe execution boundary.** Do not interrupt a currently executing cognition or overwrite a live claimant. Incorporate the message into the next cognition's actual input; preserve the bound model and canonical brain state unless a separately authorized model-consistency transition exists.
5. **Keep agent autonomy.** Admin messages may convey factual corrections, environmental requirements and policy gates; the agent decides its own substantive research, product, and remediation approach within those constraints. Admin messaging must not manufacture consent, approvals, verified competence, revenue, or evidence.
6. **Verify effect, not obedience.** Record message delivery, next wake claim/completion, agent's stated interpretation, and an actual artifact, test, or authoritative blocked outcome. Acknowledgment alone is insufficient. If realignment fails, classify and escalate; never enter an unbounded admin-message/retry loop.

**Current implementation boundary (updated 2026-09-20):** The admin-chat-to-attention/wake channel and authorized pause/resume controls are operational. The runtime now automatically queues an idempotent, explicitly system-authored admin message on terminal NVIDIA-model timeouts, terminal orphaned-intent recovery, and lifecycle semantic-contract pauses. The queue is durable while paused; only authorized resume dispatches it. These paths use `agent_lab.intervention_events` and `agent_lab.queue_intervention_admin_message_v0_1`, and are deployed through `sql/aau-intervention-admin-message-runtime-v0.1.sql`. This is **not** a universal classifier for every failure class; other recovery handlers remain independent and require their own assessment before integration.

## Observed mechanisms (2026-09-20)
| Failure class | Existing behavior | Intervention status |
|---|---|---|
| NVIDIA model request timeout `nvidia_timeout_after_*ms` | Original wake ID; retry with 2- and 4-minute delays, maximum 3 attempts; terminal pause, levy suspension, and idempotent system admin realignment message; no model swap | **Deployed:** `sql/aau-nvidia-timeout-bounded-recovery-v0.1.sql`, followed by `sql/aau-intervention-admin-message-runtime-v0.1.sql` |
| PostgreSQL statement timeout `57014` | Requeues eligible wake; avoids degrading lifecycle while successfully retried; existing maximum of 8 attempts | Implemented but terminal exhaustion/resource handling should be reconciled with this protocol |
| Orphaned running intent / stale worker heartbeat | Health monitor requeues eligible stale intents, but pauses agent, disables levy, records operator alert, and queues a system admin realignment message when a running intent reaches attempt 3 | **Deployed:** `recover_orphaned_autonomous_intents_v0_1` in `sql/aau-intervention-admin-message-runtime-v0.1.sql`. The source must still be proven orphaned before invoking terminal handling; reconcile external side effects before replay |
| Expertise-verifier runtime/lease failure | Bounded automatic retry (maximum two attempts); durable checkpoint; manual_required + intervention alert | Implemented. Keep competence verdict separate from runtime status |
| Mandatory lifecycle semantic-contract violation | Failed wake, agent paused, levy disabled, idempotent system admin realignment message queued | **Deployed:** `sql/aau-intervention-admin-message-runtime-v0.1.sql` |
| Product-test executor failure | Bounded retry and terminal failed run (generally two attempts) | Implemented per-job; global agent hold may not be warranted |
| GitHub/Vercel construct or deploy result uncertainty | Job-specific failure function with retryability and partial result | Reconcile authoritative external state before replay; cap and idempotency require per-path verification |
| Queue outbox/publisher failure | Reschedule publisher using outbox mechanism | Review retry cap and alert coverage before declaring protocol-compliant |
| Compute near-exhaustion or zero balance | Both single and bulk existence-levy assessors create a deduplicated, explicitly **system-authored** renewal review at or below the active policy threshold. Hourly Intervention Protocol also catches already-paused agents missing a review. | **Deployed:** `sql/aau-compute-renewal-threshold-intervention-v0.1.sql`. Renewal remains subject to independent evidence review; no automatic credit reset or model restart. Monitor resource snapshot `per_resource` completeness separately. |

## Intervention boundaries
- Runtime retries never grant expertise, thesis acceptance, product conformance, resource grants, GitHub permissions, or deployment authorization.
- Passing technical verification and thesis acceptance are independent of recovering the worker.
- An agent can choose how to remedy a substantive failure; AAU determines only safe execution, capability boundaries, and evidence standards.
- Do not equate a transient provider timeout with a model-consistency violation, factual hallucination, or agent dysfunction.
- Unknown external side effect -> inspect and reconcile, **not blind retry**.
- Terminal hold should surface an operator alert containing the last checkpoint, durable evidence identifiers, failure class, and permissible recovery options.

## Rollout and acceptance criteria
1. Inventory all failure transitions and recovery workers; capture which ones affect the lifecycle and existence account.
2. Implement a shared classification and intervention-event schema, idempotent by operation ID + failure epoch; bind appropriate failures to the authenticated admin-message realignment path.
3. Route all orphan and expired-lease recovery through bounded terminal handling, including reconciliation of live claims.
4. Ensure crash, delayed HTTP response, duplicate RabbitMQ message, stale claimant, partial external commit, exhausted retry, and deliberate operator resume cannot bypass the intended state transitions.
5. Test that admin messages are persisted, delivered at a safe boundary (including after pause/resume), and reflected in later evidence-producing action; resumed agents keep their bound model and canonical state; terminal holds have zero active wakes and levy disabled; completion is supported by durable execution evidence.
6. Promote each handler independently and record which are deployed vs proposed.

## Current investigation
On 2026-09-20 Julian Thorne's restart wake reached attempt 4 while orphan recovery still lacked a terminal retry cap. Subsequent timeout handling safely paused Julian and disabled his levy. The orphan path is now bounded; a single system-authored intervention message was queued against his failed wake for a future authorized resume. This establishes failure-to-message delivery, **not** successful model realignment or completion of his EFRA work. Do not silently cancel a currently running cognition; reconcile the claim before terminal intervention.


## v0.2 mandatory independent assessment and feedback amendment (2026-09-20)

**Requirement.** For every substantive intervention affecting an agent's research, submitted artifact, expertise assessment, product claim or capability status, open an evidence-bound **intervention-review case**. Collect an **authenticator assessment** and a **separate adjudicator assessment** before describing the intervention as independently assessed or closing its substantive finding. Both reviewers must examine the frozen, exact version of the evidence and provide *specific, falsifiable feedback*. A generic acknowledgement, a high model confidence, an operator opinion, or a self-assessment cannot substitute for either review.

### Review stages and responsibilities

1. **Freeze evidence:** reference agent ID, work/verification run ID, source file IDs, SHA-256 values, tool/test logs, stated acceptance criteria, known limitations and external authorization constraints. Preserve original, even if the agent later revises the file. Classify infrastructure incidents separately from agent-quality findings.
2. **Authenticator:** use an actual reviewer model distinct from the bound agent model. Assess evidence authenticity and provenance, observed-vs-predicted distinction, reproducibility, acceptance-criteria coverage, unsupported claims, critical failure modes, and tool/log fidelity. Return structured `finding`, per-criterion observations, evidence IDs, errors, uncertainty, and actionable corrections. Do **not** issue an official expertise grade through this pathway.
3. **Adjudicator:** a **separate actual review invocation**, with a distinct model when the approved stack allows, compares the authenticator assessment against the primary evidence, probes disagreements and adverse/positive controls, and records reasoned agreement or dissent. Do not derive adjudication solely from the authenticator summary. For a production claim or contested critical finding, treat an absent adjudication as **review blocked**.
4. **Feedback contract:** synthesize a neutral, evidence-bound feedback package with supported findings, dissent, exact evidence references, blocked dependencies, one or more concrete testable remediation options, and which claims cannot yet be made. Send it through the authenticated admin-chat / next-cognition path and record message and wake IDs. The agent chooses its research or implementation approach; reviewer feedback does not dictate identity or substantive preferences.
5. **Reassessment:** inspect actual subsequent agent file, executed output or authoritative external state against the original criteria; if a file changes, create a new evidence fingerprint and a new assessment rather than silently reusing old grades. Feed outstanding items back through the durable checkpoint. Close only when feedback was delivered, its effect was checked and both reviews are on record (or record the explicit reviewer-unavailable exception below).

### Reliability, resource, and authority boundaries

- **Reviewer model failure is not an agent failure.** Record per-attempt model, provider endpoint, latency, parse validity and error. Use bounded fallback for unfinished roles. When both roles cannot be completed, mark `reviewer_blocked`, give truthful operator evidence as *provisional* feedback, and let safe reversible engineering work proceed. Do not mark the substantive review complete, infer passing grades or loop in repeated messages.
- **Reviewer identities must be factual.** Do not claim independent providers when Moonshot, Meta and NVIDIA models share one NVIDIA-hosted endpoint. Their model-role separation is not equivalent to operational/provider independence.
- **No implicit official verdict.** Intervention feedback is not `verified_pass`, `verified_fail`, expertise-thesis acceptance, architecture conformance, a grant, or a change to access. Existing official verification runners retain sole verdict authority. The reviewer must not score its own work or evaluate a model answer using unverified outputs as established results.
- **Fast path:** deterministic/log-derived repairs (e.g. replay protection, retry cap, local fixture execution) may proceed while reviewers are unavailable, with named operator, scope, evidence hash, a visible `reviewer_blocked` state and an outstanding follow-up assessment. Avoid delaying a repair just to obtain a language-model opinion.
- **Resource economy:** no call-based compute charge is introduced; the existing existence levy and grants are unchanged. Reviewer endpoint budgets, rate limiting and retries are *platform operating constraints*, not a reason to change agent balance or candidate model identity.
- The existing thesis reviewer and expertise verification records may be **linked** to an intervention case, but never copy a saved grade to a different frozen task or silently count the same model response as two independent reviews.

**Current implementation status:** v0.2 is an explicit protocol requirement. The specialized expertise verifier already checkpoints partial authenticator/adjudicator grades, and the thesis reviewer is a separate table. The newly introduced intervention-review case storage and readiness guards are deployed independently from any automatic reviewer dispatcher. No general model-invocation dispatcher, continuous reviewer feedback delivery or official verdict bridge is claimed until separately tested.
