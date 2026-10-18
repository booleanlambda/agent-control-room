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


---

## Experiment 3 — Uninterrupted single-worker recovery lifecycle: PASS (2026-10-17)

- Branch: `experiment/solo-uninterrupted-v3`; one-time draft PR https://github.com/booleanlambda/agent-control-room/pull/49 (research only; do not merge).
- Verified single-job Actions run: https://github.com/booleanlambda/agent-control-room/actions/runs/39056795340 — job `single-worker-uninterrupted` completed **success**.
- Artifact: https://github.com/booleanlambda/agent-control-room/actions/runs/39056795340/artifacts/12110206030 (`aau-single-run-recovery-v3-evidence`).
- Implementation: `experiments/solo-uninterrupted-v3/live.mjs`, workflow `.github/workflows/solo-uninterrupted-v3.yml`.
- Same independently exhaustive precedence-aware benchmark as Experiment 2: public and two withheld logistics variants (NOT independent new task families). Six deterministic preflight checks passed.

### One-workflow sequence and evidence
1. Kimi K2.6, thinking disabled, independently produced a decomposition (`R`, `R.001`), derived constraints and exact algorithm (`R.002`), then authored Python solver (`R.003`). **Initial solver passed** exact public 113/113 and two hidden optimality checks 119/119, 140/140.
2. As no organic initial solver error occurred, the **same workflow** injected a controlled input-handling defect into the model-authored Python: `fixedCost += 7` per vehicle. The independent oracle detected a public cost disagreement: model claimed **127**, oracle recomputed **113**. The branch type is `controlled_tamper_after_success`, not an organically occurring cognitive bug.
3. In that same running job and with no human intervention, the model generated a diagnosis (`R.005`) that specifically found the fixed-cost inflation (+7 per vehicle, +14 total). It provided a repair plan, authored a corrected whole Python program (`R.006.1`), and passed public 113/113 plus both hidden cases 119/119 and 140/140, on **first repair attempt**.
4. Kimi then authored final synthesis (`R.final`), and the deterministic ledger created a root digest.

**Measured:** Six sequential actual Kimi calls (plan, derive, author, diagnose, repair, synthesize), 18,112 provider-reported total tokens, one worker, zero parallel calls within this workflow, zero automatic retries of uncertain provider requests, repair accepted, 2/2 hidden cases passed. All six API calls returned complete `finish_reason=stop`.

**Root digest:** `50de5e5288880e98fe2628416bc1b0c4aa16e2317d84fd674774a38719f69b23`.

### Interpretation and remaining limitations
This **does** demonstrate automatic detect -> diagnose -> repair -> verify -> synthesize within one uninterrupted, isolated single-worker process, without an operator-initiated second run. It is a proof of concept, not production readiness.
It does **not** demonstrate that the same uninterrupted runner reliably repairs an **organic** initial coding failure (that occurred in Experiment 2 and was recovered in a manually initiated second run). It also does not demonstrate new unseen task families, adaptive multi-level recursive decomposition, concurrent workers, long-horizon recovery, or broad reliability. The controlled defect is visible in source and relatively localized. Do not mistake this easy injection for a severe unknown fault.
Production AAU/Silas were untouched. Original production `Systemic Runtime Tree CI` blockers remain independent of this research lane.

**Recommended next gate, NOT launched:** one single-worker run where the model's own initial solver fails naturally, and a recovery node is automatically created without a workflow restart; repeat with multiple unfamiliar held-out problem families and explicit error budgets. Do not enable concurrency until serial recovery is robust across novel faults.


---

## Experiment 4 — Two new algorithm families, genuine model-authored failures, uninterrupted serial recovery (2026-10-17)

