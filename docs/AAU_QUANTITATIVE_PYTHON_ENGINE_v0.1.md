# AAU Quantitative Python Engine v0.1

Status: runtime contract  
Engine ID: `aau_quantitative_python_v0_1`

## Purpose

The Quantitative Python Engine is a deterministic companion capability for AAU agents. It does not replace the bound agent's reasoning, identity, model selection, evidential judgment, or interpretation.

The governing separation is:

**Agent chooses the question, variables, statistical method, assumptions, and interpretation. Python executes the numerical/statistical procedure. The agent must reconcile any disagreement before completion.**

## Modes

### Arithmetic verification

Existing `python_checks` remain the contract for ordinary quantitative arithmetic.

The agent first states the model/formula and its claimed result. Python independently evaluates the bounded arithmetic expression. A mismatch blocks completion and is returned to the same bound agent for correction.

### Statistical analysis

Designated statistics/computational requirements use `python_analyses`.

Each item contains:

- `id`: stable analysis label.
- `analysis`: one allowed statistical operation.
- `spec`: the dataset/parameters selected by the agent.
- `claims`: numerical conclusions stated by the agent and checked against Python's output.

Supported v0.1 analyses:

- `describe`
- `pearson_correlation`
- `simple_linear_regression`
- `proportion_ci`
- `difference_proportions_ci`
- `mean_ci`
- `one_sample_t`
- `welch_t`
- `coefficient_t`
- `bootstrap_ci`
- `monte_carlo_expression`

## Statistical authority boundary

Python is authoritative only for deterministic execution of the selected statistical procedure.

Python does **not** determine:

- whether the selected procedure answers the substantive question;
- whether sampling/design assumptions are credible;
- whether an association is causal;
- whether a p-value is decision-relevant;
- whether a model is economically meaningful;
- whether a result should change an AAU decision.

Those remain cognitive responsibilities of the bound agent.

## Reconciliation protocol

1. Agent performs Pass A and states the statistical method and claims.
2. Python recomputes the requested analyses from the supplied data/parameters.
3. Runtime compares the agent's claims to Python output.
4. Any missing analysis, invalid analysis, or mismatch returns deterministic feedback before model reconciliation.
5. The retry attempt is part of the durable checkpoint identity; a rejected statistical artifact cannot be silently replayed.
6. Agent must make a fresh correction attempt and explain assumptions/limitations.
7. Only a numerically consistent artifact proceeds to cognitive reconciliation and persistence.

## Reproducibility and provenance

Each statistical analysis returns a deterministic SHA-256 `input_hash` over its canonicalized specification.

Bootstrap and Monte Carlo operations require deterministic seeded execution. The runtime bounds analysis count, data size, draws, expression syntax, execution time, and output size.

The engine does not expose arbitrary Python, shell access, imports, filesystem access, or network access to the model.

## QDA-601 integration

The statistical companion is mandatory for:

- QDA601-M4-U1 — Distributions and Descriptives
- QDA601-M4-U2 — Sampling and Confidence
- QDA601-M4-U3 — Regression and Association
- QDA601-M9-U3 — Simulation and Uncertainty

Other ordinary quantitative units continue to use `python_checks` unless their runtime contract is explicitly promoted to statistical mode.

## Safety invariant

A tool result may correct computation but must never silently overwrite the agent's conclusion. Disagreement is evidence presented back to the bound agent for reconciliation.
