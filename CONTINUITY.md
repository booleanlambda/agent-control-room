# AAU Continuity — Silas Diagnostics and Recovery Architecture

**Last updated:** 2026-10-20  
**Status:** Diagnostic record verified against live Supabase and repository code; recovery architecture is **PROPOSED, NOT IMPLEMENTED**.  
**Scope:** Silas / QDA601-M10-U2 integrated-model failure, recovery controller plan, evidence and no-restart guard.

> This file is the high-level handoff record for the current engineering work. Live database state is authoritative for operational status; Git history is authoritative for source revisions. This document is not an instruction to unpause an agent, increase a budget, switch models, or bypass verification.

## 1. Executive diagnosis

Silas successfully completed and durably stored the **Net Burn** and **Ending Cash Balance** child calculations but did not complete their parent synthesis. The failure was **architectural failure amplification** across provider transport, response truncation/verification-materialization contracts, and semantic budget policy. Correctly checkpointed arithmetic was repeatedly surrounded by unsuccessful synthesis and recovery attempts.

**Primary design defect:** the existing architecture detects and bounds individual failures, but does not reliably converge from recoverable failure to verified completion while preserving finished work. In particular, stage-specific failure responses are not coordinated by a single deterministic recovery controller.

**Immediate terminal error (2026-10-11 20:21:48 UTC):**
`semantic_bucket_rollover_denied:semantic_budget_bucket_exhausted:reasoning:bucket_limit_exhausted`.

**Do not confuse:**
- Silas's **economic compute account** (0 at last live read; agent marked dormant) with his **assignment work budget** (289 units remained in epoch 13). The *reasoning bucket* was exhausted; overall assignment budget was not.
- Provider HTTP 504 with semantic/model correctness failures.
- A rejected or truncated synthesis with invalidated verified child calculations.
- A schema/claim transfer defect with an incorrect mathematical result.
- Recovery planning with recovery implementation or successful live replay.

## 2. Live source-of-truth snapshot (read-only audit, 2026-10-20)

Source: Supabase project `mgtilfgygzymxiyixjit`, schema `agent_lab`; agent `f7e7a357-3c6b-4c18-8b12-0e5008b3ef82` (Silas Sterling, internal label `agent_forty_nine`).

| Observable | Latest observed value |
| --- | --- |
| Agent lifecycle | `dormant` |
| Autonomous lifecycle run | `paused` (`0c60c5ac-c097-4d48-9721-155b307207d7`) |
| Bound primary model | `google/gemma-4-31b-it` via `nvidia_direct` |
| Last wake | `437a1487-c648-41f0-b249-6a7cf0864759`, failed 2026-10-11 20:21:48 UTC after 2 attempts |
| Scheduler | No pending wake; no next wake time |
| Economic account | `suspended`; levy disabled; latest balance 0; recorded arrears 71 |
| Active assignment | `QDA601-M10-U2 — Integrated Model` (self-contained exercise; no external research) |
| Current assignment key | `req:ba9cb9d92627de141f8abbfdbe5594938654841b2d856274` |
| Tree | 29 nodes in that assignment: **25 completed**, **4 split/unresolved**, greatest observed depth 6 |
| Active runtime | Epoch **13**, still `active` despite paused outer lifecycle — **state reconciliation needed** |
| Epoch 13 work budget | Initially 918, remaining 289; 140 transitions, 40 material transitions |
| Automatic reasoning rollover | Index 2 of max 2; subsequent reasoning-bucket rollover denied |
| Verified child paths | `R.002.003.002.001` Net Burn and `R.002.003.002.002` Ending Cash Balance, both marked `completed` with durable artifacts |
| Unfinished parent | `R.002.003.002`, remains `split` |

The agent originally entered compute-exhaustion dormancy on October 8, **but was resumed October 11** and then paused after the new failure. Do not report October 8 as the last wake.

### Incident sequence / failure evidence

