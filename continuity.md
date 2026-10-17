# AAU Recursive Tree Lab — Continuity

Last verified: 2026-10-17 (UTC)
Scope: experimental only. This is the single-thread logistics follow-up to the independent recursive-tree prototype. It does **not** change production AAU, Silas, Supabase, RabbitMQ, or Render.

## Where to resume
- Repository: `booleanlambda/agent-control-room`
- Current experiment branch: `experiment/solo-logistics-v1`
- Research-only draft PR: https://github.com/booleanlambda/agent-control-room/pull/46 (base `experiment/recursive-tree-nemotron-v0`; do not merge/deploy)
- Previous recursion tree draft PR: https://github.com/booleanlambda/agent-control-room/pull/45
- Previous technical history: `experiments/recursion-tree-v0/README.md` and associated results documents.
- New isolated test code: `experiments/solo-logistics-v1/benchmark.mjs`, `benchmark.test.mjs`, and `live.mjs`.
- Workflow: `.github/workflows/solo-logistics-v1.yml`. Trigger was `pull_request` **opened** against the experimental base; this was a one-time execution, not a recurrence.
- Live GitHub Actions run: https://github.com/booleanlambda/agent-control-room/actions/runs/39053769706
- Persisted CI evidence artifact: https://github.com/booleanlambda/agent-control-room/actions/runs/39053769706/artifacts/12109005901 (`aau-serial-logistics-v1-evidence`).

## Last completed experiment: single-thread logistics (PASS)
GitHub Actions run `39053769706` and its one `single-worker` job completed with conclusion `success` on 2026-10-17. Independently inspected job log contains:
```
SOLO_LOGISTICS_RESULT={"status":"passed","providerCalls":3,"providerTokens":4192,"nodes":[{"path":"R","status":"accepted","step":"decompose"},{"path":"R.001","status":"accepted","step":"author_solver"},{"path":"R.final","status":"accepted","step":"synthesize"}],"publicPass":true,"hiddenPasses":2,"hiddenCount":2,"rootCertified":true}
```
- Kimi K2.6, thinking disabled; three **sequential** actual model calls; 4,192 provider-reported total tokens.
- Model-authored plan accepted, model-authored Python solver accepted on first try, and final synthesis accepted.
- Exact independent grader: 1/1 public and 2/2 withheld logistics scenarios optimal; no model repairs required in this run.
- Six no-model deterministic benchmark tests passed, including reference witnesses and tamper/omission/duplication checks.
- Run took approximately 52 seconds from `node live.mjs` starting to the final result line.
- Root digest was reported certified. See the uploaded JSON for actual evidence hashes and model outputs; do not invent missing hash values in reports.
- Problem scale: two depots, two vehicles, five customers (public), separate six- and seven-customer hidden datasets, Manhattan travel, capacities, windows, service time, shift end, fixed active-vehicle cost, exact objective.
- Worker used network-disabled Docker for running model-authored Python, explicit four-call ceiling, one serial worker, no automatic retries after ambiguous provider responses.
- Some account-wide Moonshot activity can occur outside this workflow: single-worker configuration does NOT prove exclusive use of the provider across all projects.

## Interpretation / limits
This establishes a baseline for **one-worker autonomous plan -> code -> exact verification -> synthesis**. It does NOT yet establish adaptive depth-10 recursive decomposition, multiworker safety for this new task, systematic self-remediation, independent reliability rates, or cost advantage. The first solver passed; recovery was not exercised. The workflow test should not be re-run automatically with billable calls.

## Prior recursion-tree evidence (separate from logistics)
- Synthetic depth-10 balanced topology: 2,047/2,047 nodes traversable; this is deterministic simulation, not 2,047 independent live reasoning calls.
- Earlier Kimi depth-10 live spine: 21/21 semantic nodes and 10/10 parent syntheses; keep its proof/report separate from this serial logistics run.
- Earlier unfamiliar seeded software defects: 3/3 repairs and 6/6 public/hidden grades in a separate bounded Kimi study. Full autonomous end-to-end remediation remains to be established.
- Prior production `Systemic Runtime Tree CI` was failing; do not treat passing isolated research checks as production approval.

## Proposed next experimental step (NOT started)
Keep **one worker and one provider call at a time**. Increase cognitive complexity rather than concurrency:
1. Supply a genuinely unfamiliar logistics variant with interacting constraints; let the model determine decomposition depth instead of forcing a fixed ten levels.
2. Give each semantic step a durable, hash-verifiable child node, actual independent checks, evidence provenance, and budget ledger.
3. Inject one controlled cognitive/program error and require a complete model-originated diagnose -> correct -> test -> verify -> synthesize cycle; hidden oracle never appears in the agent prompt.
4. Stop and journal `manual_hold` on uncertain provider results; do not automatically resend billable calls.
5. Record actual calls/tokens, accepted and rejected semantic nodes, retries, hidden scores, root proof, and all CI identifiers. Only consider controlled concurrency after the serial end-to-end lifecycle passes.

