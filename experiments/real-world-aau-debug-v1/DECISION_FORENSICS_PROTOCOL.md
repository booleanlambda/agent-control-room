# AAU Agent Decision Forensics Protocol — v1

**State:** Implemented and offline-tested in isolated research branch, **not merged into AAU production**.

## Nonnegotiable requirement

Every Kimi call that returns usable JSON must include a short `decisionForensics` object with:

- `choice`: what action, decomposition, patch or escalation was chosen.
- `rationale`: a concise decision summary, not private chain-of-thought.
- `evidence`: 1–5 supplied source references plus observations; public case IDs only.
- `alternatives`: at least one considered option and why it was not chosen.
- `expectedOutcome`: what observable outcome the decision is intended to produce.
- `uncertainty`: what has not been verified yet.

Missing, malformed, or unsafe forensics is a **hard response acceptance failure** (`MODEL_DECISION_FORENSICS_MISSING`); it must not turn into a silent fallback, generated rationale, or a duplicate paid call. No model evidence is treated as ground truth without independent verification.

## Deterministic runtime evidence per step

The runtime writes a structured forensic ledger alongside its original evidence. Each entry has a sequence number and timestamp, links via ID to the Kimi decision, and records the hashes of request, response, candidate, and immutable decision claim when available. A SHA-256 event chain links records to their preceding events. Event types distinguish:

1. Pre-send reservation and provider attempt, accepted/rejected response and settled receipt; completion and reasoning token counts, finish reason, transport timeout or manual hold.
2. Initial problem decomposition and model-generated patch selection.
3. Public test results *per case*, with independent suite summary and actual-versus-expected categories where public.
4. Repair-tree node selection, model proposal, patch validation, accepted improvements, rejected regressions or non-progress.
5. Failed-node decomposition, child-queue admission/rejection, recursion decisions, budget blocks and final outcome.
6. Thinking-ON last-resort repair, separately attributed to the same independent verifier.

A Kimi choice is a **model-stated claim**. The runtime's verdict is a **separate independent observation**. The trail must never label a prediction as validated solely because it is written in Kimi's answer.

## Privacy and boundaries

Do **not** store Kimi's private `reasoning_content`, raw completion text, prompts, model-generated source-code patches, credentials, secrets, provider error bodies, stack traces, internal hidden oracle cases, or URLs in the public evidence artifact. Only bounded, validated, sanitized explanation fields, safe case/reference identifiers, source hashes, classification codes, and test receipts are retained. Unacceptable model text is rejected rather than transformed into an invented reason.

No change to the original V28 historical source, the public/hidden behavioral contract, thinking OFF 4K / thinking ON 32K completion ceilings, finite compute policy, or ambiguous-paid-call no-retry rule. The deterministic audit trail does not answer the technical problem for the model.

## Validation and rollout

- Module: `experiments/real-world-aau-debug-v1/decision-forensics.mjs`.
- Tests: `decision-forensics.test.mjs` and `decision-forensics-integration.test.mjs`.
- Hook: `experiments/real-world-aau-debug-v1/live.mjs`; every parsed provider answer must carry a decision record before it is marked accepted.
- Evidence: `real-world-debug-evidence.json` includes `forensics.modelDecisions` and `forensics.events`.

**Deployment gate:** Research-branch offline tests first; separately authorized live model trial next; only then consider promotion into production AAU/Silas. This protocol is the required acceptance contract, but this branch does **not** assert that production has adopted it.

---

## Three-alternative branch-of-approach protocol (research)

When an independently executed PUBLIC software-repair case fails, Kimi must propose **exactly three distinct, prioritized, testable alternative approaches** with `approach`, `hypothesis`, and `acceptance` fields. Every proposal and implementation response still requires its own valid top-level model-stated `decisionForensics` (choice, evidence, considered alternatives, expected outcome and uncertainty). The host must NEVER synthesize or fill missing approaches or reasons. Branches represent **stated hypotheses and decisions**, not private chain-of-thought.

The deterministic orchestrator runs alternative 1, verifies unchanged four public cases, then runs alternatives 2 and 3 **only if the problem remains unresolved**. A failed or regressed candidate is discarded. A verified partially improved candidate is checkpointed, and the next alternative receives its code plus newly observed public failures; a complete public pass skips remaining alternatives, with explicit forensic skip events. No hidden-case result, test assertion, raw model patch, provider error payload, private reasoning or credential is published. Provider uncertainty, invalid mandatory model forensics, or budget exhaustion stops safely without replaying a paid call.

The immutable recorded audit event chain includes `ALTERNATIVES_PROPOSED`, `ALTERNATIVE_SELECTED`, every independent case and suite result, `ALTERNATIVE_SETTLED`, optional `ALTERNATIVE_INVALID_PATCH`/`ALTERNATIVE_INTERRUPTED`/`ALTERNATIVE_SKIPPED`, and `ALTERNATIVES_COMPLETED`. Events bind to `branchGroupId`, `alternativeId`, model decision ID, request/response/candidate hashes and deterministic test receipt. Sanitized per-branch summaries retain the model's validated brief approach, hypothesis and acceptance text, their individual hashes, selection index, attempts, verdicts, provider-token receipts, old/new independent scores and final status. The proposal hash is sealed in the timestamped SHA-256 forensic event chain; the independent auditor checks both each field hash and the sealed proposal hash. The separate `inspectForensicsReport` check rejects missing, out-of-order, unlinked or unverified branch evidence.

This stage is implemented only on `experiment/aau-three-alternative-forensic-branches-20261018`. Offline tests are separate from live Kimi compliance. No promotion to Silas, production, or main; the research-only `AAU_ALTERNATIVES_SMOKE=yes` mode stops after the initial three-alternative group, avoiding full recursive execution and hidden tests. Real provider calls require a separate controlled run; an offline test passing must not be reported as Kimi correctly diagnosing/fixing a historical bug.


**First live three-alternative trial (October 18, 2026):** [Draft PR #102](https://github.com/booleanlambda/agent-control-room/pull/102), [Actions #39170960079](https://github.com/booleanlambda/agent-control-room/actions/runs/39170960079), [sanitized artifact #12152502581](https://github.com/booleanlambda/agent-control-room/actions/runs/39170960079/artifacts/12152502581). The first thinking-OFF planning call was accepted, but the second code-patch response failed mandatory model-authored forensic validation. The runtime blocked at `MODEL_DECISION_FORENSICS_MISSING` after two provider calls and 6,687 reported tokens; zero public suites and zero alternatives executed. Independent audit returned `PROVIDER_RESPONSE_REJECTED_MISSING_FORENSICS`. This is a confirmed model-output contract failure, **not** a tested failure of the three-alternative repair strategy. No automatic replay, production promotion or Silas wake. Stage-specific patch instructions were clarified offline afterward to require top-level `decisionForensics`; that edit has not been validated live.
