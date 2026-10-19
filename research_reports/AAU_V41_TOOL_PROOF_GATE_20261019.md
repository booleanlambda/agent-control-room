# AAU independent executable tool-selection proof gate — v4.1 report

**Status: IMPLEMENTED AND CI-VERIFIED. Result for Kimi K2.6's archived v4.1 toolchain: BLOCKED. Original 11-point model grades remain unchanged; no stage two authorized.**

## Live reproducible receipts

- Research [PR #122](https://github.com/booleanlambda/agent-control-room/pull/122).
- Verified [GitHub Actions run 39320796677](https://github.com/booleanlambda/agent-control-room/actions/runs/39320796677), job 118294225520, **SUCCESS**.
- [Final original test artifact 12220530472](https://github.com/booleanlambda/agent-control-room/actions/runs/39320796677/artifacts/12220530472) holds machine-readable `smoke-results.json`, `tool-proof-verdict.json` and the frozen independent obligation manifest.
- Original saved Kimi A/B/C/D evidence was downloaded from [previous v4.1 run 39317382580](https://github.com/booleanlambda/agent-control-room/actions/runs/39317382580) and checked against the original fixed response hash and challenge. No Kimi was called again.
- Frozen challenge/rubric Git blobs remained `e51781a1a000f59f8c5ba508698c513d6c90bdb6` / `e19e740ebbe52c8772faa34685ffb4165b3883ec`.

## Executable narrow capability probes (all actually ran)

| Probe | Result | Scoped evidence, NOT a full restoration certification |
|---|---|---|
| OpenDSS / OpenDSSDirect.py | PASS | A synthetic three-phase feeder with unequal phase loads converged and returned distinct per-phase voltages |
| Pyomo + HiGHS | PASS | Small mixed-integer binary problem returned expected optimum |
| NetworkX | PASS | Valid graph recognized as tree; injected cycle rejected |
| OR-Tools | PASS | Small vehicle-routing example visited all expected road nodes and returned to depot |
| SciPy | PASS | Piecewise interpolation API returned known expected numerical value |
| Python hashlib + JSON | PASS | Deterministic provenance-hash operation worked |

The first trial found an OR-Tools/HiGHS native-library conflict when importing both in one process; the final rerun ran every probe in a **fresh Python subprocess** and all six passed. The distinction was preserved rather than claiming OR-Tools itself unsuitable.

**Negative tests:** all seven pass. These include deliberate missing mandatory audit rows, unknown tool IDs, false model self-approval, missing generator routing, incomplete synchronism interface and invalid stage-two authorization.

## Externally authored proof obligations and gate verdict

The obligation manifest is derived from the original task and saved independent auditor, not constructed by K2.6. Tool-role mappings are reviewer-authored and intentionally narrow. A named tool or successful smoke test cannot confer task-level pass.

**Missing or unsubstantiated capabilities (5):**

- `C4-mobile-generator-transport`: **ABSENT**. An OR-Tools crew-routing smoke test cannot establish generator vehicle dispatch, routing on flood-closed road segments, travel times, delivery/setup scheduling or link to generator electrical placement.
- `C5-overcurrent-protection`: **UNSUBSTANTIATED**. K2.6 selected a custom SciPy time-current-curve candidate, but simple interpolation does not verify bidirectional DER-fed relay coordination across switching topology.
- `C5-island-grid-reconnection`: **UNSUBSTANTIATED**. K2.6 discussed inverter dynamics but did not demonstrate actual island-vs-grid angle/frequency/voltage synchronization and reclose acceptance.
- `C5-grid-forming-stability`: **UNSUBSTANTIATED**. Named dynamic inverter framework, but applicable island/black-start model and acceptable operating-transition evidence unverified.
- `C5-cold-load-start`: **UNSUBSTANTIATED**. Named GridLAB-D dynamics, but executable capability, DSS-to-GLM model conversion and independent sag/relay-trip acceptance remain unproven.

**Missing critical typed interfaces (3):**

1. `GEN-ROUTE-TO-RESTORATION`: generator_id, route, travel_time, arrival_time and setup_time must connect road assignment to electrical/schedule acceptance with invalid-data rejection.
2. `SYNC-MEASUREMENT-TO-CHECK`: separate phase_angle, frequency, voltage and time measurements/estimates must feed an independent synchronism checker.
3. `PROTECTION-TO-ACCEPTANCE`: independently computed fault, relay and selectivity evidence must feed the optimizer's rejection/feedback.

The independent gate also found that all 14 mandatory auditor IDs have at least one repair row and no invalid ID references or model stage-two request; these **structural checks pass**. They cannot override the missing capability and interface evidence.

### What this proves — and does not prove

This is the first **actual independently executed software-capability verification layer** in the AAU tool-selection experiment. It prevents false-positive selection based on a plausible name, unverified custom code, or Kimi's own declaration of completeness.

The tiny probe cases were synthetic and isolated. They **do not** prove 4,800-bus feasibility, full scenario execution, verified voltage/thermal performance, cold-load dynamics, relay coordination, island synchronization or any live-system safety. Those require real field inputs, true specialist-capability tests, integration contracts and independent domain review before proceeding.

**Verdict: `gate_result=BLOCKED`, `stage1_pass=NO`, `stage2_authorized=false`.** No restoration computation, physical actions, production deployment or merge occurred.

## Code and extensibility

- `experiments/tool-selection-restoration/external_tool_proof_obligations_v1.json`: reviewer-owned task obligation pack
- `experiments/tool-selection-restoration/tool_capability_smoke_probes.py`: six executable, subprocess-isolated narrow probes
- `experiments/tool-selection-restoration/tool_selection_proof_gate.py`: typed contract closure, evidence status and fail-closed decision
- `experiments/tool-selection-restoration/test_tool_selection_proof_gate.py`: seven false-pass regression tests
- `.github/workflows/aau-real-world-debug-v1-live.yml`: reproducible action. Runs no Moonshot inference; downloads frozen model evidence and uploads proof receipts.

This proof gate is a reusable framework. To apply it to a new task, an independent reviewer must supply task-specific critical obligations and an auditable tool-to-role evidence mapping. It cannot generate domain-correct requirements autonomously from software names.
