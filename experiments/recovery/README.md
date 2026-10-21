# AAU experimental recovery artifact v0.1 — Silas

**Status:** Experimental code, no production integration, no live replay.  
**Target failure:** QDA601-M10-U2 parent \`R.002.003.002\`, October 11, 2026.  
**Git branch:** \`experiment/aau-silas-recovery-v0-1-20261020\`.

## Files

- \`workers/recovery/experimental-controller.js\` — pure offline stage-aware recovery planner, evidence receipt reconciliation, deterministic numerical parent projection, model-output guard.
- \`workers/recovery/experimental-controller.test.js\` — adversarial replay of provider HTTP 504, truncation, typed verification errors, budget exhaustion, broken hashes and no-progress loops.
- \`experiments/recovery/silas-20261011-diagnostic-fixture.json\` — sanitized **real incident metadata** and durable node references. No full live calculation data.
- \`.github/workflows/silas-recovery-experiment-ci.yml\` — isolated Node 22 workflow; no external services/credentials.
- Root \`CONTINUITY.md\` — architecture plan and source-of-truth summary.

## Run the test

\`\`\`sh
node --test workers/recovery/experimental-controller.test.js
\`\`\`

The module imports only \`node:crypto\`; test imports only \`node:test\` and \`node:assert/strict\`. **No Supabase, Neon, NVIDIA, Moonshot, queue or agent-control credentials are required or used.** This is intentionally not wired to a wake controller.

## Trust model — very important

The planner accepts **independent trusted verification receipts**, indexed by exact child node path. For each child it checks:
- \`status === "completed"\` and expected node path;
- \`result_hash\` equals the externally pinned receipt result hash;
- SHA-256 of the supplied artifact equals its independently pinned receipt;
- \`python_checks\` is an array with declared cardinality and a matching pinned verified-check digest;
- every check has a unique label, expression and finite claimed result;
- each child calculation has exactly 12 ordered months and a valid numeric value;
- cross-child \`openingCash - cumulative(netBurn) = endingCash\` within currency rounding tolerance.

No code in this experiment **executes or independently verifies each Python expression**; it relies on external trusted receipts. Therefore its \`PROJECTION_READY\` result means mechanical integrity of an externally verified set, **NOT proof that arbitrary supplied financial figures are mathematically correct**. Never create a receipt by trusting an unverified model submission. The synthetic test supplies matching mock trusted receipts by construction *only to test the gate*.

A parent whose \`semanticRequirements\` remain open is reported as \`PRESERVE_PROJECTION_AWAIT_SEMANTIC_WORK\`, not marked complete. Even a fully mechanically projected parent gets \`live_node_completed:false\`. All returned plans are tagged \`OFFLINE_ONLY\`.

## What the replay demonstrates — and does not

1. Deterministic assembly of synthetic 12-month net-burn/cash inputs and exactly 48+36 checks without a model call.
2. Rejection of corrupted/missing receipts, malformed checks, wrong cardinality, cross-child cash inconsistency and bad finish reasons.
3. Proper fault separation (transport vs schema vs truncated synthesis vs reasoning sub-budget).
4. Denial of automated budget bypass, retries on paused lifecycle or repeated no-progress loops.
5. No modification of child inputs, economic accounts, active agent, assignment tree or live wakes.

**It does not demonstrate that Silas's October 11 parent is now completed**. The sanitized diagnostic JSON intentionally does not include full child artifacts or certified external verification transcripts. Live replay would require an authenticated, explicitly authorized adapter to retrieve and cross-check the exact original child artifacts and verification proofs, satisfy remaining interpretation/audit obligations and commit a valid parent. That integration is a separate engineering stage and safety gate.

## Next experimental gate

- Verify CI passes on this isolated branch, including negative tests.
- Perform an external read-only fixture extraction with pinned SHA/deterministic math receipts and sensitive-data filtering. Keep raw fixture private if necessary.
- Expand the projection contract to preserve evidence provenance and reconcile the full QDA parent response schema, not just numerical fields.
- Add an idempotent state-transition adapter only in an isolated database branch and an opt-in test runner, not in production.
- Replay injected failures and produce a measured \`RECOVERY_VERDICT.md\` including the exact unresolved semantic obligations and model/compute cost.
- Seek explicit authorization separately before any live wake, credit update, model swap or production cutover.

See root \`CONTINUITY.md\` for the broader recovery plan, including outstanding state reconciliation (\`lifecycle=paused\`, \`semantic_epoch=active\`).
