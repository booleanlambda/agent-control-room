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