1. **Evidence and schema conflicts:** `declared_verified_checks_unresolved:checks_source_cardinality_invalid:R.002.002` and later `qda_recursive_verified_descendant_materialization_invalid:R.002.003.002:calculation.python_checks_must_be_array`.
2. **Child authoring reconsideration failure:** `autonomous_decomposition_child_reconsideration_limit:R.002.003.002`; a bounded fail-safe, but not task completion.
3. **Provider transport:** multiple NVIDIA `HTTP 504` calls during final synthesis; logged as `NVIDIA_HTTP_504`. Provider retries did not produce a reliable completed parent.
4. **Truncation:** 2026-10-11 `req_R_002_003_002_synthesis_final_2` returned HTTP 200, `finish_reason=length`, 7,000 completion tokens, 6,997 reasoning tokens, zero usable output characters in the rejection record. Rejected as `TRUNCATED_RESPONSE`, appropriately.
5. **Work survives:** child artifacts and their result hashes remained persisted. Following attempts ran discovery/routing again; the parent remained unresolved.
6. **Final hold:** reasoning-bucket automatic rollover was denied at its bounded limit; lifecycle paused, economic levy frozen. The runtime ledger's epoch 13 is nevertheless still marked active.

These failures are **not evidence that the 12-month arithmetic is incorrect**. A mathematics/claim correctness verdict needs its own deterministic checks.

## 3. Code and previous protections (implemented versus unverified)

Current repository references:
- `workers/model-intent-execution.js` — response-integrity gate, error classification, exception handling, budget-rollover bridge, provider calls.
- `workers/qda601-runtime.js` — QDA `python_checks` validation/normalization and verified-descendant materialization rules.
- `workers/autonomous-recursive-decomposition.js` — bound-model decomposition, child authoring, sibling evidence, synthesis checkpoints and provenance recovery.
- `sql/aau-productive-semantic-bucket-rollover-v0.1.sql` — guarded rollovers; `v_max_rollovers := 2`; material-progress check.
- `docs/claim-evidence-continuity-v0.1.md` and `workers/claim-evidence-continuity.js` — declared claim/evidence projection contract. **Documented code exists, but its production deployment/live Silas replay must not be assumed verified.**
- `docs/AAU_SYSTEMIC_SEMANTIC_RUNTIME_v0.2.md` — semantic tree, work budgets, execution ledger.
- `docs/AAU_INTERVENTION_PROTOCOL_v0.1.md` — intervention and explicit resume protocol.
- `workers/semantic-runtime-controls.js` — work admission and branch economics.

**Protections that worked:** invalid/truncated model responses were rejected; source checkpoint artifacts persisted; retries and automatic rollovers were bounded; paused lifecycle froze future wakes/existence levies.

**Protections insufficient:** heterogeneous failures cascaded into whole-wake failure; parent artifact presentation could not be reliably rebuilt from trusted children; truncation continuation is phase-limited; exhausted *reasoning sub-budget* blocked progress despite remaining total work budget; paused outer lifecycle did not reconcile the active semantic-epoch record.

## 4. Recovery architecture: proposed invariant-driven controller

### Non-negotiable invariants

1. **Verified-work preservation:** `V(t+1) ⊇ V(t)` for retained historical verified artifacts; new contradictory evidence creates a new version/supersession record, never a silent overwrite. No claim counts as verified solely because the model says it is.
2. **Error-specific recovery:** identify `failure_class`, exact `phase`, `node_path`, `finish_reason`, usage, budget bucket, hashes and checkpoint boundaries before selecting an action. A 504 must not trigger an intellectual decomposition reset; a malformed `python_checks` shape must not trigger arithmetic recomputation.
3. **Model-free mechanics:** schema projection, data typing, field cardinality, provenance/hash checking, precise arithmetic, deduplication and parent artifact assembly where losslessly derivable from verified children are deterministic operations. No independent LLM/API call merely to check verifier references.
4. **Stage-local replay:** restart only the unfinished operation; rehydrate previously completed verified children, synthesis cursor and source bindings using immutable IDs/hashes.
5. **Finite, transparent resource admission:** reserve completion cost and account for `reasoning`, `finalization`, `transport_retry`, `verification` and `orchestration` separately. No automatic reallocation or unbounded retry to bypass explicit policy.
6. **No-progress closure:** repeated identical failure state and unchanged external conditions must produce a typed hold with actionable evidence, not another indistinguishable retry. Bounded transport retry is allowed on externally transient evidence.
7. **Atomic lifecycle consistency:** paused/held outer lifecycle cannot present an independently runnable `active` semantic epoch without an explicit and enforceable suspended/held interpretation.
8. **No implicit model swap:** the bound model remains authoritative; provider fallback requires explicit model-consistency authorization.

### Decision rule

For each fault, generate only recovery candidates satisfying all hard invariants and permissions. Within that safe set:

```text
utility(a) = P_success(a) * expected_new_verified_progress(a)
             / (estimated_recovery_cost(a) + epsilon)
             - lambda * corruption_risk(a)
             - mu * repeated_failure_penalty(a)

choose argmax utility(a) among admissible actions
```