## Preservation and safety
Do not merge PR #46 or enable production wakes by implication. Do not convert CI success to universal correctness. Record every live attempt by immutable run ID and differentiate synthetic tests, local deterministic tests, model-authored solutions, and provider-side errors. Update this file after each verified experiment, including failures.

---

## Experiment 2 — Self-remediation with a real Kimi-authored failure (2026-10-17)

**Research-only recovery branch:** `experiment/solo-remediation-recovery-v2`; draft PR [#48](https://github.com/booleanlambda/agent-control-room/pull/48) (do NOT merge).
**Harder benchmark:** `experiments/solo-remediation-v2/benchmark.mjs`, `benchmark.test.mjs`. Two vehicles, 6 public customers and two withheld cases (6-7), capacity, precedence on the SAME vehicle, time windows, return deadlines, fixed fees and vehicle-specific distance weights. Independent exhaustive reference grader.

### Stage A: initial original-solver failure — verified
- Live GitHub Actions run: https://github.com/booleanlambda/agent-control-room/actions/runs/39056004458
- Evidence artifact: https://github.com/booleanlambda/agent-control-room/actions/runs/39056004458/artifacts/12109795305
- Six deterministic benchmark tests passed.
- Kimi K2.6 thinking off made **3 real serial calls**, **8,128 provider-reported tokens**: generated a valid-looking decomposition and a Python solver, but independent public evaluation rejected its answer with `precedence_or_vehicle_violation`. No injection had happened.
- Actual causal code defect: `get_valid_permutations` treated a predecessor absent from the assigned vehicle's subset as if it were not required; `check_route` did not verify same-vehicle precedence. Model-authored code could therefore route a dependent customer on a different vehicle from its prerequisite.
- Workflow intentionally stopped as `baseline_not_solved`; its actual source and SHA256 were journaled. The source hash was `b611840f700134806f441d5c862194f4950134d363072b791c0b14dc8b6fcc36`. Do not claim artificial fault injection or autonomous recovery happened during Stage A.

### Stage B: controlled resume of the actual original failure — verified PASS
- One-time live run: https://github.com/booleanlambda/agent-control-room/actions/runs/39056356817
- GitHub Actions evidence artifact: https://github.com/booleanlambda/agent-control-room/actions/runs/39056356817/artifacts/12109488264
- Recovery implementation `experiments/solo-remediation-v2/resume.mjs` imports Stage A's original artifact via `actions/download-artifact@v4` and checks exact stored source hash and benchmark identity before another model call.
- Kimi thinking off made **3 additional sequential live calls**: (1) diagnosis; (2) complete repaired Python solver; (3) final synthesis.
- The generated diagnosis explicitly identified missing SAME-vehicle predecessor enforcement. First repaired solver passed independent public and 2 withheld cases on its **first** attempt. No hidden correct answers were exposed to Kimi.
- Independent optima and repaired outputs: public **113/113**, hidden A **119/119**, hidden B **140/140**. All exact feasible witnesses accepted by grader.
- Recovery provider-reported usage **8,201 tokens**. Combined Stage A + B: **6 real calls, 16,329 tokens**. No concurrent model calls, no automatic retry of ambiguous provider results.
- Durable accepted evidence nodes: `R`, `R.001` failed replay proof, `R.002` model diagnosis, `R.003.1` repaired solver, `R.final` synthesis. Root SHA256 proof: `5412e92e32ad6a3c5f0a6603fa7251427dd98fdf158935e51ea56e63c4f004d0`.
- Result: **real agent-authored error successfully self-diagnosed and repaired**, verified on hidden inputs. This is stronger evidence than recovery from the originally proposed artificial injection.

### Limits and next gate
The successful cognitive recovery occurred across **two workflow runs with an operator-initiated continuation** after the first failed. It does NOT yet prove automatic error detection, auto-branching recovery, and re-verification in *one unattended lifecycle*, nor generalization reliability over multiple unrelated failures. The fixed original source plus two hidden variants form one narrow benchmark family.
**Next recommended isolated test:** incorporate bounded fail -> diagnose -> repair -> independently regrade -> synthesize in a single durable one-worker workflow with no human intervention and no parallel provider calls. Repeat across new unknown failures only after that. No deployment or Silas state changes were performed here. Production runtime CI must be evaluated separately.

