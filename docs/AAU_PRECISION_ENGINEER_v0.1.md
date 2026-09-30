# AAU Precision Engineer v0.1

## Purpose

Precision Engineer is a deterministic, offline-capable quantitative precision substrate for AAU agents.

**It is not an AI model and it does not contain a second reasoning agent.**

The originating AAU agent owns problem understanding, assumptions, method selection, interpretation, and final judgment. The agent emits a strict precision specification containing the calculations or statistical claims it wants checked. Precision Engineer executes those claims through deterministic local software and returns evidence the same agent must reconcile.

## Core architecture

```
AAU agent
  -> authors aau.precision_spec.v0.1
  -> deterministic Precision Engineer
       -> safe Python arithmetic
       -> statistics / simulation
       -> future symbolic algebra
       -> future optimization
       -> future dimensional analysis
  -> VERIFIED | RECONCILE | NEED_CONTEXT | ESCALATE
  -> same AAU agent
```

The governing principle is:

> One strong model for cognition. Deterministic local software for exactness.

There is no AI-to-AI handoff in the precision path.

## Responsibility boundary

### The originating agent owns

- understanding the problem
- choosing the mathematical or statistical model
- identifying variables
- stating assumptions
- deciding which material results require verification
- interpreting deterministic outputs
- reconciling disagreements
- making the final decision

### Precision Engineer owns

- validating the precision specification
- executing safe deterministic calculations
- executing supported statistical analyses
- comparing deterministic results with the agent's claims
- preserving both sides of a disagreement
- reporting unsupported or underspecified work explicitly
- provenance hashes tying results to exact specifications

Precision Engineer never invents a formula for the agent and never silently replaces an agent claim.

## Precision specification

The agent emits `aau.precision_spec.v0.1`.

A minimal arithmetic example:

```json
{
  "schema": "aau.precision_spec.v0.1",
  "job_id": "retention_check",
  "intent": "Verify annual retention and churn.",
  "assumptions": [
    {"statement": "Monthly retention is 96.5%."}
  ],
  "missing_information": [],
  "arithmetic_checks": [
    {
      "id": "retention_12m",
      "expression": "0.965 ** 12",
      "claimed_result": 0.6521203607482342,
      "unit": "ratio"
    },
    {
      "id": "annual_churn",
      "expression": "1 - (0.965 ** 12)",
      "claimed_result": 0.3478796392517658,
      "unit": "ratio"
    }
  ],
  "statistical_analyses": []
}
```

The agent must state its own claim before deterministic verification. This prevents the precision layer from becoming an answer oracle that bypasses cognition.

## Governing rules

1. **No secondary model.** The same agent that owns the task authors the precision specification.
2. **The model is never the arithmetic authority.** Deterministic software is authoritative only for the computation it actually executes.
3. **The agent remains the semantic authority.** Precision Engineer does not choose the formula, causal model, or business interpretation.
4. Every material numerical result requires its own deterministic verification path.
5. Missing inputs are surfaced through `missing_information`; they are never silently invented.
6. A mismatch returns `RECONCILE`. The agent claim and deterministic result are both preserved.
7. Unsupported methods or unavailable deterministic runtimes return `ESCALATE`.
8. Units are mandatory for arithmetic claims.
9. Provenance hashes bind results to the exact specification.
10. The full core path can run without network access.

## Result states

### VERIFIED

All deterministic checks agree with the originating agent's claims.

### RECONCILE

One or more deterministic results disagree with the agent's claims. Precision Engineer returns both values. The originating agent must diagnose the discrepancy and submit a revised specification if appropriate.

### NEED_CONTEXT

The agent has explicitly identified information required before the computation can be valid.

### ESCALATE

The specification is structurally invalid, a deterministic engine is unavailable, or the requested operation is outside the current deterministic capability.

## Supported v0.1 deterministic engines

### Safe arithmetic

Local Python supports bounded:

- addition, subtraction, multiplication and division
- modulo and powers
- absolute value and rounding
- square root
- natural and base-10 logarithms
- exponentials
- constants pi and e

Arbitrary Python, shell execution, imports, files, networking, and model-generated executable code are not allowed.

### Statistics and simulation

The existing AAU quantitative Python engine supports:

- descriptive statistics
- Pearson correlation
- simple linear regression
- proportion confidence intervals
- difference-of-proportions confidence intervals
- mean confidence intervals
- one-sample t tests
- Welch t tests
- coefficient t tests
- bootstrap confidence intervals
- Monte Carlo expression simulation

## Local service

Run:

```
npm run precision:serve
```

Defaults:

- host: `127.0.0.1`
- port: `47821`

Routes:

- `GET /health` — confirms deterministic Precision Engineer availability.
- `GET /v1/capabilities` — returns supported deterministic operations and explicitly reports `secondary_model_required: false`.
- `POST /v1/execute` — validates and executes an agent-authored `aau.precision_spec.v0.1`.

The service refuses non-loopback bind addresses. It requires no model endpoint.

## CLI

Pipe an agent-authored precision specification to:

```
node workers/precision-engineer-cli.js
```

Exit codes:

- `0`: VERIFIED
- `3`: RECONCILE
- `2`: NEED_CONTEXT / ESCALATE / runtime failure

## Tests

Run:

```
npm run test:precision
```

The regression suite covers exact arithmetic, deliberate disagreement, missing information, mandatory units, statistical disagreement, and the no-secondary-model architecture invariant.

## Future deterministic engines

v0.2 candidates:

- SymPy symbolic equivalence and equation solving
- dimensional/unit algebra
- constrained optimization
- numerical root finding
- matrix and linear algebra
- interval arithmetic
- uncertainty propagation
- engineering tolerances and invariants
- deterministic equation-system solving
- local result cache and provenance ledger

Each future capability must remain deterministic and must not introduce another LLM into the precision path.

## Product thesis

> A local deterministic precision substrate that gives AI agents exact quantitative verification without adding another AI model.