**Scope:** one isolated GitHub CI worker; Kimi K2.6 thinking disabled; no artificial defect injection, no model concurrency, no production calls, no Silas state changes. Both problems were new to this research sequence. Draft research PR [#50](https://github.com/booleanlambda/agent-control-room/pull/50) must NOT be merged. Branch `experiment/organic-multifamily-v4`.

- **Verified completed workflow:** https://github.com/booleanlambda/agent-control-room/actions/runs/39057888097 (single-worker job concluded **success**).
- **Preserved full CI artifact:** https://github.com/booleanlambda/agent-control-room/actions/runs/39057888097/artifacts/12109309917 (`aau-serial-organic-v4-evidence`).
- **Implementation:** `experiments/organic-multifamily-v4/{benchmark.mjs,benchmark.test.mjs,live.mjs}` and `.github/workflows/organic-multifamily-v4.yml`.
- **No-model preflight:** 10/10 independent tests passed; reference oracles each generated witnesses for the public problem and two held-out variants.
- **Real inference:** 7 sequential model calls, 24,226 reported tokens, max 1 in-flight model request. All seven returned HTTP 200 / complete `finish_reason=stop`. No uncertain paid request retried.
- **Overall artifact state:** `passed`; root digest `b6a9d053817e6fb39c671f8f2a08400ff910d149361865c21e0d768f57656489`.

### Task 1: Precedence machine scheduling — ORIGINAL FAILED, SELF-REPAIRED
Model had to write an exact solver for two machine types, jobs with dependencies, machine type setup delays, release dates and weighted late-delivery penalties.
- Initial Kimi model-authored source was **12,421 characters**, above the Python sandbox's **12,000-character code-size bound**. Sandbox refused execution (`code_size_bounds`): this is a **model-authored interface/resource compliance error, NOT a proven mathematical algorithm error**.
- In this **same workflow**, deterministic public failure feedback caused Kimi to write its own diagnosis and then attempt repairs. First model-written replacement (4,936 chars) executed with `python_exit_1`; second replacement (3,389 chars) was accepted.
- First completed valid repair passed independent **public + 2/2 hidden** instances with optimal costs **0, 0, 0**. This means the witnesses were correct, but the instance costs are trivially zero under the chosen due dates; future material must include positive-optimum / high-pressure settings.
- 5 serial Kimi calls for this family: plan, initial solver, diagnosis, first repair, second repair.
- Task root digest `e037550aa2fc9a4d4560fa3f80fedd0457e98fa74319c10999e152bff78b48a1`.

### Task 2: Battery / toll / ordered-checkpoint directed graph — PASSED FIRST TRY
Model had to find the least-cost path through a cyclic directed graph respecting finite battery, recharge time and count, a once-use toll waiver and checkpoints visited in order.
- Initial model-authored Python passed the independent public optimum **33**, and two hidden-optimum checks **37** and **33**. All three were exact feasible witnesses.
- No error arose, so self-remediation was **not** exercised in this case; only two Kimi calls (plan and solver).
- Task root digest `1006abdd44a496484ca8a8233397b47d350841a8a40aeaa4d39922a0e1c582be`.

### Interpretation and next experimental gate
**New demonstrated capability:** a single live worker continued from an **organic model-output compliance failure** into model-authored diagnosis, two bounded repair attempts, independent exact revalidation and sealed hash-verified root—without an operator-started second run. Also demonstrated a fresh first-attempt optimum graph solver.

**Do NOT overclaim:** This does not yet establish recovery from a genuine *logical/cognitive* error on a nontrivial positive-optimum scheduling instance. It also does not validate statistically reliable generalization or 2+ concurrent workers, and the job's top-level success hides the fact that one task used the entire two-repair budget. The sandbox error was initially code length, not an observed wrong algorithmic answer.

**Recommended next gate, NOT launched:** retest one-worker automatic remediation with **strictly positive optimal penalties**, held-out hard cases, and at least one model-authored wrong **executable** answer requiring logical repair. Keep cost ceilings, journaling and no hidden-answer leakage. After sufficient serial repetitions, test two workers separately and preserve independent production gates.


---

## Experiment 5 initial run — positive-cost scheduling, blocked by output truncation (2026-10-17)

- Research branch `experiment/positive-logic-recovery-v5`, draft PR https://github.com/booleanlambda/agent-control-room/pull/51.
- Actions run https://github.com/booleanlambda/agent-control-room/actions/runs/39058921207 **completed with failure**; evidence https://github.com/booleanlambda/agent-control-room/actions/runs/39058921207/artifacts/12110612531.
- Benchmark `experiments/positive-logic-v5/benchmark.mjs` tests seven dependent jobs on two machines, hard maintenance blackouts, setup changes, machine activation fees and weighted tardiness. Independent preflight **8/8 passed**, including a strict assertion that each exact optimal cost is positive (>=15).
- Kimi K2.6 thinking-off, single serial worker, 2 actual calls, 10,983 provider-reported total tokens. Planning call completed normally; initial source-generation request returned HTTP 200 with **`finish_reason=length`** and 8,000 configured max output tokens. Correctly entered `manual_hold` without sending again.
- No complete solver was parsed or executed. **No logical/cognitive failure or repair was demonstrated**. This is a provider output ceiling / response truncation, not a failed independent math test.
- The runner journaled one accepted root and four sequential model-authored plan steps; no solver, hidden grader results, or verified root.
- Next controlled iteration: a newly authorized one-time branch/workflow with explicitly shorter source output instructions and a higher finite output cap. Keep one worker, fail-closed uncertain provider responses, zero hidden-answer leakage, no concurrent model requests and no production changes.

---

## Experiment 5B — One-worker positive-cost scheduling, failed after two self-repairs (2026-10-17)

**Scope:** isolated, serial-only, Kimi K2.6 thinking disabled; fresh controlled experiment, not a retry of an ambiguous provider call. No modifications to AAU, Silas, Render, brokers, or production databases.

- Research draft PR: https://github.com/booleanlambda/agent-control-room/pull/52. Branch `experiment/positive-logic-v5b`. DO NOT MERGE.
- Run: https://github.com/booleanlambda/agent-control-room/actions/runs/39059227910 — GitHub job **conclusion failure**, not success.
- Complete evidence artifact: https://github.com/booleanlambda/agent-control-room/actions/runs/39059227910/artifacts/12110867393 (ZIP `aau-positive-logic-v5b-evidence`).
- Independent positive-optimum preflight: **8/8 passed**. Benchmark has seven precedence-constrained jobs, sequence-dependent setup, two machines with hard maintenance intervals, release dates, weighted tardiness and machine activation fees. Public and two withheld instances each have an exact optimum >=15, though the live model never reached hidden verification.
- Five **sequential** actual Kimi calls, **19,312 provider-reported tokens**; all five HTTP 200 and `finish_reason=stop`. No concurrency or ambiguous provider retries.
- First model-written Python was complete and under the sandbox size cap (6,137 chars), but it crashed with `python_exit_1`: `NameError: best_cost` because a nested recursive function wrote `global best_cost` where `nonlocal best_cost` was required.
- Kimi's own diagnosis correctly identified this Python closure scoping error. Repair attempt 1 (4,849 chars) executed and returned a schedule, but the independent public verifier rejected it for `release_dependency_or_setup`. Source inspection found it passed the **job start** `ws` rather than **job finish** `fin` as the updated machine completion clock on recursion.
- Repair attempt 2 (4,879 chars) corrected that machine-clock advance to `fin`, but the public grader again rejected the executable schedule for `release_dependency_or_setup`. Code inspection shows the solver checks whether parent jobs have been enumerated, but sets work start based only on machine completion + setup and job release, **omitting actual parent completion times**. This is a plausible direct reason for the remaining rejection; the v5b grader exposed a category, not an item-specific counterexample.
- **Correct classification:** a real model-authored execution failure was diagnosed, followed by **two executable, logically invalid model-authored attempted repairs**. Self-remediation did **NOT** succeed within the two-repair budget; state `completed_with_case_failures`, `public_failure_not_recovered`. **0 hidden cases graded and no root proof certified**. This does not meet the target of autonomously repairing a logically erroneous executable solver.
- The earlier Experiment 5 initial run ended in `manual_hold` after 2 calls and 10,983 tokens because `finish_reason=length` on an 8,000-max-output coding request, with no solver returned. Its results are in the preceding continuity section. Across v5 plus v5b, two distinct isolated live runs used 7 calls and 30,295 provider-reported tokens; do NOT present this as one uninterrupted single run.
- **Next action NOT started:** enhance deterministic public failure feedback to include the precise invalid job, required predecessor finish, actual work start, setup reservation and machine completion. Do not expose hidden oracle feedback. Add bounded unit tests proving the public diagnostic counterexample. Then run a separately authorized, single-thread experiment with a finite diagnosis/repair budget. Do not increase worker count or merge these drafts.


---

## Experiment 6 — Precise diagnostic recovery of real model-authored logic error (2026-10-17)

**Result: FAILED to complete remediation, but diagnostics independently verified.** Single-worker isolated draft PR [#53](https://github.com/booleanlambda/agent-control-room/pull/53); branch `experiment/precise-diagnostics-v6`. **Do not merge or deploy.**

- GitHub Actions run: https://github.com/booleanlambda/agent-control-room/actions/runs/39060149714
- Preserved evidence: https://github.com/booleanlambda/agent-control-room/actions/runs/39060149714/artifacts/12110094862 (`aau-precise-diagnostics-v6-evidence`).
- Reference source: Kimi's ACTUAL last executable-but-invalid Python from Experiment v5b run `39059227910`. Downloaded as immutable Actions artifact and checked source SHA256 plus identical public/hidden input SHA256 before model calls. No synthetic defect injected. This is a **new manually initiated recovery test**, not the original uninterrupted v5b execution.
- New verifier files: `experiments/precise-diagnostics-v6/{benchmark.mjs,benchmark.test.mjs,recover.mjs}`; workflow `.github/workflows/precise-diagnostics-v6.yml`.
- **13/13 deterministic regression tests passed**, including exact parent finish, wrong start, machine setup overlap, release, maintenance and valid held-out oracle witnesses. Public diagnostic outputs first invalid job + `requiredPredecessorFinish`, `predecessors` IDs and finish times, `previousMachineFinish`, `actualSetupStart`, `setupDuration`, `minimumWorkStart`, and violated constraint types. Hidden oracle data/answers were never shown to model.
- **Original logical error reproduced:** model's prior schedule was executable, but `J2` on `M1` started at **1** when its predecessor `J1` on `M0` did not finish until **15**. Exact verifier rejected `before_predecessor_finish`.
- Kimi K2.6 thinking disabled made **3 sequential real calls**: one diagnosis and two model-authored whole-code repair attempts; **13,576 provider-reported tokens**. Model correctly diagnosed missing parent-finish tracking across different machines.
- **Repair 1:** Python executed, returned schedule, but violated machine/setup timing: `J1` assigned `M1`, work start **0**, initial machine type `c` vs job type `b`, required setup **3** and prior machine clock **0**, so setup would start **-3**; minimum legal work start **3**. Public grade rejected.
- **Repair 2:** Same public failure remained: `J1` on `M1` at start **0** with setup duration **3** and setup beginning **-3**. Inspection of both versions shows their setup-search input `earliestWorkStart - setupDuration` could become negative. The initial recurrence allowed time before zero; a proper fix would bound setup start by machine availability/clock (>=0) before searching maintenance windows.
- State: `repair_failed_within_two_attempts`. **0/2 hidden cases graded**, **no root proof**, no acceptance of invalid output. The verifier passed its invariants and successfully rejected Kimi's model-authored invalid results.
- Distinguish model diagnosis correctness from model repair success. Three calls completed without provider uncertainty. Combined preceding v5 and v5b should NOT be merged into one lifecycle; keep run identifiers separate.

**Next gate (NOT started):** independently test the verifier's `machine_or_setup_overlap` counterexample and verify start-of-horizon bound against a locally controlled wrong schedule. If further model trials are authorized, ensure public feedback includes the precise *current* failing job after each repair, without exposing hidden reference answers. Do not silently raise the two-repair cap or retry uncertain paid calls. Keep one worker; no deployment or Silas wake.

---

## Resolution plan after V6: deterministic scheduling kernel, model chooses order and assignments (not implemented)

**Diagnosis:** V6 Kimi consistently recognized a model-authored logical error, but generated two programs which both attempted machine setup before time 0. This is a reliability limit when prompting the model to regenerate a whole constraint solver. Further trial-and-error prompting alone is not the recommended remedy.

**Architectural decision for next work:** separate agent decision-making from deterministic constraint satisfaction.

1. **Trusted scheduling kernel** in a new isolated module: consume an ordered list `[{id,machine}]` with no model-provided timestamps; check known job IDs, exactly-once coverage, eligibility, all parent jobs already completed, finite integer times. Maintain each machine's `finish`, `previousType` and active count and each job's verified finish time. Derive `setup=previousType===job.type ? 0 : machine.setup` and `start=max(release,max(parentEnds),machine.finish+setup)`; check the entire `[start-setup,start+duration)` interval against maintenance; advance through intersecting blackout windows while keeping `start-setup>=machine.finish>=0`. Record activation fees, weighted tardiness, complete schedule and verifiable event ledger. Reject invalid assignments/order, rather than secretly alter model decisions.
2. **Independent validator/oracle remains distinct:** the existing exact exhaustive oracle/verifier in `experiments/precise-diagnostics-v6/benchmark.mjs` must independently recalculate validity and optimum; do not replace it with the new kernel or have both trust the same result path. This guards against shared implementation errors.
3. **Test before paid inference:** directed regressions for negative setup start, cross-machine parent completion, combined setup+work maintenance overlap, consecutive setups, zero-duration setup, release time, missing/duplicate jobs, machine eligibility, machine activation exactly once; property-based randomized small cases against an independently written reference and exact optima; positive-cost hidden cases all pass.
4. **Reframe Kimi's role:** ask for candidate topological order and eligible machine assignment, not executable Python timing code. Kernel returns public feasibility, exact start/finish/cost and error witness. Model may propose a new arrangement if the deterministic checker rejects it, with fixed budget and max 2 strategic revisions; never expose withheld/hidden oracle answers.
5. **Success gate:** deterministic kernel 100% on targeted invariants; same candidate order gives reproducible schedule, all submitted public/hidden positive-cost test cases match independent validator exactly, no negative setup or predecessor violations ever accepted; one isolated single-worker model study with no production writes; preserve hashes and every rejected attempt. Then test across unfamiliar task variants before concurrency.
6. **Failure policy:** stop on verifier mismatch, failed invariant, ambiguous provider result, budget exhaustion. No automatic retries of uncertain billable calls and no Kimi-authored changes to verifier/kernel during live tests. Keep Silas paused/untouched and avoid merging research PRs.

**Next implementable work item:** create `experiments/deterministic-scheduler-v7/kernel.mjs` and `kernel.test.mjs` on a new research branch, establish green independent cross-checks before one new paid Kimi run. Do not call the architecture fix complete until these tests and a live end-to-end trial pass.

---

## Experiment V7 — Deterministic scheduling kernel, implementation and successful live single-worker test (2026-10-17)

**Research draft PR:** https://github.com/booleanlambda/agent-control-room/pull/54
**Branch:** `experiment/deterministic-scheduler-v7` — DO NOT MERGE OR DEPLOY to AAU production; Silas, Render, Supabase and queues are untouched.

### Architectural change implemented
- New trusted pure JS scheduling transitions: `experiments/deterministic-scheduler-v7/kernel.mjs`.
- Kimi NEVER authors or passes timing/arithmetic source: it submits only `{jobs:[{id,machine},...]}`. Kernel rejects extra keys, missing/repeated jobs, illegal machines, unresolved predecessors. It owns release, machine clock, previous type, non-preemptible setup, earliest parent FINISH, maintenance windows, activation exactly once, weighted tardiness, schedule, evidence ledger and SHA256 hashes.
- Kernel derives earliest legal start: `max(job.release,max(parentFinish),machine.finish+setup)`; adjusts for every maintenance intersection on the **entire [setupStart,workFinish)** interval; setupStart is always >= machine.finish >= 0.
- For small cases the kernel includes `searchBestCandidate` exhaustively searching feasible topological orders and machine assignments. **Independent** `experiments/precise-diagnostics-v6/benchmark.mjs` oracle evaluates/grades its results; no shared solver implementation.
- 13 tests in `kernel.test.mjs`: positive-cost public and both hidden optima, randomized 24 small exact cross-check problems, time-zero setup, cross-machine parent finish, maintenance, unsorted overlaps, sequential changes, release, no setup for same type, one-time activation, tamper/duplicates and deterministic hashes.

### GitHub Actions actual run results and fixes
1. Initial CI run `39061112011`: failed preflight 8/13 because one-machine regression fixtures incorrectly invoked the old exact oracle which intentionally only supports 2 machines. Model stage SKIPPED, no paid inference. Regression test helper fixed to use independent feasibility `evaluate` for 1-machine cases, and full independent `grade` only for 2 machines.
2. Run `39061169990`: 13/13 regressions PASS, 3/3 oracle optimal cross-check PASS; provider call rejected with **HTTP 400** (0 reported tokens); model stage set `manual_hold`. No automatic retry.
3. Run `39061242564`: independent preflight still PASS; response journal revealed precise HTTP 400 `invalid temperature: only 0.6 is allowed for this model`. No model tokens returned.
4. Corrected request temperature 0.45 -> **0.6**. Verified successful final research run: **https://github.com/booleanlambda/agent-control-room/actions/runs/39061295205**; one worker, one serial Kimi K2.6 thinking-off model call, **877 provider-reported tokens**. Full evidence artifact: **https://github.com/booleanlambda/agent-control-room/actions/runs/39061295205/artifacts/12111636580** (`aau-deterministic-scheduler-v7-evidence`). Job conclusion **success**; 13/13 deterministic tests passed.

### Exact measured outcomes for final successful run
- Independent public and hidden kernel-oracle optimality baseline costs: **415**, **387**, **582**. Kernel's exhaustive search matched reference oracle on each EXACTLY.
- Kimi's first candidate topological assignment was accepted without requiring revision:
  `[J0@M0,J1@M1,J3@M0,J2@M1,J4@M0,J6@M0,J5@M1]`.
- Kernel-generated candidate PUBLIC cost **512** vs independent proven optimum **415** (gap 97); **feasible but NOT optimal**.
- Same Kimi ordering/assignment re-evaluated on two hidden datasets: both **valid feasible schedules**; hidden 1 **387 vs 387 optimum** (optimal), hidden 2 **690 vs 582 optimum** (108 gap). This checks deterministic kernel robustness on changed timing inputs, NOT new hidden cognitive problem-solving by Kimi.
- Kernel never accepted negative setup start, unmet predecessor, or maintenance conflict; external exact verifier accepted all model proposal outputs as feasible and computed actual cost. Model did not supply timestamps, costs or executable Python.
- Three proof nodes (model assignment, trusted scheduling kernel result, independent verifier) accepted. Verified root SHA256 `75688b1130ba366c6a56aa01f3977f05908324ca2170f1287e6f9521458acfe7`.
- Model call and token figures apply to successful final run only. Prior HTTP400 requests are separately recorded and had zero reported tokens; do not combine distinct GitHub runs into one uninterrupted Kimi execution.

### Interpretation / next gate
**Verified isolated resolution of recurring scheduling timing errors:** runtime owns all arithmetic/time constraints and independent verifier confirms feasibility. No amount of agent reasoning can submit an illegal start timestamp for acceptance under this interface.
**Not yet production-ready**: tested only one benchmark family with small (7-job) problems, and model optimization remained suboptimal (public +97, hidden2 +108). Larger cases need bounded optimizer/search with measurable quality/gap, adversarial testing and additional guardrails. Next stage, if authorized: add an explicit independent optimization service for bounded small problems or heuristic exploration for larger ones; preserve agent autonomy in choice of strategies, but never delegate clock correctness to LLM. Test more problem families and failure modes before considering 2-worker concurrency or merging into AAU.

---

## Experiment V8 — Kimi proposal refinement vs deterministic optimizer (2026-10-17)

**Research branch:** `experiment/scheduler-optimization-v8`; draft PR https://github.com/booleanlambda/agent-control-room/pull/55. NO MERGE, NO AAU/Silas/production changes.
**Verified final GitHub Actions run:** https://github.com/booleanlambda/agent-control-room/actions/runs/39061989692 (one worker, conclusion success).
**Full evidence artifact:** https://github.com/booleanlambda/agent-control-room/actions/runs/39061989692/artifacts/12112315096, `aau-serial-scheduler-optimization-v8-evidence`.
**Implementation:** `experiments/scheduler-optimization-v8/optimizer.mjs`, `optimizer.test.mjs`, `live.mjs` and `.github/workflows/scheduler-optimization-v8.yml`. Existing v7 scheduling kernel and independent v6 exhaustive oracle unchanged.

### Measured execution
- Mandatory preflight: **10/10 optimizer tests** and **13/13 trusted scheduling-kernel tests** passed, including 16 randomized small-graph optimizer tests plus original v7 randomized validation. Independent exact oracle baseline: public **415**, hidden 1 **387**, hidden 2 **582**.
- One live Kimi K2.6 thinking-off worker; **2 sequential actual model calls, 1,433 provider-reported tokens**. Both returned complete structured 7-job candidate order/machine assignments with no model-authored timestamps or executable code.
- Model's own first proposal: **public cost 630**, independently feasible.
- Model's own revised proposal using public feedback: **public cost 533**, independently feasible. Kimi improved its own suggestion by **97 units**, but did **NOT** beat v7 historical baseline **512** (21 units worse).
- The experimental runtime explicitly refused to attribute deterministic gain to Kimi; chose **historical 512-cost baseline** as trusted optimizer seed.
- Deterministic bounded relocation/reassignment search inspected **78 proposals**, found **one strictly improving round**, and produced public cost **459**. **53-unit / ~10.35%** gain attributable solely to deterministic optimizer, **44-unit gap** above exact 415 optimum.
- Same optimized machine assignments/order re-evaluated on withheld inputs (NOT seen by Kimi): **hidden1 cost 437 vs optimum 387**, **hidden2 cost 705 vs optimum 582**, both independent verifier **feasible/valid**, neither optimal.
- Neither model proposal nor deterministic improver produced an illegal timestamp, negative setup start or missed precedence/maintenance check; verified deterministic root digest: `2d8e975fc723d3e7507b4d7f5f0dba20a3fb603add284f610c457c9e46c6d4ac`.
- Model-attributable improvement from historical baseline was **-21**, deterministic optimization gain **+53**. Do not collapse these or call Kimi globally optimal.

### Failure and run history
1. First V8 workflow run `39061864986`: preflight **9/10**. Zero-evaluation optimization budget correctly left schedule unchanged but incorrectly set `truncated=true`; no Kimi run. Corrected bounded-search bookkeeping.
2. Re-run `39061905077`: optimizer tests **10/10** plus kernel tests **13/13** passed. One Kimi call reached HTTP 200 but `finish_reason=length` under 2,200 output token limit; logged `manual_hold`, **2,757 provider-reported tokens**, no proposal used. No automatic retry.
3. Fresh authorized V8 rerun `39061989692`: instruction explicitly restricted JSON to 7 jobs and short strategy, raised bounded output ceiling, kept Kimi K2.6 required temperature **0.6**, and passed as above. Previous runs remain separate paid/event records.

### Conclusion and next gate
This demonstrates agent-guided candidate refinement and deterministic, independently validated feasible optimization in one isolated research workflow. Runtime correctness remains strongly separated from strategic selection quality.

**Remaining problem:** steepest-descent search stopped at a local minimum (459 vs 415); Kimi's second proposal did not beat original baseline. The trusted kernel already has `searchBestCandidate` for exact small-instance optimization, but V8 did NOT substitute its exact result for the bounded neighborhood improver, to preserve attribution.

**Recommended next step (not launched):** add beam search or bounded multi-start exploration, or invoke exact branch-and-bound only for small instances, comparing compute cost against optimality gap. For larger schedules report a feasible incumbent and a defensible bound, not an unsupported 'optimal' badge. Preserve one worker and independent oracle; do not bring Silas into experiment until robustness and budget gating improve.

---

## Experiment V9 — Bounded beam and exact small-instance scheduling (2026-10-17)

**Research branch:** `experiment/scheduler-beam-v9`, draft PR https://github.com/booleanlambda/agent-control-room/pull/56, DO NOT MERGE or deploy. **Verified one-worker live GitHub Actions run:** https://github.com/booleanlambda/agent-control-room/actions/runs/39063301365 (job conclusion SUCCESS). **Persisted full evidence artifact:** https://github.com/booleanlambda/agent-control-room/actions/runs/39063301365/artifacts/12112620386 (`aau-beam-and-exact-v9-evidence`). This is one isolated inference experiment, no Silas/AAU production changes.

### Implementation
- `experiments/scheduler-beam-v9/beam.mjs`: deterministic bounded **beam search** over machine reassignments, job relocations, and swaps, with global state deduplication, deterministic cost ordering, explicit width/depth/evaluation caps, provenance digest, and strict cost-improvement trace. It allows exploration of temporary non-improving states without certifying any infeasible schedule. The trusted V7 kernel still owns ALL job start/setup/maintenance/parent timing.
- Same module's `exactSmall`: exhaustive small-instance search only when job count <=8; refuses larger instances. Independent V6 exact oracle remains separate and certifies cost; model proposals do NOT get credit for deterministic exact solve.
- `beam.test.mjs`: 9 tests, including exact independent public+hidden comparisons, randomized 20 small instances, deterministic replay, strict budgets, no feasible seed, one invalid+one valid seed, and refusing false optimality for >8-job instance. V8 optimizer 10/10 and V7 scheduling kernel 13/13 tests also reran. **TOTAL 32/32 deterministic tests passed**.
- `live.mjs`: Kimi K2.6, thinking disabled, single worker, max 2 strictly serial calls, 19k token reported budget, provider-reject/uncertain fail closed, no hidden-case contents or oracle answers in prompts. Compare historical baseline, bounded V8 local, bounded V9 beam without model, V9 beam using additional model seeds, and independent exactSmall reference. Model vs deterministic attribution preserved; final chosen public plan is evaluated on unchanged hidden variations.

### Verified real live results
- Two Kimi serial calls; **1,264 provider-reported tokens**; structured assignment proposal costs **735** then **512**. Kimi's second output improved its own first by 223 units, but **did not beat the historical 512 baseline**; model improvement versus historical baseline = **0**.
- Public historical baseline **512**; V8 single-path local search **459** (78 evaluations; about **5.94 ms** measured for one CI run).
- **V9 beam baseline-only reached the exact public optimum 415** using 1,200 evaluations, depth 5 (about **33.14 ms**). The augmented beam with Kimi seeds ALSO reached 415 with 1,200 evaluations, depth 4 (about **23.08 ms**). Kimi seeds did **not** improve final public cost.
- Deterministic exactSmall enumerated **448 completed feasible assignment candidates**, reached **415**, about **37.31 ms** in this single CI run. Independent V6 exhaustive oracle certified **415** separately. These timings are observational, too few samples for robust speed comparison.
- Selected winning source is **`v9_beam_baseline_only`**, selected public cost **415**, exact gap **0**. Machine assignment/order `J0@M0, J3@M0, J1@M0, J2@M1, J4@M0, J6@M0, J5@M1`; independent public feasibility and optimality certified. Search, model proposals, comparisons and verifier receipts included in evidence.
- Public-optimized static order was applied without new optimization to the **withheld changed-timing cases**: both valid, but hidden1 **648 vs independent optimum 387** (gap **261**), hidden2 **925 vs optimum 582** (gap **343**). These outcomes are *not* Kimi failure to solve hidden cases (it never saw them); they show sensitivity of one publicly optimized fixed arrangement to changed conditions.
- Hidden exactSmall instances were **separately** verified optimal by the independent oracle: hidden optima **387** and **582**. These results were not fed into model prompts and were not used to select the public winning candidate.
- Root-proof SHA256 **`4a486664ec324c743a749e16ba0ba26c6a9c254ee82ddf490571c203e8142718`**, validated from retained evidence.

### Interpretation / next gate
**Confirmed:** the bounded beam overcame the V8 local minimum and independently achieved the small public exact optimum while scheduling legality stayed deterministic. Small exact fallback also worked. The success is credited to **deterministic search**, not Kimi reasoning. These specific task sizes may be small enough that exact search is practical; bounded beam is a heuristic and must NEVER claim optimality absent independent proof or a valid lower bound.

**Not established:** robustness on unseen task families, scaling beyond eight jobs, model-led optimization gain over a baseline, reliable runtime/cost comparisons, transfer of static optimized order to changed timing conditions, or production readiness.

**Recommended next research gate (NOT launched):** apply the same trusted kernel and bounded beam separately to each **new problem instance** (not one reused public plan), benchmark 9-12 job scaling with strictly enforced compute ceilings, and measure heuristic gap versus independent exact/lower bounds when available. Further model studies should test whether Kimi contributes useful high-level decomposition or diversification rather than scheduling arithmetic. Keep one worker, finite budgets, hash receipts and no production changes.

---

## Experiment V10 — Independently re-optimize every instance; bounded 9–12 job scaling (2026-10-17)

**Status: isolated research experiment PASS.** New branch `experiment/per-instance-scaling-v10`, draft PR [#57](https://github.com/booleanlambda/agent-control-room/pull/57) — NO MERGE or production/Silas/Render/Supabase/queue changes.

- Verified successful one-worker GitHub Actions run: https://github.com/booleanlambda/agent-control-room/actions/runs/39063906570.
- Permanent Actions evidence: https://github.com/booleanlambda/agent-control-room/actions/runs/39063906570/artifacts/12112760726 (`aau-per-instance-scaling-v10-evidence`).
- New files: `experiments/per-instance-scaling-v10/bench.mjs` (deterministic generation + independent admissible bound + fresh topological seed heuristics + beam for each problem), `bench.test.mjs` (11 new tests), `live.mjs` (live benchmark and Kimi 10-job seed), and `.github/workflows/per-instance-scaling-v10.yml`.
- **43/43 deterministic tests passed**: new V10 11/11, V9 9/9, V8 10/10, V7 kernel 13/13. Includes randomized small exact cross-checks, independent feasibility checks and fixed search budgets.
- All six cases used **a separately generated set of topologically valid, machine-eligible seeds**, and an independent **V9 beam search capped at 1,400 evaluations per instance**, width 12, depth at most 9. It does NOT reuse the public-optimized order for other timing variants.

### Verified costs (lower is better)
| Scenario | Jobs | Fresh initial seed cost | Independent per-instance beam cost | Independently proven exact optimum | Provable lower bound | Upper bound on true optimality gap |
|---|---:|---:|---:|---:|---:|---:|
| Seven-job original public | 7 | 533 | **415** | **415** | 10 | **0 by exact proof** |
| Seven-job hidden variant 1 | 7 | 546 | **387** | **387** | 36 | **0 by exact proof** |
| Seven-job hidden variant 2 | 7 | 630 | **582** | **582** | 70 | **0 by exact proof** |
| New nine-job case | 9 | 645 | **499** | not established | 200 | **<=299** |
| New ten-job case | 10 | 488 | **420** | not established | 157 | **<=263** |
| New twelve-job case | 12 | 848 | **706** | not established | 73 | **<=633** |

All six results were verified independently feasible and obeyed machine setup, predecessor completion, maintenance, machine eligibility, and cost calculations. **All six beam runs used the entire 1,400-evaluation allowance.** The bound for >8 jobs is admissible: optimistic earliest release/parent finish ignoring setup, congestion and downtime, plus minimum unavoidable machine activation using type coverage. The bounds are conservative/loose: they do NOT establish that 499/420/706 are optimal. For seven-job cases external exact oracle certifies optimality, overriding much weaker relaxation-bound gaps.

### Genuine one-worker Kimi integration
- Kimi K2.6 thinking OFF, one actual serial provider call, **666 provider-reported tokens**, HTTP 200 `finish_reason=stop`. No retries/concurrency.
- It saw ONLY the new ten-job problem and supplied a complete, machine-eligible, topological assignment without timestamps/code. Its legal assignment cost **516**, worse than the best deterministic initial seed **488**.
- Adding Kimi's assignment as a V9 beam seed reached **420** at the same 1,400-evaluation budget. Beam *without* Kimi also reached **420**. **Incremental model-attributable gain: 0**. The difference from the Kimi seed 516 to 420 (96) belongs to the deterministic engine.
- The 9- and 12-job problems were not shown to Kimi. Their plans were independently optimized by the deterministic system. Do not misreport these as model solving hidden tasks.
- Verified root digest from full Actions artifact: `f864a9d407072b581fbb46a89bec303fda17f91049124a84ba6937776a8b2934`.

### Research conclusion and next decision
- The prior V9 hidden generalization weakness **was partly an evaluation protocol error**: applying the public plan unchanged to altered instances caused large avoidable gaps. Re-optimizing each input independently yields exact optima for ALL THREE seven-job cases.
- The deterministic kernel and beam produce verified-feasible improvements on 9, 10 and 12 jobs without any model-derived clock arithmetic. This is a bounded scaling feasibility demonstration, NOT evidence of statistically reliable optimality or real-world performance.
- The admissible lower bounds for large instances are weak; a tighter independent bound or bounded exact solver is needed for meaningful optimality certification at >=9 jobs. 1,400 evaluations were exhausted for each.
- Kimi's single 10-job trial supplied a valid but worse-than-baseline plan and did not boost beam search. Its best role may be choosing strategy/diversity/which exact tools to invoke, not generating schedules.
- Timings recorded in artifact are one CI realization and should not be presented as stable performance comparisons.

**Next experimental gate NOT started:** strengthen lower bounds through disjoint chains/machine workload relaxations or constraint programming, profile search with explicit time/evaluation ceilings on several seeded 9–12 job instances, and evaluate proof-backed anytime optimality gap vs computed feasible incumbents. Preserve hidden separation, serial model calls and production isolation.

---

## Experiment V11 — Provably bounded anytime search resolves exact optima through twelve jobs (2026-10-17)

**Outcome:** PASS, isolated deterministic-only research branch `experiment/certified-anytime-v11`, draft PR https://github.com/booleanlambda/agent-control-room/pull/58. **DO NOT MERGE or deploy.** No Silas, AAU, Render, Supabase, brokers or production changes. No Moonshot calls or token spend.

- Verified successful GitHub Actions run: https://github.com/booleanlambda/agent-control-room/actions/runs/39066390120.
- Full evidence artifact: https://github.com/booleanlambda/agent-control-room/actions/runs/39066390120/artifacts/12113467349 (`aau-certification-v11-evidence`).
- Root SHA256 ledger digest: `b6d2ee66b927f40c1351850631da1e81332117e6aefed3444775125a6af08a53`.
- Implementation: `experiments/certified-anytime-v11/{certifier.mjs,certifier.test.mjs,live.mjs}`, `.github/workflows/certified-anytime-v11.yml`. Trusted V7 scheduling kernel, independent V6 feasibility/exact oracle and V10 fixture generator were unchanged.
- Mandatory deterministic test gate: **9/9 new exact-certifier tests and 11/11 V10 tests passed**, 20/20 total. Includes independently checked exact 4/7-job proofs, randomized small instances, zero-expansion honest lower bounds, monotone upper bounds, error/budget fail-closed behavior and safe 9/10/12 schedules.
- Provider use: **0 calls, 0 tokens**. One CI worker, no provider request secrets needed.

### Mathematical certificate mechanism
The algorithm enumerates still-feasible precedence-respecting job choices and eligible machine assignments via **best-first branch-and-bound**. Every partial transition computes real earliest legal start considering setup, predecessor completion, machine previous type/availability and downtime. At every partial state:
1. Cost incurred is exact (activation already incurred and each finished job's weighted tardiness).
2. For all remaining jobs, derive an admissible **optimistic** earliest finish by respecting releases and their predecessor finishes, plus each eligible machine's current availability/setup, while allowing unrealistically unlimited future machine capacity and ignoring maintenance.
3. Add a **minimum unavoidable extra activation fee** for uncovered remaining job types; this cannot exceed the extra activation costs of any valid completion.
4. The sum is a true lower bound for every extension of that partial state. Prune when lower bound is no better than a known, independently verified feasible incumbent upper bound.
5. At interruption, `min(current verified upper bound, smallest surviving frontier lower bound)` is a certified global lower bound; `upper - lower` is a rigorous upper limit on the unknown optimality gap. If frontier exhausted/pruned with lower=upper, the incumbent is **certified optimal**.

Priority queue retains the complete unexplored frontier, capped at 85,000 states; per-instance expansion caps are 16,000 for 7- or 12-job cases, 10,000 for 9, 12,000 for 10. No unexamined branches are silently dropped. The output includes the incumbent witness, independently checked by V6 `evaluate`, root/ledger hashes, node counts, pruning counts and exit reason. <=7 jobs also cross-checked against V6's separate brute-force **exact oracle**. >=9 optimality follows from the new certifier's admissible bound proof and exhausted/pruned frontier, **not** an independent pre-existing 9+ job exact oracle; this distinction is important.

### Verified single-run results
| Scenario | V10 feasible beam incumbent | V11 rigorously certified optimum | Nodes expanded | Surviving frontier |
|---|---:|---:|---:|---:|
| 7-job public | 415 | **415** | 38 | 0 |
| 7-job hidden 1 | 387 | **387** | 35 | 0 |
| 7-job hidden 2 | 582 | **582** | 22 | 0 |
| New 9-job | 499 | **499** | 101 | 0 |
| New 10-job | 420 | **420** | 58 | 0 |
| New 12-job | 706 | **664** | 4,232 | 0 |

Every case exited `proof_complete` with **certified lower = verified feasible upper**, gap=0. The new 12-job incumbent improves the previous 706 by **42 (~5.95%)** while proving 664 globally optimal under the benchmark's stated scheduling assumptions. One workflow computed all six with no budget exhaustion.

### Interpretation and limits
- The V10 large-instance optimality gap has now been resolved **for these particular deterministic fixtures** with actual search certificates, not guessed from weak static bounds.
- These results demonstrate exact correctness and bounded proof search on ONE synthetic 2-machine family up to 12 jobs. They do **not** establish favorable scaling for larger job counts, other machine topologies, real-world operations, unbounded search, or autonomy of Kimi. The certifier intentionally caps jobs at 16, machines at 10 and total work by explicit limits.
- The deterministic certifier depends on the established earliest-start dominance property for a fixed job order/machine assignment and integer nonnegative weighted tardiness/activation objective. This assumption should be reverified if objective, setup policy or resource model changes.
- Any future change must keep validation independent, never turn a positive residual gap into an `optimal` claim and preserve proof frontier or fail closed.

**Next research gate (NOT started):** audit proof and performance using multiple independently seeded 12–16-job fixtures, profile max-frontier and expansion exhaustion, and deliberately trigger censored/budgeted runs to verify that `[LB,UB]` remains sound. Explore whether agent-led decomposition improves search ordering only when a deterministic baseline and independent verifier have been established; no production integration or concurrency yet.

---

## Experiment V12 — Multi-seed 12–16 job stress; discovered and repaired frontier-cap bug (2026-10-17)

**Research scope**: draft PR [#59](https://github.com/booleanlambda/agent-control-room/pull/59), branch `experiment/certificate-stress-v12`. DO NOT MERGE or deploy; AAU production, Silas, services and secrets untouched. **Zero model/provider calls or tokens.**

### Actual CI execution, failure and correction
- First CI: https://github.com/booleanlambda/agent-control-room/actions/runs/39067524365 **FAIL** (6/8 new stress tests passed). Two tests found a real V11 implementation defect: after popping a frontier state, expanding all its children could make heap size **exceed the nominal `maxFrontier` cap**. It retained all states so was not silently discarding proofs, but its advertised memory limit was **not hard**. No inference was triggered.
- Fixed in the V12 **research branch copy** of `experiments/certified-anytime-v11/certifier.mjs`, commit `9e9dfc6`: stage all candidate children in a temporary list; if accepting them would exceed the configured frontier capacity, reinsert the **whole unexpanded parent** with its admissible lower bound and exit `frontier_budget`. Otherwise atomically commit all children. Nothing is silently dropped. Counting expansions and the exit flag were corrected.
- Verified **successful final CI**: https://github.com/booleanlambda/agent-control-room/actions/runs/39067594396 (job success).
- Full evidence artifact: https://github.com/booleanlambda/agent-control-room/actions/runs/39067594396/artifacts/12114205557 (`aau-certificate-stress-v12-evidence`).
- **17/17 deterministic regressions passed**: 8 new V12 stress tests and 9 old V11 anytime tests. Additional live independent exact-oracle checks on 4-, 5-, 6-, and 7-job instances all passed. No provider requests.
- Verified root evidence digest: `71ac37274b99c14a45d567053901948164878a2ea6d12a69f09b071396aa593e`.

### Workload and budgets
- Nine distinct, reproducible seeded cases: three each with **12, 14, and 16 jobs**, varying precedence graphs, setup, releases, maintenance, activation and due dates; all two-machine synthetic tasks.
- Every case got an independently checked legal incumbent after up to 400 deterministic beam evaluations. Four proof checkpoints per case: zero expansions, early 450 expansions, deeper 2,200 expansions, and intentionally tight 100-state frontier with 2,200 possible expansions; ordinary frontier cap 2,400. The solver correctly stopped early on frontier pressure.
- **36/36 proof checkpoints** returned feasible independent-validated upper bounds, admissible lower bounds <= those uppers, correctly bounded node and frontier usage, and honest proof status. All nine early checkpoints were censored, eight of nine deep checkpoints censored, all nine tight-frontier cases exited `frontier_budget`.
- Key result: the hard frontier restriction is now actually enforced, and the remaining frontier retains a mathematically sound lower bound on *all* incomplete branches. A censored result must be reported as **[LB, UB]**, not as optimal.

### Results of deep search (lower is better)
| New seeded instance | Independently valid upper bound UB | Certified lower bound LB | Uncertainty UB-LB | Expanded | Decision |
|---|---:|---:|---:|---:|---|
| 12 variant 0 | 1146 | 553 | 593 | 261 | frontier budget |
| 12 variant 1 | **1685** | **1685** | **0** | 948 | **optimal certified** |
| 12 variant 2 | 934 | 261 | 673 | 352 | frontier budget |
| 14 variant 0 | 1189 | 730 | 459 | 333 | frontier budget |
| 14 variant 1 | 2080 | 936 | 1144 | 489 | frontier budget |
| 14 variant 2 | 1337 | 801 | 536 | 542 | frontier budget |
| 16 variant 0 | 1464 | 495 | 969 | 198 | frontier budget |
| 16 variant 1 | 1346 | 297 | 1049 | 221 | frontier budget |
| 16 variant 2 | 1054 | 530 | 524 | 401 | frontier budget |

No outside exact 12–16 job oracle was used. Optimality of **12 variant 1** follows from the bounded best-first tree's exhausted/pruned frontier and bound invariants; independent feasibility and randomized small-oracle checks were performed. For the remaining eight, **optimality NOT shown**. There are no speed, memory or scale guarantees from nine synthetic cases.

### Implications
1. V11's claim that its frontier cap was a hard maximum was overbroad; **V12 fixes this**. The revised implementation must be used for any further research and previous V11 numerical certificates should be regression-replayed if considered for later use. V11 is not retroactively edited in its prior branch.
2. The solver can give correct gap bounds when budgets are exhausted, but proof quality degrades at larger sizes under tight frontiers. This is the correct fail-closed result, not a failure to return a feasible schedule.
3. The next gate should compare smarter bounded search, tighter admissible relaxations, and wall-clock/memory ceilings on multiple unseen instances, keeping the 100-state pressure tests. Do NOT widen budgets or merge into production by default. Keep model input restricted to strategic assignment, never clocks or certifier code.

---

## Experiment V13 — Forced-machine rank relaxation, compressed frontier state and capped proof stress (2026-10-17)

**Status: PASSED on isolated research branch** `experiment/tighter-bounds-v13`, draft PR [#60](https://github.com/booleanlambda/agent-control-room/pull/60). **DO NOT MERGE/DEPLOY.** No Moonshot/Kimi provider calls (0 tokens); no changes to production AAU, Silas, Render, Supabase or broker.

**Verified GitHub Actions:** https://github.com/booleanlambda/agent-control-room/actions/runs/39070162429 — job concluded SUCCESS. Full ZIP evidence https://github.com/booleanlambda/agent-control-room/actions/runs/39070162429/artifacts/12114582383 (`aau-tighter-bounds-v13-evidence`). Verified evidence root SHA256 **`98fca6fd552aacc159c887d444301dbfd53283e06b5899f0c082349a5e389351`**.

### Implemented change
1. New independent research copy `experiments/tighter-bounds-v13/certifier.mjs` of V12's already fixed certified frontier engine; prior V12 branch not changed.
2. Stronger provably **admissible** remaining-job tardiness lower bound: for jobs eligible on exactly one machine, the k-th mandatory job cannot finish before that machine's current clock plus the sum of the k shortest mandatory processing times. A bounded subset-assignment DP (max 9 forced jobs per machine; otherwise safe fallback) assigns forced jobs to optimistic completion ranks, respecting the independently relaxed release and parent-finish earliest lower limits. Combine the forced group and flexible-job optimistic penalties, then take the maximum with the original V12 independent relaxation, adding unavoidable extra machine activation fee. This **cannot overstate** the cost of a valid full completion.
3. Store each search node's `parent` pointer and latest `step` instead of repeatedly copying the whole proposal prefix. Reconstruct the full proposal only at a complete candidate. This reduces repeated path duplication by design; however direct overall **memory savings were not measured against a separate V12 process**, so do not claim verified byte-level improvement.
4. Preserve V12's **atomic hard frontier limit**. Add finite wall-time (`maxWallMs`) and sampled heap use (`maxHeapBytes`) guards checked between expansions; when exhausted, stop and return a surviving-frontier admissible [LB,UB] interval. The heap byte check is a **sampled guard, not a guarantee against momentary GC/allocation peaks**.
5. New `certifier.test.mjs`, `live.mjs` and `.github/workflows/tighter-bounds-v13.yml`.

### Direct CI results
- **9/9 new V13 tests and 8/8 existing V12 stress regressions passed**: total **17/17**. V13 tests compare against independent exact reference optima for 4–8 jobs, verify V13 bound never weaker than V12 at the root, independently verify reconstructed witnesses, compare V12-bound-mode results, check reproducible proofs, and deliberately censor both wall and heap search before any node expansion.
- **Same nine independently seeded V12 12-, 14-, 16-job fixtures, same verified beam incumbents and the SAME standard budget of up to 2,200 node expansions and 2,400 frontier states.**
- V12 aggregate certified gap `sum(UB-LB)` **5947**; V13 aggregate gap **5531**, improvement **416 (~6.99%)**. Eight of nine cases had a strictly smaller residual certified gap, one (12 variant 1 already optimal) unchanged, none worse.
- V12 fully certified **1/9** and V13 **1/9** at the standard limit. Already-optimal 12 variant 1: V12 **948 expansions** vs V13 **563 expansions**, approximately **40.6% fewer**; independently feasible optimum **1685** retained.
- V13 had fewer expansions in **2/9** cases; some unsolved cases expanded more before encountering the same 2,400-state frontier cap. No general runtime superiority is established.

| Case | V12 certified LB | V13 certified LB | Verified incumbent UB | V13 expansion count | V13 proof status |
|---|---:|---:|---:|---:|---|
| 12 variant 0 | 553 | **565** | 1146 | 261 | frontier exhausted |
| 12 variant 1 | 1685 | **1685** | 1685 | 563 | **certified optimal** |
| 12 variant 2 | 261 | **264** | 934 | 355 | frontier exhausted |
| 14 variant 0 | 730 | **787** | 1189 | 357 | frontier exhausted |
| 14 variant 1 | 936 | **945** | 2080 | 512 | frontier exhausted |
| 14 variant 2 | 801 | **820** | 1337 | 595 | frontier exhausted |
| 16 variant 0 | 495 | **599** | 1464 | 193 | frontier exhausted |
| 16 variant 1 | 297 | **440** | 1346 | 245 | frontier exhausted |
| 16 variant 2 | 530 | **599** | 1054 | 427 | frontier exhausted |

- Nine out of nine **tight 100-state frontier** experiments exited `frontier_budget` with valid admissible intervals; no silent state loss. Both deliberately `maxWallMs=0` and `maxHeapBytes=1` tests returned an independent-feasible upper bound and retained root lower bound with **zero expansions**, `wall_budget` and `heap_budget` respectively.
- Maximum measured `heapUsed` in V13 standard nine runs was **32,256,752 bytes** (~30.8 MiB). This is NOT a full-process high-water RSS measure and not comparable to historical V12 independently. Timings are one-off observations.

### Interpretation and next gate
**Demonstrated:** the lower-bound improvement is sound in all targeted oracle/invariant tests and tightens certification on most tested large cases with zero provider spend. No invalid schedule was accepted; all incomplete cases remain formally uncertain and are NOT called optimal. The parent-pointer structure compresses repeated paths but does not remove the exponential search frontier; 2,400-frontier cap still dominates 8/9 proofs.

**Next research gate, NOT launched:** attack the frontier size itself with a provably safe memory-bounded search strategy (e.g., iterative deepening A* / branch-and-bound with complete iteration accounting), profile standalone memory and wall time on independent CI jobs, and test whether exact certificates can be completed for additional 14–16-job instances without raising current memory cap. Preserve existing independent exact/feasibility oracles, deterministic clocks, serial worker and all research/production isolation.

---

## Experiment V14 — Memory-bounded IDA* is sound but underperforms V13 (2026-10-17)

**Outcome:** Implementation and independent correctness PASS, **performance hypothesis NOT SUPPORTED**. Isolated research draft PR [#61](https://github.com/booleanlambda/agent-control-room/pull/61), branch `experiment/ida-memory-v14`. Do not merge or deploy. **Zero provider/Kimi calls**, 0 tokens, no production AAU/Silas/Render/Supabase/broker changes.

- Successful GitHub Actions single-worker run https://github.com/booleanlambda/agent-control-room/actions/runs/39070931629. Evidence artifact https://github.com/booleanlambda/agent-control-room/actions/runs/39070931629/artifacts/12114814768 (`aau-ida-memory-v14-evidence`).
- Root proof/journal SHA256 `9e23158b4dbfcdf4405f6f8b07b3024e04d3362825850767f78a737366b643d1`.
- New module `experiments/ida-memory-v14/ida.mjs` uses memory-bounded depth-first iterative-deepening A* with V13's admissible forced-rank relaxation, exact partial weighted tardiness and activation costs, a current feasible incumbent, and **no materialized global frontier**. Each threshold pass collects the minimum cutoff from branches above the current threshold. **Only COMPLETED threshold passes raise the certified lower bound**. Interrupted passes leave the last proven lower bound unchanged. Independent V6 schedule evaluator checks every returned feasible incumbent. Work is capped by node, iteration, sampled wall and heap budgets.
- `ida.test.mjs`: 8/8 tests passed; V13 `certifier.test.mjs` 9/9 reran; **17/17 total passing**. Includes independent exact oracles for small jobs, interrupted iterations, repeatability, zero-node/time/heap budgets, all nine 12–16-job stress problems and invalid source rejection.
- The comparison used the **same nine V12/V13 fixtures and same trusted beam incumbents**, **2,200 node expansion budget**, V13 allowed 2,400 frontier states, and V14 had no globally stored frontier. These methods have different search semantics; node counts do NOT measure equal search diversity or total work across repetitions.

### Comparative result — negative, preserve V13 as leading proof method

| Case | V13 certified interval [LB,UB] | V14 IDA* certified interval [LB,UB] | V14 node expansions |
|---|---|---|---:|
| 12 variant 0 | [565,1146] | [436,1146] | 2200 |
| 12 variant 1 | **[1685,1685] optimal** | [1271,1750] | 2200 |
| 12 variant 2 | [264,934] | [194,934] | 2200 |
| 14 variant 0 | [787,1189] | [658,1189] | 2200 |
| 14 variant 1 | [945,2080] | [788,2080] | 2200 |
| 14 variant 2 | [820,1337] | [622,1337] | 2200 |
| 16 variant 0 | [599,1464] | [572,1464] | 2200 |
| 16 variant 1 | [440,1346] | [355,1346] | 2200 |
| 16 variant 2 | [599,1054] | [396,1054] | 2200 |

- V13 aggregate remaining certified gap **5,531**, V14 **7,008**, **1,477 larger (~26.7% worse)**. **V13 1/9 complete optimality proofs, V14 0/9**. V14 had a strictly worse gap in **all nine** equal-budget comparisons. It can retain a safe [LB,UB] interval but recomputes many partial subtrees across approximately 40 completed threshold rounds per case, spending CPU capacity without advancing proof as fast as best-first.
- Separately allowed **15,000 expansions** to V14 on **14 variant 0,1,2**: [721,1189], [891,2080], [741,1337], all still nonzero gaps, none proven optimal. These are additional research runs **not part of equal-budget comparison**. Four independent small exact-oracle checks completed.
- This DOES NOT establish real memory savings over V13: V14 has no global queue by design, but no controlled separate-process memory or RSS benchmark was done. The bounded V13 parent-pointer heap is still the better certifier for these fixtures at existing budgets. Do not replace V13 with V14 or silently call V14 an optimization success.

**Next gate, NOT STARTED:** investigate proof-preserving alternatives with memory/expansion efficiency better than naive iterative deepening, e.g. memory-bounded best-first with disk-spill checkpointing or recursive best-first with backed-up f-bounds and complete iteration accounting. Measure separate-process peak RSS, disk I/O, time, expansions, proof gap, and independent validity on the same nine fixtures. Retain V13 baseline, preserve the hard frontier cap and no false optimum labels. No automatic production merge.

---

## Experiment V15 — Durable SQLite frontier spill vs V13 best-first, negative performance trade-off (2026-10-17)

**Scope/status:** Isolated research draft PR [#62](https://github.com/booleanlambda/agent-control-room/pull/62), `experiment/disk-frontier-v15`; CI PASS and exact correctness checks PASS, **overall replacement NOT recommended** due large runtime penalty and lost exact proof. **DO NOT MERGE/DEPLOY.** Zero Moonshot/Kimi/provider calls, zero provider tokens and no production AAU/Silas/Render/Supabase/broker writes.

### Verified execution and implementation
- Successful GitHub Actions run https://github.com/booleanlambda/agent-control-room/actions/runs/39071580533.
- Evidence artifact https://github.com/booleanlambda/agent-control-room/actions/runs/39071580533/artifacts/12114768554 (`aau-disk-frontier-v15-evidence`).
- Root evidence ledger SHA256 **`7eccea8c6d359321c006c78e4e001e283a8bea2308683e074585044877275b96`**, checked against downloaded ZIP.
- Implemented `experiments/disk-frontier-v15/spill.py` with Python stdlib `sqlite3` durable on-disk best-first queue ordered by admissible forced-machine-rank lower bound. Each node removal and all its child inserts are an **atomic SQLite transaction**; if a hard queue-state cap would be exceeded, do not remove parent or drop children, report `disk_queue_budget` and certify interval using complete surviving queue. Soft on-disk byte cap checked between transactions, not byte-perfect. `PRAGMA synchronous=FULL` + rollback journal chosen for durability.
- `disk.mjs` runs Python as an isolated subprocess, independently recomputes selected proposal via trusted V7 scheduling kernel and separate V6 feasibility validator, reports source/hash/certificate. `v13-worker.mjs` runs V13 in its own separate Node process for RSS comparisons. `live.mjs` tests exactly the original V12/V13 nine independently seeded 12,14,16-job instances and same beam incumbents.
- **8/8 V15 tests plus 9/9 V13 tests passed (17/17)**. V15 tested *10 independent 4–8 job exact oracle fixtures*, four additional 4–7 job exact oracle trials in the final evidence, atomic queue-budget censoring, soft database-budget censoring, zero-node budget, independent feasible witness and deterministic replay. No falsely certified optimality or dropped queue state was observed.

### Same-case fixed expansion-budget comparison
Each configuration allowed at most 2,200 node expansions and used V13's forced-rank admissible relaxation; V13 was capped at 2,400 **in-RAM frontier states**, disk-tight at 2,400 **on-disk queue states**, disk-spill at **16,000 on-disk queue states**. These are **not equal memory/storage budgets**. Separate-process peak RSS is not interpreter-normalized.

| Measure | V13 in-memory Node | SQLite tight (2,400 disk states) | SQLite spill (16,000 disk states) |
|---|---:|---:|---:|
| Cases fully proved optimal | **1/9** | 0/9 | 0/9 |
| Aggregate certified uncertainty `sum(UB-LB)` | 5,531 | 6,120 | **5,255** |
| Cases with smaller gap than V13 | baseline | — | **7/9** |
| Total node expansions across nine cases | 3,508 | 4,933 | 18,219 |
| Total measured solver time across nine cases | **0.562 seconds** | 14.10 seconds | **73.99 seconds** |
| Largest peak child-process RSS | ~66.6 MiB (Node) | ~14.3 MiB (Python) | ~15.4 MiB (Python) |
| Largest SQLite database/journal bytes recorded | n/a | ~1.19 MB | **6,840,320 bytes (~6.5 MiB)** |

The disk spill's aggregate certified gap improved **276 (about 5%)** vs V13 only because it could retain more frontier states, and it tightened seven of nine gaps. It **lost** the V13 exact proof: for 12 variant 1, V13 certified optimum **1685**, while disk spill under the same 2,200-node expansion limit stopped at **[1642,1750]** without any proof. Two of nine spill intervals were worse than V13. No new 14/16 job case became certified exact.

Measured solver time **73.99 seconds vs 0.562 seconds** (roughly 132× in this one CI run) includes far more disk search expansions and durable SQLite fsync per expansion; do not interpret as a pure algorithmic speed factor or stable hardware benchmark. Same-state-cap disk-tight also took **14.10 seconds**, exceeding V13's **0.562 seconds** by roughly 25×. Node/Python RSS figures are not apples-to-apples because interpreter overhead differs, and the database occupies separate disk space.

### Decision
**Do NOT substitute V15 disk-backed search for V13.** It demonstrates correct proof-preserving spill/censoring with low measured Python RSS and moderate disk allocation, but under the existing expansion budget yields no additional exact proofs and large wall-time penalties. Preserve V13 as the preferred in-memory certifier. Disk spill should remain an experimental fallback for genuinely memory-limited environments only if durability/I/O overhead can be controlled and per-process benchmarks prove a practical advantage. No production integration, concurrency, or expanded paid model experiments authorized by this result.

**Next research gate, NOT STARTED:** profile database transaction/fsync costs separately, test batched or WAL-backed disk priority queues with proof-preserving atomicity, or a proof-preserving bounded hybrid RAM+disk queue, and compare equal search work and equal memory budgets. Make any successor independently pass small exact oracle and hard interrupted-frontier invariants before considering migration. Continue writing exact run/evidence hashes to continuity.

---

## Experiment V16 prerequisite — GitHub AMQP secret presence + read-only handshake (2026-10-17)

**Scope:** Credential verification ONLY, not a queued search frontier or runtime deployment. Isolated research branch `experiment/amqp-credential-probe-v16`, [draft PR #63](https://github.com/booleanlambda/agent-control-room/pull/63). No RabbitMQ queue/message mutation, no agent wake, no production/Silas/Render/Supabase writes, and **no credential/hostname/URL revealed in workflow output**.

Existing repo integration verified: `.github/workflows/rabbitmq-smoke.yml` and `.github/workflows/autonomous-rabbitmq-wake.yml` read `${{ secrets.AMQP }}` into `AMQP_URL`. Existing worker modules use `process.env.AMQP_URL || process.env.AMQP`. The smoke workflow is designed to publish/consume/acknowledge; the V16 prerequisite intentionally did **not** run that smoke test or create any queues.

**Completed GitHub Actions run:** https://github.com/booleanlambda/agent-control-room/actions/runs/39073722305, single job SUCCESS. Read-only check printed `AMQP_SECRET_PRESENT=true`, `AMQP_URL_FORMAT_OK=true`, `AMQP_TLS_CONFIGURED=true`, `AMQP_CONNECT_OK=true`, `AMQP_NO_QUEUE_OR_MESSAGE_MUTATION=true`. The GitHub Actions repository secret is therefore **present and live-usable for AMQPS connection/authentication at time of test**. Secret *value* is not obtainable from this run and must not be copied into code, logs, artifacts or model context.

**What is NOT established:** existence of a separately isolated AAU proof-search queue, queue declarations/permissions, durability/ack/nack/redelivery, throughput, idempotency, ordering, crash recovery, independence of production broker namespaces, or any speedup in V13 search. A read-only connection does not prove access to create queues. GitHub Actions secret availability does not imply every Render worker has that exact secret available.

**Next research gate (NOT STARTED):** implement a bounded broker-frontier experiment using `secrets.AMQP` from GitHub Actions, with an exclusive run-scoped namespace and no production queues. First prove queue create/publish/consume/ack with deduplication and a durable SQL search ledger holding authoritative [LB,UB] proof state, then measure one-worker equal-budget results versus V13 before attempting concurrency. Keep non-interfering keys/queues, single worker, no Silas wake or production deployment, and require deterministic verification of every branch/result.

---

## Experiment V17 — Actual RabbitMQ frontier + SQLite proof ledger, isolated redelivery and exact verification (2026-10-17)

**Outcome: PASS.** Branch `experiment/rabbitmq-proof-frontier-v17`, [draft PR #64](https://github.com/booleanlambda/agent-control-room/pull/64). **DO NOT MERGE or deploy.** Production AAU/Silas and all existing RabbitMQ queues were untouched. Reused prevalidated Actions `secrets.AMQP` without displaying its value, hostname or URI. No provider/LLM calls or paid tokens.

- Successful one-worker GitHub Actions run https://github.com/booleanlambda/agent-control-room/actions/runs/39074256954.
- Downloadable JSON proof artifact: https://github.com/booleanlambda/agent-control-room/actions/runs/39074256954/artifacts/12116213178 (`aau-rabbitmq-proof-frontier-v17-evidence`).
- Independently inspected ZIP JSON `broker-frontier-v17-evidence.json`; evidence root SHA256 **`512c09d09c622c29b2c8d0927e17e98caeb4a562b5a55b50e5410e6c64fe62f4`**.
- Code: `experiments/rabbitmq-proof-frontier-v17/{ledger.py,partition.mjs,frontier.test.mjs,live.mjs}` and `.github/workflows/rabbitmq-proof-frontier-v17.yml`. Mandatory **6/6 new tests and 13/13 V7 kernel tests PASS** (19/19 total) before broker connection, including deterministic partition vs separate exact oracle on all three seven-job cases, ledger idempotency/conflict rejection, incomplete-frontier truth and independently verified schedules.

### Actual broker + proof trace
- Connected to existing RabbitMQ over **AMQPS TLS**, successfully declared one unique run-scoped **exclusive, non-durable, auto-delete** queue. This queue is unrelated to production/agent wake queues; it is explicitly deleted during cleanup and is not reusable.
- Published **four confirmed messages**: one for each of three disjoint initial action partitions `J0@M0`, `J1@M0`, `J1@M1`, plus one deliberate same-ID duplicate.
- Consumer made **five message deliveries**, including **one broker redelivery** following a deliberate channel shutdown after the authoritative SQLite ledger committed a valid root result but **before** its RabbitMQ message ACK. A new consumer channel fetched redelivered work and skipped its duplicate computation by consulting the ledger. The independently published duplicate was skipped too. **Two duplicate deliveries safely suppressed**, **four final acknowledgments**, **three distinct completed roots**, and no duplicate branch-result commit.
- SQLite `FULL` synchronous transaction ledger stores root entry, pending/done, exact min cost, witness, hash, explored counts and claims. RabbitMQ transports only opaque partition IDs; **SQLite ledger determines whether a result counts**.
- With only `J0@M0` complete and two roots unfinished, reported **certified interval [0,415]**, uncertainty gap **415**, `optimal=false`. Correctly refused to declare a proof early.
- Exact partition results: `J0@M0`: **240 complete schedules, min cost 415**; `J1@M0`: **104 schedules, min 469**; `J1@M1`: **104 schedules, min 452**. All **448 possible complete assignments/orders** were traversed exactly once by disjoint topological initial choices. Final ledger [LB,UB] **[415,415]**, gap **0**, all three roots done, `optimal=true`. Independently rechecked root schedule witnesses using V6 feasibility evaluator and independently confirmed global optimum **415** with V6's separate exact oracle.
- Broker evidence: `secretPresent=true,tls=true,connected=true,queueAsserted=true,confirmedPublishes=4,consumed=5,acknowledged=4,duplicateSkipped=2,redeliveries=1,simulatedUnackedDisconnect=true`. **0 model calls**.

### Limits and production gate
**Important:** This is an isolated transport/idempotency feasibility proof on a **single GitHub Actions runner**. Its SQLite file is local and disappears when the runner is destroyed. Its RabbitMQ queue is **non-durable exclusive auto-delete**. Thus this DOES NOT demonstrate entire-runner crash recovery, full broker restart durability, durable multi-host authoritative proof storage, distributed atomic queue+DB transaction, concurrency, exact global best-first prioritization, or 9–16-job speed improvement against V13.

The experiment does confirm that an AMQP message queue can distribute branch IDs and safely recover unacknowledged **channel disconnects** while a separate ledger prevents duplicate proof commits and premature optimality claims.

**Next gate NOT STARTED:** use a genuinely durable shared SQL proof ledger (e.g. isolated schema/tables with explicit unique `run_id` and RLS/lease/idempotency fencing) and a **run-scoped durable RabbitMQ queue** with queue lifecycle cleanup, then test crash/restart/redelivery across independent processes/runners, stale worker lease fencing, duplicate commits, poison-message policy and artifact-bound frontier reconciliation. Do not let a RabbitMQ queue replace the mathematical priority/index proof registry. Preserve one-worker baseline before concurrency. Do not touch existing production queues or agents.

---

## Experiment V18 — Cross-runner durable broker research: offline proof PASS, live integration BLOCKED (2026-10-17)

**Status:** PARTIAL, not a completed live broker/recovery experiment. Research-only branch `experiment/broker-cross-runner-v18`; draft [PR #65](https://github.com/booleanlambda/agent-control-room/pull/65). **DO NOT MERGE OR DEPLOY.** No production AAU/Silas, RabbitMQ production queue, Supabase schema, or Neon production branch changed. No LLM/provider calls.

### What was implemented
- `experiments/broker-cross-runner-v18/stages.mjs`: proposed serialized five-job GitHub Actions protocol—publish three disjoint root messages plus a deliberate duplicate to one unique run-scoped durable RabbitMQ queue with persistent messages and 15-minute automatic expiry; handoff stages each consume and commit one root result to SQLite before deliberately closing the AMQP channel *without* ACK; each subsequent fresh runner imports a GitHub Actions immutable artifact snapshot of the SQLite ledger and ACKs the redelivered completed root; a finalizer checks all partitions against independent V6 exact oracle and removes the run-specific queue. Every live broker action is gated behind `GITHUB_ACTIONS=true` and `AAU_V18_RESEARCH=yes`.
- `experiments/broker-cross-runner-v18/checkpoint.test.mjs`: offline fresh-process, distinct-temporary-directory SQLite checkpoint restoration and idempotent completion protocol, including intentionally conflicting duplicate results, partial [LB,UB] intervals, three partition minima, 448 exhaustive complete candidates, independent exact optimum 415 and the fail-closed runner guard.
- `.github/workflows/broker-cross-runner-v18-preflight.yml`: **offline-only** CI. It intentionally contains NO AMQP secrets, RabbitMQ network calls, queue creation or production access.
- **Live five-job workflow was NOT installed:** an attempted GitHub workflow creation containing per-job `secrets.AMQP` references was blocked by tool safety controls. Do not represent any V18 broker redelivery or cross-runner RabbitMQ test as having occurred.
- A requested isolated Supabase development branch required separate cost confirmation and was not created. A separate Neon development branch creation was blocked; no shared durable SQL database was provisioned. Immutable GitHub artifact snapshots are not a live, concurrent shared SQL proof registry and cannot replace it.
- First offline run [39075033685](https://github.com/booleanlambda/agent-control-room/actions/runs/39075033685) **failed one test** because the static AMQP import loaded before the research guard and the offline workflow does not install `amqplib`. Fixed by moving import to after the guard in commit `b6d9428`; no live execution.
- Verified follow-up CI [39075082440](https://github.com/booleanlambda/agent-control-room/actions/runs/39075082440): **8/8 tests passed** (V18 2/2 and trusted V17 6/6); both independent exact and ledger recovery checks succeeded. No broker secret exposed or connected.

### Honest conclusion / next gate
The serialized SQLite checkpoint logic is verified offline across distinct local processes and restored filesystem snapshots. **Not yet established:** genuine fresh GitHub Actions runner-to-runner handoff, broker durable queue permissions, persistent AMQP message redelivery, clean queue expiry, whole-runner crash recovery, online shared SQL row locking/fencing or multiworker concurrency.

The existing **V17** live same-run AMQP channel-redelivery demonstration remains the latest fully proven broker integration. To proceed with V18 live, obtain an approved way to provision a separate persistent research database and inject AMQP credentials into the isolated workflow without bypassing repository safety controls. First do serial fresh-runner recovery with authoritative durable ledger; then add durable lease/idempotency fencing; only then compare against V13 and allow concurrency.

---

## V18B — Real separate-runner SQLite artifact handoff PASS; live broker+shared DB remains gated (2026-10-17)

**Status:** Verified independent GitHub Actions runner artifact handoff, NOT verified live cross-runner RabbitMQ. Single isolated research branch `experiment/broker-cross-runner-v18`, draft [PR #65](https://github.com/booleanlambda/agent-control-room/pull/65). **DO NOT MERGE OR DEPLOY.** Zero model calls, zero RabbitMQ calls, no production database writes.

**Actual workflow:** https://github.com/booleanlambda/agent-control-room/actions/runs/39076158735 — **all five independent GitHub Actions jobs succeeded**: `init` (runner 1) → `root1` (runner 2) → `root2` (runner 3) → `root3` (runner 4) → `verify` (runner 5). Each restored the **immutable snapshot artifact** from the prior job and uploaded a fresh SQLite file plus digest-chained JSON manifest. The final verified artifact is https://github.com/booleanlambda/agent-control-room/actions/runs/39076158735/artifacts/12117485059 (`v18b-verified-proof`). Also confirmed successful earlier V18 offline preflight run https://github.com/booleanlambda/agent-control-room/actions/runs/39075082440 (8/8 tests).

**New changes:** `experiments/broker-cross-runner-v18/artifact-handoff.mjs` (run-ID fenced digest-checked SQLite checkpoint import and exact partition solver) and `.github/workflows/broker-artifact-cross-runner-v18b.yml` (five serial GitHub jobs, no AMQP secret). Each stage rejects out-of-order/stale run IDs, mismatched database file hashes, duplicate root execution, and conflicting duplicate completion. The durable SQLite data is transferred via GitHub Actions artifacts between separate runners and is independent of any shared online service.

**Downloaded and inspected final ZIP** `aau-v18b-cross-runner-verified-proof.zip`, containing `manifest.json` and `proof.sqlite`; `complete=true`, `noBrokerCalls=true`, `modelCalls=0`, final proof SHA256 `8cf534287226585ff534ca90d64d4640c36ce9b6b2766b044276b95d6567fb24`.
- Initial state: 3 pending branches, certified interval **[0,512]**, not optimal.
- After `root1`: 2 pending, interval **[0,415]**, not optimal.
- After `root2`: 1 pending, interval **[0,415]**, not optimal.
- After `root3`: 0 pending, interval **[415,415]**, exact optimality certified.
- Final independent verifier: optimum **415**, exhaustive **448** complete schedules across three disjoint root partitions (240/104/104); branch minima 415/469/452; **0 proof gap**, all three root witnesses independently checked by V6 exact oracle/evaluator. The proof was still sound and correctly censored before the final branch.

**Explicit barriers:** The earlier attempted live multi-job workflow with repeated AMQP secret injection was blocked and was NOT committed/executed. A separate Neon branch creation was blocked. Supabase's **supported** development branch path is available only after its financial confirmation process. `get_cost(type="branch")` for the project's organization returned **$0.01344/hour**, and `confirm_cost` MUST NOT be called before the user explicitly agrees to that specific hourly charge. No cost has been accepted and no Supabase development branch has been created.

**Decision / next gate:** Artifact snapshot persistence across fresh runner jobs is now **real and verified**. This validates serial handoff and proof correctness, not continuous shared ledger access, concurrency, crash recovery after lost artifact, broker restart, or RabbitMQ redelivery across distinct GitHub runners. V17 remains the last live RabbitMQ delivery/redelivery proof. Before V18 live combined test, secure user approval of branch cost and proper authorized workflow secret setup; don't bypass either control. Preserve separate run-scoped queue, one worker, and no production queue or Silas changes.

---

## Experiment V19 — Neon isolated durable proof ledger with lease fencing and exact receipts (2026-10-17)

**Status: Neon persistent proof storage VERIFIED; combined RabbitMQ+Neon worker NOT YET TESTED.** New branch `experiment/neon-durable-proof-v19`, draft PR #66: https://github.com/booleanlambda/agent-control-room/pull/66. **DO NOT MERGE/DEPLOY.** No changes to production AAU/Silas, existing RabbitMQ production queues, Supabase production data, or Neon production branch. No LLM calls.

### Isolated Neon infrastructure created and checked
- Project `lucky-term-22683833` (Aau-saau). New independent Neon branch `br-cold-rice-b4m3l9qu` (`aau-v19-proof-ledger-isolated`), with small 0.25 CU configured compute and suspend timeout 0. The original `br-mute-rain-b4sgepsi` production branch is untouched. Branch may incur resource costs until retired; never delete it without explicit user authorization.
- Installed PostgreSQL schema `aau_research_v19` on that *specific development branch* with tables `runs`, `branches` and `events`. **RLS enabled on all 3/3 tables**, public schema/table/function grants revoked; confirmed actual schema ACL `{neondb_owner=UC/neondb_owner}`.
- Implemented owner-executed `claim(run,branch,worker,seconds)` with exclusive time-bound lease and monotonically increasing **fencing epoch**, `complete(...epoch,cost,leaves,receipt)` with row-level transactional lock and idempotent result handling, and `summary(run)` which never declares optimum while even one root remains incomplete and returns certified [LB,UB] interval. All operations used the explicit research branch ID via Neon connector.
- Migration source `experiments/neon-durable-proof-v19/schema.sql`. First attempts failed safely/rolled back because Neon SQL API rejects multi-statements in one prepared query and native Neon Postgres lacks Supabase's `anon` role. Fixed and applied **13-statement transactional migration** successfully.

### Verified live Neon transaction trace (same three exact scheduling roots from V17)
Neon test UUID `bcf92471-83d3-4aad-95b0-af5912480c16`; trusted V6/V7 public problem digest `544ebed3a3624eb4ef422454e8c6d064b4171b20282ef242de8dd8933685884f`. V17's source exact receipts and independently validated scheduling witnesses taken from https://github.com/booleanlambda/agent-control-room/actions/runs/39074256954/artifacts/12116213178 and reverified in GitHub CI.
- Initial state 3 pending roots, [LB,UB] **[0,512]**, NOT optimal.
- Worker alpha claims `J0@M0` epoch 1. Second worker's claim while lease live returns `ok=false`.
- Simulated expiration was explicitly set on the **isolated research branch**. Worker beta reclaims the same root with epoch **2**. Old worker alpha's epoch 1 completion returns **`STALE`**; it did not mutate the completed result.
- Worker beta valid exact root receipt **COMMITTED** 415/240 leaves. Replaying identical completion returned **DUPLICATE**, conflicting cost 416 returned **CONFLICT**. Mid-run Neon summary 1/3 roots, [LB,UB] **[0,415]**, NOT optimal.
- Remaining two verified root receipts committed: `J1@M0` cost 469/104 leaves; `J1@M1` cost 452/104 leaves. Final real Neon readback **3/3 complete; global certified [415,415], zero gap, optimal=true**. Total **448** complete schedules covered exactly once across three disjoint exhaustive V17 partitions. Database event audit: 4 claim events (including a reclaim), 3 completion events (not double counted).
- Data persisted across multiple independent Neon connector invocations—not runner-local SQLite. This is a successful **persistent shared proof ledger**, without a combined broker worker.

### Independent CI and evidence
- GitHub Actions SUCCESS: https://github.com/booleanlambda/agent-control-room/actions/runs/39077168309. **21/21 tests passed**: two new receipt/migration tests, 6 V17 partition-ledger tests and 13 V7 kernel tests. Recomputed all three V17 witness receipts, 448 leaves and independent V6 oracle optimum **415**.
- Checked-in nonsecret trace: `experiments/neon-durable-proof-v19/verified-evidence.json`; migration `schema.sql`, test `receipt.test.mjs` and workflow `.github/workflows/neon-proof-v19.yml`.
- No database connection string or role password written to GitHub repository, Actions logs or model artifacts.

### Honest limits / next gate
- **Neon persistence/transaction correctness proven. RabbitMQ+Neon combined crash recovery not yet proven.** The Actions workflow has the pre-existing `secrets.AMQP` but no confirmed **branch-scoped least-privilege Neon Postgres credential**, and connector-owned privileged connection strings must never be committed to repo or displayed in logs.
- Stale-worker test was controlled expiry + reclaim, not an actual runner crash. SQL functions trust a caller-controlled exact-cost receipt; a future **independent deterministic verifier service with tightly restricted database role** must authorize completion. RLS and revoked public access alone are not a complete multi-tenant authorization model.
- Next gate: give isolated GitHub Actions worker a branch-specific Neon credential through a supported secrets-management action, execute real broker delivery → deterministic witness verification → Neon fenced claim/complete → broker ACK, then terminate worker between commit and ACK and prove recovery in a second process. Start with one worker and run-specific queue; do not add concurrency or connect production agent wake paths until that gate passes.

---

## Experiment V20 — Combined RabbitMQ + Neon SIGKILL recovery ready, LIVE BLOCKED BY MISSING BRANCH SECRET (2026-10-17)

**Outcome:** Isolated implementation and deterministic CI **26/26 tests PASS**; **live combined broker/Neon test NOT RUN**. New branch `experiment/rabbitmq-neon-integrated-v20`, [draft PR #67](https://github.com/booleanlambda/agent-control-room/pull/67). DO NOT MERGE/DEPLOY. Zero LLM/provider calls, no existing production agent queues touched, no Silas wakes or production Neon/Supabase changes.

### Implemented
- `experiments/rabbitmq-neon-integrated-v20/store.mjs` uses `pg` with TLS and a hard fail-closed **branch marker check** matching `br-cold-rice-b4m3l9qu` and `AAU_V20_ISOLATED_LIVE_WORKER` before any write. Calls V19's already-tested `aau_research_v19.claim`, `complete`, and `summary`, fenced by worker epoch, with all SQL parameters bound.
- Research-only `marker.sql` added and **actually installed on V19 isolated Neon development branch**: `aau_research_v19.integration_scope`. RLS enabled; no public grants. This branch is `br-cold-rice-b4m3l9qu`, NOT the production branch `br-mute-rain-b4sgepsi`.
- `worker.mjs`: one worker process verifies every root exhaustively with V7 scheduling and independent V6 evaluator, then COMMITs its exact result to Neon, and **SIGKILLs itself before ACK**. A separate replacement worker consumes redelivered/pending messages, skips already completed roots, commits outstanding legal results and ACKs deliveries. Each message carries only `run` UUID and root ID; unique `aau.research.v20.<uuid>` broker queue with 10-minute expiry, durable queue and persistent publishes. Worker always requires AMQPS. No production queue names.
- `live.mjs`: orchestrates two OS worker processes in one CI runner, validates initial unfinished interval, checks SIGKILL, Neon persistence, broker requeue, duplicate suppression and final V6 exact optimum 415 over 448 exhaustive legal schedules. Explicit guarded outcomes on missing credentials. This is **one GitHub runner with two worker processes**, not cross-runner or broker restart durability.
- `integration.test.mjs` (5 unit/regression tests), `.github/workflows/rabbitmq-neon-proof-v20.yml`; workflow references existing `secrets.AMQP` and intended **new** branch-limited `secrets.NEON_V19_DATABASE_URL`, and preserves every outcome as an artifact. **Never prints/stores either secret.**
- The V19 Neon proof ledger already passed its own live lease fencing, stale worker/duplicate/conflict checks, and the V17 RabbitMQ test previously passed a broker redelivery simulation; however, their **combined** live use is not verified by V20 yet.

### Verified current CI
- GitHub Actions: https://github.com/booleanlambda/agent-control-room/actions/runs/39078310334. The workflow job SUCCESS: **5 V20 + 2 V19 + 6 V17 + 13 V7 tests = 26/26 passed**, no failures.
- Artifact https://github.com/booleanlambda/agent-control-room/actions/runs/39078310334/artifacts/12117469142 (`aau-rabbitmq-neon-v20-evidence`). Downloaded JSON status **`blocked_missing_neon_v19_branch_secret`**; `amqpsConnected=false`, `neonMarkerVerified=false`, no proof receipt. Thus workflow success means only *preflight success*, NOT end-to-end recovery success.
- The combined integration was deliberately not launched because GitHub Actions **has no configured `NEON_V19_DATABASE_URL` secret**. The GitHub connector available here does not expose a repository-secrets write method. Do not paste the Neon connection string into code, PR, chat, artifacts or logs.

### Precise next user action and future gate
In the repository GitHub UI, Settings -> Secrets and variables -> Actions -> New repository secret, name **`NEON_V19_DATABASE_URL`**; value: a valid PostgreSQL TLS connection URL for the **Neon development branch `aau-v19-proof-ledger-isolated`**, obtainable in Neon's console after selecting that branch (NOT production). Keep the URL private. Then rerun this exact V20 GitHub Actions workflow on the research PR. A least-privilege branch-specific role is preferable over production-wide privileged credentials.

Once configured, V20 must demonstrate **actual** broker delivery, verified Neon commit, SIGKILL-before-ACK, redelivery in a distinct process, idempotent completion, final Neon [415,415] proof and independent V6 oracle. Do not claim any of those happened just because the preflight passed. Retire the separately billed research branch only with explicit user authorization when finished.

---

## Experiment V20 — Live RabbitMQ + Neon SIGKILL-before-ACK recovery PASS (2026-10-17)

**Status:** LIVE INTEGRATION VERIFIED, no production merge or deployment. Isolated GitHub research draft [PR #67](https://github.com/booleanlambda/agent-control-room/pull/67), branch `experiment/rabbitmq-neon-integrated-v20`. The existing AMQPS GitHub secret and the now-installed private `NEON_V19_DATABASE_URL` were successfully used by isolated GitHub Actions; neither credential was printed. Production AAU/Silas, production RabbitMQ queue namespaces, Supabase production and Neon production branch untouched. **0 LLM/provider calls.**

### Successful execution
- GitHub Actions run https://github.com/booleanlambda/agent-control-room/actions/runs/39079131720 completed **SUCCESS** after the user configured the branch-only Neon GitHub Actions secret.
- Tests: V20 5 + V19 2 + V17 6 + V7 13 = **26/26 passed**.
- Artifact https://github.com/booleanlambda/agent-control-room/actions/runs/39079131720/artifacts/12118001973, downloaded and inspected: `integrated-v20-evidence.json` within `aau-rabbitmq-neon-v20-verified-evidence.zip`. Evidence root `proofDigest=91f8416f8d7f0c6d6a7cf8d049ba4a8cb9cfa64697884a24e3b09a62fa43f1da`. ZIP SHA256 `6fdb47b0b991be0e9522d29887bd55c370d475ad560e83a3981667a4c82c6f79`.
- Implemented and executed a unique **run-scoped durable RabbitMQ queue** with 10-minute expiry and persistent message publication (4 confirmed messages: 3 distinct root IDs plus an intentional duplicate). A single active worker process verified the first root with trusted V7 scheduling and independent V6 evaluator, COMMITTED its exact witness receipt to the private Neon V19 research branch, and was then actually terminated by **`SIGKILL` without RabbitMQ ACK**.
- A second OS worker process connected and received **1 RabbitMQ redelivery**, skipped **2 duplicate deliveries** based on Neon durable completion ledger, completed the other **2 unfinished roots**, and ACKed all **4** originally published messages. Only one worker process was active at a time.
- The isolated Neon branch marker `br-cold-rice-b4m3l9qu` + `AAU_V20_ISOLATED_LIVE_WORKER` was checked before any V20 write; `neonMarkerVerified=true`, `amqpsConnected=true`, `simulatedKill=true`. No production queue name reused.
- V20 produced 3/3 completed exact root minima **415, 469, 452**, representing **240 + 104 + 104 = 448** exhaustive seven-job complete schedules; final global certified interval **[415,415]**, gap zero, matches separate V6 exact oracle **415**. Final proof hash `91f8416f8d7f0c6d6a7cf8d049ba4a8cb9cfa64697884a24e3b09a62fa43f1da`.
- **Independent subsequent Neon connector readback**, NOT just a worker assertion: Neon project `lucky-term-22683833`, development branch `br-cold-rice-b4m3l9qu`, actual new `run_id=b70f5987-9de5-4850-86ea-db5b5c59a1fe`, persisted **3/3 complete, 448 leaves**. Separate SQL `aau_research_v19.summary(run_id)` returned `total=3, completed=3, pending=0, lower_bound=415, upper_bound=415, gap=0, optimal=true`.
- An essential correctness repair before rerunning: no missing credential may silently leave GitHub Actions green; `live.mjs` now sets a nonzero exit status when AMQP or the research Neon secret is missing.

### Proven vs unproven
**Proven:** scoped durable AMQP delivery, Neon database transaction after exact deterministic evaluation, real process death between COMMIT and ACK, redelivery to a different process, idempotent duplicate suppression, acknowledgment of all original messages, and persisted global exact certificate on the separate Neon research branch.

**NOT proven:** RabbitMQ broker restart persistence, recovery across **two different GitHub runners/machines** (both worker processes ran in one job), concurrent worker scaling, crash recovery from corrupt or irretrievably lost Neon credentials, or improvement in 12–16-job certification throughput against V13. A durable queue plus a separate SQL ledger is now viable infrastructure, but these scheduling tests are controlled seven-job workloads and do not demonstrate general cognitive gain for Silas.

**Next proposed gate, NOT STARTED:** test durable broker delivery and real Neon persistence **across distinct GitHub Actions runners**, then one-versus-two-worker throughput and proof quality using the same V13 12–16-job controlled instances. Keep isolated queues/branch, per-worker lease fencing and external independent proof verification; do not production-merge or assume concurrency improves performance.

---

## Experiment V21 — Actual cross-runner RabbitMQ/Neon crash recovery (2026-10-17) — PASS

**Scope and status:** Draft isolated research [PR #68](https://github.com/booleanlambda/agent-control-room/pull/68), `experiment/broker-neon-cross-runner-v21`, not merged or deployed. Successful full GitHub Actions run https://github.com/booleanlambda/agent-control-room/actions/runs/39079576622 with **two separate GitHub-hosted runner jobs**. Existing `secrets.AMQP` and `secrets.NEON_V19_DATABASE_URL` were available, never printed; Neon branch marker `br-cold-rice-b4m3l9qu` was verified. **No production Silas/AAU/queues/Neon production branch changed**, 0 model calls.

### Verified two-runner protocol
- First job `phase1_publisher_crash` (ID `117533602545`): create one unique `aau.research.v20.<uuid>` **durable, nonexclusive RabbitMQ queue** with `x-expires=1800000` and four confirmed persistent messages (three disjoint exact schedule root IDs and one intentional duplicate). Initialize the separate V19 Neon proof ledger, verify partial [0,512]; launch one worker process, verify one complete root via V7 trusted schedule kernel and independent V6 evaluator, **commit exact proof receipt to Neon**, then **SIGKILL worker before broker ACK**. After death, independently verify Neon has one completed/two unfinished [0,415] and broker reports all **four** remaining messages ready for redelivery. Runner job succeeds and uploads **nonsecret** artifact `aau-v21-phase1-handoff` (ID `12118013859`) containing run UUID, queue name and SHA256s. The worker did not ACK before its death.
- Second job `phase2_independent_recovery` (ID `117533678593`) runs on an independently provisioned GitHub Actions job environment. Restores only the previous artifact, checks scoped IDs/hash and V19 private Neon branch marker, checks the existing queue **without re-declaring it**, observes four pending messages and the first worker's committed Neon record. A replacement worker receives **one RabbitMQ redelivery** and skips **two duplicate deliveries** using the authoritative Neon ledger, completes and validates the other **two** roots, and ACKs all **four** original messages. Independent full proof: 3/3 root partitions done, **448** exact complete schedules, best **415** vs separate V6 exact oracle **415**, global Neon certified interval **[415,415]**, gap 0. Job verified queue empty and **deleted only its own run-scoped research queue**.
- New scripts `experiments/broker-neon-cross-runner-v21/{phase1.mjs,phase2.mjs,cross-runner.test.mjs,verified-evidence.json}`; workflow `.github/workflows/broker-neon-cross-runner-v21.yml`. **11/11 preflight tests passed** (V21 4 + V20 5 + V19 2).
- Final artifact https://github.com/booleanlambda/agent-control-room/actions/runs/39079576622/artifacts/12118312887, downloaded as `aau-v21-cross-runner-proof.zip` and inspected. Full JSON SHA256 `8f5f4eaeede34ea793a7d8703779dbfacd64487276f4f95ebb19b6da55cff482`, artifact ZIP SHA256 `004c531d7b37893287d7ca79a4e64ff1995f34306a0032f3de1767cdc0be37b2`, proof digest `f86c74e073c850a8c35ad620105d933e554ddf1cbccec967b291bdd2cf5acf58`.
- **Independent post-workflow Neon readback**: project `lucky-term-22683833`, research branch `br-cold-rice-b4m3l9qu`, run UUID `b64bfc4b-cef5-4073-829c-e253b683c61c`. A fresh direct `Neon.run_sql` on `aau_research_v19.summary(run)` independently returned **completed=3, pending=0, lower_bound=415, upper_bound=415, gap=0, optimal=true, leaves=448**. Evidence committed to `verified-evidence.json`; neither DB URL nor AMQP secret in artifacts.

### Proved and not proved
**Proved:** Real message queue persistence and delivery across two distinct CI jobs/runners; Neon durable authoritative ledger across job boundaries; actual process `SIGKILL` precisely after verified SQL COMMIT and before queue ACK; requeue/recovery in separate environment; duplicate suppression, idempotency, final broker ACKs, exact deterministic global proof and isolated queue cleanup. **Not proved:** broker SERVER restart durability, real simultaneous worker concurrency, or improvement against the original nine 12/14/16-job V13 best-first search fixtures. The bounded exact scheduling experiment is a transport/proof correctness test, not a general AI cognition benchmark.

**Decision:** The broker + Neon pattern is now validated for serial cross-runner recovery; retain as isolated research, do not merge into production. **Next gate (NOT STARTED):** benchmark one versus two concurrently running workers with transactional Neon leases on the same V13 nine 12–16-job workload under normalized node/compute budgets, and stress stale leases/poison messages. Use only separate run-scoped queues; preserve deterministic external proof verification and treat every unfinished branch as unresolved. Cleanup the Neon research branch only upon explicit authorization.

---

## Experiment V22 — One versus two concurrent RabbitMQ workers, nine V13 proof workloads (2026-10-17)

**Status: PASS — one observed 1.33× improvement in job wall time with two workers; evidence insufficient for a stable general speedup conclusion.** Isolated draft PR [#69](https://github.com/booleanlambda/agent-control-room/pull/69), branch `experiment/rabbitmq-parallel-v22`. **DO NOT MERGE/DEPLOY.** Existing production AAU/Silas, existing broker wake queues, Supabase and Neon production branch untouched; 0 LLM/provider calls or tokens.

### Actual implementation and isolation
- Established additional research-only Neon schema `aau_research_v22` on **existing isolated research Neon branch** `br-cold-rice-b4m3l9qu`, with three private tables `runs/cases/events`, RLS and revoked public access. Censored per-case [LB,UB] certificates are stored honestly, **not** labeled exact just because a worker finished computing. Fenced `claim`, atomic idempotent `complete`, conflicting replay rejection and `summary` functions are specific to V22 cases. PostgreSQL check rejects non-finite duration using `p_ms >= 'Infinity'::double precision`; naive `isfinite(double precision)` had been rejected by Neon and was repaired before the live run.
- Code `experiments/rabbitmq-parallel-v22/{schema.sql,store.mjs,worker.mjs,live.mjs,parallel.test.mjs}` and `.github/workflows/rabbitmq-parallel-v22.yml`; one draft PR. Both modes enforce the verified V19 private Neon branch marker, unique expiring research durable AMQPS queue with persistent messages and confirmed publishing, and **ACK only after** an independently verified V13 certificate is committed to Neon. All test queues were deleted.
- Benchmarks original **nine V12/V13 12/14/16-job stress instances (three seeds/variants for each size)**, **one case per RabbitMQ message**, with one worker serial vs **two simultaneously spawned OS worker processes**. Each case receives the *same* V13 forced-rank best-first search, warm beam of 400 evaluations, expansion cap 2,200, frontier cap 2,400, V7 deterministic scheduling and independent V6 feasibility/cost verification. Case hashes, proof LB/UB, expansions, certificate and witness SHA256 values were independently replayed and matched **case-by-case** between modes. The two workers divide *independent cases*, NOT branches within any one search tree.
- GitHub Actions full run https://github.com/booleanlambda/agent-control-room/actions/runs/39080274754 **SUCCESS**; **4/4 new V22 tests and 9/9 V13 certifier tests, total 13/13 preflight**; 18/18 independently validated live case executions and both Neon fenced ledger runs completed.
- Artifact https://github.com/booleanlambda/agent-control-room/actions/runs/39080274754/artifacts/12118871233, downloaded `aau-rabbitmq-parallel-v22-evidence.zip` containing `parallel-v22-evidence.json`. ZIP SHA256 `e87891c92727ea90d0aeb541d3588c0e4ea88172925d61147d4bc9f989fabff1`. JSON SHA256 `f2ad45a29e304e7a9021e150acd523ab0979228ae57e87606f02a00bb62094bb`. V22 aggregate proofDigest `16222e2b0af88d206d421d4b5dfa250ac172f32585bc8298a5fcdf561c642e04`.

### Actual per-run resource and correctness measurements

| Measure | One worker | Two concurrent workers |
|---|---:|---:|
| Cases completed | **9/9** | **9/9** |
| Certified optimal cases | 1/9 | 1/9 |
| Sum of certified gaps `Σ(UB-LB)` | **5,531** | **5,531** |
| Total V13 node expansions | **3,508** | **3,508** |
| Full workflow-mode wall time (dispatch through workers completed) | **6,870.105 ms** | **5,172.099 ms** |
| Throughput (cases/sec, including transport and worker startup) | **1.3100** | **1.7401** |
| Summed per-task warmup+solver wall times (not true CPU usage) | 531.585 ms | 976.386 ms |
| Peak worker-process RSS (Linux, KiB) | one process: 116,592 | two processes: 113,252 + 113,528 |
| Broker ACKs | 9/9 | 9/9 |
| Unreconciled/duplicated Neon case claims | 0 | 0 |
| Research queue cleanup | true | true |

**Observed wall-time speedup** `6870.105 / 5172.099 = 1.3283×`, equivalent to **24.7% less elapsed wall time** and **32.8% more throughput** in this single CI benchmark. Mean workload / output exactly equal: every case has identical V13 bound, feasible witness hash and certificate hash. The only case certified optimal in both modes was `n12_variant1` at cost **1685**. All other eight have nonzero certified gaps; no false global optimum claimed.

The two processes occupied about **1.94× the sum of per-process peak RSS** (113,252+113,528 KiB vs 116,592 KiB) and incurred higher summed per-case wall times, likely due to scheduling contention and cold/warm variances. These are peak RSS samples **per process**, not synchronized aggregate peak memory or billed CPU measurements. The ~5–7 second end-to-end latency is dominated by process setup, AMQP/Neon roundtrips, queue polling and idle poll delay relative to ~0.5–1.0 seconds of summed local solver work. Thus do not extrapolate to expensive reasoning tasks.

**Independent post-run Neon connector readback** of latest serial/two-worker V22 research runs: both `total=9, complete=9, pending=0, expanded=3508, gap=5531, proved=1, nonunique_claims=0`; each source row in the downloaded evidence verified `state=passed`. We have one observed **serial-first** run on shared GitHub Actions hardware. Order bias, host/cold start differences, DB/network variability and overlapping CPU costs are not controlled by one observation.

### Decision and next research gate
**Correctness and real concurrent multi-worker case dispatch PASS. Performance improvement is provisional**: only one serial-first run, modest observed 1.33× wall-time speedup, materially higher worker process memory. Retain V13 deterministic certifier. No production replacement authorized.

**Next recommended experiment NOT STARTED:** crossover/repeated trials (1→2 and 2→1; multiple seeds or repetitions) and real **within-one-problem tree splitting** using Neon as a global authoritative proof-bound registry. With split search, no open node may be dropped and a leaf work item may only mark a subtree fully completed when its entire frontier was deterministically exhausted. Test poison/redelivery/stale-lease paths under concurrency and compare *equal total expansion, CPU and memory budgets* with V13. Do not confuse parallelism over nine independent tasks with parallel proof of a single task.

---

## Experiment V23 — Cheap Kimi thinking OFF, **one RabbitMQ-driven durable cognitive thread**, unfamiliar non-scheduling problem (2026-10-17) — PASS

**Goal restored:** Test **system-level cognitive amplification**, not model-weight improvements or multi-worker throughput. One Kimi K2.6 configured `thinking:{type:'disabled'}`, one active model call at a time, RabbitMQ dispatching serial cognitive stages, Neon persisting phase state/outbox, Docker executing **Kimi-written** general Python with no network, external independent exhaustive verifier. Research only; DO NOT MERGE OR DEPLOY. Draft [PR #70](https://github.com/booleanlambda/agent-control-room/pull/70), branch `experiment/kimi-one-thread-cognition-v23`. Production Silas, AAU, external wake queues, Supabase, and Neon production branch untouched. New database schema `aau_research_v23` with four RLS tables (`runs, events, outbox, calls`) only on existing isolated branch `br-cold-rice-b4m3l9qu`.

### Live verified Kimi experiment
- GitHub Actions [run **39083145752**](https://github.com/booleanlambda/agent-control-room/actions/runs/39083145752) SUCCESS: **4/4 deterministic preflight tests**, real model stage passed, artifact [12119941820](https://github.com/booleanlambda/agent-control-room/actions/runs/39083145752/artifacts/12119941820), saved ZIP `aau-kimi-cognitive-thread-v23-evidence.zip`. ZIP SHA256 **`85d327890dc523586cab2958be1872af64879c361df6c817582690717f23d251`**, contained JSON SHA256 **`14c385afc9e21525c716ba150b0adde3541fc6baa94f37a5ddaa284a61f08430`**.
- Task family, deliberately not scheduling: **dependency-constrained security control subset selection**. Twelve controls with costs, required tags, recursively required controls, pairwise exclusions, at-least and at-most tag counts, mandatory selections, any-of groups, budget and lexicographic tie breaking. A reference exhaustive verifier searches 4,096 subsets per instance and validates general feasibility, cost and exact optimum. Model does NOT access oracle algorithm or hidden inputs.
- **Unaided thinking-OFF one-response Kimi baseline FAILED**: proposed selection `A,B,C,D,E,G,H,J,L`, self-reported cost **42**, violates mutually exclusive `E` vs `G`; independent public optimum **24**.
- Same thinking-OFF Kimi in architecture: proposed a generalized subset-enumeration/branch-pruning method, explicitly listed seven invariants including dependency closure and exclusion enforcement; wrote its own reusable Python solver, without the trusted V7 scheduling kernel or V13 branch-and-bound supplied to it. Runs in offline, 1-CPU, 192 MiB capped, read-only Docker sandbox with no network or secrets. **First generated program PASSED public optimality**: selected `B,D,E,H,I`, verified total cost **24**, and **both independently held-out variants passed exact optimum and feasibility** (hidden input digests in artifact).
- **No remediation was triggered**: there was no initial code failure to repair. Do not claim successful localized self-repair from this V23 live run.
- **Real usage:** 4 sequential Kimi calls `baseline` (693 tokens), `plan` (1,161), `implement` (2,817), `synthesize` (1,339), **6,010 provider-reported tokens total**, all `finish_reason=stop`. No ambiguous response retries. One worker, no concurrent LLM calls. Five RabbitMQ phases/messages (baseline, plan, implement, verify, synthesize), **5/5 ACKs**, persisted checkpoints/events with hash chaining, all model calls journaled in Neon *before* dispatch, transactional next-phase outbox, queue emptied and deleted.
- Independent post-job direct Neon connector query on run `9280f537-7bd8-4158-b63a-787152ccc3f9`: `status=passed, seq=5, next_phase=null, events=5, outbox=5, modelCalls=4, providerTokens=6010, repairAttempts=0, baselinePass=false, architecturePass=true`. No inference from workflow green alone.
- Root proof digest **`dbb379631048a576e9a2d3dcde6f62f15e3ea2a5dfdad40f55c9544ecf01165e`**; model source retained in private Neon run state, only SHA and verification outcomes in artifact. Five event chain nodes retained. Model received public failure data only; withheld inputs and oracle answers were not passed in any prompt. End-to-end stage orchestration actual RabbitMQ/Neon, rather than a script merely calling functions in order.

### Interpretation
**A concrete architectural amplification result on one synthetic task family**: the same thinking-OFF model returned an invalid unaided direct answer, yet generated a general-purpose computation strategy and reusable Python program which independently solved public plus two hidden variants exactly when coordinated by the cognitive runtime. This is a combined **tool use + external computation + verification** result. It does **not** show that Kimi's internal intelligence improved. Nor does it isolate which architectural component caused the gain; in particular a simple one-shot "write Python" instruction could also succeed. Avoid a strong claim of comparative superiority absent that ablation.

**NOT yet proven:** autonomous logical-error repair; adaptive recursive depth (this was five sequential phases, NOT a ten-deep semantic tree); resilience across job death during an uncertain paid call; general transfer beyond this one novel constrained-selection family; competitive total price versus more powerful model; statistically reliable performance, or advantage over a cheaper *single-shot code + deterministic test* pipeline.

### Next warranted controlled test (NOT STARTED)
Ablate baseline model **with general-purpose Python once** versus durable multi-phase architecture and test significantly harder independent unfamiliar families. Require model-authored **recursive semantic decomposition** with verified parents and children, and multiple cases where original independently testable subproblem code really fails. Exercise **unique-span local patch** remediation with explicit public counterexample and two retries without leaking hidden oracle results. Maintain same bounded spend, no new task-specific execution solver, one broker thread and independent hidden assessment, and preserve source provenance. Do NOT treat solver correctness on a known test family as general cognition.

---

## V24B verified — thinking-OFF Kimi finishes a depth-ten recursive reasoning spine with real self-remediation (2026-10-18)

**Status: PASS on one verified live run, strictly research-only.** Branch `experiment/kimi-recursion-trusted-cost-v24b`, draft [PR #72](https://github.com/booleanlambda/agent-control-room/pull/72), DO NOT MERGE/DEPLOY. This extends the V24 one-thread RabbitMQ+Neon cognition research and keeps Kimi K2.6 thinking **OFF**, only one model call at a time. No AAU/Silas/production deployment, Neon production branch change, or broker production queue change.

### Exact live result and evidence
- GitHub Actions run [39085292384](https://github.com/booleanlambda/agent-control-room/actions/runs/39085292384), job **117550435260**: **SUCCESS**. Five V24 depth tests and four arithmetic-companion tests passed before paid inference (**9/9**), plus Docker isolation and AMQPS+Neon research marker.
- Artifact [12120332121](https://github.com/booleanlambda/agent-control-room/actions/runs/39085292384/artifacts/12120332121) downloaded as `aau-kimi-v24b-10-level-evidence.zip`. Artifact ZIP SHA256 `24694f053bc4b83763e6eec05ed92ca412afe07103aae67366f0e0fcb3e2b0ce`; contained `kimi-recursion-v24-evidence.json` SHA256 `a3651ed89241dcc242b0fc11a3b4812b686b0c7b3c8ca04e3ed86e9ab95c6ccd`.
- **Fresh independent Neon readback** from isolated branch `br-cold-rice-b4m3l9qu`, run UUID `366aecae-3eec-4822-8166-f45fd956ccf9`: `status=passed`, `seq=31`, `verifiedDepth=10`, 10 proof nodes, 31 persisted events, 16 received Kimi call receipts. Two withheld hidden variants both **EXACT_VERIFIED**; independent exhaustive grader confirms every stage, without disclosing hidden answers to Kimi. Root digest `13cceb260fd182c317cd4deae41f91334c12ff4d9152975cece6d8782e2f26ef`.
- **Measured**: 16 sequential real thinking-OFF Kimi calls, **37,825 provider-reported tokens**, 10 level calls + five model-authored remediation calls + one final synthesis. **5 genuine local Kimi code repairs**: two at child depth 1 (tie-break/pruning), two at depth 2 (mandatory and sorting), one at depth 3 (deduplication with transitive dependency). They were **not synthetic faults or deterministic engine fixing the model's code**. Each accepted correction was revalidated across all ancestor public cases; full depth 10 independently verified **30 cumulative public cases**. Exactly **31/31** durable RabbitMQ event messages acknowledged, phase commits persisted to Neon, run-scoped AMQPS queue deleted.
- **CRITICAL ATTRIBUTION:** The new deterministic arithmetic companion was present, independently tested, and allowed to reconcile reported costs of Kimi-chosen subsets. But the successful run's actual evidence says **`costNormalizations=0`**. Therefore **do not credit the improvement to the companion's intervention**; no observed selected-cost was corrected by it. The gain shows this one **thinking-OFF Kimi + durable ten-step architecture + verifier-driven Kimi-authored local remediation** sequence succeeded. The model remains independently fallible. Need repeated trials and ablation; previous V24B isolated run `162d378d-7562-4d87-bd1f-ef0b9e19839f` attained depth 9 but failed final hidden exact tag-count, using 11 calls/19,597 reported tokens/one repair. The original V24 (run `3d892e08-4e2c-4ec9-b4dc-d87ef913f57a`) stopped at depth 2 after two unsuccessful model repairs.
- **What is and isn't demonstrated:** Verified sequential traversal of a **10-deep semantic chain** of progressive invariants with Kimi-authored program changes, cumulative testing, verified hidden variants, root synthesis, error diagnosis and five real localized corrections. Not a breadth-2^10 tree and not ten continuous transformer context windows; phases were separate model calls with external persisted state. The level definitions and verifier were preprogrammed, so this is *architecture-assisted adaptation within one constraint-optimization domain*, not general out-of-distribution reasoning, proof of mental intelligence increase, or a stable pass rate. The two independent hidden variants do support generalization **within this family**, not beyond. Twelve controls and 4096 exhaustive subsets per instance were intentionally bounded.
- The successful branch included two overlapping CI workflow definitions; treat any further live workflows as **distinct paid trials with separate UUIDs**, never as the same uninterrupted 16-call run. Avoid rerunning solely because continuity.md changed. No change to tests/prompts/budgets/secret scopes for this evidence record.

### Next gate (not launched)
Repeat the same frozen v24b config with controlled seeds and a one-shot Kimi-write-code baseline. Then challenge **multiple independent unfamiliar problem families** and more than one nested branch while keeping per-call budget/Neon checkpointing/strict unknown-provider retry stops. Report exact pass rate, per-level remediation cost, nonoptimum failures, and cost tradeoffs. Do not introduce a more powerful LLM hidden behind Kimi or imply that RabbitMQ creates reasoning on its own.


### V24B supplementary repetitions and paid-run safety — independently reconciled

After the independently verified run above, two additional workflows started through overlapping GitHub Actions PR-update triggers. These are **NOT parts of the same cognition thread**; report each as a distinct run with its own model calls and provider tokens.

| Isolated Neon research run UUID | Verified depth | Kimi calls | Provider-reported tokens | Model-authored repair attempts | Final state |
|---|---:|---:|---:|---:|---|
| `162d378d-7562-4d87-bd1f-ef0b9e19839f` | **9**, but hidden variant failed `EXACT_TAG_COUNT` | 11 | 19,597 | 1 | failed |
| `366aecae-3eec-4822-8166-f45fd956ccf9` | **10**, both held-out hidden variants exact | 16 | 37,825 | 5 | **passed** |
| `c6fe225b-7ca8-4a10-bfba-afa26641d0ab` | **2** | 5 | 15,221 | 2 | failed |
| `eb394afe-7d1f-41ca-82da-58f1ef3b1ba8` | **3** | 6 | 8,829 | 2 | failed |

The 5-call failed run is [Actions 39085292461](https://github.com/booleanlambda/agent-control-room/actions/runs/39085292461); the 6-call failed run is [Actions 39085911753](https://github.com/booleanlambda/agent-control-room/actions/runs/39085911753). The second paid retest was accidentally dispatched because a second workflow `.github/workflows/kimi-recursion-v24.yml` also matched PR updates; a documentation-only update then triggered another workflow pair. CI automatically cancelled one of the duplicates before inference.

**Safety remediation applied, verified:** Both existing research workflows `.github/workflows/kimi-recursion-cost-v24b.yml` and `.github/workflows/kimi-recursion-v24.yml` now listen only to `pull_request.types: [opened]`, **not `synchronize`**, to stop ordinary documentation commits from triggering another paid experiment. Changes were committed with `[skip ci]`; GitHub Actions lookup for both safety commits returned **no additional runs**. No new model inference requested by these safety edits.

**Correct interpretation:** Four observed live V24B attempts had substantially different outcomes (9-depth hidden failure, 10-depth exact success, 2-depth failure, 3-depth failure). They were not a prespecified repeated-trial protocol with rigorously frozen source revisions, so do **NOT** publish a calibrated 25% success-rate claim. There is **one real full-depth success, not reliable repeatability**. The exact successful run required real Kimi code remediation; its `costNormalizations=0` means the new deterministic cost helper made no observed corrections in that success. Its verified capability is **architecture-assisted long-horizon recursive task execution**, not an increase to Kimi's native model reasoning, and the failed repetitions show significant variability. Preserve all failures. Further paid trials require a new explicitly authorized experiment or manual dispatch, rather than CI automatically retrying on changes.

---

## V25 — Behavioral invariant-completeness gate and first live thinking-OFF Kimi result (2026-10-18)

**Status: deterministic regression PASS; one isolated paid end-to-end depth-ten trial FAILED at depth 0. Do not confuse them.** Draft research [PR #73](https://github.com/booleanlambda/agent-control-room/pull/73), branch `experiment/kimi-recursion-invariant-v25`, parent V24B. NO merge, deploy, Silas wake or AAU/production changes. Runner remains serial Kimi K2.6 thinking **OFF**, durable RabbitMQ event dispatch, dev-Neon-only checkpointing and public verification, max 2 Kimi-authored local patches per level, and untouched final hidden cases.

### What is new
- `experiments/kimi-recursion-v24/behavioral-probes.mjs`: **12 miniature public behavioral counterexamples** spanning each of the ten semantic levels. For each, the independent exact enumerator certifies that enforcing vs disabling the new rule **changes the optimum**; a cosmetic check or a calculated-but-unused boolean cannot meet this gate. Examples: exact console-tag count **zero** or **one**, conditional selected-trigger requires another control, excluded pair, min/max tag counts, mandatory optional control, impossible total budget, tie-breaking. These are distinct from both withheld final V24B inputs.
- `experiments/kimi-recursion-v24/fixtures/failed-hidden-v24b.py` is the frozen **real Kimi-written** solver from previous 9-depth/hidden-failed run `162d378d-7562-4d87-bd1f-ef0b9e19839f` (not an invented defective program). Replayed in offline Docker: it **passes the original public depth-9 case** but **fails** the new `exactly_zero_console` public behavioral test with `EXACT_TAG_COUNT`. This reproduces the documented missing acceptance condition without leaking or recycling a held-out hidden input.
- `live.mjs` now checks all historical public cases AND every behavioral probe from each ancestor level before accepting a new child; stores `probeId` and exact public first-failure details for Kimi's existing repair branch. Behavior-probe digests also join the child receipt. Verifier still rejects non-optimal model-chosen subsets and never substitutes the oracle's answer. The cost-only deterministic companion and separate hidden grading remain unchanged.
- **One-time PR-`opened`** CI trigger, not PR-`synchronize`; avoids the costly repeat problem. [GitHub Actions run **39087321693**](https://github.com/booleanlambda/agent-control-room/actions/runs/39087321693), job `117556512401`. Pre-inference gate **13/13 tests passed**: 4 new behavioral including original-source Docker replay, 5 ten-level depth, 4 cost companion. Docker available; model stage ran once. Full evidence [artifact 12121307722](https://github.com/booleanlambda/agent-control-room/actions/runs/39087321693/artifacts/12121307722), saved as `aau-kimi-behavioral-invariants-v25-evidence.zip`. ZIP SHA256 `05a2aec971b1ba8e16bb2652e4a1be3842bdd63b33eedd10a26f7dca0963add5`; contained JSON SHA256 `7ebbdb2387a88c51011b7a70a15293b297aef5f0e7d4b0a1a4428e0ead464467`.

### Live trial — FAILED before V25 behavioral probes
- Isolated Neon run `485862c5-8525-4b74-92ed-d242e6fbc277`: `status=failed`, `verifiedDepth=0`, `3` real Kimi K2.6 thinking-OFF calls, **4,875 provider-reported tokens**, **two model-authored unique-span patches attempted**, `6` stage events ACKed, private research queue deleted, root proof **absent**, no hidden grading.
- The initial Kimi program failed the EXISTING level-one public `LEXICOGRAPHIC_TIE_BREAK` check *before* reaching the new behavior-probe loop. It retained an equal-cost comparison/pruning defect. Repair 1 correctly described missing equal-cost tie handling but did not make a valid program; repair 2 contained contradictory reasoning about combination iteration and equal-cost pruning and also failed. Both source modifications were genuine Kimi patches; no synthetic faults. **This run does not show live success by the new behavior gate**—only the independent archived-source preflight proves that it catches the prior missed condition.
- The true bottleneck exposed by this live trial is quality of diagnostic witness and repair, not correctness of the reference oracle or availability of RabbitMQ/Neon. Do not raise model intelligence or blindly retry the same problem. Do not publish deep success or general reliability from this run.

### Recommended next isolated gate (NOT STARTED)
Before another billable trial, add to the *public-only* remediation feedback a **specific, minimal counterexample with the expected lexicographically ordered answer** and executable pass/fail witness, then prove the feedback is sound using independent deterministic tests. Keep final hidden oracle and hidden test inputs isolated from the model. Target the archived nine-level failure directly to prove an actual local patch repairs the omitted acceptance check. Measure remediation efficiency and fresh unseen behavior separately, and do not infer that more model attempts by themselves ensure convergence.


---

## V27 — Kimi thinking ON *only for verifier-triggered remediation* (2026-10-18)

**User-directed configuration; research branch only** `experiment/kimi-recursion-repair-thinking-v27`, draft [PR #75](https://github.com/booleanlambda/agent-control-room/pull/75), not deployed or merged. Kimi **K2.6** remains model for every phase. Strict centralized `thinking-router.mjs` limits `thinking:{type:'enabled'}` **exclusively** to stage labels `repair_0` through `repair_9`. Other model stages (`level_0..level_9`, `synthesize`) remain `thinking:{type:'disabled'}`. Independent `verify_i` uses no model. No second powerful model introduced; RabbitMQ/isolated Neon and cumulative public/hidden verifier unchanged, at most **two model-authored repairs per failing level**, no retry of uncertain/billable provider calls.

**Provider compatibility researched**: official Moonshot K2.6 supports disabled/enabled thinking, and returns `reasoning_content` separately from final `content`. Source https://huggingface.co/moonshotai/Kimi-K2.6 and https://platform.moonshot.ai. Stage-specific response validation now *accepts* nonempty reasoning content for repair calls, **rejects** it during thinking-OFF calls. Raw reasoning is never copied into results: persist only `reasoningReturned`, provider-reported reasoning token count if present, request-response hashes and final code patch. Repair temperature 1.0; ordinary temperature 0.6. Changed contradictory older system prompt that formerly asserted all Kimi calls were thinking OFF, and updated final synthesis to report hybrid stage configuration accurately.

### Tests, live provider receipt, and actual outcome
- PR #75 first static run [39089339574](https://github.com/booleanlambda/agent-control-room/actions/runs/39089339574) caught an **obsolete historical regression assertion** that demanded literal `thinking:{type:'disabled'}` in every call source; no billable call attempted. The assertion was corrected to check the stage router.
- Corrected one-time live probe [Actions **39089650981**](https://github.com/booleanlambda/agent-control-room/actions/runs/39089650981): **3 router tests + 5 depth/ancestor tests passed** in preflight. Offline sandbox and isolated Neon marker passed. Submitted exactly **one real Kimi repair-only thinking-ON request** using the actual archived V25 model-written lexicographic-error source `485862c5-8525-4b74-92ed-d242e6fbc277`. No gold solution, hidden input or extra patch attempts.
- **Provider confirmed thinking actually ON**: returned `reasoning_content` and `8,999` reported reasoning tokens, with `9,763` total tokens. But `finish_reason='length'` exhausted the then-`9,000` max output+thinking tokens **before complete usable JSON patch**. Safe `manual_hold` triggered; **0 repaired code validated**, and request was NOT repeated. This is a provider/model-response truncation, NOT proof the repair logic is correct or incorrect.
- Preserve failure receipt from [artifact **12122277773**](https://github.com/booleanlambda/agent-control-room/actions/runs/39089650981/artifacts/12122277773), downloaded as `aau-kimi-repair-thinking-v27-evidence.zip`; ZIP SHA-256 `72224456483f28f034a2c86e2849d9a2126d3bd6aad27b670318ade149ad9692`; contained JSON SHA-256 `7f83a4edefb980d3a80d2e51aadc84f86d816507c275acf134cfa9365bc0dc58`.
- **Adjustment after measured truncation**: repair-only request cap increased to **16,000** output+thinking tokens and repair timeout to **330,000 ms**. Ordinary stage max tokens and timeout untouched; global provider budget remains `75,000` tokens and max `24` calls in full experiment, and the total reservation guard remains in force. This increased cap is **statically verified**, not yet re-tested with paid Kimi inference. It is *not* appropriate to claim a successful live repair.
- [Static-only Actions **39090010386**](https://github.com/booleanlambda/agent-control-room/actions/runs/39090010386) **SUCCESS**: passed router/phase isolation + ten-level proof tests + arithmetic-companion tests, with **no Moonshot, Neon or AMQP secrets available**. Earlier redundant [PR #76](https://github.com/booleanlambda/agent-control-room/pull/76) closed as superseded. The paid probe workflow returned to `pull_request.types: [opened]` only, with no PR-update auto-paid inference.
- Production Silas/AAU untouched, no redeploy, no shared model default switched. Current status is **configured and deterministic tests passed; provider enabled mode observed; actual thinking-ON remediation efficacy not yet established**. More paid trials should be explicit, not triggered by routine commits.

**Follow-up research, if requested:** compare thinking-ON vs prior OFF failures under controlled public tests with response caps adequate to avoid reasoning-token truncation, same model and model-authored patch limits. Keep the provenance of each original source, no oracle gold answers, and report token cost/latency as a tradeoff of enabling thinking selectively.

---

## V28 — 32K remediation thinking, 4K OFF, budget-exhausted OFF decomposition (2026-10-18)

**Implemented on isolated research branch; OFFLINE CI VERIFIED; not yet live-provider tested and NOT deployed.** [Draft PR #77](https://github.com/booleanlambda/agent-control-room/pull/77), branch \`experiment/kimi-32k-exhaustion-decompose-v28\` relative to V27. [GitHub Actions run 39122543990](https://github.com/booleanlambda/agent-control-room/actions/runs/39122543990), job \`117660893908\`: success; syntax, pure state transitions, inherited router/depth regressions and archived behavioral-gate replay all passed. **No production or Silas changes, no provider/secrets in CI, zero live model calls for V28.**

### Fixed budget policy
- Kimi K2.6 thinking enabled ONLY in \`repair_[0-9]\` model calls. Fixed \`max_tokens = 32768\`; temperature 1; up to 720 seconds request ceiling. As documented for Moonshot, **32,768 is the SHARED completion ceiling for internal reasoning and final answer**, not a separate guaranteed reasoning budget plus final output. A completed valid JSON repair may use fewer.
- Every Kimi thinking-OFF call uses \`max_tokens = 4096\`, temperature 0.6: \`level_[0-9]\`, \`decompose_[0-9]\`, \`repair_piece_[0-9]\` and \`synthesize\`. The supplied per-call caller max cannot silently override these fixed architecture ceilings.
- Only a **successfully received provider response** with \`finish_reason = length\` on a \`repair_N\` thinking-ON stage is an authenticated completed 32K output-budget exhaustion. Persist call outcome \`budget_exhausted\`, usage, hash and thinking metadata; do not treat it as a model-authored logical patch or mark a logical repair attempt used. Never reuse incomplete code. Provider timeout, transport/network failure, missing receipt, incomplete JSON or OFF-stage truncation remains uncertain/manual hold with NO automatic retry.

### Bounded decomposition on exhaustion
- At most **one** exhaustion-driven decomposition per cognitive node. Durable research Neon state captures source code hash, last failed public verifier evidence, previous verified node sequence and logical repair counter. RabbitMQ transactional outbox sends one \`decompose_N\` stage with thinking OFF (4K).
- \`decompose_N\` returns **1–2 validated small tasks**, each defined by focused code region or fault hypothesis and a behavioral acceptance criterion. No gold answer or hidden problem sent. Tasks and pointer are saved in the persisted run state.
- \`repair_piece_N\` executes one scoped thinking-OFF 4K localized Python source patch at a time; at most **two total completed logical patch attempts** per parent node across thinking-ON and decomposed-child patches, with at most two children. Every candidate patch, including a child patch, re-runs all original ancestor public cases and each behavioral-invariant counterexample. Only independently proved acceptance permits next parent depth.
- Upon failed child proof, try the next allowed decomposition task if there is a remaining patch slot. If tasks/slots are exhausted, terminal \`blocked\` or \`failed\`; **no automatic repeat of the 32K model call, no escalating beyond 32K, no exhausted-source restart and no infinite recursion**.
- Previous 24-provider-call and 75K-reported-token run caps, research-only Neon scope marker, RabbitMQ ACK-after-commit, per-run queue cleanup, unchanged independent hidden verifier and model-authored patches retained. Decision engines never substitute an expected selection.

### Evidence limitations and next gate
- V28 tests are **pure/offline CI with static source structure, deterministic transition tests and archived executable behavioral checks**. They verify the intended single-exhaustion policy and no inadvertent thinking-mode escalation, but **no live Kimi thinking-ON 32K exhaustion, live agent-generated decomposition or full ten-deep traversal has been exercised under V28 yet**. A separate explicit authorization should precede another expensive paid experiment.
- V27's prior Kimi thinking-ON 9K generation used 8,999 reported reasoning tokens and exhausted without returning a patch. V28 changes **only the authorized budget routing and bounded fallback**, not Kimi weights, verification rules or production model selection.

---

## V28 actual Kimi live test — 2/10 verified, repair manual hold, no 32K exhaustion (2026-10-18)

**Frozen isolated research live run, failure honestly preserved.** Draft [PR #78](https://github.com/booleanlambda/agent-control-room/pull/78); [Actions run 39123073223](https://github.com/booleanlambda/agent-control-room/actions/runs/39123073223), job `117662479385`, CI result **failure** because the actual cognitive stage stopped `manual_hold`. Evidence archive [artifact 12134783933](https://github.com/booleanlambda/agent-control-room/actions/runs/39123073223/artifacts/12134783933), file `aau-kimi-v28-live-evidence.zip`, verified ZIP SHA256 `adb87123da0d2d4528acaf3098aec0f7a48c2e8df725aca8b5c12fe0c05a18bd`. User authorized live testing, **no production changes or merges**.

- The existing V28 pure budget, routing, depth and archived omission tests passed in the GitHub job before inference; Docker sandbox available, sealed research-only Neon branch and AMQPS credentials.
- Neon live run UUID `0377b1b2-72cd-41c6-bef6-8cc68e7c3c92`, 7 durable stages and 7 ACKs, terminal `manual_hold`, `verifiedDepth=2`, 4 real Kimi K2.6 requests, **9,680 provider-reported tokens**, zero completed local repairs, no final hidden checks, no root proof, run-scoped queue deleted.
- Readback from `state.thinkingRouting`: `level_0,level_1,level_2` all `thinking: disabled,max_tokens:4096`; `repair_2` `thinking: enabled,max_tokens:32768`. These are actual request-routing records in Neon, not just declarations.
- Three OFF stage provider completions were received and `stop`, with reported token usage 1,013; 1,497; 1,907. Level 3 generated a Python program with a public `python_exit_1` failure after the two verified ancestors. This correctly invoked an ON remediation call. The ON attempt increased total reported token usage by ~5,263 to 9,680, but the code categorized the call `uncertain_or_rejected` and raised `MODEL_REQUEST_MANUAL_HOLD` **without logging exact HTTP status, finish_reason or parse rejection subtype**.
- No model-authored correction was returned and no `budget_exhausted` receipt appears. The provider did **not** yield a safely classified `finish_reason=length`, so the new 32K exhaustion→4K OFF decomposition was **NOT exercised**. We CANNOT claim that thinking was simply starved or that the new fallback failed. The actual post-call rejection root cause remains unclassified because the legacy exception handler collapses provider/finish/JSON errors into one error code.
- Workflow evidence reports `thinkingOnlyDuringRepair=true`, `thinkingExhaustions=[]`, `decompositionSummary=[]`, `brokerACKs=7`, `queueDeleted=true`.
- **Next engineering step before billable retry:** improve NONSENSITIVE provenance of live provider responses: record HTTP success/failure category, `finish_reason` (including `length`), whether content was valid JSON, and explicit provider error category, without recording API credentials, raw private reasoning or hidden references. Differentiate `length`, API rejection, timeout/ambiguous transport and invalid JSON; still do not automatically retry ambiguous calls. Verify all offline in tests, then obtain explicit authorization for another live test. Keep proof/failure lineage intact.


### V28 first live provider trial — MANUAL HOLD at depth 2 (2026-10-18)

**This is the live evidence, not a demonstration that the 32K-to-4K recovery transition executed.** Isolated research [PR #78](https://github.com/booleanlambda/agent-control-room/pull/78), [GitHub Actions run 39123073223](https://github.com/booleanlambda/agent-control-room/actions/runs/39123073223), job 117662479385 (job failed after explicit research manual hold). GitHub artifact ID \`12134783933\`, name \`aau-kimi-v28-actual-budget-recovery-evidence\`, downloaded copy \`aau-kimi-v28-live-evidence.zip\`. Neon run ID \`0377b1b2-72cd-41c6-bef6-8cc68e7c3c92\` in already fenced dev branch \`br-cold-rice-b4m3l9qu\` with 7 persisted stage events, 7 AMQP ACKs and queue deleted.

**Measured**: 2 independently verified depth levels, failed level-3 verification with **\`python_exit_1\`**, then a remediation model request. Routing receipts show \`level_0\`, \`level_1\`, \`level_2\` were \`thinking: disabled\` and \`max_tokens: 4096\`; \`repair_2\` was \`thinking: enabled\` and \`max_tokens: 32768\`. 4 total provider calls and 9,680 accumulated provider-reported tokens; the three completed OFF calls used 1,013 + 1,497 + 1,907 = 4,417 tokens. The repair call was marked \`uncertain_or_rejected\` with NULL per-call provider usage and no finish_reason/response hash, yet cumulative run usage increased by 5,263 (9,680−4,417), which confirms usage data was parsed in the live process. **Do not falsely attribute a specific provider finish_reason, timeout, malformed content, or API error: existing catch block collapses several rejection reasons to \`MODEL_REQUEST_MANUAL_HOLD\` and erases per-call receipt details.** It was not confirmed \`finish_reason=length\`; neither an accepted logical repair nor confirmed 32K exhaustion occurred. No 4K OFF decomposition stages were executed (\`thinkingExhaustions=[]\`, \`decompositionSummary=[]\`), and zero model-authored repairs were recorded. The model call MUST NOT be automatically retried because outcome is uncertain.

**Preflight**: syntax, 32K/4K budget routing, old and new deterministic behavioral gate, offline Docker all passed. These prove implemented policy and actual model stage mode routing, but **the 32K exhaustion → OFF decomposition branch remains LIVE UNTESTED**. Root depth-10 proof not generated; status correctly \`manual_hold\`.

**Safe next engineering gate**: preserve the HTTP-status, provider \`finish_reason\`, model content parse status, token receipt and sanitized error class whenever a provider response is received; record those before the broad catch masks the failure. Do not expose raw reasoning, secret headers, prompt content, hidden answers or model-generated source in user-facing reports. A provider-confirmed \`length\` may trigger the new decomposition state path exactly once; uncertain responses must remain held. Add offline fault-injection tests for \`finish_reason='length'\`, \`finish_reason='stop'\` with invalid JSON, provider HTTP errors, aborted fetch, and ledger failures before another paid test. No production deployment or Silas wake.

---

## V28 provider diagnostics repair — isolated research branch (2026-10-18)

**Applied and independently checked offline, NOT a successful live Kimi remediation or new paid trial.** Branch `experiment/kimi-v28-provider-test` on `booleanlambda/agent-control-room`. The original live V28 experiment run 39123073223 stopped at verified depth 2 with four Kimi calls, 9,680 cumulative provider tokens, level-3 public `python_exit_1` failure, and repair-stage `MODEL_REQUEST_MANUAL_HOLD`. The original repair `finish_reason` cannot be reconstructed from the old overwritten receipt.

### Repair scope and diagnostic contract
- Added `experiments/kimi-recursion-v24/provider-response-diagnostics.mjs` and its fault-injection tests; wired into the existing isolated `live.mjs`, with no production/Silas files changed.
- Categorize HTTP failure, non-JSON provider body, known thinking-on `finish_reason=length` exhaustion, OFF-stage length, other incomplete finish, empty content, contract rejection, malformed valid-HTTP model JSON, invalid object shape, aborted/timeout transport, generic transport/client error, provider configuration failure, and ledger write failure.
- Before `MODEL_REQUEST_MANUAL_HOLD`, persist category in the existing isolated `aau_research_v23.calls.status`, retain `provider_tokens`, `finish_reason`, and output hash when available. The artifact report additionally preserves bounded `httpStatus`, prompt/completion/reasoning token usage, JSON parse status, and ledger-persistence status. No raw model content, hidden oracle, credentials or private reasoning enters the diagnostic report.
- If a ledger write itself fails, do not issue a second ledger finalization attempt; mark its commit uncertain and preserve the local diagnostic artifact. Ambiguous paid model requests must **not** be retried automatically.
- The only accepted budget-exhaustion-to-thinking-OFF-decomposition transition remains provider HTTP success plus exact `finish_reason='length'` on `repair_[0-9]` thinking-ON. All existing 32768/4096 ceilings, bounded decomposition, deterministic verifier, RabbitMQ sequencing and branch fencing remain unchanged.
- Added `.github/workflows/kimi-v28-provider-diagnostics-static.yml`: offline-only syntax/fault-injection/routing/depth tests with no provider or database credentials. Initial failures found outdated test assertions after extraction and were corrected. **GitHub Actions run [39129608497](https://github.com/booleanlambda/agent-control-room/actions/runs/39129608497) succeeded**. This validates the static/offline diagnostic contract, not actual live provider outcomes or database persistence under service failure.

**Next independent live gate:** a separately authorized, metered Kimi trial on this isolated branch, observing provider receipt and matching Neon call ledger; never claim the original 5,263 repair-call tokens imply a specific finish reason. No deployment or Silas wake from this change.

---

## V28 live diagnostic validation — 2026-10-18 (PR #79)

**One authorized paid live trial, experimental branch only.** Draft [PR #79](https://github.com/booleanlambda/agent-control-room/pull/79), [GitHub Actions run 39130556926](https://github.com/booleanlambda/agent-control-room/actions/runs/39130556926), job 117684664123; research Neon branch `br-cold-rice-b4m3l9qu`, run UUID `7265a8e9-dff1-498d-abef-caa3a08d1ac7`. Job conclusion: failure because guarded cognitive stage entered manual hold, NOT because preliminary syntax/offline gates failed. Exactly one live run triggered; no automatic replay.

**Measured provider receipts:** `level_0` thinking OFF, `finish_reason=stop`, 1,323 tokens; `level_1` OFF/stop, 2,710 tokens; `level_2` OFF/stop, 2,517 tokens. They all persisted with HTTP 200, `contentJson=valid_object`, response hashes, and ledger persistence flag true. Cumulative recorded usage before repair: 6,550 tokens. Two semantic depths were independently verified. Depth three public verifier reported `MISSING_DEPENDENCY`, triggering `repair_2` with thinking enabled and 32,768 completion-token ceiling.

**Fourth-call diagnostic:** `repair_2`, attempt 1, persisted `aau_research_v23.calls.status=transport_or_client_error` (artifact `errorCategory=TRANSPORT_OR_CLIENT_ERROR`); HTTP status NULL, finish reason NULL, usage NULL, response hash NULL, `contentJson=not_received`, `ledgerPersisted=true`, `ledgerWriteFailed=false`. The call was sent with preserved presend journal but yielded no completed provider response received by the runner. Neon run terminated `manual_hold`, 7 staged events and 7 ACKs, queue deleted. Exactly four provider calls attempted and zero accepted repair patches; no model output on fourth call can be counted in the 6,550 **reported** tokens. The elapsed interval for the fourth stage was approximately five minutes and nineteen seconds based on durable stage timestamps; this alone does NOT authenticate an underlying timeout subtype. The classified generic transport/client failure is narrower than V28's old generic `MODEL_REQUEST_MANUAL_HOLD`, but not yet a root-cause diagnosis.

**Not established:** Kimi hitting its 32K completion budget; model finish `length`; whether provider calculated unreported tokens; whether a network socket, HTTP library, proxy, upstream connection or unknown client exception caused the fourth-call failure. `thinkingExhaustions=[]` and `decompositionSummary=[]`—the 32K→4K fallback was correctly not activated on transport uncertainty. It would be inaccurate to call this a cognitive repair failure or a proven provider timeout. Do not retry this ambiguous paid call automatically.

**Evidence:** [GitHub artifact 12138370737](https://github.com/booleanlambda/agent-control-room/actions/runs/39130556926/artifacts/12138370737), downloaded ZIP `aau-kimi-v28-live-diagnostic.zip`, SHA-256 `255dee4b096adce77d4292f9892304c151258a25b813ce1e93abb88a30baed71`; embedded `kimi-recursion-v24-evidence.json` SHA-256 `8aad03a5d4e2574e9f29fc2636d01c19b6138d5bc257167ba42cc7e7b2a1c33f`. Production Silas untouched. The repair-level ledger status can be independently joined to the exact run UUID.

**Next bounded improvement before any repeat paid trial:** capture sanitized exception name, allowlisted top-level and nested `cause.code` (e.g. HTTP client header/body timeout vs connection reset), elapsed milliseconds and whether HTTP headers were received; keep raw error messages, request headers, tokens and private reasoning out of diagnostics. Preserve current non-retry/manual-hold policy and run deterministic transport-fault injection first. The current live run already validates that error category and ledger persistence no longer disappear, not the root source of the client/transport exception.

---

## V28 diagnostic provenance refinement — offline verified (2026-10-18)

**Scope:** isolated experiment branch `experiment/kimi-v28-diagnostics-live-20261018`, draft PR #79, **no new paid Moonshot call**. This follows the live trial [39130556926](https://github.com/booleanlambda/agent-control-room/actions/runs/39130556926), which preserved `transport_or_client_error` but not the exact underlying transport cause. The earlier failed response cannot be reclassified retroactively.

### Changes
- `provider-response-diagnostics.mjs` now extracts only an allowlisted exception name plus allowlisted top-level `error.code` and one-level `error.cause.code`. Examples: `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`, `EAI_AGAIN`. Unknown values map to `OTHER_ERROR` or `null`. It never persists raw `error.message`, stack, cause object, credential-bearing URLs, or private reasoning.
- Provider call instrumentation captures bounded `elapsedMs`, `httpHeadersReceived` (only after `fetch` returns), and `requestDeadlineFired` (only if the configured timer fires while the provider response is still unsettled). A completed body clears the timer before ledger work so a slow database commit cannot masquerade as a provider timeout.
- When `MODEL_REQUEST_MANUAL_HOLD` is raised, the sanitized diagnostic is attached to the failure and written into the existing `aau_research_v23.events.details.providerDiagnostic` through the terminal state transition, in addition to the existing evidence JSON and per-call status/finish/token fields in `aau_research_v23.calls`. No schema changes needed.
- Ambiguous paid calls remain **non-retryable**. A failed ledger finalization is not automatically replayed. The `repair_N` thinking-ON 32768-token and routine thinking-OFF 4096-token ceilings, one-time confirmed `finish_reason='length'` decomposition trigger, RabbitMQ ACK sequencing and independent public/hidden verifier are unchanged.

### Tests and limits
- Added credential-free fault-injection cases for nested Undici timeout, socket reset, DNS error, local deadline, HTTP header observation, unknown/malicious code redaction and durable event plumbing, alongside the existing budget/routing/depth regressions.
- [GitHub Actions **39131784314**](https://github.com/booleanlambda/agent-control-room/actions/runs/39131784314): **SUCCESS**, syntax check and all configured offline tests. The earlier diagnostic test run [39131692594](https://github.com/booleanlambda/agent-control-room/actions/runs/39131692594) also passed before the post-response deadline refinement.
- This validates **instrumentation and static/offline fault classification**, not a new live provider failure or the 32K exhaustion → 4K decomposition transition. Further paid work requires separate authorization; production AAU and Silas remain unchanged. An unrelated pre-existing `repair-expertise-verifier-runtime` push workflow still reports failures and was not modified.

---

## V28 live trial 2: full depth-ten success, new transport instrumentation (2026-10-18)

**Single explicitly authorized paid research run, actual Kimi K2.6; independent Neon and GitHub evidence verified.** Draft [PR #80](https://github.com/booleanlambda/agent-control-room/pull/80), isolated branch `experiment/kimi-v28-transport-cause-live-v2-20261018` based on diagnostics commit `c5ca2e9`; [GitHub Actions run **39132045865**](https://github.com/booleanlambda/agent-control-room/actions/runs/39132045865), job `117689025220`: **SUCCESS**. Evidence [artifact **12138596580**](https://github.com/booleanlambda/agent-control-room/actions/runs/39132045865/artifacts/12138596580), downloaded ZIP `aau-v28-10level-live-pass.zip`: ZIP SHA256 `426c83d2b2da03c67bc037d622b9d8e8bc513dca9cfab8572a9e8b105a9f1863`; JSON SHA256 `b0b4a0f8b8f443b056aaf9916c93ac862cacae793c122b278c1fe0630d64e1b4`.

**Readback:** live fenced isolated Neon branch `br-cold-rice-b4m3l9qu`, durable run UUID `ed27b187-ca60-4f58-b1c7-2d435226ea33`: status **passed**, `verifiedDepth=10`, ten verified source-hashed nodes, **both final hidden checks passed**, final root proof `f2739001024ddf6103685861181df1350e5f7fecb4d71cb0682ee3bd5bb8c6c6`. Exactly **11 actual Kimi calls**, **20,374 reported provider tokens** (10 sequential levels plus synthesis), all `finish_reason=stop`, `status=received`; no remediation, `repairCount=0`, `thinkingExhaustions=[]`, `decompositionSummary=[]`. Each call remained **thinking OFF** and had the fixed 4096-token completion ceiling. Actual full thread: 21 durable events, 21 RabbitMQ publishes and ACKs, ephemeral research queue deleted. The 11th synthesis call used 1,437 tokens, raising the 10-level-only count from 18,937 to 20,374. Independent GitHub artifact and Neon readback agree.

**Observed depths/tokens per call:**
`level_0=850`, `level_1=1554`, `level_2=2003`, `level_3=1637`, `level_4=1770`, `level_5=2059`, `level_6=2085`, `level_7=2082`, `level_8=2350`, `level_9=2547`, `synthesize=1437`.

**Interpretation and limitations:** This is a genuine full ten-semantic-level live pass in one bounded dependent chain, with archived verifier and hidden-case acceptance, **not** a thousand-leaf recursion tree, not evidence of general PhD-level reasoning, and not proof that the selective thinking-ON remediation or 32K `length` -> OFF decomposition logic works live. Prior two V28 live trials independently stopped at verified depth 2. This successful third trial progressed without encountering an error, so **the new `exceptionName`, `causeCode`, HTTP-header and elapsed-error classification fields were not exercised against a live transport failure**. The 11 accepted response receipts do validate that the expanded diagnostic code did not break normal successful processing. All offline transport-fault injection regressions had already passed on [Actions 39131862112](https://github.com/booleanlambda/agent-control-room/actions/runs/39131862112). No automatic retries, no merge, no production deployment or Silas wake occurred.

**Operational next gate:** Do not artificially inject transport failures into expensive real requests or repeat paid runs merely to see the new fields. Use isolated offline fault injection and keep genuine future transport errors attributable without storing raw error text/secrets. A future live remediation trial should be separately authorized and must not conflate a clean full-depth pass with actual remediation success.

---

## First real historical AAU software-debugging benchmark — 2026-10-18 (not a pass)

**This is not the previously reported synthetic ten-level optimization problem.** We froze the actual uncorrected `model()` function from V28 source blob `649f8af2247cc9fa69cd6360397f89838e5fa43a` (research branch `experiment/kimi-32k-exhaustion-decompose-v28`) as an independent software-debugging benchmark. The historical defect lost provider finish reason, usage, exact failure category and provenance during `MODEL_REQUEST_MANUAL_HOLD`. The model received the historical source and incident, **not** our existing repair or hidden tests. It selected its own plan and generated actual text substitutions against the historical source. Independent cases were run in a short-lived no-network, read-only Docker container using mocked actual provider/ledger interfaces.

**Baseline calibration:** [GitHub Actions **39133566455**](https://github.com/booleanlambda/agent-control-room/actions/runs/39133566455), SUCCESS: all eight independent test cases executed, and three or more cases failed on the frozen original vulnerable function as expected. Offline plan-alias parser tests later passed. Production Silas, main branch and live infrastructure were not changed.

**First paid run #81:** [GitHub Actions **39133682685**](https://github.com/booleanlambda/agent-control-room/actions/runs/39133682685), [PR #81](https://github.com/booleanlambda/agent-control-room/pull/81), research evidence [artifact **12139285466**](https://github.com/booleanlambda/agent-control-room/actions/runs/39133682685/artifacts/12139285466). One Kimi thinking-OFF planning call returned HTTP 200, `finish_reason=stop`, 1,541 reported tokens, but the original deterministic parser rejected its plan as `MODEL_PLAN_INVALID_NODE`; no patch or verifier run. This was an experiment-interface/schema gate failure, not proof Kimi could not diagnose the bug. The parser was amended to accept equivalent model-authored issue/acceptance aliases without inventing tasks, and tested offline.

**Second paid run #82:** [GitHub Actions **39133913360**](https://github.com/booleanlambda/agent-control-room/actions/runs/39133913360), [draft PR #82](https://github.com/booleanlambda/agent-control-room/pull/82), evidence [artifact **12139341172**](https://github.com/booleanlambda/agent-control-room/actions/runs/39133913360/artifacts/12139341172), run UUID `30612bbe-1b2a-4844-b592-ac52ff1d026a`, **failed/blocked**. The first Kimi thinking-OFF call yielded a valid plan of three distinct original-code failure mechanisms and independent acceptance criteria, using 1,617 tokens. The second thinking-OFF call yielded a single replacement-span code patch, using 4,284 tokens. Both HTTP 200, `finish_reason=stop`. Total provider-reported usage 5,901 tokens before remediation (no usage receipt for the third call).

**Independent public behavioral replay:**
- `received`: **passed**; normal accepted JSON still returns correctly.
- `malformed`: failed **literal category name**; Kimi wrote `bad_json` instead of expected `malformed_model_json`. Both refer to malformed JSON, so avoid presenting this literal mismatch as proof the underlying semantic diagnosis was wrong.
- `http_error`: failed literal category name (`http_503` vs `provider_http_error`) and the checker distinguished `undefined` from `null` as no finish reason. These are likely scoring-contract mismatches, though other persistence fields were not exhaustively reviewed.
- `timeout`: failed substantively; candidate still classified timeout as `uncertain_or_rejected`, not a safe transport/timeout category.
- Since the public gate failed, hidden tests **were never run**. There is no verified passing patch.

The runner correctly entered **thinking-ON remediation only on failed public proof**, with a maximum shared completion ceiling of 32,768 tokens. This third paid API request ended with `transport_or_client_error`, HTTP/finish/token receipt unavailable; it produced no usable patch. Under the non-replay policy, it was **not automatically retried**. This is not confirmed reasoning budget exhaustion and does not test thinking-on remediation efficacy. Model 3 calls attempted; 2 accepted, 1 ambiguous failure. The candidate source was intentionally not retained as a published gold patch; the failure evidence retains its SHA-256 `ba4b2f19087e2320847cf3311e86288a326869f44ad83f3c2626b7817eb43249`.

**Conclusion:** This was an authentic software engineering problem with verifiable original fault and model-selected plan. Kimi thinking OFF showed accurate diagnosis and a partially effective attempted code repair. It did **not** pass complete independent public validation or hidden validation; no claim of generic real-world or self-remediation success is justified. The validator's literal-label assumptions should be normalized for future tests using a predeclared mapping, while continuing to distinguish genuine timeout classification failures. Avoid repeated expensive paid trials solely to recover an ambiguous provider response. This was not a full RabbitMQ/Neon-recursion runtime and should not be counted as another ten-depth architecture result.

**Experiments remain isolated; no production merge or Silas wake.**

---

## Kimi thinking-OFF JSON adapter — authorized live replay (2026-10-18)

**Run and scope:** Single authorized research-only [draft PR #86](https://github.com/booleanlambda/agent-control-room/pull/86) against original historical V28 code, [GitHub Actions run 39139681912](https://github.com/booleanlambda/agent-control-room/actions/runs/39139681912), evidence [artifact 12140788274](https://github.com/booleanlambda/agent-control-room/actions/runs/39139681912/artifacts/12140788274), run UUID `1b5a4aac-6266-42ea-a303-5ae2a1cbf645`. Full job conclusion **failure**, with all syntax checks, Docker setup and final artifact upload passed; failed within bounded model/evaluation stage. No deploy/merge/Silas wake or automatic paid retry.

**Actual Kimi provider receipts:** `discover_and_decompose` thinking OFF, 4096 max completion, HTTP 200, `finish_reason=stop`, 1590 reported tokens, valid normalized plan with four independent model-authored tasks and acceptance criteria; response was canonical top-level `tasks` containing `issue` and `acceptance`. `implement_model_generated_plan` OFF, max 4096 completion, HTTP 200, `finish_reason=stop`, 4437 reported total tokens, canonical top-level `replacements` with one exact `old`/`replacement` patch. Total provider-reported 6027 tokens. The patch was applied to frozen historical source without reference to known gold fix. `remediate_failed_public_test` thinking ON, max completion 32768, status `transport_or_client_error`, with no HTTP/finish/usage receipt and no accepted patch. **Three calls attempted; two accepted.** Thinking was ON only for remediation after public failure. The output-adapter compatibility path succeeded on *canonical* live schemas; unusual nested/off-schema Kimi output did not occur this time and remains live-unverified.

**Independent public tests:** strict 1/4 passed. `received` PASS; `malformed` rejected on literal `malformed_json` status instead of expected `malformed_model_json`, despite recognizing malformed JSON; `http_error` status `http_rejected` instead of `provider_http_error`, and missing expected null finish reason; `timeout` substantive fail: `uncertain_or_rejected`, plus absent sanitized diagnostic. Public failure initiated optional ON repair, which failed at provider transport level. **Hidden tests not run; no verified complete real-world repair.** Do not conflate literal category mismatch with reasoning incapacity, nor mistake valid schema adaptation for actual software correctness.

**Result:** Adapter did not block normal Kimi planning or patch output in a live setting, but abnormal thinking-OFF JSON remains unproven live. Historical code remediation failed public proof and did not self-recover because repair call lacked a completed provider response. The original isolated V28 successful depth-10 benchmark remains separate and does not count as this real-world-debug pass. No further paid run authorized by this specific execution.


---

## V28 correction: thinking-ON JSON response shape (2026-10-18)

**User correction:** the suspected abnormal JSON/output structure concerns **Kimi thinking-ON remediation**, not thinking-OFF. Earlier GitHub real-world debug tests and the adapter were incorrectly interpreted as testing thinking-OFF structural problems; they did not establish a thinking-ON provider response schema or fix the real-world patch. All actual remediation calls in those trials were unresolved transport/client failures with no completed answer body. Never infer their final JSON shape or `length` finish reason from an incomplete transport receipt.

**Implementation (isolated research branch `experiment/kimi-thinking-on-json-v1-20261018`):** `provider-response-diagnostics.mjs` keeps reasoning separate from final response, and for `repair_[0-9]` only records sanitized `reasoningPresent` boolean, `finalContentKind` and bounded final JSON key names (no private reasoning, messages or values). Thinking-OFF receipt behavior and the original mode routing remain unchanged. Reasoning text is **never** treated as final JSON. A completed provider `finish_reason='length'` in thinking ON remains the **only** qualifying budget-exhaustion signal, handled before malformed/empty final content classification, preserving existing 32768->4096 decomposition routing.

**Offline assertions:** real API-like thinking-ON receipts with reasoning and JSON content, null final content, provider `length` plus incomplete final JSON, array/non-string content, and OFF boundary; tests also prove no private reasoning leaks into durable receipts. [GitHub Actions 39140564533](https://github.com/booleanlambda/agent-control-room/actions/runs/39140564533) **PASSED** provider diagnostics and existing budget/router/depth tests. The separate pre-existing `repair-expertise-verifier-runtime.yml` push workflow still fails and is not part of this change.

**Evidence limit:** This validates an offline safe shape/provenance diagnostic; no new paid model call was issued. The actual anomalous *thinking-ON* JSON response has not yet been captured because prior ON calls failed at transport. Do not claim live format recovery, actual schema mismatch, model incompetence, or a real-world debugging benchmark pass.

---

## Kimi thinking-ON JSON actual live failure reproduced — 2026-10-18

**One user-authorized, paid thinking-ON Kimi K2.6 call** triggered by [draft PR #87](https://github.com/booleanlambda/agent-control-room/pull/87), [GitHub Actions #39141865580](https://github.com/booleanlambda/agent-control-room/actions/runs/39141865580), artifact [12141886723](https://github.com/booleanlambda/agent-control-room/actions/runs/39141865580/artifacts/12141886723), run UUID `783381a4-eb5d-4828-b776-2e33ffd790b1`. Research-only branch `experiment/kimi-thinking-on-shape-live-20261018`; no production writes, no automatic retry, no Silas wake.

**Observed, sanitized actual provider response:** stage `repair_2`, mode `enabled`, model `kimi-k2.6`, JSON-object format requested, 32768 completion-token ceiling, HTTP **200**, `finish_reason=stop`, content **string**, `reasoning_content` **present**, **final content NOT valid JSON** (`MALFORMED_MODEL_JSON`, `contentJson=invalid`). No transport error; request completed in **70,539 ms**, headers received, no local deadline fired. Usage: **7475 total tokens** = **1132 prompt** + **6343 completion** tokens, including **4951 reasoning** tokens (non-reasoning completion remainder 1392). This is *not* 32768-token exhaustion, since finish reason was `stop` and usage below ceiling. The failed live GitHub Actions result is expected because a completed malformed final JSON response is not acceptable to the runtime; artifact uploaded successfully. Earlier provider diagnostics offline regressions [39140564533](https://github.com/booleanlambda/agent-control-room/actions/runs/39140564533) and probe preflight [39141802258](https://github.com/booleanlambda/agent-control-room/actions/runs/39141802258) were green.

**Safety/evidence limits:** Neither raw final content nor private reasoning was retained; saved evidence contains only response field names (`role`, `content`, `reasoning_content`), content kind, parsed success/failure, finish reason, usage and timing. Therefore the exact syntactic pathology (code fences, unmatched braces, non-JSON preface, invalid escaping, etc.) is **not established**. The actual failure is *malformed final JSON under thinking ON*, not merely an alternative but valid schema, not transport timeout, and not budget exhaustion. A JSON field-alias adapter would not resolve parse-level invalidity. No automatic retry or downstream JSON patch application was performed.

**Engineering implication:** Keep model execution outcome separate from final-format validity, and keep `MALFORMED_MODEL_JSON` as a distinct manual-hold category unless a future preauthorized, strictly bounded deterministic normalization validates an actual syntactic variant without inventing missing text. To pinpoint subtype without private content retention, consider adding sanitized syntax-location/error-family metadata and controlled diagnostic probes; never persist private reasoning or full raw response and do not auto-retry ambiguous billable calls. **No more paid calls in this trial.**


---

## V28 thinking-ON syntax classification and bounded deterministic recovery — offline (2026-10-18)

**Motivation:** The prior genuine Kimi K2.6 thinking-ON response in [Actions 39141865580](https://github.com/booleanlambda/agent-control-room/actions/runs/39141865580) completed HTTP 200, `finish_reason=stop`, total 7475 tokens / 4951 reasoning tokens, but its final `message.content` could not be parsed as JSON. The raw final content was deliberately not stored, so the exact cause is unknown. This work does **not** claim to fix that historical response retrospectively.

**Scope and code:** research branch `experiment/kimi-thinking-on-json-recovery-v1-20261018`, no production Silas or AAU modifications. Added `experiments/kimi-recursion-v24/thinking-on-json-syntax.mjs` and its isolated tests; integrated parser into `provider-response-diagnostics.mjs` **only** for `repair_[0-9]` thinking ON. This uses the already completed provider response; there is no second paid request or automatic replay.

**Strict deterministic strategy:** First attempt a normal `JSON.parse`. On syntax failure, generate *only* sanitized `syntaxClass`, bounded optional numeric `syntaxOffset`, `rawContentChars` (capped), `rawSyntax`, and a `recoveryStrategy`/`recoveryResult` enum. No raw error message, invalid JSON substring, private reasoning, URLs or code text is persisted. Only allow (a) removal of exactly one leading BOM, or (b) removal of an **entire** fenced JSON block with nothing before/after; reject multiple fences, ambiguous prefaces/suffixes, JSON5, truncated JSON, missing braces, and overlength responses. Do not synthesize a missing bracket, quote, field or token. A complete fenced **JSON object** may be used as an accepted answer; valid JSON arrays or primitives remain `MODEL_RESPONSE_SHAPE` rather than malformed syntax. On actual invalid syntax, retain `MALFORMED_MODEL_JSON` and manual-hold behavior. Never interpret `reasoning_content` as final answer or store it. Thinking OFF path is unchanged. HTTP failure and known thinking-ON `finish_reason=length` budget exhaustion take precedence over this recovery attempt.

**Proof:** The first new offline regression [Actions 39142532356](https://github.com/booleanlambda/agent-control-room/actions/runs/39142532356) caught ambiguous multiple fences and an invalid OFF test fixture that included a forbidden reasoning field. Fixed by rejecting multiple fences and testing OFF with only content. [GitHub Actions **39142617198**](https://github.com/booleanlambda/agent-control-room/actions/runs/39142617198) now **SUCCESS** with 14 new syntax/recovery/redaction assertions plus existing diagnostic, transport, budget, thinking-router and depth tests; no credentials or paid Kimi calls. The unrelated `repair-expertise-verifier-runtime` push workflow still fails on experiment branches and was not modified.

**Limits:** No new live thinking-ON response was generated in this patch/test cycle. We cannot conclude that the earlier malformed response would match either allowed wrapper; unresolved syntax remains guarded `MALFORMED_MODEL_JSON`, and no speculative model repair is performed. A further strictly scoped paid live response could characterize future failures if separately authorized.


## Kimi thinking-ON live JSON retry (2026-10-18)

GitHub [run 39143250133](https://github.com/booleanlambda/agent-control-room/actions/runs/39143250133) from [draft PR 88](https://github.com/booleanlambda/agent-control-room/pull/88) SUCCEEDED with one paid Kimi K2.6 thinking-ON call. HTTP 200, finish reason stop; 7208 total tokens, of which 5332 were reasoning tokens; 73870 ms. Raw final 3540-character string was not valid JSON. The narrow deterministic COMPLETE_JSON_FENCE recovery parsed its complete code-fenced object successfully, preserving its values. Recovered final response: accepted with top-level diagnosis, remediation and testableRequirements. The original final text was inspected in a restricted temporary runner file and deleted; public artifact 12142602103 includes only sanitized structure, hash, provider usage and recovery status. No raw content or private reasoning was uploaded. Previous run 39141865580 was malformed but its exact cause remains unknown. No production changes, merge, Silas wake or automatic paid retry. Offline suite run 39143219943 passed. This proves a real thinking-ON code-fence output-format issue and its limited deterministic recovery, not general software remediation correctness.

---


## Thinking-ON semantic acceptance gate — 2026-10-18

The earlier [Kimi thinking-ON PR #88](https://github.com/booleanlambda/agent-control-room/pull/88) succeeded on **final JSON format recovery only**. The historical AAU diagnosis/strategy task had no deterministic answer checker, so valid parsing was mistakenly reported without checking task coverage. Final JSON and private reasoning were deleted as configured, and the exact old answer cannot be retroactively graded.

On isolated research branch `experiment/kimi-thinking-on-semantic-gate-v1-20261018`, added `experiments/kimi-thinking-on-shape-probe/diagnostic-acceptance.mjs` and dedicated tests. The predeclared checklist distinguishes broad catch provenance, provider usage/finish preservation, malformed JSON, HTTP failure, timeout/transport, thinking-on completion length, ambiguous DB writes, prohibition of ambiguous paid retries, and testable verification scenarios. Results are only named booleans and coverage totals; the model text is never stored. `live.mjs` now requires both `ACCEPTED` JSON and requirements coverage before reporting success. **This is a heuristic strategy-coverage check, not executable code-repair verification.**

A single new thinking-ON [PR #89](https://github.com/booleanlambda/agent-control-room/pull/89), [Actions #39145232583](https://github.com/booleanlambda/agent-control-room/actions/runs/39145232583), made a paid Kimi K2.6 call (HTTP 200, `finish_reason=stop`; 7295 total tokens, including 5087 reasoning; ~70 seconds). Final 4997-character content was **valid JSON without a wrapper** (`finalRecoveryStrategy=NONE`). The initial rubric scored **8/9**, failing `testable_verification`, even though sanitized final JSON structure recorded a five-item `testableOutcomes` array with `scenario`, `given`, and `then` fields. This is strong evidence of a **validator false negative**, not demonstrated missing tests. The answer text was deleted by the ephemeral-runner policy, so exact full retrospective rescoring is unavailable. Sanitized artifact [12143121420](https://github.com/booleanlambda/agent-control-room/actions/runs/39145232583/artifacts/12143121420) is retained.

The independent verifier was repaired twice through offline tests: (1) named scenarios in a testing section may not imply implemented handling, (2) a `testableOutcomes` array with multiple concrete scenario/expected-outcome objects must count as explicit verification evidence, while label-only scenarios or incidental prose must not. The corrected offline suite [Actions #39145557646](https://github.com/booleanlambda/agent-control-room/actions/runs/39145557646) passed. No additional paid live runs were started after the checker corrections, and no production/Silas changes or merges occurred. The complete real-world code-fix benchmark remains **unverified**.


---


## Original real AAU V28 debugging benchmark rerun with thinking-ON JSON recovery (2026-10-18)

**Actual one-time rerun:** [draft PR #90](https://github.com/booleanlambda/agent-control-room/pull/90), [GitHub Actions #39146017834](https://github.com/booleanlambda/agent-control-room/actions/runs/39146017834), [evidence artifact 12143537543](https://github.com/booleanlambda/agent-control-room/actions/runs/39146017834/artifacts/12143537543). Research-only branch `experiment/kimi-realbug-rerun-thinking-on-fix-20261018`; immutable historical source and original four public/four withheld code-execution cases unchanged. Baseline and parser/budget/transport offline calibration [Actions #39145974053](https://github.com/booleanlambda/agent-control-room/actions/runs/39145974053) SUCCESS; original paid benchmark run **FAILED**. No production or Silas mutation, no merge, no automatic retry.

**Kimi response/cost receipts:** K2.6 plan thinking OFF accepted (HTTP 200, stop, 1,571 provider tokens), three self-chosen diagnostic tasks. Implementation thinking OFF accepted (HTTP 200, stop, 2,838 provider tokens), two model-selected code replacements; candidate SHA-256 `f4a086994010667192cfae6303f52165cc04fcaed91a591966754d15ca849e7d`. Public verifier: **1/4 pass**, normal response PASS; malformed JSON category `bad_json` vs expected `malformed_model_json`; HTTP error category `http_error` vs expected `provider_http_error`, finish reason mismatch; timeout case still `uncertain_or_rejected` and leaked sensitive diagnostic data. The literal category-name mismatches should not be conflated with complete semantic failure, but timeout and privacy failures are substantive.

**Thinking ON remediation:** It was correctly selected only after public verification failed, configured with 32,768 completion max. The paid Moonshot request ended in `transport_timeout_or_abort`, exception TypeError with allowlisted nested cause `UND_ERR_HEADERS_TIMEOUT`, no HTTP headers/finish/usage received. Since provider outcome was ambiguous, no automatic retry. **This was not malformed thinking-ON JSON** or confirmed budget exhaustion; no completed remediation answer existed for the new JSON wrapper parser to recover. The benchmark therefore did not reach any hidden cases, failed with `MODEL_REQUEST_MANUAL_HOLD`, three requests attempted, two accepted, **4,409 known provider-reported tokens** (third call usage unknown). Reported model decision to preserve full original stack/message/provider snapshots is **not approved** and could violate sanitization; retain only allowlisted metadata.

**Conclusion:** New thinking-ON JSON fence/BOM recovery was present and offline-tested but **not exercised** by the remediation call due to a real provider header timeout. The original AAU defect remains without an independently verified patch; do not count the rerun as solved, 8/8 verified, or as a failed JSON-format recovery. Further testing must preserve the manual non-retry policy and distinguish naming-contract mismatches from unsafe diagnostic leakage. This is not a full AAU RabbitMQ/Neon deep recursion run.


---

## Moonshot header-timeout root-cause investigation — 2026-10-18

**Finding (high confidence client timeout ordering; upstream slowness not definitively attributed):** The failed original AAU real-world bug rerun ([Actions #39146017834](https://github.com/booleanlambda/agent-control-room/actions/runs/39146017834), evidence artifact 12143537543) used Node's global `fetch()` without any explicit Undici dispatcher. Kimi thinking-ON remediation was allowed a **720,000ms** application AbortController deadline, but Undici's documented default **headersTimeout=300,000ms** acts independently. The failed request's allowlisted nested cause was `UND_ERR_HEADERS_TIMEOUT`, no HTTP response headers and no application deadline firing. Entire live step started at 16:39:55Z and ended 16:45:15Z (~320s including two successful OFF calls, Docker verification and third call); a ~300s inner header timeout is consistent with that timeline. Exact duration of the third request was **not recorded** in prior evidence, so avoid claiming it lasted precisely 300s or assuming Moonshot backend was solely to blame. Previously completed independent thinking-ON probes returned in ~70-74 seconds, so this was not an always-failing route.

**Controlled independent reproduction:** research branch `experiment/aau-moonshot-header-timeout-investigation-20261018`. With a local delayed HTTP server (no Moonshot endpoint, credentials or paid requests), an Undici Agent with a header deadline shorter than the application's abort produced `UND_ERR_HEADERS_TIMEOUT` while the application deadline flag remained false; the exact same delayed response completed after widening only the header deadline; setting a shorter application abort still fired first. The initial too-short test threshold was affected by Undici's coarse timers; the stable loopback regression uses 2.4s server delay. [Offline Actions #39147452106](https://github.com/booleanlambda/agent-control-room/actions/runs/39147452106) **SUCCESS**, including three timeout-ordering cases, three transport-policy tests, and source checks.

**Research-only remediation candidate, not active against Moonshot yet:** `experiments/aau-provider-transport/transport-policy.mjs` declares an explicit scoped Undici header/body timeout of **750000ms** for thinking ON, retaining the preexisting **720000ms** application abort deadline, so the application deadline remains authoritative; OFF remains **175000ms**. The policy does not alter global dispatcher state or introduce retries. It has been validated with offline tests but **has not been wired into any live provider call**. Future integration should use a matched `undici.fetch` + `new Agent({headersTimeout:750000,bodyTimeout:750000})` pair rather than assuming an npm Agent works with Node's bundled global fetch; import/install the dependency explicitly in the isolated research workflow. Preserve manual hold on sent/uncertain calls and no automatic paid retry.

**Telemetry repair:** The isolated original real-world benchmark `experiments/real-world-aau-debug-v1/live.mjs` now records per-call `elapsedMs`, `httpHeadersReceived`, `requestDeadlineFired` and passes them to `inspectV28TransportFailure`; previously that benchmark called it without options, always emitting null elapsed time. The research branch has **not** been merged or deployed; production AAU and Silas remain unchanged.

**Independent unresolved issues:** Provider header timeout is separate from thinking-ON code-fence JSON recovery, from Kimi's programming correctness, and from the generated patch's sensitive diagnostic-data leakage flagged by the public oracle. No paid rerun occurred in this investigation.

---

## AAU research: live scoped Undici thinking-ON timeout rerun — October 18, 2026

**Authorization/scope:** One user-authorized rerun of the original historical V28 real provider-diagnostics repair benchmark. Isolated [draft PR #91](https://github.com/booleanlambda/agent-control-room/pull/91) on `experiment/aau-scoped-undici-live-rerun-20261018`. Offline baseline, original historical source, transport-policy, parser, and guarded no-retry checks [run #39148114364](https://github.com/booleanlambda/agent-control-room/actions/runs/39148114364) **passed**. Live [run #39148179786](https://github.com/booleanlambda/agent-control-room/actions/runs/39148179786), evidence [artifact 12144566010](https://github.com/booleanlambda/agent-control-room/actions/runs/39148179786/artifacts/12144566010), **job failure** due to real code-verification results, not provider transport. No production merge, deployment, Silas wake, or automated paid retry. Original eight public/hidden behavioral cases were not edited.

**Transport change actually exercised:** The benchmark used scoped `undici.fetch` and a per-call Undici `Agent` only for thinking-ON remediation, with `headersTimeout=750000`, `bodyTimeout=750000`, and the previous `AbortController` `720000`ms app deadline. Thinking OFF stayed on global `fetch()`, `175000`ms deadline and 4096 completion tokens. The scoped Agent was destroyed in `finally`. Model call receipts now preserve `elapsedMs`, `httpHeadersReceived`, `requestDeadlineFired`, allowlisted transport cause, raw-content-not-stored, reported reasoning tokens and sanitized JSON format.

**Actual Kimi K2.6 calls:** exactly 3 attempts/3 accepted HTTP 200 stop: (1) OFF autonomous plan, **1619 tokens**, 7.529s, 3 own tasks; (2) OFF initial code patch, **3156 tokens**, 15.111s, 2 replacement spans; (3) ON remediation, **23667 tokens**, **19738 reasoning tokens**, **219.983s**, 7 additional edits, 32768 completion ceiling (reported completion **20774**), HTTP headers received, no deadline firing. Total **28442** reported tokens. ON final answer was **valid JSON** (`rawSyntax=valid`, `recoveryStrategy=NONE`) so this run did not need code-fence repair; no 300-second headers timeout. This is a live demonstration that the scoped transport path completes for a long thinking-ON call; cannot prove it will always overcome arbitrary Moonshot provider slowness.

**Independent code correctness:** First patch candidate SHA `66041f169f730924c14c4a46b2e9812c3d1914fd02e44dd6944dc499cb260ad4`: first received case passed, but verifier stopped before all four cases (exit 1 and stderr), so no 1/4 claim for the *first* pass. Remediated candidate SHA `d4422cd5ca7ba7f32b3d8452c83dc97ce2ebd5a28b2fb04687aee38dfaa24e23` had **1/4** public strict behavioral pass: `received` passed; `malformed` status was `bad_model_json` vs expected `malformed_model_json` *and missing a sanitized diagnostic report*; `http_error` status was correct `provider_http_error` but finish reason not preserved as expected *and sanitized diagnostic report missing*; `timeout` status was `transport_or_secret` vs `transport_timeout_or_abort`, *and sanitized report missing*. The wrong category on malformed is partly an equivalence/naming issue; conflating transport and secret, absence of durable diagnostics, and HTTP finish-reason deficiency are substantive. Hidden four test cases **not run** because public failed. Final report `status=failed_public_verification`, `success=false`.

**Verdict:** **Transport blocker resolved in this specific live test; the actual AAU code-repair benchmark is still failed.** JSON recovery and thinking-ON execution are distinct from correctness. Next work should address or isolate the original benchmark's remaining provenance/receipt failures and verifier status-label equivalences, not increase model budgets or claim a full successful autonomous software fix. No further paid calls authorized by this record.


---

## Public-failure remediation feedback and confirmed 32K exhaustion (2026-10-18)

**Scope:** Explicit user-authorized research-only work on branch `experiment/aau-multi-failure-remediation-feedback-20261018`, draft [PR #92](https://github.com/booleanlambda/agent-control-room/pull/92), [live GitHub Actions run #39149626818](https://github.com/booleanlambda/agent-control-room/actions/runs/39149626818), [evidence artifact #12144822862](https://github.com/booleanlambda/agent-control-room/actions/runs/39149626818/artifacts/12144822862). Original frozen historical V28 AAU `model()` source and four public/four hidden behavioral contracts unchanged. Scoped Undici thinking-ON 750s headers/body policy from PR #91 retained, original 720s application deadline, no retries. No production/Silas changes or merge.

**Verified orchestration defect and fix:** Old `real-world-aau-debug-v1/live.mjs` sent only `check.firstFailure` to Kimi thinking-ON remediation, despite public tests reporting multiple independent failures. The repaired handoff uses `makePublicFeedback` to include all four observed **public** scenarios, all failed cases, bounded allowlisted problem identifiers and sanitized candidate status labels, with no raw provider errors, code, credentials, or hidden test data. Candidate exceptions no longer terminate the entire test loop; each case yields its own independent outcome. Verifier success now additionally requires all four original cases reported and passed, so a partial case list cannot produce a spurious pass. The original independent assertions for canonical categories, finish/token preservation, sensitive-data protection, ledger writes, no paid replay, and hidden cases remain untouched. Extra regression verifies malicious/untrusted statuses cannot reach model feedback. Later instrumentation retains only allowlisted candidate exception types (e.g. ReferenceError) and never exception message/stack.

**One actual paid model rerun before the later exhaustion-classifier additions:** Kimi K2.6 generated its own 3-node diagnostic plan with thinking OFF: HTTP 200 stop, **1,563 total provider tokens**; a 5-span first patch with thinking OFF: HTTP 200 stop, **3,547 provider tokens**. Public verifier executed **all 4** public cases: `received` passed, and `malformed`, `http_error`, `timeout` all threw unexpected candidate exceptions, yielding a strict **1/4**, with no hidden cases run. Full public feedback was sent to the sole thinking-ON remediation call, which returned HTTP 200 with `finish_reason=length` and exactly **32,768 completion tokens**, including **32,767 reasoning tokens**, **36,444 total reported tokens** for that call, approximately **319,044ms** elapsed. All three provider calls together reported **41,554 tokens**. The thinking-ON call had headers and no application timeout; its output was incomplete and no usable patch was available. Live run status was `blocked`, `success=false`, 3 calls attempted; **NOT** a real-world software repair pass. This is confirmed thinking completion-budget exhaustion, not malformed JSON or transport timeout. The original runner mistakenly labeled it `incomplete_response` and generic `MODEL_REQUEST_MANUAL_HOLD`.

**Post-run offline correction only:** Added deterministic `remediation-exhaustion-route.mjs` and dedicated regressions to classify `finish_reason=length` + confirmed 32768/32768 thinking completion tokens as `THINKING_BUDGET_EXHAUSTED`, distinct from unconfirmed length, provider failure, or transport. The isolated runner now records a proposed next action: **new thinking-OFF 4096-token decomposition of remaining public failures**, not paid replay. It explicitly refuses the fourth provider call if the three-call research cap is exhausted, recording `RESEARCH_CALL_CAP_REACHED`. This classification/routing enhancement and the allowlisted exception-type diagnostics were implemented **after** the live PR #92 run and have passed offline only; do not describe them as live-verified.

**Validation:** [Offline calibration #39149551568](https://github.com/booleanlambda/agent-control-room/actions/runs/39149551568) verified initial multi-failure feedback. [Offline regression #39150360144](https://github.com/booleanlambda/agent-control-room/actions/runs/39150360144) confirmed new exhaustion routing, and [#39150517596](https://github.com/booleanlambda/agent-control-room/actions/runs/39150517596) confirmed final sanitized exception-type capture and full prior tests. The unrelated `repair-expertise-verifier-runtime.yml` push workflow still fails on experimental branches; it is not a result of this new diagnostic suite.

**Limitations/next step:** No usable thinking-ON code patch was returned at 32K, no hidden tests were reached, and the model-generated first candidate was not persisted as raw source (only SHA), limiting root-cause replay. Future authorized experiments should preserve a restricted, short-lived copy of the model-generated *final patch* for independent investigation and run a genuinely bounded OFF decomposition of all failed public requirements after confirmed 32K exhaustion, rather than simply raising thinking budget or silently repeating the paid call. Never feed a gold reference patch or hidden oracle into Kimi.

---

## 2026-10-18: live 32K→4K conditional fallback and historical receipts replay

**Isolated live research trial:** [draft PR #93](https://github.com/booleanlambda/agent-control-room/pull/93), [Actions #39151588412](https://github.com/booleanlambda/agent-control-room/actions/runs/39151588412), [sanitized artifact 12144574341](https://github.com/booleanlambda/agent-control-room/actions/runs/39151588412/artifacts/12144574341), branch `experiment/aau-on-exhaustion-off-decomposition-live-20261018`. Identical frozen historical V28 AAU provider-diagnostics bug and unchanged four public/four hidden independent behavioral tests; no gold patch or hidden answers were exposed. Workflow success requires original code to pass all. It **FAILED** strict public proof.

**Architectural implementation:** Three original provider calls (4K thinking OFF diagnosis, 4K thinking OFF first patch, 32K thinking ON remediation if public fail) plus, **only** after completed HTTP 200 `finish_reason=length` with provider `completion_tokens=32768`, up to two *new* calls: 4K thinking-OFF decomposition of all remaining public issues and 4K thinking-OFF scoped implementation; then repeat all original public cases and run hidden cases only after public success. Total call cap **5**, original per-stage token budgets **unchanged**, total recorded token cap 75000, no resend of transport/ambiguous provider calls, no private reasoning retention. Deterministic guard `fallback-continuation.mjs` now also requires first two calls accepted and third flagged confirmed thinking-budget exhaustion. The rejected/partial 32K thinking-ON text is not used as a patch. This path is **conditional**; it must not be manually forced or counted as executed without the actual confirmed exhaustion receipt.

**Actual PR93 live result (negative-branch proof):** Kimi K2.6 sent three requests, all HTTP 200 with `finish_reason=stop`: OFF plan 1568 provider-reported tokens, OFF first patch 2102 tokens, thinking-ON remediation 21335 total reported tokens, **18442 completion** including **18206 reasoning**, ~181316ms. Total reported **25005** tokens. ON `rawSyntax=valid`, no JSON fence recovery needed, no 720s app deadline firing and no transport timeout. Kimi generated 3 plan tasks, 1 initial code replacement and 3 thinking-ON remediation replacements. Initial public tests: **1/4**, with malformed/HTTP/timeout category mismatches, token/finish loss and missing diagnostics. After remediation: **1/4**: `received` PASS; `malformed` still `bad_model_json` instead of `malformed_model_json`, `http_error` still `provider_incomplete_or_rejected` instead of `provider_http_error`, and `timeout` still `transport_or_timeout` instead of `transport_timeout_or_abort`; all three rejection cases lacked mandatory sanitized diagnostic report. Some token/finish issues improved, but semantic repair remains incomplete. No hidden tests reached. `continuedAfterConfirmedExhaustion=false`, `continuationCalls=0`. **Because ON ended with `stop`, OFF fallback was not authorized or called**, notwithstanding two unused model-call slots. A forced transition would violate the intended architecture and misrepresent the evidence.

**Offline positive/negative historical-provider-receipt replay:** Historical [PR92 live run #39149626818](https://github.com/booleanlambda/agent-control-room/actions/runs/39149626818) genuinely reported thinking ON HTTP 200 `finish_reason=length`, `completion_tokens=32768/32768`; its *sanitized receipt* was transcribed into `historical-exhaustion-replay.test.mjs` and confirms the new route would authorize **two distinct OFF 4096-token stages** after such a completed call, without resending the ON call. Conversely the actual PR93 `stop` with 18442 completion tokens denies the transition. [Offline regression #39152151291](https://github.com/booleanlambda/agent-control-room/actions/runs/39152151291) **PASS**, including original frozen source repro, routing tests, timeout and parser regressions, and both authentic-receipt eligibility cases. It tests the decision/guard, **not a live paid Kimi fallback execution**, because no full candidate code snapshot survives from PR92 and PR93 was not exhausted.

**Recommended next experiment:** Shift deterministic decomposition of *multiple independent public failures* earlier (before using an expensive thinking-ON remediation), and test one focused repair node at a time; PR93 shows that a thinking-ON call with substantial reasoning can fix a local scoping error yet leave separate categorical/provenance obligations unmet. Preserve full public feedback, strict independent oracle, and non-retry constraints. No merge, production AAU mutation, or Silas wake performed.


---

## Early 4K thinking-OFF focused repair nodes: real live outcome (2026-10-18)

**Authorized research only:** [Draft PR #94](https://github.com/booleanlambda/agent-control-room/pull/94), [GitHub Actions #39153414316](https://github.com/booleanlambda/agent-control-room/actions/runs/39153414316), sanitized [artifact 12146515153](https://github.com/booleanlambda/agent-control-room/actions/runs/39153414316/artifacts/12146515153), branch `experiment/aau-early-off-focused-nodes-20261018`. Frozen original AAU V28 historical provider diagnostic defect, same four public and four hidden executable scenarios and no gold patch to Kimi. No main/production deploy, Silas wake or merge.

**New orchestrator implementation:** before expensive thinking ON, Kimi thinking OFF first performs original diagnosis and initial source patch; after public failure, it generates its own 2–3 focused independent tasks with acceptance criteria using OFF 4096 tokens; two selected tasks each get a separate OFF 4096 patch attempt; after each, the independent public suite is re-executed. Deterministic `focusedPatchDecision` accepts a node only if it increases the number of passing public cases or reduces the number of recorded problems **without regressing any previously passing case**. Failed node code is discarded; only its SHA/spans, verdict and independent test outcomes remain as evidence. If public failures persist, one targeted thinking-ON call with 32768 output ceiling; at most six provider calls total, no automatic retry of ambiguous requests, no private reasoning storage, hidden tests only after full public success. The OFF-node monotonicity gate prevents accidental degradation of accepted behavior, but total problem count alone is a coarse measure and not a proof of semantic correctness.

**Live provider results:** **all six Kimi K2.6 calls completed HTTP 200 `finish_reason=stop`**: OFF plan 1,614 tokens/5.387s; OFF implementation 2,669 tokens/8.983s; OFF public decomposition 3,703 tokens/6.202s; OFF node 1 4,382 tokens/7.447s; OFF node 2 4,356 tokens/7.238s; ON residual remediation 22,926 tokens/203.495s, including **18,517 reasoning tokens** and 19,166 completion tokens (below 32,768 cap). **39,650 total reported tokens**, no transport cutoff, no malformed JSON, no confirmed exhaustion. Kimi decomposed into three model-authored tasks; two cheap nodes each produced one span and independently **made zero measurable progress**. Both were rejected; initial candidate remained. The ON residual response produced one model-authored edit; final candidate SHA `56298f24a9f874382e575cc2edb40dff6b1d60b5ee8446fef41233c563cc5a1a`.

**Independent behavioral result:** `failed_public_verification`, **1/4 public cases passed after initial, node 1, node 2, and ON remediation**. Received passed. Malformed had wrong status `malformed_json` vs expected `malformed_model_json`; HTTP failure had wrong `http_rejected` vs expected `provider_http_error` **and leaked sensitive diagnostic details**; timeout had wrong `uncertain_or_rejected` vs expected `transport_timeout_or_abort` **and leaked sensitive diagnostic details**. The public runner executed four cases on each of four public verification passes. Hidden four never reached. No original code fix confirmed.

**Additional architectural weakness found from live model-owned decomposition:** Kimi's two chosen OFF nodes addressed attaching diagnostic metadata to thrown Errors and exception wrapping, but neither repaired the observed oracle failures. Its third task falsely asserted an `INCOMPLETE_PUBLIC_SUITE` condition, despite four public cases being completed; Kimi did not reliably ground its proposed tasks in the provided public-failure list. Original public feedback provided a generic `WRONG_FAILURE_CATEGORY` and actual status but **omitted the expected public category**, making the task under-specified for autonomous code repair. This likely contributed to repeated synonym labels but cannot solely explain the unchanged privacy-leak failures. The historical benchmark is useful precisely because it shows low-cost model-side reasoning still needs high-fidelity, independently verified test feedback, not deterministic source-code repair answers.

**Post-live OFFLINE-only feedback correction:** `verify-candidate.mjs` now emits `expectedStatus` only for **public** scenarios, and `public-failure-feedback.mjs` forwards an allowlisted safe `expectedStatus` beside `reportedStatus`; the same strict pass/fail assertions are unchanged. Hidden test expected categories are not emitted or forwarded. No reference patch or model implementation answer was introduced. Redaction/canonical expected-category tests were added, and [offline calibration #39153972283](https://github.com/booleanlambda/agent-control-room/actions/runs/39153972283) **passed**. This correction was added **after** PR #94's paid run; do **not** claim it improved that historical run. No additional paid model call was started.

**Next test:** a separately authorized bounded live run with public expected-vs-actual categories and a consistency/grounding gate on model-owned decomposition, then independently observe node progression and all eight unchanged behavioral cases. Do not silently relax diagnostic-provenance or sensitive-data leak requirements.


---

## PR96: Progress-budget recursive repair-tree real Kimi result (2026-10-18)

**Live research trial:** User-authorized isolated [draft PR #96](https://github.com/booleanlambda/agent-control-room/pull/96), [GitHub Actions #39162679539](https://github.com/booleanlambda/agent-control-room/actions/runs/39162679539), sanitized [artifact #12150225140](https://github.com/booleanlambda/agent-control-room/actions/runs/39162679539/artifacts/12150225140), branch `experiment/aau-progress-budget-tree-v2-live-20261018`. Same frozen original V28 AAU provider-diagnostics source and unchanged independent four public/four hidden Docker code-execution tests. No gold patch supplied, no production/Silas changes, no merge.

**Architecture in scope:** Removed the previous fixed six-call ceiling; Kimi thinking OFF (4K completion ceiling) generates a root repair tree and, on failed focused node, decomposes into 2–3 child nodes, prioritizing children. Cycle/fingerprint checks; recursion-depth guard 3; every patch is independently verified against all four public cases; a regression of previously passing cases is rejected; passing-case improvement or reduced number of reported public problems is a measurable progress signal. Finite global provider-reported token cap 75,000; pre-call reserve includes entire maximum output ceiling plus conservative prompt estimate. Thinking ON would only run if 32K plus prompt fit remaining budget. All model sends remain no-auto-retry on ambiguous outcomes.

**Real results:** The first version (PR #95, [run #39162088029](https://github.com/booleanlambda/agent-control-room/actions/runs/39162088029)) stopped after 3 successful Kimi OFF calls and 8,009 reported tokens at a strict `MODEL_PLAN_INVALID_NODE` root parsing contract. Correction in the model-owned validation adapter retained individually valid Kimi-authored issue/acceptance nodes, rejected only invalid siblings without adding content, and passed [offline calibration #39162597638](https://github.com/booleanlambda/agent-control-room/actions/runs/39162597638). PR #96 then ran live: **24 Kimi K2.6 calls**, all thinking OFF, all HTTP 200 finish_reason=stop, **68,735 total provider-reported tokens**. Four valid root tasks; 21 unique model-owned tree tasks in total; **16 nodes visited** and **five remained queued**, depth reached 3. **Fifteen focused patch attempts**, **one accepted**, **fourteen rejected**, plus six further OFF child-decomposition calls. The accepted patch was node 6 at depth 1; public failure-problem count went **5→4** while pass count remained **1/4**, so it was partial progress, not completion. The output was **blocked**, `errorCategory=GLOBAL_COMPUTE_BUDGET_EXHAUSTED`, `stopReason=GLOBAL_COMPUTE_BUDGET_EXHAUSTED`, with 6,265 unspent reported tokens—insufficient to reserve the next 4K call plus its prompt estimate. No 32K thinking-ON call was dispatched and no confirmed ON budget exhaustion occurred. The strict final public score stayed **1/4** (normal received pass; malformed, HTTP and timeout failed). Hidden cases not executed.

**Precise remaining public failures:** malformed final category `bad_model_json` rather than canonical `malformed_model_json`; HTTP category `http_rejection` instead of `provider_http_error` and finish reason not preserved; transport timeout candidate exception reported (safe category OTHER), not a confirmed correctly classified timeout. Do not count mere lower error count as full code correctness. The model's response text, private reasoning and raw source patch were not published; receipts, content hashes and full independent test problem codes are available in the sanitized artifact.

**Interpretation and follow-up:** The experiment proves multi-level actual model-driven traversal beyond the prior artificial 6-call restriction, and shows that deeper model-controlled splitting often produces no measurable public progress. It does NOT validate successful autonomous complex repair or exhaust all branches. Investigate why task-grounding and public category/exception-provenance defects persist despite correct expected-vs-actual feedback. Prioritize progress yield per provider token and stalled-node controls over simply increasing total compute. Be especially cautious about treating reduction in raw problem count as sufficient semantic improvement. No further paid calls were initiated after PR #96 run.
