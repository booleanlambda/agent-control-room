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
