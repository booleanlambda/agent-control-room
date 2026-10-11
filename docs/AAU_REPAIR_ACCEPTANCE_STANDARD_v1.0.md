# AAU Repair Acceptance Standard v1.0

**Status:** Normative operating standard for AAU repairs. Adopted by operator instruction on 2026-10-11; implementation/enforcement is only proven where an actual test or gate has been installed and verified. This document alone does not make a runtime enforcement gate live.

**Applies to:** All AAU infrastructure, broker, scheduler, database, model/provider adapter, cognition, lifecycle, verification, control-room, and agent-workflow repairs. The same standard applies to production incidents, regressions, and manual interventions. Where independent products use separate repositories, they must adopt this standard explicitly; inclusion here does not prove other services enforce it.

## Binding principle

> A repair is not complete when the code compiles, an error is reclassified, a synthetic probe passes, or a deployment succeeds. A repair is complete only when the original failure has been reproduced or credibly characterized, the cause has been corrected, the affected end-to-end workflow has successfully replayed, and the result is verified from authoritative evidence without compromising prior valid work.

A live provider outage is not an agent cognition failure. A successful HTTP request is not proof of a correct semantic answer. A successful build is not proof of a successful agent wake. Keep these verdicts separate.

## Required sequence: R0–R6

**R0 — Freeze baseline / preserve evidence.** Capture incident ID, first/last occurrence, error text/code, failing stage and node, service/worker, execution and agent IDs, model/provider (if relevant), source/deployment SHAs, request IDs, attempt history, resource usage, and last durable checkpoint. Snapshot redacted input and expected behavior. Do not mutate verified child evidence, previously passed assessments, the agent's identity, model binding, or authorized economic state in order to obtain a green test.

**R1 — Reproduce or characterize the original failure.** Demonstrate the failure with the actual sanitized failing payload/replay fixture or the same controlled execution path and retain the before-fix failure trace. For intermittent external outages, where repeatable reproduction is unsafe or impossible, document the observed upstream status, correlation IDs, boundaries and conditions, and the reason reproduction is not possible. A synthetic timeout simulation proves retry logic only; it does not prove the provider has recovered.

**R2 — Repair the cause, not only its label.** Identify the responsible code/config/data contract, source lines, and minimal causal change. Error catalog entries, logging, startup probes, timeout increases, budget increases, blanket retries, model swaps and moving work to smaller nodes are *not* by themselves a cure. Any such change needs its own evidence and must not silently alter policy or semantics. Keep production retry/cooldown rules intact unless explicitly authorized.

**R3 — Run layered validation.** At minimum:
- syntax/build/type and focused unit tests for modified code;
- regression test from R1 that fails before the change and passes after it, including malformed/boundary inputs and previously valid inputs;
- integration test of the same serialization, database, broker, provider, budget, checkpoint and scheduling interfaces affected by the incident;
- independent check that no nearby invariants regressed. A synthetic pass must be labelled synthetic.

**R4 — Verify a real end-to-end replay.** In an authorized environment, run the originally affected operation or its genuinely equivalent, evidence-backed replay through the actual production-like boundaries. Confirm a *durable terminal success* for the failed task, plus the expected business/academic output. A queued wake, running worker, HTTP 200, checkpoint save, provider response, isolated unit pass, or deployment success cannot substitute for this. For externally unavailable providers, label the incident `BLOCKED_EXTERNAL` and do not claim an end-to-end fix until a real provider-backed replay passes. Never issue unsafe duplicate side effects; reconcile idempotency first.

**R5 — Preserve safety, identity, and accounting invariants.** Explicitly compare before/after: immutable verified evidence and hashes; checkpoint lineage; exact agent, model and permission identities; durable task and node statuses; idempotent external actions; resource settlement/refunds; paused-agent levy; provider retry semantics; no accidental wake or auto-resume; and unchanged independent verification thresholds. A regression in any required invariant is `FAILED`, even if the original symptom disappeared.

**R6 — Record acceptance with proof and sign-off.** Provide the exact test command/scenario and run time, environment, source SHA/deploy ID, original failing trace, passing regression result, passing end-to-end run/wake ID and durable DB/output evidence, invariant comparison, remaining risks, and operator/reviewer decision. Declare `VERIFIED_COMPLETE` only when R0–R5 are satisfied. An independent review is required for state-machine, financial/levy, assessment, evidence, identity or authorization logic changes. The reviewer must assess evidence, not just endorse prose.

## Allowed outcome statuses

| Status | Meaning | May be called fixed? |
|---|---|---|
| `DIAGNOSED` | Cause suspected or isolated; repair not yet proven | No |
| `PATCHED_UNVERIFIED` | Change built/committed/deployed; acceptance replay missing | No |
| `REGRESSION_PASSED` | Focused tests pass, but affected end-to-end task not yet verified | No |
| `BLOCKED_EXTERNAL` | Awaiting real provider/service availability or authorization | No |
| `FAILED` | Reproduction persists, new regression appears, or invariants fail | No |
| `VERIFIED_COMPLETE` | Original path succeeds durably, regressions pass, invariants preserved, evidence recorded | Yes |

**No implied promotion:** `REGRESSION_PASSED` cannot automatically become `VERIFIED_COMPLETE` because a deployment is live or time has elapsed. A human/operator report must use these exact evidence-grounded distinctions.

## Minimal repair receipt (store with issue/PR/incident)

```yaml
incident_id:
scope:
first_failing_execution_id:
agent_id: # when applicable
node_or_operation:
error_class_and_exact_message:
before_fix_evidence_ref:
root_cause:
source_commit_sha:
deployment_id: # if deployed; do not fabricate
before_fix_reproduction_result:
post_fix_regression_result:
integration_test_result:
end_to_end_replay_id:
end_to_end_durable_status:
invariants_verified:
provider_status_and_limitations:
reviewer:
outcome: DIAGNOSED # or PATCHED_UNVERIFIED / REGRESSION_PASSED / BLOCKED_EXTERNAL / FAILED / VERIFIED_COMPLETE
```

A missing field is recorded as `not_verified`, never silently inferred. Secrets and unredacted user data must not be stored in issue/PR receipts.

## 2026-10-11 Silas incident: reference counterexample

The recursive QDA parent materialization failure `calculation.python_checks_must_be_array` was classified as `AAU-EVD-105`, but that classification did not prove correction of the malformed data contract. A separate code commit repaired an unterminated string literal. Subsequent synthesis faced 504s, a `TRUNCATED_RESPONSE`, and `AAU-BUD-202` reasoning-budget exhaustion. Startup/catalog probes with zero agent wakes were not end-to-end acceptance. These operations must remain unverified until the affected QDA path completes with durable output and verified evidence.

## Rollout

1. All new repair work starts with this receipt and explicit acceptance status.
2. Existing incidents are not retroactively marked repaired; reopen or retain nonterminal status when required proof is missing.
3. Code-based blocking of status transitions / deployment is a separate implementation task: until implemented and tested, the gate is *procedural*, not an already-active runtime enforcement mechanism.
4. A repair to a live service requires separate deployment/replay authorization and awareness of auto-deploy settings. Do not restart production brokers just to publish a document.
