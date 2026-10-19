# Retrospective turn-by-turn forensics — Kimi Net3 tool execution

**Read-only reconstruction from the original evidence, authored after the experiment.** Do not confuse Kimi's recorded `why` field with any private reasoning. Neither the original tool response, hidden truth, test scorer, nor model prompt has been edited to make results pass.

- One-run evidence: https://github.com/booleanlambda/agent-control-room/actions/runs/39179160997/artifacts/12155915604
- Live workflow: https://github.com/booleanlambda/agent-control-room/actions/runs/39179160997
- Test source PR: https://github.com/booleanlambda/agent-control-room/pull/106
- Evidence ZIP SHA-256: `630b83b69d77e2868fbcbf23d9e5752b4572550336578c8d71855ee6058dbe87`
- Audit head: `39a60e1e7a84e036ff36c4706f92f3342148170e422ed8044360fd2fb8c2e322`
- Independently recalculated: **22/22 event hashes valid, 10/10 model response hashes valid**, original measurement hash valid.
- Model: Kimi K2.6, thinking OFF, six available real computational tools; `MAX_CALLS=10` was imposed by the **assistant-built experimental runtime**, not by Kimi or the AAU user.

## Raw 10-turn analysis

| Turn | Tool | Provider tokens | Cumulative | Result |
|---:|---|---:|---:|---|
| 1 | `inspect_network` | 639 | 639 | Correct setup: 92 junctions, 117 pipes, 14 sensors; no hospital node or physical authorization. |
| 2 | `inspect_observations` | 870 | 1,509 | Read 14 synthetic pressure deltas; maximum notable drop at sensor 145 was -8.92259 m. |
| 3 | `scan_single_leaks` | 1,530 | 3,039 | Executed 92 hydraulic candidate simulations; true node 149 ranked fifth, true node 241 was not included in output top 25. |
| 4 | `fit_two_leaks` | 2,496 | 5,535 | Compared 300 (25 choose 2) pairs using linearized least squares. First predicted pair [145,251], linearized RMSE 0.0445774 m. Tool excluded hidden true node 241. |
| 5 | `simulate_pair` | 3,180 | 8,715 | Nonlinear EPANET RMSE 0.0801557 m, maximum absolute error 0.28344 m; linearized rank not definitive. |
| 6 | `simulate_pair` | 3,420 | 12,135 | Nonlinear RMSE 0.0404948 m, max error 0.1244968 m; improvement vs previous pair. |
| 7 | `simulate_pair` | 3,677 | 15,812 | RMSE 0.088505 m; worse than turn 6. |
| 8 | `simulate_pair` | 3,910 | 19,722 | RMSE 0.1308524 m; worse than turn 6. |
| 9 | `simulate_pair` | 4,138 | 23,860 | RMSE 0.0283838 m, max error 0.0640365 m; best pair actually tested. Not hidden truth. |
| 10 | `simulate_pair` | 4,389 | 28,249 | Exact repeat of turn 6 with identical arguments and RMSE 0.0404948 m. Kimi said it would adjust coefficients but didn't. Run stopped at assistant-authored MAX_CALLS=10; no final answer. |

## Kimi's actual choice, stated purpose, and observed outcome

### Turn 1 — inspect_network

**Kimi's recorded justification (verbatim):** First, I need to understand the network topology, sensor locations, and units to properly interpret observations and plan my analysis.

**Actual arguments:** `{}`

**Independent observation:** Correct setup: 92 junctions, 117 pipes, 14 sensors; no hospital node or physical authorization.

### Turn 2 — inspect_observations

**Kimi's recorded justification (verbatim):** I need to see the actual synthetic pressure measurements and baseline residuals at the 14 sensors to understand the leak signature I'm trying to match.

**Actual arguments:** `{}`

**Independent observation:** Read 14 synthetic pressure deltas; maximum notable drop at sensor 145 was -8.92259 m.

### Turn 3 — scan_single_leaks

**Kimi's recorded justification (verbatim):** I need to build a library of single-leak hydraulic signatures. The large pressure drop at node 145 (-8.92m) suggests a leak very nearby. Smaller drops at 243, 219, 207, 199, 273 suggest a second leak elsewhere. Single-leak scan will help identify candidate locations.

**Actual arguments:** `{}`

**Independent observation:** Executed 92 hydraulic candidate simulations; true node 149 ranked fifth, true node 241 was not included in output top 25.

### Turn 4 — fit_two_leaks

**Kimi's recorded justification (verbatim):** The single-leak scan shows node 151 as top candidate with RMSE 0.76m, but the caution note says single-leak rankings misrank with two leaks. I need to use the two-leak fitting tool which uses the cached single-leak signatures and nonnegative least squares over candidate pairs to find the best combination.

**Actual arguments:** `{}`

**Independent observation:** Compared 300 (25 choose 2) pairs using linearized least squares. First predicted pair [145,251], linearized RMSE 0.0445774 m. Tool excluded hidden true node 241.

### Turn 5 — simulate_pair

**Kimi's recorded justification (verbatim):** The top pair from fit_two_leaks is [145, 251] with linearized RMSE 0.0446m. I must verify this with full nonlinear EPANET simulation before trusting it. This is the critical validation step warned about in the tool description.

