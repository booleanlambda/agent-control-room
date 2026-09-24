# Model Cognition, Continuity Across Multiple Steps and Arithmetic Reasoning Artifact

**Artifact:** MCCA-SILAS-001 · **Agent:** Silas · **Bound model:** google/gemma-4-31b-it · **Status:** Experimental, independent of MBA assessment.

## Objective
Compare thinking OFF and thinking ON while applying a frozen, unfamiliar 42-day cold-storage business interruption case. Observe initial planning, quantitative cash reasoning, treatment of errors, business decisions, adaptation to new vendor pricing, and written continuity across durable checkpoints.

The case source `CASE42-V1` uses $11,000 starting cash, a $2,500 floor, cash events on days 14, 28 and 35, and three recovery options. `QUOTE-V2` changes rental pricing and is disclosed only at stage 4. The case brief is byte-identical between evidence branches (Git blob `ace26e6a1459cac335c6301226d68e5e894add80`).

## Conditions and interpretation
- **OFF:** Already executed, `enableThinking:false`; original workflow included a failed first calculation, one unsuccessful repair, and separate continuation through stages 3–5.
- **ON:** Independently executed with `enableThinking:true`; no OFF answers are injected. Each ON response stores termination, model identity, token usage, full content hash, assessment and restart checkpoint.
- These are descriptive comparative conditions, **not a randomized or strictly controlled causal experiment**: their persisted plans differ; the OFF run included error-feedback and a repair; ON uses bounded decomposition following a 300-second numerical request timeout.
- Both conditions exercise the bound model with supplied pilot context, **not Silas's full ordinary AAU brain packet**, unaided long-term recall, or formal curriculum verification. Structured evidence checks are not equivalent to correctness of the memo.

## Thinking OFF: completed reference
| Stage | Observable result | Model time |
| --- | --- | ---: |
| Plan | Complete and durably saved | 8.132 s |
| A/B ledger | B correct; eight A fields incorrect | 29.055 s |
| Bounded correction | Reproduced same eight A errors | 37.964 s |
| C and business decision | Coherent conditional business decision; four C cash figures incorrect | 48.894 s |
| Changed quote | Decision changed; eight updated rental figures incorrect | 21.471 s |
| Board memo | Complete and referenced five prior hashes; carried wrong cash figures | 92.253 s |

Evidence: [OFF pilot branch](https://github.com/booleanlambda/agent-control-room/tree/pilot/silas-bounded-continuation-20260924).

## Thinking ON: recorded events
- Step 1 completed, finish `stop`, 60.983 s; 758 provider-reported reasoning tokens, source and plan checks passed. Output hash `307936dc8b1cb35d7aa88626df42d68dc983fb517f87eed2f5f037c0644a5547`.
- First combined A/B request terminated with `NVIDIA_TIMEOUT` at 300 seconds; no calculation was accepted and no inference about arithmetic accuracy is possible from this call.
- A/B ledger is now being attempted as independent bounded substeps; subsequent ON outputs and final comparison remain contingent on observed evidence.

## Independent numeric reference (fictional case)
| Option | Day-42 cash | Lowest cash | Liquidity floor |
| --- | ---: | ---: | --- |
| A, original rent | $5,914 | $3,915 | Pass |
| B, buy | $2,248 | -$535 | Fail |
| C, outsource | $1,380 | -$150 | Fail |
| A, revised rent | $1,672 | $380 | Fail |

These reference values are never supplied to the model as gold answers. The initial OFF and ON values are compared against them only after generation.

## Scope restrictions
No degree credit, grade changes, lifecycle resume, grants, or AAU-wide rules. The experimental flags are to be disabled after the run. Final conclusions must distinguish **correct arithmetic**, **semantic continuity when checkpoints are supplied**, **response transport completion**, and **independent long-term retention**.
