## Change classification
- [ ] Repair / incident fix (complete the evidence section below)
- [ ] Feature, documentation, or governance change (repair checks marked N/A with explanation)

## Repair acceptance (AAU R0–R6)

See [AAU Repair Acceptance Standard v1.0](../docs/AAU_REPAIR_ACCEPTANCE_STANDARD_v1.0.md).

- [ ] R0: Incident baseline, original error, failing execution/path and preserved evidence linked
- [ ] R1: Original failure reproduced before fix (or unreproducible external conditions characterized)
- [ ] R2: Root cause and exact causal code/config change identified; not classification-only
- [ ] R3: Before-fails/after-passes regression plus integration and negative tests linked
- [ ] R4: Authorized real end-to-end replay shows durable terminal result and expected output
- [ ] R5: Existing evidence, model identity, checkpoints, budgets/levy, retries, idempotency and related invariants verified
- [ ] R6: Acceptance receipt + independent review when critical logic changes
- [ ] No misleading completion claim from passing builds, deploys, startup probes, HTTP statuses or queued wakes

**Incident / receipt link:**

**Failing execution, node and log:**

**Git SHA / deployment ID:**

**Replay ID / durable status / output evidence:**

**Outstanding risks / external blockers:**

**Current verdict:** `DIAGNOSED` / `PATCHED_UNVERIFIED` / `REGRESSION_PASSED` / `BLOCKED_EXTERNAL` / `FAILED` / `VERIFIED_COMPLETE` / `N/A (non-repair)`

**If any acceptance item is unchecked, explain why and do not call the repair complete:**
