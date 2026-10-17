# Kimi K2.6 sustained self-remediation replay — October 17, 2026

## Scope and question

Can Kimi resume **its own** previously failed Python job-assignment
dynamic program, diagnose the bad reconstruction, write a repair and
independent property tests, and **persist its reasoning across separate
operating-system processes** until the repaired program passes the
original case plus a different held-out case and five modified cases?

Research only. No production Silas, Supabase, RabbitMQ or Render changes.
The test runs in disposable GitHub CI on draft PR #45.

## Implemented experiment

- Actual previous Kimi report loaded from GitHub Actions run **38994095805**,
  artifact `aau-kimi-unseen-python-cognition-audit`.
- Exactly its **second unsuccessful Python source**, SHA-256
  `320681db4e573366aa28df9bfe9924f89bdcf1e7f64d2753bdbbe7258b58ac7b`,
  was used as the seed, not a human-written or repaired substitute.
- The initial code was executed in an isolated Docker Python 3.12 Alpine
  container with network disabled, no secrets, unprivileged, read-only
  filesystem, bounded CPU, memory, processes and time.
- Its public output **`{"cost":90,"assignment":[2,2,2,2,2,2,2]}`**
  reproduced the exact original failure. The cost is correct, but the
  witness violates machine-capacity limits.
- New `self-remediation-kimi.mjs` implements a bounded 7-cycle
  checkpoint-driven repair loop: each step is a distinct OS process;
  a durable `request_in_flight` gate prevents ambiguous re-submission;
  answers are journaled **before** Python execution; accepted answers can
  be replayed on process restart without another model request.
- Kimi is meant to produce its **own revised full Python** and a
  separate **model-written property-test Python** that both accepts the
  corrected witness and rejects the original invalid witness.
- Independent JavaScript oracle and full witness checker (not exposed
  to the model) check the public input, **one held-out case and five
  unseen perturbations** with different costs, capacities, activation
  and switching charges, and job order. Both optimality and a feasible
  assignment must pass; correct numerical cost alone never suffices.
- No automatic top-ups, retries, extra code fix-up by the harness or
  answer substitution are allowed.

## Actual live result — **NOT A COGNITIVE VERDICT**

