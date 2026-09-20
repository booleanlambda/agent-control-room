# EFRA T1/T4 operator execution evidence — 2026-09-20

**Scope:** Operator-run, isolated local Python execution of the exact agent-authored test fixtures. This is not independent verification of production EFRA, a real external oracle, the full EFRA v0.3 suite, or the agent's separate expertise assessment.

## Source integrity
| Fixture | AAU agent_files.file_id | SHA-256 of exact inline_text |
|---|---|---|
| T1 `efra_t1_grounding_test.py` | `6f7307e3-9ea3-4238-9cd5-baccfef2392c` | `d366e9c52bd6e123ad63351d431090f57fbbb6cbf096aa9865b3f60a681494a6` |
| T4 `efra_t4_drift_normalization_test.py` | `a24b6570-32da-4662-b462-e6a68b4fa7fd` | `00a4622258d40b09b57fc0d5501bd65254d2477fd55fbdb6bb32610b2ada9e37` |

The locally reconstructed source bytes matched the hashes calculated from Supabase `inline_text`. The fixtures were executed using isolated Python, without production credentials or external network access. Separate operator-written boundary assertions were executed. **12 of 13 assertions passed; one T1 positive-control assertion failed.**

## Observed fixture stdout

```text
--- EFRA T1 Grounding Test ---
Self-Attested: False -> Result: REJECTED: Hash mismatch. (Expected: Hash mismatch)
Self-Attested: True -> Result: REJECTED: Self-attestation is not independent evidence. (Expected: Self-attestation rejected)
Self-Attested: False -> Result: VERIFIED_PASS: Grounded via Verified Source A (Expected: VERIFIED_PASS)

--- EFRA T4 Normalization Test ---
Lambda: 0.1, Freq: 1 -> Delta: 0.1000 (Expected: High Drift)
Lambda: 0.1, Freq: 10 -> Delta: 0.0100 (Expected: Low Drift)
Lambda: 0.5, Freq: 10 -> Delta: 0.0500 (Expected: Moderate Drift)
```

## Independent operator boundary findings

- Three separate self-attested cases were rejected in the small local fixture. This is **not** evidence of a statistically established 100% rejection rate over all possible inputs or production conditions.
- Hash mismatch and absent-registry cases were rejected; the local dictionary entry for empty-string SHA-256 returned `VERIFIED_PASS`, representing a simulated success rather than genuine external provenance.
- **T1 defect (positive-control failure):** the configured `Verified Source B` digest `5feceb66ffc86f38d952786c6d696c79c20bd697` is not the SHA-256 of `0`. The correct digest is `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`. A matching legitimate positive-control input returns `REJECTED: No external grounding found.` The operator's 13th assertion failed as expected on this defect.
- T4 scalar values decreased when f increased from 1 to 10 for both lambda 0.1 and 0.5 (as calculated by the exact fixture). For lambda 0.1, f=1, the actual output is **0.1000**; Julian's commented projected 0.0999 is not the implementation's numeric result for those inputs.
- The f=0 implementation returns infinity via division-by-zero handling, not a validated physical or epistemic behavior.

## Interpretation and next action

These observations establish **limited operator-run fixture execution**, not verified external grounding, production-level efficacy, or an agent expertise pass. T1 remains **in progress with a concrete defective positive control**; T4 has operator-observed local scalar outputs, but real-world drift normalization and the full EFRA suite remain unverified. Julian should revise the registry-B digest, strengthen affirmative and adversarial assertions, and revise v1.1 to distinguish local tested results from untested production claims. Preserve the original agent-authored fixture, work item `527020ee-222d-465b-ba96-24850c38e149`, and held expertise run `7d2a052f-c1ae-4567-90cf-626f442a3457`.

Operator-side local JSON report SHA-256: `8a00d361411e31757a8ec39b7f8fdaa94846c1c36422f7cf64bad5216618770d`. No full source or private credentials are included in this public-facing repository record.
