# AAU Net3 full fresh-hybrid experiment — activation forensics

Research experiment date: October 18, 2026 (US Eastern); GitHub Actions timestamps on October 19 UTC.

## Source and conditions

- Original EPA Net3 source, benchmark construction, original test parameters, and sealed independent scoring unchanged. No answer-key access by either model.
- Source SHA snapshots: Net3.inp `1bfc21bc17d22c265727833885e1232e06012752`; prepare.py `d47686b7da2ed0b4843957ee4004b3c5fa048762`; full-coverage tools_runtime.py `a30cb6668f75cec009a0bdef9598396bb6bf18a3`; original verifier.py `e3f006fd52cda35ef9ff0699e5420df60db385f6`.
- Both are **new end-to-end trials** beginning with thinking OFF and empty context; neither replays the previous successful single-mode traces.
- Proposed model strategy: thinking OFF explores EPANET tools; independent thinking ON invoked by evidence checkpoints; every model response and tool output hashed in the persisted journal.
- Configured triggers: first fitted pair RMSE <= 0.001 m; distinct direct EPANET confirmation of same candidate; OFF-proposed final; four unproductive tool actions; two invalid/repeated tool actions; 80% budget in first version / 70% in second. A checkpoint can occur only when the preceding tool call completes. Quality checkpoints cannot fire without a measured candidate.
- ON may accept, remediate or abstain. Deterministic submission authorization requires full nonlinear fit and **distinct direct simulation** within 0.001 m for the same node pair and coefficients. Unchanged verifier checks original hidden truth after final.

## First new hybrid attempt — PR #111

- [Actions run 39193199377](https://github.com/booleanlambda/agent-control-room/actions/runs/39193199377) and [raw evidence artifact 12161171717](https://github.com/booleanlambda/agent-control-room/actions/runs/39193199377/artifacts/12161171717).
- 16 thinking-OFF calls = **83,124 provider tokens**; 2 thinking-ON calls = **16,926**; 16 real computational tool calls; cumulative **100,050**.
- Thinking ON call **13** after 12 OFF tools, trigger `SUSTAINED_NO_IMPROVEMENT`, 46,637 earlier tokens. It issued `remediate`, but requested exhaustive pair screening that had already happened.
- Thinking ON call **18** after 16 OFF tools, 89,013 earlier tokens; provider returned `finish_reason=length` and empty visible JSON, so no complete verdict for the second review.
- No solution discovery, no model-authored final. Error `MODEL_OR_RUNTIME_ERROR`, caused by provider output truncation under inadequate reserved completion budget; recorded total exceeded nominal 100K by 50 provider tokens.
- Valid original forensic hash chain: **37/37**.

## Second fresh attempt with repaired controller — PR #112

- [Actions run 39193927085](https://github.com/booleanlambda/agent-control-room/actions/runs/39193927085) and [raw evidence artifact 12160588832](https://github.com/booleanlambda/agent-control-room/actions/runs/39193927085/artifacts/12160588832).
- 16 thinking-OFF calls = **65,080 provider tokens**; 2 thinking-ON calls = **19,810** (12,128 reasoning tokens in all 18 calls); 16 tool calls; cumulative **84,890** provider tokens.
- Thinking ON call **12** after 11 OFF tools, trigger `SUSTAINED_NO_IMPROVEMENT`, 39,153 earlier tokens. It **abstained**, judging best nonlinear RMSE 0.02166 m to be too high for the 0.001 m gate.
- Thinking ON call **17** after 15 OFF tools, trigger `SUSTAINED_NO_IMPROVEMENT`, 68,560 earlier tokens. It **requested remediation**, recommending `optimize_pair\` for nodes `145,249` based on the linearized ranking. Kimi OFF then performed that experiment: RMSE 0.023612 m, not an improvement.
- The thinking ON reviewer did not recommend or test hidden true pair `149,241`; nor did thinking OFF. No quality verification checkpoint or final-answer review checkpoint fired.
- Run stopped **before** another call because estimated prompt+12K ON completion allowance and safety buffer would exceed the 100K token limit. Actual provider usage 84,890, not an overrun. This guard prevented the earlier truncation but still left the task unresolved.
- Valid forensic hash chain: **41/41**. Original independent verifier: no model final, hence top-1 and top-3 not accepted.
- Repair included explicit audit-chain context compaction and all 4,186-pair screen receipts in the ON reviewer summary. The frozen benchmark/oracle/tool implementation were not modified.

## Main forensic interpretation

**The hybrid policy activated reasoning too early for the specific intended role of 'thinking ON verifies thinking OFF'.** Both completed reviews in the second run were triggered by stagnation, *not* evidence that a candidate was trustworthy. The reviewer could correctly withhold acceptance but could not turn approximate top-ranked linearized hypotheses into an accurate physical solution. In the first run, the reviewer recommended redundant full screening. In the second, it first issued an overconfident 'no untested pair plausibly fits' assessment even though true pair [149,241] had never been optimized.

**Activation policy recommendation from actual evidence:** keep thinking OFF as primary model tool operator. Use cheap deterministic novelty/progress/error checks routinely; do NOT call thinking ON for each simple plateau or unproductive page of candidate results. Call thinking ON for (a) a substantive claim ready for evaluation with measured evidence, (b) a contradiction across independently executed tools that cheap checks cannot resolve, (c) a fundamental candidate-space/tool-methodology failure after inexpensive deterministic diagnostics, or (d) an explicitly budgeted final decision. Do not let the reviewer call be swallowed by re-sending long tool histories; pass a complete, concise evidence dossier with tool coverage, known failed regions, uncertainties, and verified residuals. Require a specific, falsifiable remediation action or reasoned abstention. Reserve output/compute headroom.

This is a negative result for **this proposed hybrid policy** on two fresh runs, not evidence that hybrid architecture can never work. The earlier thinking-OFF-only run found hidden correct nodes but never finalized, and the prior fresh thinking-ON-only run found, verified and submitted them. Those were different stochastic trajectories. There is no retrospective conversion of these failures to passes or adjustment of the oracle.