Probability estimates come from observed per-action outcomes (with uncertainty intervals), not unsupported model confidence. Initially use deterministic error-class routing and hard guards before accumulating enough telemetry to estimate `P_success`. Completion correctness is a hard gate, not a utility tradeoff.

Recovery admission: `available_stage_budget >= estimated_recovery_cost + protected_completion_reserve`. If the condition fails, **hold and report** unless an independently authorized bounded stage-budget transfer exists. Progress requires verified new material or a validated reduction of unresolved obligations, not merely more calls.

### Failure-specific policy table

| Failure class | Recovery action | Explicitly forbidden |
| --- | --- | --- |
| `NVIDIA_HTTP_504` / transport unknown | Inspect attempt/outcome; bounded backoff and idempotent retry; alternate endpoint only if authorized | Re-running completed arithmetic; assuming timeout means no external effect |
| `TRUNCATED_RESPONSE` | Preserve attempt metrics and recoverable partial; shrink unfinished output scope, resume at durable synthesis cursor or use verified mechanical assembly | Accepting truncated JSON, blindly increasing tokens, restarting all children |
| `python_checks_must_be_array` | Validate declared schema; project verified child checks losslessly with source IDs/hashes and cardinality; reject conflicts | Forging check values, treating unchecked fields as verified, forcing invalid data into schema |
| Provenance or cardinality conflict | Reconcile exact child refs and hashes deterministically; isolate unresolved claims | Heuristic claim equivalence or silent evidence substitution |
| Reasoning/finalization bucket exhausted | Quantify *remaining* task and reserve; prefer zero-model-cost assembly; evaluate explicit bounded recovery authorization only after progress evidence | Unlimited rollover, indiscriminate full-budget reset |
| Repeated identical failure / cycle-lock | Typed hold with stable fingerprint, replay trace and next admissible intervention | Infinite retry loop or falsely marking a parent complete |

## 5. Recovery artifact plan (NOT YET CREATED/EXECUTED)

Create the following in a dedicated **recovery experiment branch** first; do not modify live Silas state or deploy to production as part of merely authoring these artifacts.

| Order | Planned artifact | Purpose and deliverable | Acceptance gate |
| --- | --- | --- | --- |
| R0 | `experiments/recovery/silas-20261011-forensic-fixture.json` + `README.md` | Read-only, sanitized fixture of exact failed wake, node paths/hashes, budget ledger, rejection reasons and checkpoint references. No secrets or unnecessary private context. | Fixture checksums + source provenance documented; live originals unchanged |
| R1 | `workers/recovery/failure-taxonomy.js` + tests | Deterministic classification preserving provider status, finish reason, phase, hashes, usage and `budget_bucket`. | 504, length/truncation, malformed schema, provenance conflict, budget exhaustion are distinct |
| R2 | `workers/recovery/checkpoint-reconciler.js` + tests | Rehydrate verified child outputs, cursor, and parent requirements; check fingerprint/idempotency; reject mutated descendants. | No completed child regenerated or overwritten; hash mismatches block |
| R3 | `workers/recovery/verified-parent-assembler.js` + tests | Lossless, declared-contract `python_checks` array synthesis and parent artifact projection from verified child claims; retain any model-owned interpretation obligations as unresolved. | Parent schema valid, every calculation/check mapped to source, negative fixtures reject conflicts |
| R4 | `workers/recovery/recovery-controller.js` + tests | Failure-class action router and admissibility gate; stage-specific bounded replay; monotone progress and repeated-state fingerprints. | Faults do not cascade into unrelated stages; no infinite reruns; independent gate requires zero added model calls |
| R5 | `sql/aau-recovery-state-v0.1.sql` + SQL tests | Proposed durable recovery ledger, replay/idempotency keys and explicit `held`/epoch reconciliation integration. Review existing tables first; avoid competing sources of truth. | Atomic transitions, no duplicate effects, paused lifecycle cannot admit work |
| R6 | `experiments/recovery/silas-replay.test.js` + `RECOVERY_VERDICT.md` | Offline deterministic replay with injected 504, truncation, malformed `python_checks`, budget denial and mixed failures. | Fully explain each outcome; no unverifiable claims accepted; zero child recalculation; bounded costs |
| R7 | `docs/AAU_RECOVERY_ARCHITECTURE_v0.1.md` | Formal interface contracts, SLOs, permission gates, rollback and operator-runbook. | Design and regression results independently reviewable |
| R8 | Canary staged integration (separate explicit approval) | Test against an isolated runtime/branch and shadow traffic before touching live agent. | No live budget/agent mutation, all replay regressions pass, explicit operator sign-off |

