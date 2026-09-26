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

The currently bound Silas model `google/gemma-4-31b-it` has a provider-observed 131,072-token combined context ceiling from NVIDIA. AAU records that as the observed/declared ceiling, but does not operate at the cliff: after a production request reached 121,527 input tokens plus a 10,000-token output request, the operational ceiling was calibrated to 114,688 tokens. The remaining provider headroom is intentional and separate from the per-request input safety margin.

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


## Durable context versus model context

Durable cognition storage is not the same thing as a model prompt window.

AAU may persist more evidence/context than a selected model can consume in one request. The recursive cognition runtime therefore maintains two distinct bounds:

- **durable context storage** — a model-independent persisted context/index used for continuity across worker restarts;
- **model context view** — a model-profile-aware projection fitted to the effective safe input allowance for the current model and cognition role.

The durable node context currently allows up to 256 KiB of compact context. This is a storage policy, not a claim about any model's context window.

For each substantive model call, the runtime derives a safe input budget from:

`operational_context_limit_tokens - input_safety_margin_tokens - requested_output_tokens`

The safe input budget is then divided among:
- fixed prompt/runtime framing,
- authoritative completed sibling evidence,
- durable pinned research evidence,
- and the remaining supplied context.

Research evidence is compacted structurally. The complete research receipts remain durable in `agent_lab.agent_web_research_batches`; the cognition node preserves a source catalog sufficient to rediscover exact URLs. When storage pressure occurs, the catalog degrades from a full index to a minimal index and then to source-id + exact URL pairs rather than disappearing wholesale.

The model-facing context preserves the source catalog where possible, prioritizes newest research rounds, compacts excerpts fairly, and removes sibling outputs from `supplied_context` when they are already surfaced through the authoritative sibling-evidence channel. This avoids counting the same durable evidence twice.

The in-memory context is bounded immediately after research acquisition. It is not permitted to grow unbounded between a research response and the next model call merely because the persisted database copy is smaller.

This separation is required for model portability: changing the bound agent, authenticator, or adjudicator model changes the model-facing context projection without requiring durable evidence to be deleted or rewritten.


## Workflow compatibility and enforcement

The model runtime contract constrains execution capacity; it does not choose workflow semantics.

A workflow owns its requested task budget. The model profile owns physical/operational capability. AAU resolves both explicitly and does not silently reduce substantive output budgets.

If a workflow requests more completion tokens than the selected model profile permits, execution fails closed with `MODEL_TASK_OUTPUT_BUDGET_UNSUPPORTED`. The runtime must not silently clip a 10,000-token cognition task to an 8,192-token model ceiling and pretend the workflow was unchanged.

Requested timeouts are bounded by the selected model's `max_request_timeout_ms`. The effective timeout and whether it was capped are exposed in runtime telemetry.

Thinking and JSON-mode requests are capability-checked. Unsupported requested thinking fails with `MODEL_THINKING_NOT_SUPPORTED`; unsupported requested provider JSON mode fails with `MODEL_JSON_MODE_NOT_SUPPORTED`. Workflows may still ask a model for textual JSON and parse/validate it independently when native JSON mode is unavailable.

Operational roles now include `agent`, `candidate`, `authenticator`, `adjudicator`, `serializer`, `planner`, `reviewer`, `vision`, and `generic`. Role policy supplies defaults only; it does not alter semantic authority.

Production text-model paths governed by the shared NVIDIA adapter include autonomous cognition, expertise candidate/authenticator/adjudicator, product test execution, product test design, product/service architecture, architecture conformance, and entrepreneurship assessment.

File vision is also governed by the registry, but retains direct multimodal transport because image accounting is not equivalent to text-token estimation. Its profile explicitly declares `supports_vision`, `max_image_bytes`, and multimodal accounting policy, while output and timeout are resolved through the same model task budget.

Provider smoke tests, timeout probes, migration scripts, and CI workflows may intentionally call provider endpoints directly. They are diagnostics/tooling rather than production cognition or grading authority and do not define workflow model limits.

The effective request contract is auditable through runtime telemetry:
- requested/effective output tokens,
- requested/effective timeout,
- timeout-capped flag,
- thinking mode,
- JSON mode,
- estimated/max input tokens,
- selected model and runtime role.

A model change therefore cannot silently rewrite a workflow's resource assumptions. It either satisfies the workflow request under its registered profile or produces an explicit capability mismatch that the workflow/operator must handle.
