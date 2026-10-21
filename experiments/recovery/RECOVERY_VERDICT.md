# AAU experimental Silas recovery — first test verdict

**Result:** PASS, for **offline synthetic replay only**.  
**UTC CI date:** 2026-10-21; local AAU work date 2026-10-20.  
**GitHub Actions run:** https://github.com/booleanlambda/agent-control-room/actions/runs/39527869954  
**Draft PR:** https://github.com/booleanlambda/agent-control-room/pull/140  
**Status:** code committed and synthetic tests executed; no live Silas recovery attempted.

## Executed tests

GitHub Actions job \`offline-recovery-replay\` completed successfully:
- \`node --check workers/recovery/experimental-controller.js\`
- \`node --check workers/recovery/experimental-controller.test.js\`
- \`node --test workers/recovery/experimental-controller.test.js\`
- **21 tests; 21 passed; 0 failed; 0 skipped.**

Cases include actual observed failure *classes* (provider 504, \`finish_reason=length\`, QDA \`python_checks\` array mismatch, reasoning sub-budget exhaustion) with synthetic child artifacts and receipts. The test explicitly checks no code writes agent state or performs live model calls.

## Positive outcome

From an independent synthetic fixture with:
- two completed child records,
- 12 ordered months of net burn plus ending cash,
- 48 verified-check receipt entries for net burn and 36 for ending cash,
- pinned test receipts for complete child artifact hashes and check-array digests,
- paused outer lifecycle, reasoning budget zero, two automatic rollovers already used, total remaining assignment units 289,

the recovery module emitted \`MECHANICAL_PROJECTION_READY\` with **84 source-attributed checks**, zero model calls, and \`live_node_completed=false\`. With unsatisfied model-owned interpretation requirements, it correctly emits \`PRESERVE_PROJECTION_AWAIT_SEMANTIC_WORK\`.

## Negative outcome gates

The suite rejects/holds: forged hashes, missing or self-attested receipts, missing children, unexpected or duplicate children, incorrect check cardinality, bad check labels, invalid array structure, inconsistent cumulative cash arithmetic, truncated responses, invalid JSON, repeated unchanged failures, and missing budget admission for additional model work.

## What this DOES NOT establish

- No original October 11 Silas child artifact was inserted into the test.
- The actual 48 and 36 check expressions were **not independently re-executed**; trust came from synthetic pinned receipts. The artifact API must only accept genuine independent receipts in real integration.
- The exact QDA parent submission schema (including prose interpretation, self-audit and strict provenance bindings) is **not yet fully implemented**.
- No adapter for Supabase, Neon, RabbitMQ or the production worker has been created.
- No provider fallback, new model reasoning, live wake, credits update or lifecycle reconciliation was executed.
- A green CI verdict is **NOT** a live recovery success or permission to unpause Silas.

## Next gate

Read-only extraction of real completed child artifacts **and actual math-verification receipts**, then replay the full QDA parent contract without inventing calculations, changing evidence, or calling a verifier model. If source receipts/interpretation are insufficient, return typed \`UNRESOLVED\`, not a success claim. Implement an optional state adapter only in an isolated DB branch after the offline verdict is independently reviewed.
