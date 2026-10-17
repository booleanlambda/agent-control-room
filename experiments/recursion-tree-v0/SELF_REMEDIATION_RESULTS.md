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