**Actions:** [run 39023455258](https://github.com/booleanlambda/agent-control-room/actions/runs/39023455258), artifact
`aau-kimi-durable-self-remediation-report` (ID **12097358996**).

| Measurement | Observed |
|---|---|
| Original source integrity | Verified SHA |
| Original invalid output | Reproduced exactly |
| Persisted state | `remediating` after seed |
| First live model action | `request_in_flight` |
| HTTP client deadline | 95 seconds |
| Response outcome | Abort, **no completed response** |
| Persistent recovery outcome | `manual_hold` |
| Completed new remediation cycles | **0** |
| Executed repaired code | **0** |
| Provider-reported tokens observed | **0** (unknown provider-side usage possible) |
| Additional automatic inference requests | **0** |

The runner issued a first Kimi K2.6 request with thinking disabled
and a 6,500-token output ceiling. It received **no complete HTTP
response** before its 95-second client AbortController deadline, then
saved `manual_hold` with `This operation was aborted`. Because
Moonshot synchronous completed responses could not be retrieved
through the tested endpoints and no guaranteed deduplicated POST
contract had been established, the runner did not automatically send
the same request again.

**Interpretation:** The recovery infrastructure correctly protected
against a potentially duplicate billed model request and durably
preserved the failure state. The experiment never reached a successful
Kimi-produced diagnosis or code revision, so **autonomous repair
capability is untested**. Neither "Kimi repaired it" nor "Kimi cannot
repair it" is supported by this run. The GitHub Actions job is failed
by the final success gate; this is expected for non-completion.

## Safer follow-up

A further *new potentially billed inference* requires explicit
operator authorization under the existing `manual_hold` policy.
If authorized, a fresh bounded diagnostic with a longer per-request
deadline and a more compact model output can test the original defect
without silently retrying the uncertain prior request.
Any later correction must be credited to that later run, not this one.

Implementation `self-remediation-kimi.mjs` remains isolated and
unmerged in experimental draft PR #45. The separate production
`Systemic Runtime Tree CI` failure is still unresolved.


## Authorized staged retest V2 — 17 October 2026

**Evidence:** [GitHub Actions run 39024126193](https://github.com/booleanlambda/agent-control-room/actions/runs/39024126193), artifact `aau-kimi-remediation-v2-authorized-evidence` (ID `12097842257`).

**Result: incomplete, not a cognitive verdict.** The user's explicit authorization
created a NEW billable attempt; it did not retry the ambiguous request from
run 39023455258. The authentic original Kimi-generated failed code was
recovered by SHA and reproduced in a separate network-disabled Docker
process. A fresh `diagnose` phase was sent to Kimi K2.6 thinking disabled.

The model endpoint returned **HTTP 200 after 18.105s**,
`finish_reason=length`; its output exceeded the diagnosis-stage
`max_tokens=850` and the runtime correctly refused to treat this as a
completed diagnosis. The provider reported **2,288 total tokens**,
despite no usable response. No repaired Python or self-tests were executed,
and no hidden variant was assessed. The checkpoint moved to
`manual_hold` after exactly one new call. There were **zero automatic
duplicate submissions**.

**Attribution:** This time the failure was a **model-output cap / test
configuration** limitation, *not* a network timeout and not evidence that
Kimi can or cannot repair its traceback bug.

**Subsequent research-code correction (not live retested):** The isolated
`self-remediation-kimi-v2.mjs` diagnosis cap was increased from 850 to
2,200; the accounting now records provider-reported usage on truncated
responses, while still refusing to accept incomplete cognitive output.
The immutable V2 Actions checkpoint recorded zero accepted-response tokens,
but the live log provides the true reported usage **2,288**. This
distinction is important for research cost accounting.

No more paid attempts were made. The feature branch and PR #45 remain
draft and unmerged, Silas untouched. The separate production
Systemic Runtime Tree CI remains failing.


## Synthetic full lifecycle test — 17 October 2026 (NO new provider calls)

**Verified final CI:** [AAU Free Self-Remediation Protocol End-to-End, run 39025203270](https://github.com/booleanlambda/agent-control-room/actions/runs/39025203270), artifact `aau-remediation-no-provider-protocol-evidence` (ID `12098590440`). An earlier initial pass was [run 39025088219](https://github.com/booleanlambda/agent-control-room/actions/runs/39025088219). The final run additionally disables all `fetch` use in fixture mode and counts only journaled synthetic answers.

**Result: 8/8 scenario expectations satisfied — 2 positive controls, 6 correctly rejected/stopped negative controls, zero genuine LLM calls and zero new billed inference.** All paths used the **same V2 remediation runner** (`self-remediation-kimi-v2.mjs`) as the live experiment, with a protected synthetic response adapter; they did not call the Moonshot API. The original Kimi assignment source was downloaded unchanged from the historical GitHub Actions artifact and its failure was reproduced. Python ran in actual short-lived Docker containers with networking disabled, no credentials, read-only filesystem and resource limits. Diagnosis, code, tests and recovery were separate OS process invocations backed by an on-disk journal.

| Scenario | Test expectation and observed result |
|---|---|
| Full `diagnose → repair → tests` | **Accepted** fixture-authored generic enumeration algorithm; public exact optimum and all **six** sealed variant tests passed. Fixture-authored property test accepted valid witness, rejected the old all-machine-2 witness, rejected a changed-cost witness. |
| Restart after response journaling | **Accepted** without another synthetic model response: saved `answer_journaled` was applied from the next OS process; downstream stages finished, count remained 3 completed fixture responses. |
| Original Kimi's faulty witness, despite optimal numeric cost | **Rejected**: public optimum 90 but machine-capacity violation; independent witness check prevented certification. |
| Solver optimal but verifier returns `passed: true` unconditionally | **Rejected**: public and six hidden solutions valid, but model-written self-test failed to reject the original invalid witness and a tampered cost. |
| `finish_reason=length` | **Stopped** at `manual_hold` with zero completed answer and **2,288 simulated** reported token units correctly recorded. |
| Unknown transport result | **Stopped** at `manual_hold`; no duplicate submission, no invented provider usage. |
| Interrupted `request_in_flight` | **Rejected** resubmission from a new process; request count did not increase. |
| Attempt ceiling reached | **Stopped** at `exhausted`; artificial pre-used attempts do not count as completed answers. |

Other research-only hardening: checkpoints are atomically replaced after file `fsync`, followed by parent-directory `fsync` on the disposable Linux filesystem; fixture mode is only allowed in GitHub CI **without provider credentials and without live-inference authorization** and explicitly throws if any network `fetch` is attempted. The workflow reuses the exact original failing source from GitHub Actions run 38994095805, with SHA-256 seed verification. Artifacts label simulated actions and tokens separately from real provider calls and never credit the manually written fixture repair to Kimi.

**Interpretation:** the response/journaling/repair/execution/hidden-grading workflow is now tested end to end, including failure containment and OS-process restart. **Kimi's own ability to produce the repair remains unproven**, because this run substituted explicitly synthetic responses instead of making a new Moonshot inference. The last real Kimi attempt still ended with `finish_reason=length` under the earlier 850 output-token limit; the research branch has since increased the diagnosis cap to 2,200 without testing it against a new live request. The next live inference would require its own explicit potentially billable authorization.

Files: `self-remediation-v2-fixtures.mjs` (labeled synthetic responses), `self-remediation-v2-fixture-integration.mjs` (eight independent-process scenarios), `self-remediation-kimi-v2.mjs` (shared execution state machine), and `.github/workflows/experimental-self-remediation-fixture.yml` (permanent, secret-free CI).

All changes remain research-only in draft PR #45; **no merge or deployment and no Silas wake**. The independent production `Systemic Runtime Tree CI` failure remains a separate blocker.


## User-authorized LIVE Kimi K2.6 self-remediation — 17 October 2026

**Live GitHub Actions:** [run 39025542225](https://github.com/booleanlambda/agent-control-room/actions/runs/39025542225).  
**Immutable live audit artifact:** `aau-kimi-self-remediation-v3-live-evidence` (ID **12098172297**).

**VERDICT: self-remediation FAILED under the experiment's bounded conditions.**
This time it was a genuine cognition/code-generation exercise, not the
prior 95-second timeout or 850-output-token truncation. A newly authorized
campaign loaded the unchanged model-authored failed factory assignment code,
verified its SHA and reproduced the invalid all-machine-2 witness. Every
actual Moonshot request completed (HTTP 200, `finish_reason=stop`,
thinking disabled). The one-shot workflow trigger was deleted immediately
after dispatch; this campaign was not auto-retried.

| Measured condition | Real result |
|---|---|
| Model | `kimi-k2.6`, thinking disabled |
| Genuine model calls | **7** |
| Provider-reported tokens | **19,112** |
| Stage sequence | `diagnose, repair, tests, diagnose, repair, tests, diagnose` |
| Submitted repaired Python programs | **2** |
| New model-written property-test scripts | **2** |
| Repaired Python execution | **Both exited `python_exit_1`** |
| Passed original 7-job public witness | **No** |
| Passed six sealed alternate instances | **No** |
| Self-tests reject original invalid witness | Yes |
| Self-tests accept validated repair | No repaired output to accept |
| Remediation state | **`exhausted`**, strict failure, no retry |

Kimi's first diagnosis blamed omission of explicit machine-2 capacity from
the DP state; its first changed code expanded the state to track all three
machine loads, but retained incorrectly scoped traceback/predecessor data,
and Python exited before returning any result. A second diagnosis identified
the traceback failure; the next version added job-indexed state but
incorrectly saved/recovered predecessor information and still exited.
On its seventh call, Kimi proposed another predecessor-pointer fix, but
the maximum call count had already been reached; no third code revision
was submitted or certified.

**Precise failure attribution:**
- **Cognitive/code failure:** the model did not deliver an executable,
  globally optimal assignment with a valid witness within two revisions
  and seven calls. This is a negative result for its bounded self-repair
  ability on this particular persistent traceback defect.
- **Harness feedback flaw exposed:** the experiment returned only generic
  `python_exit_1` and not the bounded public Python stderr traceback.
  Kimi had to hypothesize the specific crash instead of seeing the actual
  interpreter error.
- **Harness scheduling flaw exposed:** it spent a `tests` model call
  after each repaired program had already failed public execution.
  This reduced the useful repair budget and stranded the final diagnosis
  without a remaining code-call slot.
- Model-written property tests rejected the original wrong witness but
  could not accept repaired outputs because both Python programs crashed.
  Their `rejectsCostTamper=false` evidence is not proof the check is
  intrinsically unsound: the harness had **no valid model output** to
  mutate and pass to the test.
- The exact optimum from the earlier public run (90) was not reproduced
  by the new code because neither repaired program returned a result.

### Post-mortem experimental harness improvements (NO new model calls)

After auditing the immutable live artifact, the isolated research
implementation `self-remediation-kimi-v2.mjs` was revised to:
1. Return a bounded **public-only Python stderr traceback** on execution
   failure; sealed hidden-case output and internal oracle data remain
   unavailable to the model.
2. Require a publicly **executable, feasible AND exact-optimal witness**
   immediately after a repair. If it crashes, is infeasible or is
   suboptimal, go directly to the next `diagnose` phase instead of
   generating tests for already broken code.
3. Continue keeping request state journaled before network submission,
   using atomic `fsync` checkpoints, bounded attempts, and `manual_hold`
   on ambiguous external provider outcomes.

The changed workflow was tested with the **same fixture-driven V2 process**
in disposable containers, including the negative original-code case:
[CI run 39025947393](https://github.com/booleanlambda/agent-control-room/actions/runs/39025947393)
**passed all eight expected cases**. The bad-witness fixture now traverses
`diagnose → repair → diagnose` with **no wasted tests phase**,
while complete synthetic positive fixtures and negative controls retain
their expected outcomes. All fixture calls are simulated, not a new
Kimi cognition demonstration.

**Remaining work:** A later live model test could determine whether exact
stderr feedback and phase triage improve real self-repair. It must be
separately authorized as a new possibly billable experiment. Nothing
in this report warrants deploying Kimi remediation into production:
PR #45 remains draft/unmerged, Silas untouched, and the separate
`Systemic Runtime Tree CI` failure remains open.


## Live Kimi traceback-feedback retest V4 — 17 October 2026

**Authenticated run:** [GitHub Actions 39036081642](https://github.com/booleanlambda/agent-control-room/actions/runs/39036081642).  
**Immutable artifact:** `aau-kimi-v4-traceback-remediation-live`, ID `12102276741`.

The user authorized a **new bounded test** using the earlier repaired
harness: send public Python stderr if Kimi-authored code crashes,
skip property-test generation for failing public programs, and preserve
all six sealed hidden cases. The new run was not a retry of any previous
ambiguous HTTP request; the temporary paid-inference workflow trigger
was removed immediately after dispatch.

**Observed LIVE outcome: `manual_hold`, no completed remediation actions.**
The seed stage verified the genuine original model-written failed code
(`320681db4e573366aa28df9bfe9924f89bdcf1e7f64d2753bdbbe7258b58ac7b`)
and reproduced the invalid assignment. On the first NEW
`diagnose` API request, Moonshot responded **HTTP 200** after
**31.886 seconds**, `finish_reason=length`. The model consumed
the configured **2,200 output-token allowance** without finishing
the required JSON response, despite prompt instructions to keep the
diagnosis under 350 words. The provider reported **3,638 total tokens**.
The updated accounting preserved all known provider-reported tokens,
and the checkpoint went to `manual_hold`. No response text was
accepted, no Python repair was produced, no property tests ran, and no
hidden variant was executed; **no automatic repeated request** occurred.
The final GitHub job failed its deliberately strict completion gate.

**Cause:** This is an **output-budget/response-completeness failure
of the first diagnosis step**, not the previous 95-second transport
timeout and not another demonstrated self-remediation cognitive
failure. The newer traceback-feedback mechanism was therefore
**not exercised in a live model repair**, even though the synthetic
end-to-end 8/8 regression tests had passed.

**Next-stage recommendation (no automatic paid request):**
remove the mandatory standalone diagnosis step from the next controlled
trial. Provide the known original failed code plus the actual public
execution error as context and request a combined *diagnosis + complete
Python repair* in a single bounded `repair` response; use the
verified public execution+feasible-optimum gate before asking for
property tests. Preserve the external `manual_hold` and token-budget
policy. Any subsequent live request must be newly authorized; the
exact Moonshot response from this run cannot be safely replayed or
retrieved with a verified provider contract.

No merge, deployment or Silas wake. Draft PR #45 remains isolated;
the independent production `Systemic Runtime Tree CI` failure is
unchanged.


### Zero-cost direct traceback-to-repair preparation (no additional live Kimi call)

[CI run 39036508935](https://github.com/booleanlambda/agent-control-room/actions/runs/39036508935) **PASSED**. This run repeated the original eight end-to-end
synthetic-response scenarios **8/8** and added a ninth separate positive
control to avoid the repeated first-stage diagnosis truncation.

The new optional `AAU_REPAIR_START_WITH_V3=yes` entry:
- Downloads the **genuine Kimi V3 crashing code** from immutable real
  artifact in run 39025542225, verifies the exact Kimi-written code hash
  `8ac998fcba84990297a65e6c34cdaf81c8e4d1943a19d25e047e32cd54d11b4d`;
- Executes it with the public factory input in the network-disabled
  Docker sandbox; **requires a reproduced Python traceback** before
  admitting the run, and captures bounded stderr as factual feedback;
- Starts at `repair` rather than a separate `diagnose`, using the
  prior model-authored diagnosis and **actual interpreter failure**,
  then (only if the new code passes public exact-optimum/witness
  verification) proceeds to independent property tests;
- Runs simulated code/test messages end to end with the same worker
  and isolated Docker implementation. The synthetic repair passed
  the public optimum plus six sealed variants, and the synthetic
  property tester rejected both the old invalid witness and a
  tampered cost. **Zero real model calls** were made.

This does **not** establish any new cognitive capability for Kimi. It
establishes that the next separately authorized live experiment can
start with real traceback evidence and skip the repeated diagnosis
output-bottleneck step. The live V4 attempt remains `manual_hold` and
was not retried. No production or Silas changes.


## LIVE Kimi K2.6 direct traceback self-repair — 2026-10-17

**GitHub Actions:** [39038175797](https://github.com/booleanlambda/agent-control-room/actions/runs/39038175797)  
**Immutable real evidence artifact:** `aau-kimi-direct-traceback-real-repair-evidence` (ID `12102617954`).

**Verdict: model-authored ALGORITHM REPAIR SUCCEEDED, but full self-remediation certification FAILED.**

The user authorized a fresh paid experiment (not a retry of old uncertain calls).
The runner loaded the original failed Kimi source and model-authored V3
crashing source from two separate prior immutable GitHub Actions artifacts.
It reproduced the actual Python traceback, then began immediately with
`repair` rather than a standalone diagnosis. The live workflow trigger
was deleted after dispatch to avoid accidental reruns. Seven-call max,
39,000 reported-token cap, thinking disabled, independent no-network
Docker Python grader.

**Actual model sequence:**

| Call | Stage | Provider tokens reported for call | Result |
|---|---|---:|---|
| 1 | repair | 2,184 | First new predecessor-tuple fix still crashed public Python |
| 2 | diagnose | 1,900 | With real Python KeyError traceback, identified that `par=npar` destroys predecessor maps from earlier job layers |
| 3 | repair | 2,604 | **Successful** layer-indexed traceback restoration using `par_layers`; public exact optimality and feasible witness passed |
| 4 | tests | 2,674 | Model-authored tests rejected a **valid optimal answer**; final acceptance rejected |
| 5 | diagnose | 4,128 | HTTP 200, `finish_reason=length`, no accepted answer, `manual_hold` |
| **Total** | | **13,490** | 5 real calls, 4 complete actions, 1 incomplete response |

**Verified corrected solver outputs:** public 7-job assignment
`[0,1,1,1,2,2,2]`, exact global cost **90**, and each of the SIX sealed
variations independently passed witness-feasibility and optimum:
- Held-out changed-job problem: cost **99**
- Changed assignment prices: **91**
- Changed activation penalties: **93**
- Zero switching penalty: **77**
- Changed machine capacities: **91**
- Reordered job list: **90**

The successful algorithm is **real Kimi-authored Python** (`codeHash:
732f54bc7b428ef7d670c721c669060b2d0cf1741a339bdc0d33120862d5042b`),
not the synthetic fixture repair. Its state/action path is auditable in
the immutable Actions artifact. The independent grader and actual isolated
Docker execution returned a feasible optimal assignment for each of the
seven cases.

**Why the entire test failed:** the model-authored property test contained
a case-specific exception incorrectly labeling `[0,1,1,1,2,2,2]` as a
known bad assignment, and commented that its true optimum should be **88**.
Both assertions are wrong: the independent exhaustive verifier certifies
that exact assignment is feasible and **90** is the global minimum.
The property test therefore returned false on Kimi's newly repaired
correct output; it correctly rejected the original all-machine-2
witness and a tampered cost. Test audit:
`acceptsCorrect=false`, `rejectsOld=true`,
`rejectsCostTamper=true`. The fifth diagnosis response was
incomplete (`finish_reason=length`) and the runner properly entered
`manual_hold` without automatic repeat.

**Failure attribution:** This is a **self-verification/test-design failure
after a successful algorithmic repair**, not evidence of remaining
incorrect mathematical optimization or a failed repaired witness.
We cannot mark the entire autonomous-remediation protocol passed while
the agent's own tests falsely reject the known-good output. We also
cannot claim generality from only one problem and six variations.

### No-cost workflow revision after the immutable LIVE test

The research-only `self-remediation-kimi-v2.mjs` now separates
`solverAccepted` (correct public and all six sealed variants) from
`selfTestAccepted`. If the code is independently certified but its
self-written test is wrong, the next phase becomes **`tests` again**,
NOT `diagnose` or another code rewrite. Feedback identifies the exact
public verified optimal output and states that an invented smaller
optimum must not be hardcoded. Previously proven `manual_hold`
handling still prevents any automatic repeat of ambiguous provider
requests. These changes were NOT applied to the old immutable live
artifact and have made **zero new Moonshot calls**.

[No-cost CI 39038687537](https://github.com/booleanlambda/agent-control-room/actions/runs/39038687537)
**passed 9/9 regression scenarios** (3 expected successes including a
`diagnose → repair → tests → tests` synthetic self-test-only fix,
6 expected rejections/holds) and a separate direct Kimi V3 traceback
fixture. Actual Docker runs, process restarts and sealed grading were
used, but all model turns in this *regression* were synthetic and must
not be credited as live Kimi cognition.

**Release boundary:** draft PR #45 remains unmerged. No Silas wake or
production deploy. Independent production `Systemic Runtime Tree CI`
continues to fail and blocks promotion.
