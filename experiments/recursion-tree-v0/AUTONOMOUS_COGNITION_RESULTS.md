# AAU Autonomous Cognition Stress Test — 8-hour microgrid

**Experiment ID:** `AAU_AUTONOMOUS_MICROGRID_COGNITION_V1`  
**Date:** October 16–17, 2026 UTC  
**Scope:** Draft research-only PR #45. **No Silas, production worker, Supabase, or RabbitMQ changes.**

## Purpose

Measure whether non-thinking lightweight LLMs can independently choose a task plan
and correct computational method for a nontrivial engineering problem. This is
a step beyond the prior known-split classification tree. The runtime supplies
optional deterministic calculation tools, but **does not prescribe the split
tree, generator schedule, or optimal value in the LLM prompt.**

Problem: eight hourly generator output decisions from `{0,2,3,4,5}`,
electric demand and solar, battery 0–6 kWh with ±2 kWh/hour rate,
initial SoC 3, final SoC ≥3, ramp ≤3 per hour, generator energy ≤30,
time-varying costs, quadratic fuel cost, startup penalties and a high-output
surcharge at two specified hours.

Reference: independent JavaScript full-enumeration search, memoized dynamic
programming, and separately implemented Python full enumeration:
**390,625** total generator sequences, **3,013** feasible sequences,
**unique optimum 467**, generator schedule
`[3,4,4,3,4,4,3,4]`, SoC path
`[3,3,3,5,3,3,4,2,3]`, 29 generator kWh.
The reference optimum was not passed into either model's initial context.

## Live authenticated results

Run: [AAU Autonomous Engineering Cognition One Shot #38993116578](https://github.com/booleanlambda/agent-control-room/actions/runs/38993116578).

### Kimi K2.6, thinking disabled — tool-assisted pass

Artifact: `aau-autonomous-microgrid-kimi-k26`, ID **12085619447**.

- **4 actual model calls**, **8,623 provider-reported tokens**,
  four HTTP 200 responses, four `finish_reason=stop`,
  no `reasoning_content`; combined model-request latency **55.965s**
  (wall time is greater due enforced **3 RPM** pacing).
- Without a supplied decomposition tree, Kimi authored this sequence of
  **four subtasks**: identify full DP state; formulate recurrence and costs;
  run DP optimization; validate schedule and explain optimality.
- Chosen sufficient state:
  `(hour, battery_state, previous_generation, cumulative_generation)`.
  It correctly identified previous output as needed for ramp and startup
  costs, and cumulative generation as needed for the emissions cap.
- Asked the exact DP tool with a proposed recurrence; the **deterministic
  runtime optimizer**, not Kimi's unaided arithmetic, computed the
  optimum (128 DP states, 555 candidate transitions).
- Then independently selected the candidate-evaluation tool, which
  confirmed cost **467**, generator output **29** and SoC
  `[3,3,3,5,3,3,4,2,3]`.
- Final submitted generator schedule
  `[3,4,4,3,4,4,3,4]` and claimed optimum **467** matched an
  independent exhaustive verifier. **Zero semantic/final revisions needed.**
- Kimi gave a verbal Bellman optimality argument and its state formulation
  is defensible. The benchmark's deterministic acceptance gate verifies
  numeric optimality and minimum proof length, **not a formal natural-language
  theorem proof**. Do not claim Kimi derived all 467 units without its tools,
  or achieved PhD-level reasoning from one example.
- Its prior ten-depth synthetic classification test is not directly
  comparable in token cost or task difficulty.

### NVIDIA Nemotron 3.5 Lightning 30B A3B, thinking disabled — inconclusive

Artifact: `aau-autonomous-microgrid-nemotron`, ID **12086026499**.

- **2 model requests**, **855 provider-reported tokens** (from the one
  successfully returned response). First call HTTP 200 and
  `finish_reason=stop`, **75.582s** latency, producing a one-step
  DP formulation plan.
- Second request exceeded the explicit **80s** transport deadline,
  aborted with no final response, and no additional provider tokens were
  reported. A timed-out provider call may still consume remote resources.
- No candidate schedule or optimizer call completed; **no mathematical
  verdict is possible**. It is a transport/latency failure, not a
  verified bad decomposition or failed cognition. The two runs are NOT a
  controlled equal-cost comparison; request latencies, context handling
  and provider policies differ.

## Independent verifier methodology

- `autonomous-engineering-benchmark.mjs`: hidden exact evaluator,
  exhaustive reference enumeration and independent memoized DP.
- `autonomous-engineering-reference.py`: separate Python implementation
  exhaustively audits all `5^8` output sequences without importing JS.
- `autonomous-engineering-benchmark.test.mjs`: four independent tests
  of optimum, feasibility, consistency and the proposed-DP-state gate.
- `autonomous-engineering-live.mjs`: real model runner; per-provider
  bounded call/tokens, no automatic inference retries, no predetermined
  task tree, model-controlled optional `plan`, `evaluate` and
  `optimize` actions, hidden final answer grader.
- The full deterministic experimental suite (now **85 tests**) passes:
  [CI run 38993172392](https://github.com/booleanlambda/agent-control-room/actions/runs/38993172392).
  The independent Python proof also passed the same CI.
- One-shot credentialed GitHub workflow was deleted immediately after
  dispatch. The evidence remains as artifacts and immutable GitHub
  Actions logs; neither run will be repeated automatically.

## Inference limits and next gates

This was an authentic live **tool-augmented cognition** experiment, but
not proof of tool-free advanced mathematics. A more challenging next
assessment would require model-authored code or a verified recurrence
derived without receiving the numerical optimum from a full-solver tool,
and multiple unseen engineering instances to test generalization.

Before any production deployment, the still-failing independent
`Systemic Runtime Tree CI` must be investigated and repaired. PR #45
remains **draft and unmerged**; Silas remains untouched.
