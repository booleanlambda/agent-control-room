# Model Cognition, Continuity Across Multiple Steps and Arithmetic Reasoning Artifact

**Agent:** Silas · **Model:** `google/gemma-4-31b-it` · **Date:** 2026-09-24  
**Status:** completed experimental comparison; no degree/curriculum credit, normal wake, or AAU-wide policy change.  
**Case:** fictional cold-storage venture, 42 days, $11,000 opening cash, $2,500 minimum cash requirement; original CASE42-V1, later QUOTE-V2. Both conditions use the exact same frozen brief (Git blob `ace26e6a1459cac335c6301226d68e5e894add80`).

## Scope and interpretation

This is a **matched-case, not a perfectly controlled one-variable trial**. The OFF path used `enableThinking:false`, mostly 120-second bounded responses, and one failed arithmetic revision. The ON path requested `enableThinking:true`, permitted up to 300 seconds for the primary responses, and **had to decompose the A/B finance work** after the combined stage timed out at 300 seconds and the initial B-only attempt timed out at 180 seconds. The ON substeps were independently generated and persisted; the final stage-2 record was assembled from complete substep records. Accordingly, observed differences cannot be attributed solely to the thinking switch.

Both paths exercise Silas's **bound model with explicitly supplied, durable pilot checkpoints**, not his full autonomous brain/wake or unaided long-term memory. Each completed model response was saved by output hash and re-read. A structurally complete final memo is **not** evidence that all its claims are true.

## Step-by-step observations

| Dimension | Thinking OFF | Thinking ON |
|---|---|---|
| Stage 1: plan | Complete, 8.132 s; checklist passed | Complete, 60.983 s; checklist passed |
| Stage 2: rental A | Incorrect: minimum **$3,896** instead of **$3,915**; eight erroneous fields | Correct: minimum **$3,915**; A bounded calculation took 170.069 s |
| Stage 2: correction | One attempt, 37.964 s; reproduced same eight rental errors | Original combined A/B request timed out at 300 s; initial B-only request timed out at 180 s; smaller B portions took 70.222 s + 149.944 s and produced correct ledger |
| Stage 2: purchase B | Correct: minimum **−$535** | Correct: minimum **−$535**, saved from bounded parts |
| Stage 3: outsourcing C and business decision | Used prior text and flagged earlier A calculation, but C minimum **$350** was wrong (correct **−$150**); four numeric fields failed | Correct C minimum **−$150**, original A preferred under the specified cash floor; numeric/source checks passed |
| Stage 4: revised rental quote | Recognized no option met the $2,500 floor, but calculated a wrong revised minimum of **−$134** (correct **$380**) | Correct revised minimum **$380** and day-28 balance **$2,088**; nevertheless recommended proceeding with A as the only cash-positive alternative, without preserving the mandatory minimum floor |
| Stage 5: final memo | Persisted prior references and conditional decision; repeated wrong monetary amounts | Persisted prior references and accurate monetary amounts; repeated the stage-4 recommendation to proceed with A notwithstanding the $2,500 floor breach |

### Independent arithmetic reference

The correct 42-day minimum balances are **A original: $3,915 (day 35 pre-collection), B: −$535 (day 35 pre-collection), C: −$150 (day 35 pre-collection), A revised: $380 (day 35 pre-collection)**. The revised option A still violates the defined $2,500 minimum, although it avoids negative cash. No initially available option satisfies that requirement after QUOTE-V2. Both calls in the comparison treat collection dates and fictional costs as scenario assumptions, not externally verified market evidence.

### Continuity and judgment

Both conditions completed a multi-stage narrative using preserved prior outputs, correctly referred to preceding output hashes, distinguished hypothetical inputs from verification gaps, and produced substantive board memos. This **demonstrates continuity when the runtime supplies the prior checkpoints**; it does **not** demonstrate independent long-term memory retrieval. Both ON and OFF results were saved across operator-triggered stages and broker deployments.

Thinking ON exhibited better arithmetic in this experiment **after task decomposition**, but its improved numerical precision did **not** guarantee correct application of the given decision constraint. Its own stage-4 narrative explicitly observed that A breached $2,500 yet reframed the goal as staying above zero and recommended proceeding. The structural stage-4/5 checks did not grade that decision against the original requirement; their passing status should not be described as full business correctness. Conversely, OFF retained the original minimum-cash constraint in its revised decision, even while miscomputing intermediate balances.

### I/O and resource observations

All persisted completed responses had normal `finish_reason:stop` (assembled ledgers explicitly identified as assemblies); no evidence of output truncation in the completed stages. Thinking ON stage 3 / 4 / 5 took **171.803 s / 221.953 s / 168.805 s**, with reported reasoning tokens **2,323 / 2,400 / 1,822** respectively. OFF comparable stages took **48.894 s / 21.471 s / 92.253 s**. The ON 300-second combined timeout and 180-second B timeout are actual failed inference requests, not evidence that calculation was completed during those calls. Smaller durable computations subsequently completed.

## Evidence index

**Thinking OFF:** [brief](https://github.com/booleanlambda/agent-control-room/blob/pilot/silas-bounded-continuation-20260924/pilots/silas-bounded-continuation-20260924/brief.json) · [plan](https://github.com/booleanlambda/agent-control-room/blob/pilot/silas-bounded-continuation-20260924/pilots/silas-bounded-continuation-20260924/step_1.json) · [first arithmetic](https://github.com/booleanlambda/agent-control-room/blob/pilot/silas-bounded-continuation-20260924/pilots/silas-bounded-continuation-20260924/step_2.json) · [failed correction](https://github.com/booleanlambda/agent-control-room/blob/pilot/silas-bounded-continuation-20260924/pilots/silas-bounded-continuation-20260924/step_2_revision_1.json) · [business decision](https://github.com/booleanlambda/agent-control-room/blob/pilot/silas-bounded-continuation-20260924/pilots/silas-bounded-continuation-20260924/holistic_step_3.json) · [quote change](https://github.com/booleanlambda/agent-control-room/blob/pilot/silas-bounded-continuation-20260924/pilots/silas-bounded-continuation-20260924/holistic_step_4.json) · [final memo](https://github.com/booleanlambda/agent-control-room/blob/pilot/silas-bounded-continuation-20260924/pilots/silas-bounded-continuation-20260924/holistic_step_5.json).

**Thinking ON:** [frozen brief](./brief.json) · [plan](./step_1.json) · [rental A](./step_2_A.json) · [purchase B part 1](./step_2_B_days_0_28.json) · [purchase B part 2](./step_2_B_days_29_42.json) · [combined A/B](./step_2.json) · [business decision](./step_3.json) · [quote change](./step_4.json) · [final memo](./step_5.json).

## Outcome and boundary

This artifact records a mixed result, not a credential or agent-wide policy determination. Under ON plus bounded decomposition, Silas produced accurate cash arithmetic and maintained the supplied textual references, while incorrectly relaxing the decision's liquidity requirement. Under OFF he made repeated calculation errors but maintained that decision constraint after the revised quote. The two paths vary both model thinking and execution decomposition/time budgets; a causal estimate for the thinking switch alone is **not established**.

Normal Silas lifecycle and Master's verification remain on hold. No academic assessment or AAU-wide rule is modified by this artifact.
