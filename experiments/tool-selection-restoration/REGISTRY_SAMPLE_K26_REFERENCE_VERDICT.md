# AAU computational capability registry sample — Kimi 2.6 reference test

**Date:** 2026-10-20  
**Scope:** Stage 1 only; unchanged power-grid restoration question; unchanged generic V5 system prompt; additional **illustrative sample registry** user-message and instruction to cite matching operation IDs.  
**Original run:** [GitHub Actions 39455936347](https://github.com/booleanlambda/agent-control-room/actions/runs/39455936347)  
**Full frozen evidence:** [Artifact 12280792701](https://github.com/booleanlambda/agent-control-room/actions/runs/39455936347/artifacts/12280792701).  
**Baseline blind run:** [39451190485](https://github.com/booleanlambda/agent-control-room/actions/runs/39451190485).  
No production database, live field operation, real-grid data, stage-two solve or automatic model retry.

## Sample registry

`capability_registry_sample_v01.json` contains six evidence-scoped computational operations. It is **a Git-versioned JSON sample**, not an actual populated Supabase database or a universal catalog.

| Sample operation_id | Package | Tested narrow capability |
|---|---|---|
| `op.opendss.phase_voltage.v0` | OpenDSSDirect 0.9.4 | Synthetic asymmetric phase voltages |
| `op.pyomo.highs.binary_mip.v0` | Pyomo 6.10.1 + highspy 1.15.1 | Tiny binary MIP optimum |
| `op.networkx.is_tree.v0` | NetworkX 3.6.1 | Tiny cycle/tree rejection |
| `op.ortools.routing_tiny.v0` | OR-Tools 9.12.4544 | Depot plus three-visit route |
| `op.scipy.linear_interp.v0` | SciPy 1.17.1 | Numeric linear interpolation |
| `op.python.sha256_json.v0` | Python stdlib | Repeatable JSON content hash |

**Important:** The records specify untested negative rejection conditions, limitations and known unavailable broader domain capability. A narrow probe PASS does NOT imply every proposed fault injection was actually executed or that full task-level safety was verified.

## Actual Kimi consultation

Kimi K2.6 thinking ON: one SSE streamed API call, `response_format=json_object`, `finish_reason=stop`, thinking observed, **411.688 seconds**, **29,404 total provider tokens** including **16,294 reasoning tokens**. One complete JSON response, no known timeout or output-cap failure.

Kimi **explicitly referenced 4 of 6 sample operation IDs**, corresponding to OpenDSS, Pyomo/HiGHS, NetworkX, and OR-Tools. It omitted explicit operation IDs for SciPy interpolation and Python hashing.

Kimi proposed **9 tools**:
Pyomo+Gurobi; OpenDSSDirect; GridLAB-D; NetworkX; OR-Tools; OSMnx; Pandas+PyArrow; custom Python audit harness; PostgreSQL+PostGIS.

It defined **9 required computations, 6 interface contracts and 5 independent tests**. It self-classified as `PROPOSAL_FOR_EXTERNAL_VERIFICATION`, not pass.

## Independent outcome

The external structural verifier returned **`BLOCKED_INVALID_SELECTION_STRUCTURE` with 34 findings**. The model's `required_computations[]` use identifiers beginning `comp_`, while `requirement_to_tool_mapping[]`, selected tool `requirement_ids`, and verifier test requirement references use unrelated identifiers beginning `req_`. Thus all nine declared hard computations remain unmapped to the named toolchain in machine-verifiable terms, and tests/tools point to unknown requirement IDs. Two mapping rows also lack verifier IDs.

These are not semantics-only criticisms: they are exact invalid foreign-key references. The response cannot be reliably assembled as a graph or verified through its declared contracts.

**Task suitability remains incomplete:** No full mobile-generator road transport -> arrival/setup -> electrical placement computation or independent test is selected. Kimi acknowledges unknown protection zones but does not select an executable fault/relay coordination + DER-fed island selectivity verifier or explicit island-grid synchronism checker. Its own final assessment says critical safety layers lie outside computational coverage, so the mandatory C4/C5 gate cannot be declared passed. It also proposes the online call `osmnx.graph_from_place(...)` despite the offline task requirement, and a Gurobi-based optimization dependency despite no pinned license/installation/execution evidence or full-cost benchmark.

**Narrow software tests:** All six original sample probes were independently rerun with `PASS_NARROW_CAPABILITY_ONLY`. These confirm that the indicated small operations still execute, not that Kimi's selected cross-package chain works.

## Comparison interpretation

The original blind V5 response had four missing required verifier references under the previous structural gate. The assisted run has 34 structural findings, dominated by `comp_` / `req_` identifier drift. These counts are **not comparable as a toolchain intelligence score**: the input was augmented with a long registry example, the responses differ, and the original gate's hard-requirement type handling was subsequently corrected. They do show that reference examples alone do not guarantee compliant typed output.

## Decision

- Sample catalog created: **YES**, six evidence-scoped operation records.
- Kimi consulted it: **YES**, explicitly cited four record IDs.
- Provider response completeness: **PASS**.
- Independent typed requirement graph: **FAIL**.
- Critical domain coverage: **UNVERIFIED / INCOMPLETE**.
- Stage 1: **BLOCKED**.
- Stage 2: **NOT AUTHORIZED**.

## Next engineering correction, not applied to this frozen result

Keep the sample and original Kimi response unchanged. Before making any more paid inference calls, implement a **deterministic ID allocator and schema-reference validator** that rejects or repairs only identity aliases with explicit proof, without inventing missing computations; validate proposed catalog citations against exact operation API/version and require separate domain-specific capability probes for missing critical operations. For strict model comparison, hold prompt and question fixed and vary only the catalog reference material, then use the same independently frozen judge.
