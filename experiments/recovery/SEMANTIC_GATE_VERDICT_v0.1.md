# AAU Semantic Consistency Gate v0.1 — experimental

**Status:** Implemented on draft PR #140, offline only; not deployed to Silas. The original 21/21 controller tests passed previously; the new semantic gate has **21 local unit tests passing** against the experimental implementation. **A new GitHub Actions execution is not yet confirmed** for the changed branch.

## Scope and trust boundary

The gate in `workers/recovery/semantic-consistency-gate.js` compares the proposed parent interpretation with the numerical evidence projected from two verified child artifacts. Input projection must have 12 months, exact source-node paths, pinned result hashes, and 12 internally reconciling cash balances. The upstream `silas-persisted-parent-replay.js` remains responsible for independent check execution and source authenticity; a naked `status=PROJECTION_READY` supplied by arbitrary callers is not itself proof of trust.

Three results:

- `SEMANTIC_MISMATCH`: a structured statement explicitly contradicts verified closing cash, cash direction, month-by-month cash pattern, final Net Burn, or a narrowly parseable contradictory narrative. Includes a reason tied to the metric or claim.
- `UNRESOLVED`: missing/unsupported claims, ambiguous or free-form prose, unknown fields, missing/duplicated provenance, inconsistent numerical basis or unreviewed semantic dimensions. **Never promote this to PASS.**
- `PASS`: all **four narrow, typed claims** agree with verified numbers, source bindings match, and interpretation and sanity-check text are exactly the deterministic rendered template. **This PASS establishes consistency of only these limited facts, not general semantic correctness or parent completion.**

Required structured claim IDs: `cash_at_month_12`, `cash_change_from_opening`, `cash_monotonicity`, `net_burn_at_month_12`. Contradictory raw prose about declining cash by month 12 and falsely rising cash every month is rejected conservatively; arbitrary free-form reasoning cannot be fully proved without broader verification.

## Runtime integration

`workers/recovery/silas-persisted-parent-replay.js` now optionally receives `parentCandidate` and invokes the gate **only after** a verified numerical projection is ready:

- Contradiction: replay status `SEMANTIC_MISMATCH` and `mandatory_next_action=REMEDIATE_SEMANTIC_MISMATCH`.
- No candidate or ambiguous candidate: numeric projection remains `VERIFIED_NUMERIC_PROJECTION_ONLY`; `semantic_gate.status=UNRESOLVED`.
- Narrow semantic PASS: still `VERIFIED_NUMERIC_PROJECTION_ONLY`, `live_node_completed=false`, `model_calls=0`, with unresolved self-audit, full QDA schema, source/verification and task-coverage obligations.

The gate does NOT call another AI/model API, write to Supabase or Neon, grant budget, restart an agent, or implicitly authorize a model switch.

## Test coverage

`workers/recovery/semantic-consistency-gate.test.js` exercises canonical PASS, false closing cash, wrong direction, false monotonicity, explicit contradicting interpretation, false month-by-month trend, negation/conditionals, plausible unverified prose, missing/duplicate/extra structured claims, forged/duplicated provenance, corrupted numerical basis, unreviewed self-audit, missing parent, and an observed 12-month Silas numeric series.

Additional persisted-replay integration tests cover absent candidate, narrow canonical PASS without live completion, and typed semantic contradiction.

**Validation boundary:** 21 semantic unit tests were run locally successfully. The updated GitHub CI suite and three new integration tests are committed but have **not** yet returned an independent CI result. Production remains paused, with no live recovery attempted.

## Next acceptance gates

1. Execute the updated complete test suite in GitHub Actions or another approved isolated runner; record commit SHA and actual pass/fail.
2. Extract independently pinned original verifier metadata and replay full authentic Silas envelopes through the integrated gate.
3. Add task-aware interpretation and self-audit validation (not merely numerical semantics), with explicit positive/negative evidence links.
4. Only after full QDA contract is verified, consider an explicitly authorized live recovery path. No automatic rollover or live writes.
