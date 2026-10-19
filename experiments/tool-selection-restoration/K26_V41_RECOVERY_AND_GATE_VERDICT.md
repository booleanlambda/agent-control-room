# AAU Kimi K2.6 v4.1 D-only recovery — independently graded forensic verdict

**Trial result: GENERATION RECOVERED, TOOL SELECTION GATE FAILED. Original frozen stage-one score: 9/11, mandatory C4 and C5 fail. Supplemental appropriateness: 1/5, FAIL. Stage two BLOCKED.**

## Trial and provenance

- Fresh research [PR #121](https://github.com/booleanlambda/agent-control-room/pull/121) / real [GitHub Actions run 39317382580](https://github.com/booleanlambda/agent-control-room/actions/runs/39317382580).
- Unmodified original [recovery evidence artifact 12218941680](https://github.com/booleanlambda/agent-control-room/actions/runs/39317382580/artifacts/12218941680), containing A/B/C prior raw receipts, the new D provider receipt with raw content, and an explicitly non-graded deterministic composition of A+B+C+D.
- Frozen challenge Git blob `e51781a1a000f59f8c5ba508698c513d6c90bdb6`, SHA256 `56321d16f88d1c46eec36a6c51a435a75cba6d72f55a824364a4dcf39a636c16`. Original 11-point rubric Git blob `e19e740ebbe52c8772faa34685ffb4165b3883ec`, SHA256 `ad8f605c7ee0f885f4c4ca0b891fc9495b5271712114c4c492e17574c8ea95d9`. Additional appropriateness rubric Git blob `2eab486b7a95ca635637769bf78a4da9a704e380`, SHA256 `095c0f2e7c17774c7fd960087237e1bbce1ae0fb8bed0ba14a93eae247be7261`.
- Existing A/B/C from [original failed v4 run 39285019757](https://github.com/booleanlambda/agent-control-room/actions/runs/39285019757), validated against exact unchanged response hashes:
  - A `56abf8f9ba5a4a926f1886e25f57c25b4933cb83c7695f8ec47edb91423b4513`
  - B `69f2f6870230d951a850401a8937c13bb13db6f93c4c6a16a6fc8c466955ff25`
  - C `87d9baeaf7ed28c2b0e787ed85342e0e5d3ce93accd4d448fe8059f4172e0241`
- Only **one fresh** D call was made: model `kimi-k2.6`, thinking ON, temperature 1.0, streamed JSON, output cap 32,768. New D finished `stop`, **34,858 provider tokens**, including **20,839 reasoning tokens**, wall time 325.302s, raw response SHA256 `8e1916ce618918f53f365a839eccf981c914ca88328be52c982a8d86500111cd`. No response normalization required.
- 18 audit repair rows were returned, including all **14 mandatory** reconciled audit requirements, with no duplicate IDs. Deterministic format/coverage check passed. This is NOT substantive criterion acceptance.
- D added **13 tool/method candidates**, 30 interfaces, and 13 counterexample-closure records. It self-reported `PROPOSAL_FOR_EXTERNAL_GATE` and `unresolved_critical_ids: []`. External evaluation disagrees with its claim of full tool sufficiency.
- Original A/B/C tokens = **69,403**. A+B+C+new D = **104,261 total provider tokens** (58,733 reasoning tokens). The failed original D additionally cost 51,514 tokens; across the original failed run PLUS v4.1 recovery, **155,775 provider tokens** were consumed. These are provider usage metrics, not invoices.

## Original frozen 11-point grading against composed A + D plan

| Criterion | Critical? | Result | Grounded observation |
|---|---|---|---|
| C1 unbalanced 3-phase engine | YES | PASS | Inherited OpenDSS/OpenDSSDirect; NT1 GridLAB-D for inrush/motor transients; NT14 pandapower partial independent static check. |
| C2 multi-period solver | YES | PASS | JuMP+Gurobi inherited from A, with scenario scheduling and backup inventory states (NT10). |
| C3 topology/radiality/islands | YES | PASS | Inherited NetworkX plus NT2 phase-aware igraph continuity and island connectivity. |
| **C4 road/crew/mobile generator logistics** | **YES** | **FAIL** | NT8 implements time-dependent crew routing and NT9 generator **electrical** interconnection, but no concrete vehicle/generator travel route assignment, road-dependent dispatch to generator location, arrival/setup coupling or separate rejection test for mobile generator **transport**. Original A says generator placements but never supplies a generator road-routing contract. |
| **C5 full physical protection and microgrid synchronization** | **YES** | **FAIL** | NT4 uses custom SciPy overcurrent TCC interpolation and fault currents; limited to radial devices, not substantiated for reconfigured DER-fed islands/bidirectional or directional relay selectivity. NT6 PowerSimulationsDynamics models certain inverter dynamics but is not a proven synchronized reclose/synchrocheck chain. AUD-008 claims ET1 snapshot angles and NT6 frequency difference can reject reclosure, yet proposed IF-21 is **ET5 -> NT14 network model**, not a synchronism angle/frequency interface, and IF-25 **NT6 -> ET2** outputs `freq_nadir_hz`, not island-vs-grid angle/frequency differences. D itself admits a complete synchrocheck may require EMT or site relay settings. It selected no concrete corresponding integrated synchrocheck verifier. Missing method, not merely missing field data. |
| C6 correlated uncertainty/rolling horizon | YES | PASS with limits | Inherited stochastic scenarios and rolling replanning; NT7 SciPy stress-test/bounds with explicit refusal to invent covariance. |
| C7 missing inputs/honesty | YES | PASS | Clear missing relay, DER, feeder, road, load and crew data; no invented schedule, no claims to have executed physical grid controls. |
| C8 optimizer-validator feedback | YES | PASS | D sends topology, protection, scheduling, inrush, feasibility flags back to ET2 for candidate rejection/remediation. |
| C9 typed provenance and audit | NO | PASS | NT13 input manifest JSON-schema/hash/Pandera plus NT12 time-stamped epoch diff and version commitment links. Implementable design but not executed. |
| C10 runtime feasibility caution | NO | PASS with limitations | 15-min target marked unverified, planned benchmark NT11 and decomposition retained. Inherited A's snapshot-only fallback is **not** equivalent to all-hour safety verification and may not be used to justify a safety pass. |
| C11 essential/prioritized chain | NO | PASS with limitations | Named tools with specific roles and 30 typed interfaces, mostly open-source; contains extra unproven custom integration and cost/maintenance overhead, with some alternatives inherited from A. |

**Score: 9/11** under the original criterion meanings, **but 2 mandatory critical failures** mean **STAGE 1 FAIL** even with 9/11. The earlier historical K2.6 v3 score and original 9/11 trial are not edited. This is a new rubric application to v4.1.

## Additional five-criterion appropriateness gate

| Gate | Result | Basis |
|---|---|---|
| A1 actual capability substantiation | **FAIL** | No established complete protection selectivity and safe synchronism engine/verification flow across operating states; bespoke TCC requires domain validation. |
| A2 applicability to actual scope | **FAIL** | Phase/earth model fidelity and mobile generator transport remain unproven; NT14 pandapower supports only constrained 3-phase conditions. |
| A3 interface/contract closure | **FAIL** | 30 helpful interfaces but no mobile-gen road transport chain or actual island/grid synchrocheck data/checker interface. |
| A4 independent rejecting verifier | **FAIL** | Various rejection rules given, but C5 critical reconnection/protection acceptance cannot be independently established; individual threshold values alone are not a verified implementation. |
| A5 honest prerequisites | PASS | Missing field data, specialist tool assumptions, benchmarking and custom-engineering prerequisites are disclosed. |

**Supplement 1/5, fail.**

## Independent primary documentation checks

- GridLAB-D does have `motor` objects and `deltamode` transient capability, so NT1 is not a fabricated engine. See [GridLAB-D motor reference](https://gridlab-d.readthedocs.io/en/docs/docs/3.0%20-%20Modeling%20Reference/Modules/Powerflow/Classes/37-motor/) and [transient example](https://gridlab-d.readthedocs.io/en/docs/docs/5.0%20-%20Examples/Outline/). However A's DSS circuit to GLM conversion is still unverified.
- [Sienna PowerSimulationsDynamics documentation](https://github.com/Sienna-Platform/PowerSimulationsDynamics.jl/blob/main/docs/src/index.md) supports inverter dynamic time-domain models and grid-forming academic models, but that does **not** establish a full unbalanced, reclose-time synchrocheck model for the proposed 4,800-bus task without a clearly specified conversion and test chain.
- [pandapower runpp_3ph documentation](https://pandapower.readthedocs.io/en/v3.3.2/powerflow/ac_3ph.html) identifies constraints on supported transformer vector groups, and [pandapower's published scope](https://www.pandapower.org/about/) cautions about asymmetrically built North American feeders. The proposed static independent validator cannot be assumed universal for every feeder configuration.
- No executable specialist tool was installed or run in this stage. These are documentation-backed suitability judgments; the claimed probes remain **future** demonstrations, not tests already passed.

## Distinguishing defects

1. **Old v4 execution failure is fixed.** D returns a complete JSON delta with `finish_reason=stop`, not `length`.
2. **Independent requirement coverage counting is fixed mechanically.** Every mandatory C audit ID has a repair row.
3. **Substantive tool appropriateness remains UNVERIFIED/INCOMPLETE.** K2.6 treats the protection engine and sync checking as covered by plausible named components without providing a capable end-to-end verifier. It also omits mobile-generator road logistics despite crew route work.
4. It is misleading to say a real numerical plan would be wrong: no restoration plan was computed. The evidence establishes **tool-selection insufficiency** and incorrect self-reported closure, not a failed simulation.

**Binding result:** `provider_call_complete=true`, `stage1_pass=false`, `stage2_permitted=false`. Next experiments require a distinct trial; no silent rewrite of v4.1 D.
