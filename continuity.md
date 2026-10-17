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