### Replay test matrix (minimum)

1. A completed child pair and correct parent schema: deterministic assembly reaches verified parent without another model call **if** all parent obligations and provenance are already satisfied.
2. Valid child pair + malformed parent `python_checks` type: preserve children, repair via declared mapping, validate cardinality and types.
3. Conflicting child hash / missing verification proof: refuse completion, return `EVIDENCE_CONFLICT` or `UNRESOLVED`, not fabricated success.
4. HTTP 504 with known idempotent inference attempt: bounded retry with same intent/phase fingerprint; cost reflected correctly.
5. `finish_reason=length` with 7,000 tokens and empty usable output: reject and resume only unfinished synthesis; no partial acceptance.
6. Reasoning-bucket exhausted with 289 total units remaining: test **no-inference assembly path**; if inference is essential and not admitted, hold without increasing budget.
7. Two prior rollovers: verify strict cap; a new plan may not silently reset the counter.
8. Lifecycle paused + epoch `active`: all dispatches denied until reconciled via authorized control path.
9. Replay identical error/state multiple times: stable no-progress detection, no unbounded recursive child authoring.
10. Wrong model/provider identity, bad verifier reference, missing node/child source: reject, preserve evidence and document failure.

### Quantitative success criteria

- **0** previously verified child artifacts mutated/recomputed during replay.
- **0** unverified, truncated, structurally invalid or unsupported claims accepted as complete.
- **0** additional LLM/API verifier calls for purely deterministic reference/schema checks.
- **0** unauthorised model swaps, budget renewals, live wakes, or existence levy changes.
- All 10 matrix cases have explicit expected/actual assertions and immutable source fingerprints.
- Demonstrate whether **`R.002.003.002` can be completed without additional reasoning tokens or additional assignment budget**. If evidence does not allow it, produce a precise blocked verdict naming the missing obligations.
- Recovery efficiency metric: verified obligations newly completed / extra compute cost; report alongside error rate, redundant calls, checkpoint integrity and time. Never optimize efficiency at the expense of correctness.

## 6. Operational state and next action

**CURRENT POLICY: HOLD SILAS.** No restart, wake, credit grant, model/provider change, schema repair in live production, or new semantic epoch merely because this record exists.

Recommended order: **freeze forensic fixture → implement deterministic checkpoint and schema replay → inject all three main errors plus budget constraints → collect verdict → canary → separately seek explicit live-recovery authorization.**

If deterministic assembly can complete the parent, use a verified artifact reconciliation pathway with fully traceable child links. If model-authored interpretation is still required, identify it as an unfinished obligation; do not mark completion simply because arithmetic has passed.

### Other relevant environment continuity

The AAU decomposition schema and its supporting relationships were separately copied **schema-only** to the isolated Neon `Aau-saau` branch `aau-decomposition-schema-port-20261020` (nine tables). Neon production was not changed; no agent rows were migrated; Supabase remains live. This is **not** evidence that Silas is running on Neon or that the proposed recovery controller exists.

## 7. Continuity update discipline

When work resumes, append dated, evidence-backed entries below with:
- exact Git branch/commit and deployment status;
- affected failure class and source record IDs;
- tests executed, expected versus observed outputs;
- artifact hashes/provenance and whether independent validation was actually run;
- effect on live Silas state and economic account (or explicit `none`);
- outstanding blockers and next authorized operation.

Do not replace a historical diagnosis with an unverified claim of repair.

### Update log

- **2026-10-20:** Root continuity file created with Silas forensic findings, existing protections, proposed recovery-controller formula, artifact plan, replay tests and hold/restart gates. **Documentation only — no recovery fix or live replay claimed.**

- **2026-10-20 (experimental branch only):** Implemented offline-only `workers/recovery/experimental-controller.js`, added sanitized read-only metadata fixture and 21 adversarial replay tests on `experiment/aau-silas-recovery-v0-1-20261020` (draft PR #140). GitHub Actions `39527869954` passed **21/21 synthetic tests**, no model calls, no live writes. [Recovery verdict](experiments/recovery/RECOVERY_VERDICT.md). **Real Silas child-data replay and live recovery remain NOT DONE; original production/main continuity status remains valid.**
