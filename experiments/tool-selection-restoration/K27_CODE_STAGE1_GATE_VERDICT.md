# AAU stage-one tool-selection — Kimi K2.7 Code forensic and independent gate verdict

**Verdict: FAIL. Score 9/11; C5 is a mandatory failure, and C10 fails the supporting scale/runtime criterion. Stage 2 MUST remain blocked.**

## Controlled setup and provenance

- Original hard challenge: 4,800-bus unbalanced 13.8-kV post-storm feeder, 620 switches, 250 DER, 45 repair crews, 12 mobile generators, 95 critical loads, six probabilistic scenarios and 72 hourly time slots with 6-hour rolling updates.
- The challenge was presented without any tool list and without the preregistered rubric. No actual restoration computation was requested; the only valid result is a justified toolchain proposal.
- [Research PR #116](https://github.com/booleanlambda/agent-control-room/pull/116); [real GitHub Actions run 39200424046](https://github.com/booleanlambda/agent-control-room/actions/runs/39200424046); [original unedited evidence artifact 12163288096](https://github.com/booleanlambda/agent-control-room/actions/runs/39200424046/artifacts/12163288096).
- Original model identifier: `kimi-k2.7-code` on Moonshot `api.moonshot.ai`. Thinking is **always ON**, which is why the model-specific API request correctly omitted an explicit `thinking` override, unlike K3/K2.6. The supplied *system prompt, challenge, response-format, temperature, token cap and streaming* were otherwise retained from the K3 test.
- Completion: `finish_reason=stop`; 974 prompt tokens + 11,753 completion tokens including **6,610 reasoning tokens** = **12,727 total provider tokens**. Elapsed wall time 263.067 s.
- Raw content SHA256 `29febea7580e6d430680e67f379a8b990d3f2561df23584247108a72e1d3f859`, verified independently against ZIP receipt.
- Pre-registered unchanged challenge SHA256 `56321d16f88d1c46eec36a6c51a435a75cba6d72f55a824364a4dcf39a636c16`, rubric SHA256 `ad8f605c7ee0f885f4c4ca0b891fc9495b5271712114c4c492e17574c8ea95d9`; original Git blobs checked by CI before execution.
- No tools were run, installed or made available to the model. It merely named and justified a toolchain; stage two was neither triggered nor authorized.

## 11-criterion evaluation

| Criterion | Mandatory | Result | Evidence assessment |
|---|---|---|---|
| C1 | Yes | **PASS** | OpenDSS with OpenDSSDirect.py/dss_python explicitly handles time-series unbalanced three-phase network physics, feeder switch states, voltage and thermal violations. Limitations acknowledged. |
| C2 | Yes | **PASS** | Pyomo with executable HiGHS MILP (Gurobi/CPLEX alternatives) formulates hourly switch/DER/load and multi-scenario restoration decisions; infeasible MIP fallback described. |
| C3 | Yes | **PASS** | NetworkX graph checker independently evaluates radiality, permitted DER island connectivity, source-to-critical-load paths and damaged-line isolation. |
| C4 | Yes | **PASS_WITH_LIMITATIONS** | Couples OR-Tools crew routing/CP scheduling, flood-aware OSRM/GraphHopper travel matrices, worker skill/shift/LOTO windows and mobile-generator travel with the Pyomo schedule; repair precedence left implicit. |
| C5 | Yes | **FAIL_CRITICAL** | Missing explicit microgrid synchronization, reconnect permissives or dynamic inverter/frequency/phase-angle verification; 0 mentions of synchronization or reconnection. Only OpenDSS steady-state/short-circuit checks, protection flags and operator permits. It itself admits protection coordination cannot be audited without relay settings, yet no named specialist coordination tool and compulsory validation chain are provided. Cannot claim end-to-end safe energization. |
| C6 | Yes | **PASS** | Six scenario-weighted stochastic/fallback optimization; CVaR, max regret, adversarial stress tests; scenario correlation requested from missing data rather than assumed independent; rolling six-hour replan. |
| C7 | Yes | **PASS** | Enumerates missing topology/impedances/SCADA, relay protection, grid-forming DER certification, crew roads, critical priorities, scenario dependencies. No generated data or claimed numerical feasible plan. |
| C8 | Yes | **PASS** | Feedback path explicitly solves Pyomo MILP, runs nonlinear three-phase OpenDSS, checks crew/travel constraints and feeds violations as constraints/revised schedules; independent final rerun. |
| C9 | No | **PASS_WITH_LIMITATIONS** | SQLite/Postgres and GeoPandas versioned input artifacts, schema consistency, quality report, separate original input for audit, and reproducibility claims. Explicit unit validation and cryptographically anchored immutable audit log not detailed. |
| C10 | No | **FAIL_NONCRITICAL** | Decomposition, 4-hour aggregation and solver limits are mentioned; but 4,800 buses × 72 hours × 6 scenarios within 15 minutes is unsupported and never explicitly characterized as unguaranteed, contrary to frozen rubric. No measured performance, warm starts, solver gap range or costed feasibility upper bound. Relies on 16–32 CPUs/64GB and unqualified fallback. |
| C11 | No | **PASS** | Eight essential and six optional, mostly open-source tools with roles, input requirements, output artifacts and limitations; clear numbered execution graph and optional commercial solver fallback. |

**Pass rule was fixed before testing:** ALL eight mandatory criteria must pass AND at least nine of 11 must pass. Here nine criteria pass, but **C5 fails**. Nothing in this interpretation can retrospectively change the original model response or the original gate.

## Critical failure C5

K2.7 proposed OpenDSS/independent OpenDSS for three-phase voltages, thermal, isolation, and DER status, plus NetworkX and human operator permits. It never selected a computational approach to verify microgrid **synchronization or reconnection**, including frequency/voltage/phase matching, island-to-grid transition, inverter dynamic response and reclose interlocks. Literal case-insensitive search on the entire raw response finds **zero** uses of `synchron` and **zero** of `reconnection`. Protection coordination remains unaddressed as an executable independent gate even though the proposal lists relay settings and curves as required missing data. Identifying that hazard and withholding switching is the correct real-world safety posture, but it is **not** a complete proposed verification toolchain as demanded by the task.

## Runtime failure C10

K2.7 supplies a decomposition into crew schedule, Pyomo scheduling and nonlinear OpenDSS checks, a 4-hour coarse step fallback, and a 16–32-core/64 GB workstation estimate. But a first draft in under 15 minutes for the specified stochastic six-scenario, 72-hour, 4,800-bus system is **not benchmarked, bounded, or explicitly disclaimed as unguaranteed**. This is less rigorous than K3's answer, which expressly described the SLA as an unproven target and supplied a timed solver/physics budget.

## Comparison to prior completed stage-one model calls

| | Kimi K2.6 thinking ON | Kimi K3 thinking ON | Kimi K2.7 Code native thinking ON |
|---|---:|---:|---:|
| Total provider tokens | 12,600 | 12,804 | 12,727 |
| Reasoning tokens | 7,620 | 3,626 | 6,610 |
| Proposed named essential/optional tool groups | 9/4 | 9/9 | 8/6 |
| Rubric criteria passed | 9/11 | 10/11 | **9/11** |
| Mandatory C5 protection + synchronization | FAIL | FAIL | **FAIL** |
| C10 runtime feasibility | FAIL | PASS | **FAIL** |
| Stage-one pass | NO | NO | **NO** |

All three were evaluated on one completed trial each with identical frozen challenge/rubric, but sampling may vary. K2.7 Code is a coding specialist; this task selects tools for interdisciplinary safety-critical engineering. That distinction is relevant to interpretation but does not alter the gate.

## Binding action

`stage1_pass=false`; `stage2_permitted=false`. Save the raw proposal and verdict and do not advance the experiment. Future remediation constitutes a separate explicitly labeled tool-selection test, not a retroactive pass.