**Actual arguments:** `{"nodes":["145","251"],"coefficients":[0.0094274,0.0141862]}`

**Independent observation:** Nonlinear EPANET RMSE 0.0801557 m, maximum absolute error 0.28344 m; linearized rank not definitive.

### Turn 6 — simulate_pair

**Kimi's recorded justification (verbatim):** The [145,251] pair had full simulation RMSE 0.080m, which is good but I should check the second-ranked pair [141,251] to compare. The linearized RMSE was 0.0509m vs 0.0446m for the first pair - close enough that nonlinear effects could change the ranking.

**Actual arguments:** `{"nodes":["141","251"],"coefficients":[0.0108015,0.0141105]}`

**Independent observation:** Nonlinear RMSE 0.0404948 m, max error 0.1244968 m; improvement vs previous pair.

### Turn 7 — simulate_pair

**Kimi's recorded justification (verbatim):** The [141,251] pair significantly outperforms [145,251] in full simulation: RMSE 0.0405m vs 0.0802m with max error 0.124m vs 0.283m. I should check the third-ranked pair [145,255] to ensure I'm not missing a better solution, and also to understand if 145 or 141 is the better first node.

**Actual arguments:** `{"nodes":["145","255"],"coefficients":[0.0094188,0.0168133]}`

**Independent observation:** RMSE 0.088505 m; worse than turn 6.

### Turn 8 — simulate_pair

**Kimi's recorded justification (verbatim):** [141,251] remains best so far with RMSE 0.0405m. Let me check [143,251] (4th ranked) to see if nearby nodes to 141 might perform even better, and to verify the pattern that 251 is consistently the better second node vs 253/255.

**Actual arguments:** `{"nodes":["143","251"],"coefficients":[0.0142267,0.0139937]}`

**Independent observation:** RMSE 0.1308524 m; worse than turn 6.

### Turn 9 — simulate_pair

**Kimi's recorded justification (verbatim):** Let me check one more pair to be thorough - [139,251] which is further from the 145 area but was ranked 12th. I want to confirm that 141 is indeed the sweet spot in that region, and verify 251's consistency as the best partner node.

**Actual arguments:** `{"nodes":["139","251"],"coefficients":[0.0165508,0.0138386]}`

**Independent observation:** RMSE 0.0283838 m, max error 0.0640365 m; best pair actually tested. Not hidden truth.

### Turn 10 — simulate_pair

**Kimi's recorded justification (verbatim):** I need to re-verify [141,251] since [139,251] surprisingly outperformed it with RMSE 0.0284m vs 0.0405m. I want to double-check my earlier result for [141,251] was correct, and also try slightly adjusted coefficients around the linearized values to see if I can improve it, since the tool uses fixed coefficients.

**Actual arguments:** `{"nodes":["141","251"],"coefficients":[0.0108015,0.0141105]}`

**Independent observation:** Exact repeat of turn 6 with identical arguments and RMSE 0.0404948 m. Kimi said it would adjust coefficients but didn't. Run stopped at assistant-authored MAX_CALLS=10; no final answer.

## What went wrong

**Runtime cutoff (experimental flaw):** The assistant wrote `MAX_CALLS=10`; the 10th decision could still be a tool call, and there was no reserved final-report step. The run ended `MAX_CALLS_EXHAUSTED`, not with a Kimi-authored answer. Provider total **28,249 tokens**, less than the 45,000 budget. Thus model-turn cutoff, not token budget, prevented continuation.

**Model tool-loop inefficiency (directly observed):** On turn 10 Kimi said it would adjust coefficients, but repeated turn 6's exact pair `[141,251]` with unchanged `[0.0108015,0.0141105]`. It received the same RMSE `0.0404948 m`. This is verifiable intent/action mismatch, not simply failure to submit.

**Tool design excluded the answer (system confound):** The prebuilt `fit_two_leaks` restricted search to the first 25 candidates ranked under a *single-leak* hypothesis. It tested 300 combinations, but hidden true nodes were `149` and `241`; node `241` was outside the limited candidate set. Therefore the model could not recover the correct pair through this tool's shortlist alone. This was not Kimi's own algorithm.

**Useful behavior:** The first four turns built evidence correctly, with 92 real hydraulic scenario simulations and 300 linearized pair combinations. Kimi performed five distinct full pair simulations, observed nonlinear ranking changes, and found a tested candidate `[139,251]` with RMSE `0.0283838 m`. These actions were useful even though the scored answer was absent.

**Limits on interpretation:** EPA Net3 is a real published hydraulic network, but the pressures/leaks were synthesized in a single snapshot without measurement noise. The result is neither real leak localization nor proof about safe hospital isolation. No more trial calls were made; this posthoc report does not substitute for an actual final answer.

## Next test design (recommendation only; NOT applied to the original experiment)

Preregister a fresh independent benchmark, use a total compute budget rather than a fixed model-turn count, enforce one final submission opportunity, detect duplicate calls without manufacturing a Kimi answer, and provide a tool with demonstrable full candidate coverage. Preserve model decisions, verified tool output, costs and unchanged hidden scorer. Compare multiple seeds before claiming a general capability.

**Original raw JSON** contains response text, tool arguments/results, provider usage, event hashes and the independent verdict. This file is a retrospective interpretation only.
