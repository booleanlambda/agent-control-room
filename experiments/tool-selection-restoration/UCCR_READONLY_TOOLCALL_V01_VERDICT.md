# AAU UCCR K2.6 — Real Read-Only Tool-Calling Test
**2026-10-20 | Stage 1 BLOCKED | Stage 2 prohibited**

[Research PR #128](https://github.com/booleanlambda/agent-control-room/pull/128) ·
[Actions run #39462890216](https://github.com/booleanlambda/agent-control-room/actions/runs/39462890216) ·
[Immutable run artifact #12284136617](https://github.com/booleanlambda/agent-control-room/actions/runs/39462890216/artifacts/12284136617)

## Method and controls
- Same frozen power-grid restoration problem (`challenge.json`, Git blob `e51781a1a000f59f8c5ba508698c513d6c90bdb6`).
- Same generic V5 system prompt (Git blob `e520242011970ad10338a9b764896db2ada38bd6`).
- Same hidden original rubric; Kimi never saw grading criteria.
- Read-only tool server within GitHub Actions runner, backed by a Git-blob-pinned SQL-generated export from the private **live Supabase UCCR database**, six operations. This is **NOT live SQL access during inference**. No DB credential or write tool is provided to Kimi.
- Two advertised function tools: `search_capabilities(query)` and `inspect_operation(operation_id)`. Tool results are produced by deterministic local registry code, not invented model text.
- Moonshot `kimi-k2.6` thinking explicitly enabled, SSE streaming, one research session, no transport retries. On tool-call turns the exact provider `reasoning_content` is preserved **in RAM** to maintain proper Kimi thinking-on tool-call replay, but not published as raw hidden thinking.
- Provider model output and direct tool-call evidence archived separately from independent verification. No Stage 2, field instructions or production agent changes.

## Verified provider execution
- Workflow successful.
- One Kimi session, **three provider calls**, with `finish_reason=[tool_calls,tool_calls,stop]`.
- **Eight actual provider-requested function calls**: four search operations + four detailed API inspections, all serviced without broker errors.
- Model output complete; total **28,998 provider tokens**.
- Kimi explicitly cited **four** precise database operation IDs:
  `op.opendss.phase_voltage.v0`, `op.networkx.is_tree.v0`,
  `op.pyomo.highs.binary_mip.v0`, `op.ortools.routing_tiny.v0`.

Exact registry searches issued:
1. `electric three-phase power flow`
2. `graph radiality`
3. `stochastic mixed-integer programming`
4. `vehicle routing time windows`

Four matching `inspect_operation` requests followed. Crucially, Kimi **did not search** the catalog for generator road transport, protection/fault coordination, microgrid-to-grid synchronism/reclose, transient grid forming or motor-start dynamics. Missing entries in the catalog do not prove those computations impossible; a specialist candidate and separate validation would have been needed.

## Toolchain selected
7 named tools/components:
1. OpenDSS via dss-python
2. Pyomo
3. HiGHS
4. Google OR-Tools Routing
5. NetworkX
6. Python + Pandas + NumPy
7. Custom Python auditor

Kimi declared **six hard computational requirements C1..C6**, seven requirement-to-tool mappings `R1..R7`, seven independent rejection tests `V1..V7`, and six typed interfaces `IF1..IF6`.

## Independent result
**`BLOCKED_INVALID_SELECTION_STRUCTURE`**, 27 structural findings:
- 7 `UNKNOWN_REQUIREMENT_MAPPING` because mapping rows point to `R1..R7` while required computations are declared as `C1..C6`.
- 6 `HARD_REQUIREMENT_UNMAPPED`.
- 7 `TOOL_UNKNOWN_REQUIREMENT`.
- 7 `TEST_UNKNOWN_REQUIREMENT`.

This is the *same class* of type/ID drift as the prior assisted test (`comp_` vs `req_`), despite Kimi now using actual function calls.

**Executable-API finding:** Kimi no longer used the nonexistent `nx.has_cycle(...)` API. However its proposed NetworkX expression `all(nx.is_arborescence(G_sub) for G_sub in weakly_connected_components) and all(in_degree <= 1 for n in G_sub.nodes())` is **not executable as written**: `weakly_connected_components` is undefined in the selected invocation (even when `import networkx as nx` is present). A direct execution probe against installed NetworkX 3.6.1 confirmed `NameError`. These graph and physical validations remain separate.

**Application gaps:**
- No complete mobile-generator **road route → travel/arrival → setup → dispatch** computational path or typed validator; generator placement is named as a decision but not solved as synchronized transport.
- No complete specialist short-circuit/protection relay selectivity verifier on reconfigured DER-fed islands or independent phase/frequency/voltage island-grid synchrocheck.
- Kimi explicitly admits cold-load pickup and motor-start transients, grid-forming/black-start stability, network data and runtime feasibility are unresolved. Those are mandatory constraints rather than optional scope exclusions.
- Proposed end-to-end 15-minute schedule performance was not benchmarked; no real utility network files were supplied.

All 6 catalog entries remain **NARROW_API_PROVEN_ONLY**, based on previous executable small independent probes. A successful search/inspection call does not increase their verified scope.

## Controlled comparison — interpret conservatively
| Condition | Live provider completed | Selected tools | API records explicitly cited | Structural findings | Stage 1 |
|---|---:|---:|---:|---:|---|
| Original blind V5 ([run 39451190485](https://github.com/booleanlambda/agent-control-room/actions/runs/39451190485)) | Yes | 7 | N/A | 4 | Blocked |
| Static registry reference ([run 39455936347](https://github.com/booleanlambda/agent-control-room/actions/runs/39455936347)) | Yes | 9 | 4 | 34 | Blocked |
| Real read-only function calling ([run 39462890216](https://github.com/booleanlambda/agent-control-room/actions/runs/39462890216)) | Yes | 7 | 4 | 27 | Blocked |

These error counts are **not comparable intelligence scores**: response lengths and instructions differ, and the blind gate's mandatory-flag handling was later corrected. No numeric 11-criterion domain grade is invented. The appropriately narrow conclusion is that **registry-backed tool calling worked, but did not eliminate mandatory tool-selection and interface problems**.

## Specific next architectural improvement, not represented as tested here
1. Independently enumerate hard computational requirements BEFORE Kimi searches (the private DB already stores 14 for the sample recipe).
2. Give each requirement one stable identifier owned by the deterministic control plane. Require Kimi to choose compatible operations or mark a missing specialist method for EVERY identifier.
3. Reject invented `req_` aliases or mismatched references before a toolchain candidate is accepted; never silently guess that two non-identical IDs mean the same computation.
4. Require search coverage of mobile generator transit, directional protection, dynamic grid-forming, synchrocheck and motor-start as mandatory query classes, with empty catalog results forcing externally evidenced discovery instead of fictional coverage.
5. Execute the *actual proposed API snippets*, typed inter-tool transforms, negative tests and workload benchmarks before promoting any capability status.
6. Run a new controlled benchmark only after this change, saving a new provider receipt and never overwriting the frozen V5 comparison.

**Current external disposition: Stage 1 = BLOCKED. No toolchain is certified as sufficient/appropriate/executable/interoperable/right-fit.**
