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
