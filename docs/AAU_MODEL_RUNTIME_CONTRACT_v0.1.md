# AAU Model Runtime Contract v0.1

AAU must not encode a model's operational limits implicitly in individual workers. Every model used by an agent, candidate, authenticator, adjudicator, serializer, vision worker, or other model-backed role is governed by a model runtime profile.

## Separation of concerns

Two different quantities must never be conflated:

1. **Model capability / operational profile** — what the selected model can safely accept.
2. **Task budget** — how much of that capability a particular cognition step is allowed to consume.

A task may request less than a model profile permits. It may never request more.

## Model profile variables

Each registered `model_id` defines:

- `provider`
- `declared_context_window_tokens` — vendor/provider maximum when actually verified; nullable when not verified
- `operational_context_limit_tokens` — AAU's enforced safe input+output context ceiling
- `max_output_tokens` — AAU's maximum completion allowance for that model
- `input_safety_margin_tokens` — reserved headroom that cannot be consumed by prompt or output
- `estimated_chars_per_token` — conservative preflight estimator, not a tokenizer claim
- `supports_thinking`
- `reasoning_counts_against_output`
- `supports_json_mode`
- `max_request_timeout_ms`
- `profile_source` — provenance for the configured values

If a vendor maximum has not been verified, AAU uses a conservative operational floor and leaves `declared_context_window_tokens` null. A conservative floor is not represented as the vendor's actual maximum.

The currently bound Silas model `google/gemma-4-31b-it` has a provider-observed 131,072-token context ceiling from the NVIDIA rejection returned on 2026-09-26. AAU therefore records that observed ceiling explicitly instead of relying on a generic constant.

## Role policies

Runtime roles define operational defaults independent of model identity:

- `agent`
- `candidate`
- `authenticator`
- `adjudicator`
- `serializer`
- `vision`
- `generic`

Each role defines:

- default request timeout,
- default output budget,
- default thinking behavior where applicable,
- bounded retry count.

The effective request contract is calculated from **model_id + role + task request**.

Effective output allowance:

`min(task_requested_output, model.max_output_tokens)`

Effective timeout:

`min(task_requested_timeout OR role.default_timeout, model.max_request_timeout_ms)`

Maximum safe input estimate:

`model.operational_context_limit_tokens - model.input_safety_margin_tokens - effective_output_allowance`

## Preflight

Before a governed model request is sent, AAU estimates prompt tokens conservatively. If the estimate exceeds the effective input budget, the request fails locally as `MODEL_CONTEXT_BUDGET_EXCEEDED` rather than being sent to the provider and failing opaquely.

This preflight is not permission for the runtime to delete semantic evidence. A higher-level cognition/context policy must decide how to compact, retrieve, decompose, or defer work while preserving durable evidence.

## Model changes

A model swap must not require hunting through arbitrary workers for token-window assumptions. The new `model_id` must have a registered runtime profile. Unknown models fail closed with `MODEL_RUNTIME_PROFILE_MISSING`.

Model identity remains part of agent continuity under the AAU model-consistency policy; this runtime contract only defines operational limits and does not authorize a model swap.

## Source

Canonical implementation: `workers/model-runtime-profiles.js`.

The NVIDIA adapter enforces these profiles for governed calls. Agent cognition uses the `agent` or `serializer` roles. Expertise verification binds candidate, authenticator, and adjudicator requests to their corresponding roles.
