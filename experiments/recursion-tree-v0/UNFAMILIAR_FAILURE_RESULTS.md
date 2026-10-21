# Kimi K2.6 unfamiliar-failure generalization — controlled experiment

**Date:** 17 October 2026. **Scope:** research-only draft PR #45; no production deployment or Silas wake.

## Question and method

Does Kimi diagnose and repair *unfamiliar* failures without a supplied
fault category, patch, or diagnosis? Three prior **genuine Kimi-written
and independently verified Python algorithms** were selected from immutable
GitHub Actions artifacts, and exactly one controlled defect was injected
into each source. The injected changes are research interventions, **not
errors originally committed by Kimi**.

1. Factory allocation: wrong switching-penalty condition.
2. Battery-constrained routing: energy improperly preserved while moving.
3. Diophantine optimization: inverted modular-congruence filtering.

The diagnosis and injected line are **not passed to Kimi**. The model is
given its defective full Python program, task specification, input example,
and public observed result/validation. It can submit at most two complete
repair programs per domain. All programs execute in a read-only,
unprivileged, networkless Python Docker sandbox. Independent reference
oracles score **both visible and held-out instances**; held-out inputs and
oracle outputs are never sent back to the model. Up to six real
requests, with no automatic provider retries.

## Preflight: all three defects reproducible (PASS)

[No-cost CI 39040940114](https://github.com/booleanlambda/agent-control-room/actions/runs/39040940114)

All three original Kimi programs passed **both** visible and held-out
instances prior to injection. All three controlled corruptions caused
an observable public verification failure. This is a validated benchmark;
there was **no real model call in this preflight**.

## Attempt A: request-format failure, not a cognitive result

[Live Actions run 39041003283](https://github.com/booleanlambda/agent-control-room/actions/runs/39041003283), artifact
`aau-kimi-unfamiliar-three-faults-live-evidence` (ID `12104136151`).

The first Kimi K2.6 non-thinking API call returned **HTTP 400** with no
model output and no provider-reported tokens. The request mistakenly
sent sampling `temperature=0.4`. Kimi K2.6 uses fixed
`temperature=0.6` with thinking disabled. The research runner was
corrected to `0.6`. No candidate repair was generated or graded.
The one-time credentialed workflow trigger was removed after dispatch.

## Attempt B: organization concurrency limit, not a cognitive result

[Live Actions run 39041196301](https://github.com/booleanlambda/agent-control-room/actions/runs/39041196301), artifact
`aau-kimi-unfamiliar-faults-fixed-live-evidence` (ID `12104485050`).

The corrected Kimi request returned **HTTP 429** at the first query:
Moonshot reported that the account's organization had reached its
**one-concurrent-request limit**. The provider returned no model content
or token usage. The experiment therefore stopped at the first case,
without any code attempts or automatic retries. This says nothing about
the model's ability to repair unfamiliar defects, and it does not reveal
which other request was occupying the organization slot.

The provider error logging has since been hardened to avoid copying
raw response messages containing organization identifiers into
experimental records. The postmortem change was not live-tested. No
new paid inference requests followed the HTTP 429 response.

## Bottom line and next gate

- **Verified infrastructure:** three healthy model-authored reference
  programs, three detectable defects, sealed test oracles, bounded
  fail-closed runner, no automatic repeat, no production writes.
- **Kimi cognition:** **NOT MEASURED**; both requests were provider
  rejections before inference, not failed repair attempts.
- **Blocked:** an organization-level concurrency slot at the latest
  attempt. A future live run can resume the same experimental protocol
  when provider capacity is available, but requires new authorization
  and must still respect the fail-closed policy.

PR #45 remains draft/unmerged. Silas is untouched. The separate
`Systemic Runtime Tree CI` production gate remains failing.

---

## UPDATE: Attempt C — genuine Kimi reasoning test **PASSED** (October 17, 2026)

**Actions:** [live run 39048395570](https://github.com/booleanlambda/agent-control-room/actions/runs/39048395570), final outcome **success**.  
**Immutable evidence artifact:** `aau-kimi-unfamiliar-new-attempt-evidence` (ID **12106671289**), containing actual Python sources, explanations, provider token accounting, and public/held-out grades.

A distinct user-authorized live run occurred after the earlier HTTP 400 and HTTP 429 admission failures. This time all model requests were accepted and the unchanged three controlled-fault tasks ran end to end with **Kimi K2.6 thinking disabled**.

| Unknown-to-model fault family | Genuine code attempts | Public exact/feasible | Unseen exact/feasible |
|---|---:|---|---|
| Machine assignment switch-fee logic | 2 | PASS | PASS |
| Battery routing edge-energy consumption | 1 | PASS | PASS |
| Number-theory modular congruence | 1 | PASS | PASS |

**Total: 4 real Kimi responses, 9,774 provider-reported tokens; 3/3 families and 6/6 public-plus-held-out graded outputs passed.**

### Diagnoses observed

- **Assignment:** Kimi recognized that the fee comparison was inverted. Its first repair fixed the switch condition but erroneously omitted first-machine activation, producing a feasible assignment with an incorrect claim of **82**. The trusted grader rejected it. Kimi's second repair corrected initialization/activation and produced a globally optimal, feasible assignment `[0,1,1,1,2,2,2]` costing **90**. The revised code also passed the genuinely different held-out assignment instance.
- **Routing:** Kimi explicitly identified the missing energy deduction in the Dijkstra traversal and corrected the state transition from unchanged battery to subtracting each traversed edge's energy. Its completed source returned the verified public route with cost **40**, and passed the held-out graph.
- **Number theory:** Kimi identified a reversed comparison in the quadratic-congruence rejection filter and restored the correct modular check. The independent grader confirmed public count **3**, minimum **378**, triple **[4,10,6]**, and the held-out instance.

These are **controlled injected defects, not naturally occurring live production failures**. Kimi saw only defective code, task specification and public failure symptoms, never the intentionally changed line, original working source or hidden answers. Its complete Python outputs ran under isolated network-disabled Docker, evaluated independently for feasible witnesses and exact optima. The first three cases all passed their relevant unseen instance, but the sample is small and cannot establish general-purpose autonomous reliability.

The single-use paid workflow trigger was deleted after dispatch. A proposed larger no-cost adversarial-case script was not admitted to the repository, so **no claim of additional posthoc unseen-case passes is made**. No production changes, merges or Silas wakes. The production `Systemic Runtime Tree CI` remains separately failing.

**This update supersedes the earlier "Kimi cognition not measured" bottom line for Attempts A and B, while leaving their historical admission-failure conclusions intact.**
