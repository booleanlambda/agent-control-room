# AAU Toolchain Prompt V6 — Kimi K3 thinking-OFF controlled retest

**Run:** https://github.com/booleanlambda/agent-control-room/actions/runs/39500419293
**Artifact:** 12301315329 (`aau-k3-off-v6-prompt-selfaudit-full-evidence`)
**Source:** frozen challenge, frozen eleven-item rubric, identical UCCR export and same Parallel Search limits as V5.
**Prompt V6 git blob:** `4746107111c7b6c99131396965db364016ae33f0`; V5 git blob preserved.
**Stage 1 selection verdict: BLOCKED. Stage 2: NOT AUTHORIZED.**

## Comparison against last K3 thinking-OFF V5 live discovery run

| Metric | V5 run 39478425234 | V6 run 39500419293 |
|---|---:|---:|
| Provider turns | 7 | 7 |
| Real provider tool invocations | 26 | 17 |
| Successful bounded Parallel API calls | 6 | 6 |
| Provider tokens | 72,933 | 86,714 |
| Thinking OFF receipts | All turns | All turns |
| Structural mapping errors | 0 | 0 |
| Exact registry operation IDs cited in output | 0 | 4 |
| Previously seen literal regression patterns | Various | 0/6 detected |
| Final model assessment | PROPOSAL_FOR_EXTERNAL_VERIFICATION | BLOCKED |

**Critical accuracy caveat:** The zero-regression count is a STRING PATTERN detector, not a proof that known mathematical/operational failure types have been corrected. V6 changed the spelling of the time-rounding error but preserved an unsafe temporal mapping.

## Improvements actually observed

1. Replaced false PySP==6.0.0 package selection with direct scenario-indexed Pyomo+HiGHS and explicit scale limitations.
2. Corrected OpenDSSDirect dependency command: `pip install opendssdirect.py==0.9.4 dss-python==0.15.7`.
3. Included official source links, explicit documented/unverified labels and four registered `op.*` UCCR operation citations.
4. Made generator travel, physical arrival, site setup/connection, DER protection, cold-load/motor, synchronism and GFM eligibility explicit.
5. Identified previous OR-Tools/HiGHS shared-process native library collision as an environment integration limitation.
6. Appropriately marked all 10 proposed tests NOT_RUN; stated Stage 1 BLOCKED rather than suggesting verification had passed.

## Critical unresolved / new errors in V6

### V6-S1 — Unsafe slot conversion (CONTRADICTION, CRITICAL)

The original V5 had `datetime rounded to nearest hour`. V6 changed interface I1 to `Seconds -> slot index with floor` and states `a resource is available no earlier than the slot containing its arrival`; I2 repeats `arrival slot = floor(arrival_s/3600)`. **At 08:29, floor(8*3600+29*60 over 3600)=8**, i.e. slot 08:00. If availability is represented by this slot, a resource may be made available 29 minutes before arrival. I2 also says `energization not permitted before arrival+setup+connection+clearance`, but the interface fails to say how this invariant survives the lossy floor. These are inconsistent specifications and MUST remain blocked unless the MILP retains exact seconds or uses a conservative ceiling to the next schedulable start. Semantic failure caught by manual audit, MISSED by V6 regex regression audit.

### V6-S2 — OSRM installation command has host/container boundary error (CONFIRMED FROM SHELL SEMANTICS)

K3 proposed: `docker run ... osrm-extract ... && osrm-partition && osrm-customize && osrm-routed ...`. The `&&` commands after the first Docker invocation run **on the host shell**, not inside the finished Docker container. Official OSRM instructions run separate `docker run ...` commands for extract, partition, customize and routed, with proper `.osm.pbf` input and persistent mount. As-written installation is not executable on an ordinary host without those binaries. This defect bypasses a regression rule merely checking whether the string `osrm-extract` appears.

### V6-S3 — Synchrocheck frequency source is unsubstantiated (CRITICAL)

I4 states that OpenDSS (T4) outputs each island side's `f_hz` for differential-frequency checking. The T4 operation specified is steady-state/QSTS load flow, which does **not** independently measure dynamic island frequency on the two sides of an open switch. Voltage-angle snapshots alone cannot establish Δfrequency during synchronization. Requires measured phasors/PMUs or a validated dynamic power-electronics simulation and exact time alignment. The proposed source contract is therefore insufficient for the stated synchrocheck computation.

### V6-S4 — New specialist tool invocations remain underspecified

- T6 `pandapower.pf.runpp_3ph(net)` does not match the documented public example `from pandapower.pf.runpp_3ph import runpp_3ph; runpp_3ph(net)` or `pandapower.runpp_3ph(net)`; the selected relay-coordination PyPI distribution **is real** (release 1.0.5), but K3 does not name its documented `run_coordination_analysis` or `run_sc_analysis` API.
- T7 `python -m auditor.synchrocheck` and T10 `python -m auditor.run` reference unimplemented private modules. There is no verified source artifact or executable contract beyond prose.
- T8 research small-signal repo lacks a pinned callable installation/black-start EMT execution method and shifts escalation to unlicensed PSCAD.
- T9 GridLAB-D `installation_command` is only `See https://gridlab-d.readthedocs.io/en/docs/`, not an executable install instruction.
- Independent power-flow and IEC 60909 short-circuit checks are relevant but NOT validated here against DER fault-current, damaged protection zones, microgrid reclosing, cold-load pickup or motor-start transient physics.

## Final scoring distinction

- **Prompt compliance and structural integrity:** improved (0 structural errors again, 4 exact registry citations).
- **Known specific PySP/OpenDSS dependency mistakes:** fixed.
- **New semantic safety-contract and Docker execution mistakes:** remain and are disqualifying for a completed toolchain.
- **All actual proposed tool execution tests:** NOT_RUN in the V6 model trial (by design).
- **No extra model verification call:** only existing K3 function-call session and a deterministic Python structural regression audit.
- **Independent toolchain suitability:** NOT PASSED. Kimi itself appropriately selected `stage1_assessment.status = BLOCKED`.

## Primary documentation

- OSRM containerization: https://github.com/Project-OSRM/osrm-backend
- pandapower asymmetric API: https://pandapower.readthedocs.io/en/v2.6.0/powerflow/ac_3ph.html
- PyPI relay-coordination (genuine package): https://pypi.org/project/relay-coordination/
- OpenDSS power-flow scope: https://opendss.epri.com/PowerFlow.html

**No runtime/model/prompt modifications were made after this experiment. The exact V6 response remains archived.**