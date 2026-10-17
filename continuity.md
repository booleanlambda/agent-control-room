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
