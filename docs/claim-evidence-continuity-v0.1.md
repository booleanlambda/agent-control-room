# AAU Claim–Evidence Continuity v0.1

Status: **code committed; production deployment and live Silas replay not yet verified**.

## Purpose

AAU keeps semantic decision-making with the bound agent while preserving numeric claims already verified in completed child artifacts. The runtime is not allowed to fabricate a calculation during parent synthesis or silently rewrite agent-owned interpretation.

Kimi's October 10 review identified the missing invariant: a verified child result must be transportable into a parent through an explicit, versioned claim mapping. Claims without a verified mapping remain agent-owned.

## Code

- `workers/claim-evidence-continuity.js` — generic pure claim projection/reconciliation. Returns a typed result: VERIFIED, PATCHED, UNRESOLVED, EVIDENCE_CONFLICT, or NOT_APPLICABLE. Emits claim-level fingerprints, original and patched hashes, and source node/result hashes. Parent assumptions, reasoning and formula are preserved unchanged.
- `workers/claim-evidence-contracts.js` — opt-in task-schema registry; first contract is QDA601-M10-U2 Problem 2, the 12-month MRR/gross-profit array. It explicitly declares 12 month identities and two numeric fields.
- `workers/autonomous-recursive-decomposition.js` — after QDA's existing verified-descendant materialization and before synthesis provenance review, call the deterministic checker and store the result in an immutable CLAIM_EVIDENCE cognition checkpoint. Reuse the existing FINAL_SYNTHESIS model checkpoint; preserve model-owned COMPLETE/BLOCKED choice. For contradictory verified sources, issue a REVISE finding rather than silently choosing either value.
- `workers/claim-evidence-continuity-probe.js` — startup synthetic replay suite. `workers/broker-bridge-start.js` logs `AAU_CLAIM_EVIDENCE_REGRESSION`.

## Trust constraints

Source nodes must be completed and carry their result hashes and successful deterministic math verification state. No copy occurs if a child is unverified, the calculation schema is unmapped, source coverage is incomplete, period identities repeat, values are nonnumeric, or two verified sources disagree. Explicit unit conflicts between sources refuse transfer. No arithmetic conversion or extrapolation is permitted. Original child artifacts and hashes are never mutated.

Only the declared month/field claims may be patched. Missing and incorrect values produce named findings and stable fingerprints, not anonymous regeneration failures. The transformation creates a new candidate artifact while retaining unrelated agent-authored fields.

## Test evidence

The local V8 synthetic functional replay passed 23 assertions, using a stand-in hash implementation to isolate pure claim logic; the production Node crypto implementation has not yet been exercised by a live broker run. The suite covers missing months 2–5 and 8–11, differing MRR/gross-profit values, idempotency, evidence hash changes, unsupported or unverified sources, duplicate rows, conflicting verified values, mixed source currencies, invalid schema, and lack of contract authorization.

This is a **synthetic structural reproduction**, not a replay of actual database bytes. Do not report the real QDA601-M10-U2 problem as passed until the live agent's completed child artifact format has been checked.

## Known limitations / next increments

1. This initial contract only projects MRR/gross-profit numerical rows. It does not yet resolve reviewer objections to unrelated financial inputs, or semantic disagreements over formulas.
2. The CLAIM_EVIDENCE checkpoint stores the claim-level finding and patch history, but a cross-domain versioned contradiction table with fingerprint-scoped semantic repair planning is not yet built.
3. Provider truncation remains a transport failure, separate from semantic repair attempts, but the broader retry-accounting redesign from Kimi's consultation is still pending.
4. Finalization-budget exhaustion has separately affected Silas. A successful 23-check replay does not guarantee the provider can complete the remaining provenance or independent authenticator work.
5. Parent unit representation should be compared with source unit representation or validated through a declared conversion contract before generalizing the transfer engine to other domains. Never guess equivalence from textual similarity.
6. Deploy on the broker only after confirming active wake safety, observe the startup regression, then execute a checkpoint-preserving one-wake replay. Verify the actual 12-month artifact and independent provenance review before marking M10-U2 completed.

No change to AAU's cognitive autonomy, existence levy, prior QDA verified children, or provider 504 policy is intended.
