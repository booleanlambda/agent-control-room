# AAU Repository Operating Rules for Code Agents

## Repair acceptance — mandatory

For any bug fix, production incident, infrastructure remediation, verifier correction, provider/transport fix, or runtime recovery, follow [AAU Repair Acceptance Standard v1.0](docs/AAU_REPAIR_ACCEPTANCE_STANDARD_v1.0.md). The accepted lifecycle is R0 baseline → R1 reproduce/characterize → R2 causal repair → R3 layered regression/integration → R4 real end-to-end replay → R5 invariant checks → R6 evidence-linked approval.

Never tell an operator a repair is “fixed,” “done,” “resolved” or “complete” solely because a code change, a startup probe, a synthetic test, a build, a deployment, a queue entry, or a model call succeeded. Use the standard's status labels and link to actual evidence. If authoritative replay is not available, report `PATCHED_UNVERIFIED`, `REGRESSION_PASSED`, or `BLOCKED_EXTERNAL` instead.

Retain failed input fixtures, immutable verified agent evidence, checkpoint lineage and accounting. Do not suppress validation, rewrite success flags, silently split agent work, replace an agent's model, bypass assessment gates, or change existing 504/cooldown retry semantics to make an incident appear green. Test the failed path after the fix and verify actual durable completion.

Inspect deployment triggers before merging or writing to a branch that deploys live services. Do not treat a documentation-only change as authorization to restart active workers or awaken a held agent. Do not deploy, replay, or unpause without the operational authorization required by the context.

## Scope

These rules apply to every repair in this repository and serve as reusable governance guidance for other AAU repositories once explicitly adopted there. An instruction document is not a deployed automated enforcement gate.
