# AAU Precision Engineer v0.1

## Purpose

Precision Engineer is an offline-first quantitative formalization and verification subsystem for AAU agents.

It is deliberately **not** another general-purpose agent. A small local model translates an agent's quantitative intent into a strict executable specification. Deterministic local tools execute and verify material numerical claims. The originating agent remains responsible for assumptions, interpretation, causal claims, and final decisions.

## Architecture

```
Agent
  -> local Precision Engineer model
  -> aau.precision_spec.v0.1
  -> deterministic router
       -> Python safe arithmetic
       -> Python statistics / simulation
       -> future symbolic algebra
       -> future optimization
       -> future dimensional-analysis engine
  -> independent verification
  -> VERIFIED | RECONCILE | NEED_CONTEXT | ESCALATE
  -> Agent
```

No cloud dependency is required for the core execution path. The local-model adapter rejects non-loopback endpoints.

## Governing rules

1. **The model is never the arithmetic authority.**
2. Every material numerical result requires a deterministic verification path.
3. Missing numerical assumptions are surfaced as `missing_information`; they are never silently invented.
4. Deterministic disagreement returns `RECONCILE`. The verifier does not overwrite the agent/model claim.
5. Unsupported methods or unavailable deterministic runtimes return `ESCALATE`.
6. Units are mandatory on arithmetic claims.
7. Provenance hashes bind a result to the exact specification that produced it.
8. Local model selection is swappable. Precision is provided by the protocol and deterministic engines, not by trusting one model.

## v0.1 supported deterministic tools

- Safe Python arithmetic expression execution.
- Existing AAU statistical engine:
  - descriptive statistics
  - Pearson correlation
  - simple linear regression
  - confidence intervals
  - one-sample and Welch t tests
  - coefficient t tests
  - bootstrap confidence intervals
  - Monte Carlo expression simulation

## Result states

### VERIFIED
All deterministic checks match the supplied claims.

### RECONCILE
At least one deterministic result disagrees with the supplied claim. The originating agent must explain and correct the disagreement.

### NEED_CONTEXT
The request is underspecified. The Precision Engineer returns the missing information instead of inventing assumptions.

### ESCALATE
The formal specification is invalid, a deterministic tool is unavailable, or the method exceeds the local v0.1 capability.

## Offline model interface

`workers/precision-local-model.js` supports:

- Ollama-compatible local generation.
- OpenAI-compatible servers on loopback.
- Only `localhost`, `127.0.0.1`, or `::1` endpoints.

This makes offline locality enforceable at the adapter boundary.

## CLI

Pipe a precision specification to:

```
node workers/precision-engineer-cli.js
```

Exit codes:

- `0`: VERIFIED
- `3`: RECONCILE
- `2`: NEED_CONTEXT / ESCALATE / runtime failure

## Model training/evaluation target

The local model should be optimized for:

- correct variable extraction
- correct formula/method selection
- explicit units
- complete material-check coverage
- correct deterministic-tool routing
- explicit assumptions
- refusal to invent missing inputs
- contradiction detection
- compact executable specifications

The preferred training data is generated/adversarial quantitative work with deterministic labels, not broad conversational imitation.

## Future engines

v0.2 candidates:

- SymPy symbolic equivalence and equation solving
- unit/dimensional algebra
- constrained optimization
- numerical root finding
- matrix/linear algebra
- interval arithmetic and uncertainty propagation
- engineering tolerances/invariants
- local provenance store and cache
- agent-wide Precision-as-a-Service socket/API

## Product thesis

> A local quantitative reasoning and verification layer that gives AI agents deterministic mathematical precision without cloud dependence.


## Local service

Run:

```
npm run precision:serve
```

Defaults:

- host: `127.0.0.1`
- port: `47821`
- model endpoint: `http://127.0.0.1:11434/api/generate`

Routes:

- `GET /health` — local health/status.
- `POST /v1/execute` — execute and verify an already-formed `aau.precision_spec.v0.1`.
- `POST /v1/plan-execute` — ask a loopback-only local model to formalize the request, then execute deterministic verification.

The server itself refuses non-loopback bind addresses, and the model adapter refuses non-loopback model endpoints. This preserves the offline/local trust boundary on both sides.
