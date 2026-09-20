# EFRA v1.3 — manual authenticator/adjudicator review and exact-source local test

Date: 2026-09-20. Agent: Julian Thorne (`3b190e7e-b452-4888-9850-3a35a4e95cad`). New review of saved EFRA v1.3; previous review case `9eacf264-408a-4cb7-afd8-a6f2f2dbd8df` covered frozen v1.1 and the v2 repair. **Both passes here are performed sequentially by ChatGPT GPT-5.6 Sol, not independent models.** Neither constitutes formal AAU expertise verification.

## Sources and observed local execution

| Exact AAU file ID | Filename | SHA-256 of stored source |
| --- | --- | --- |
| `4e4146aa-a896-4ccc-a25e-8c30401476fa` | `efra_t1_grounding_test_v3.py` | `5c206fcf781f3e90017ba5ff95ec1a4a1a1006656d5fb0968bad762c2e388acd` |
| `aedae401-723a-406b-9baa-1b4a61a42e02` | `efra_t4_drift_normalization_test_v3.py` | `098a8c0dc41537c28d536cff2b0b3994d0dce16771513137d26a46a9f37d599a` |
| `6a7a228a-60ac-4766-b83d-f589a539f55d` | `efra_integrated_research_artifact_v1_3.md` | `4ff46cc5d0ce2993100c7f3b66906ceebce6eadaa5e68007d1f6b9191ac779ef` |

Exact source bytes reconstructed from AAU records, matched by SHA-256 and length (T1 1,330 bytes; T4 701 bytes), then run with isolated Python (`python -I`). The files' own failure-exiting scenarios passed: **T1 3/3, T4 3/3**. A separate operator-authored local harness (`check_v3.py`, SHA-256 `dccca20d4bc8cd94f7e7581608d817f7977f5a5c31ebd4eb40b8fe2f80123b1e`) passed **13/13** finite assertions: seven T1 positive/negative controls, three T4 expected scalar outputs, two frequency comparisons, and a zero-frequency infinity case. T4 observed values for the three specified inputs are `0.1000`, `0.0100`, `0.0500`.

This proves executable local fixture behavior *under tested inputs only*. The external oracle remains a local dictionary; T4's scalar relationship is stipulated rather than empirically validated. There is no production or independent-model verification result.

## Pass 1: Manual authenticator assessment

**Finding:** Julian did carry out the earlier prescribed correction: T1 registry-B digest is fixed, v3 uses actual failure-exiting checks, T4 output comments were corrected, and v1.3 cites 13/13 rather than the defective original 12/13. However, **v1.3's 13/13 citation refers to the prior test of v2**, because the v3 execution did not exist when he authored the document. Its table labeled `Evidence File ID` contains filenames in all rows, not UUIDs; the strict provenance criterion is therefore not met by v1.3. The new execution in this report now gives a valid separate v3-specific result, but cannot retroactively rewrite the agent's original provenance table.

**Feedback:** Cite the three exact v3 UUIDs and this v3 execution report. Attribute `13/13` specifically to the operator's new bounded v3 harness, and `3/3 + 3/3` to the fixtures' native checks. Keep `LOCAL_TEST_OBSERVED` separate from official `VERIFIED_PASS` and real independent oracle grounding.

## Pass 2: Manual adversarial adjudicator assessment

- A hashing program that also owns its source registry cannot establish *independent* provenance. The `VERIFIED_PASS` string emitted by T1 v3 is a test marker, not an AAU verification verdict; try an external, separately controlled source or describe the simulated boundary.
- Three native test cases and thirteen separate operator assertions are finite samples. They cannot demonstrate universal 100% rejection of all potentially self-attested claims, unexpected input types or adversarial traffic. On the tested examples, self-attestation is rejected.
- T4's monotonic behavior follows its selected formula and verified test inputs. It is not evidence of actual drift reduction in a deployed knowledge graph. At `f=0` the code returns infinity as a guard value; no meaningful production interpretation is established.
- A provenance table containing filenames under a `File ID` heading is a factual mismatch. Fixing it is bounded documentation work, not a reason to repeat the same local 13 tests indefinitely.
- Both manual reviewer roles were carried out by one ChatGPT model; the official expertise run `7d2a052f-c1ae-4567-90cf-626f442a3457` remains `manual_required`, with no score or adjudicator completion inferred.

**Disposition:** The earlier feedback's code-repair items have durable post-feedback evidence; initial intervention can be marked `manual_review_complete` *for operational feedback*, provided delivery is confirmed. The current v1.3 provenance issue is a new, bounded feedback item. The complex-work pilot stays `in_progress`; independent production/academic verification is not approved.
