# EPA Net3 tool-directed Kimi continuation: preserved 18-turn forensics

This is a read-only summary of the research runs; the independent benchmark, `prepare.py`, `verifier.py`, and Net3 source remained unchanged. Model decisions and original computational receipts are retained as GitHub Actions artifacts. **No direct Kimi final answer was produced.**

- Original unlimited-turn/75K-token run: [run 39186812705](https://github.com/booleanlambda/agent-control-room/actions/runs/39186812705), [evidence 12158198262](https://github.com/booleanlambda/agent-control-room/actions/runs/39186812705/artifacts/12158198262), SHA-256 raw trial `86da1acbfa35ec393230a9407897e3496c4e18bc0f9c1853d7a84c2c188f5173`.
- Continuation with same original 15 model+tool decisions, no paid replay, +25K total budget: [run 39187456935](https://github.com/booleanlambda/agent-control-room/actions/runs/39187456935), [cumulative evidence 12158971408](https://github.com/booleanlambda/agent-control-room/actions/runs/39187456935/artifacts/12158971408), original trial preserved as `trial-before-continuation.json`.
- Original 15-call history validated with 15 model hashes, 15 tool hashes, and 32 event-chain links. Cumulative history: 18 Kimi K2.6 thinking-OFF calls, 18 real tool calls, **90,456 provider-reported tokens**; 41 event-chain hashes intact and checked.
- Hidden synthetic ground truth: `149` and `241`. Bench is public EPA Net3 hydraulic network; observations are simulated, not field data.
- Original independent model-submission verdict: `MODEL_TOKEN_BUDGET`, `submitted_pairs=[]`, `exact_top1=false`, `exact_top3=false` because Kimi returned tool requests rather than a final JSON response.
- **Post-run separate system result:** Generic `aggregate.py` reads only real tool receipts, verifies hashes, selects lowest full EPANET RMSE among tried pairs, writes `system-assembled-answer.json` **before** reading any hidden truth, and *then* scores against sealed ground truth. Best seen pair `[149,241]`, coefficients `[0.012,0.012]`, RMSE `0.0000037 m`. This *system-level* answer is correct but **is not a Kimi-authored final submission**.

## Chronological Kimi decision evidence

| Turn | Model-directed tool | Actual observation |
|---:|---|---|
| 1 | `inspect_network` | Read 92 junctions, 117 pipes, 14 sensors |
| 2 | `inspect_observations` | Read synthetic sensor pressure residuals |
| 3 | `scan_single_leaks` | Ran 92 EPANET signature simulations |
| 4 | `fit_two_leaks` | Requested invalid `limit=50`; tool correctly reported input error |
| 5 | `fit_two_leaks` | Used valid `limit=40` and scanned **all 4,186 possible junction pairs**; top linearized pair `[145,241]` |
| 6 | `optimize_pair [145,241]` | RMSE 0.02408793 m |
| 7 | `optimize_pair [145,239]` | RMSE 0.02342716 m |
| 8 | `optimize_pair [141,241]` | RMSE 0.0216637 m |
| 9 | `optimize_pair [143,241]` | RMSE 0.02168952 m |
| 10 | `optimize_pair [147,241]` | RMSE 0.00816065 m |
| 11 | `optimize_pair [149,241]` | **Exact truth found**, coefficients 0.012/0.012, RMSE 0.00000375 m |
| 12 | `optimize_pair [149,239]` | RMSE 0.00382357 m, worse |
| 13 | `optimize_pair [147,239]` | RMSE 0.01119488 m, worse |
| 14 | `simulate_pair [149,241]` | Independently re-simulated exact coefficients, RMSE 0.0000037 m |
| 15 | `simulate_pair [145,241]` | RMSE 0.0242145 m, worse |
| 16 | `optimize_pair [151,241]` | RMSE 0.22044636 m, much worse |
| 17 | `optimize_pair [149,243]` | RMSE 0.22203277 m, much worse |
| 18 | `optimize_pair [149,245]` | Tool returned `INVALID_NODE_PAIR` (node 245 not present) |

## Independent interpretation

Kimi selected and operated real hydraulic tools, and **actually discovered the exact hidden pair at turn 11**. It further directly corroborated the match at turn 14 without reading truth. The top-25 tool restriction in the earlier baseline was repaired generically by searching all pairs; no answer node was inserted or seeded.

The model failed to stop investigating and submit despite overwhelming numerical evidence. The artificial **10-turn** restriction was removed, but a **75K and then 100K provider-token** research compute cap remained to bound cost; these caps were experimenter-set. The continuation stopped at 90,456 tokens when next-call context/output reservation could not fit within 100K. That is not evidence the model cannot identify the correct pair.

The posthoc **system-level** evidence assembler demonstrates how AAU can produce a correct answer from model-directed tools without claiming that the model supplied a final answer. The original model-only failure and the separate system success must be reported together. No production deployment occurred.
