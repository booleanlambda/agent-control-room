# AAU Adaptive Cognition Protocol v0.1

## Purpose

AAU separates routine autonomous wake execution from substantive intellectual work. The bound model remains the agent's model in both modes. Cognition mode changes inference configuration and task context; it does not change identity, goals, memory ownership, or model continuity.

## Modes

### FAST

Use for routine structured wakes: status checks, ordinary attention handling, simple admin acknowledgements, sleep/resource decisions, and institutional assessment waits.

- bound model unchanged
- structured JSON generation
- thinking disabled
- broad continuity packet permitted
- may request same-wake escalation when unexpected complexity appears

### DEEP

Use automatically for substantive Entrepreneurship Master's units/remediation, expertise selection/development, product/service architecture and testing, or intents involving material quantitative, financial, legal, research, architecture, debugging, reconciliation, sensitivity, or similar complex work.

The DEEP pipeline is:

1. **Private work pass** — same bound model, thinking requested, JSON disabled, compact task-relevant packet.
2. **Adversarial self-critic pass** — same bound model checks conceptual categories, arithmetic/reconciliation, causal claims, assumptions vs evidence, counterexamples and boundary cases.
3. **Structured commit pass** — same bound model, thinking disabled, JSON enabled, converts checked work into the canonical AAU decision envelope.
4. **Runtime validators/gates** — existing lifecycle, submission, evidence, capability, and persistence contracts remain authoritative.

Private model reasoning is not persisted. A concise auditable work artifact may be passed from deep work to structured commit and is hashed in runtime metadata.

## Context policy

DEEP mode uses stage-specific context rather than the full brain packet. It preserves identity/continuity, the authoritative current task, relevant prior work, assessor/A/A feedback, evidence provenance, required tools/capabilities, and short recent summaries. Unrelated historical activity and infrastructure state are excluded from the reasoning packet.

For Entrepreneurship coursework, the packet preferentially preserves the current unit's prior submission rather than all prior course submissions.

## Escalation

A FAST cognition may request immediate same-wake escalation using:

`origin: cognition_escalation_request_v0_1`

when it encounters unexpected multi-step quantitative reconciliation, substantial research, architecture/debugging, financial/legal analysis, or another difficult intellectual artifact.

## Failure behavior

Thinking-mode timeout must not destroy a wake. The runtime falls back to the same bound model without thinking for the work pass, retains the separate critic/structured-commit architecture, and records the fallback in cognition metadata.

Institutional assessment waits remain FAST and must not trigger DEEP merely because the wake text says "verify" or "assessment."

## Observability

Cognition runs record:
- cognition mode and reason
- task-packet size
- deep-work artifact hash/size
- whether thinking was requested
- whether thinking/critic fallback occurred
- latency and usage
- bound/requested/returned model consistency

## Principle

Structured-output reliability must not suppress reasoning quality. AAU therefore separates *thinking about the work* from *packaging the work for deterministic execution* while preserving one persistent agent and one bound model.
