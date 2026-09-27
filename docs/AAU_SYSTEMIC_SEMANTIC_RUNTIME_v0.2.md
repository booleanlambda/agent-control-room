# AAU Systemic Semantic Runtime v0.2

## Status

This contract supersedes the mechanical convergence controls in **AAU Autonomous Recursive Decomposition v0.1**. The semantic requirement tree remains agent-authored; runtime retries, model calls, context acquisition, wake recovery, and transport failures are execution events and MUST NOT create semantic tree nodes.

## Core invariant

The semantic tree answers **what work exists**. The execution ledger answers **what happened while trying to perform that work**.

A semantic child may be created only when the bound agent authors a genuinely narrower requirement. A timeout, truncation, malformed response, retry, wake restart, broker redelivery, context fetch, remediation attempt, or model call never creates semantic depth by itself.

## Finite assignment epoch

Each stable assignment begins with one finite execution epoch. The epoch is keyed by agent, assignment key, bound model, and epoch number.

The default work budget is derived from the bound model runtime profile:

```
initial_budget_tokens = max(300000, operational_context_limit_tokens * 8)
budget_units = ceil(initial_budget_tokens / budget_quantum_tokens)
```

The default quantum is 1,000 token-equivalent work units. Operators may override the epoch token budget through `AAU_SEMANTIC_EPOCH_BUDGET_TOKENS`.

Budget is conserved across wakes. Restarting a wake does not create a new budget and does not erase prior execution history.

Every substantive model call is charged from estimated input tokens plus requested output tokens. Context acquisition, semantic node creation, and durable semantic transitions also have positive mechanical costs.

Therefore, within a finite epoch, unbounded execution cycling is impossible: the epoch must eventually complete, block, or exhaust its budget.

## Decomposition

Tree depth is not the ordinary convergence mechanism.

The runtime exposes the remaining work budget and computes current semantic-child capacity from:

- remaining epoch budget;
- per-node creation cost;
- a reserved terminal/synthesis allowance; and
- the maximum number of children that may be authored in one split.

Splitting divides the finite opportunity to do work; it does not mint new compute.

A durable node-path ceiling of 16 remains only as an emergency persistence-geometry guard. Reaching that guard is a runtime/storage condition, not a semantic conclusion and not a substitute for agent judgment.

## Attempt and usage ledgers

Existing AAU ledgers remain authoritative for execution evidence:

- `agent_lab.model_call_usage` records provider/model/token/runtime observations.
- `agent_lab.cognition_rejected_attempts` records rejected attempts without treating partial output as continuation evidence.
- `agent_lab.cognition_step_checkpoints` preserves durable cognition checkpoints.
- `agent_lab.cognition_requirement_nodes` remains the semantic requirement tree.

v0.2 adds:

- `agent_lab.cognition_assignment_runtime` — one finite epoch state per agent/assignment/model/epoch.
- `agent_lab.cognition_runtime_events` — idempotent budget and transition events.

This avoids using the semantic tree as an attempt ledger.

## Material progress and cycle lock

Every durable semantic node-state save records an idempotent `semantic_transition` event. The runtime tracks a separate `material_transition_count`.

Wake resumption records a fingerprint of the durable material state. Model attempts by themselves do not count as semantic progress.

If repeated wakes resume the same material state beyond the bounded recovery allowance, the runtime enters `SEMANTIC_RUNTIME_CYCLE_LOCK`. The failed wake is not re-armed. The lifecycle is paused, the existence levy is suspended, and an explicit new epoch or operator resolution is required.

This rule catches a higher-level scheduler cycle without misclassifying a long child computation that has actually produced durable semantic transitions.

## Budget exhaustion

If an operation cannot be charged because the finite epoch budget is exhausted, the runtime raises `SEMANTIC_BUDGET_EXHAUSTED`.

Budget exhaustion is terminal for that epoch. It is not routed into generic orphan retry or RabbitMQ re-arm logic. The lifecycle enters a hold and the existence levy is suspended.

A later resource renewal does not erase the old epoch history. Work may resume only under an explicitly authorized new epoch or another material change permitted by policy.

### Corrective infrastructure compensation

A verified AAU infrastructure defect may justify a bounded corrective epoch without granting a fresh full epoch.

A corrective epoch:
- requires the prior epoch to be `budget_exhausted`;
- carries forward the prior epoch's genuinely unspent units;
- adds only explicitly quantified infrastructure-loss compensation;
- may not exceed the prior epoch's original budget ceiling;
- preserves the entire prior event/model-call history;
- records the compensation amount and reason durably; and
- does not automatically refund provider-policy failures such as a charged NVIDIA 529 retry.

The canonical corrective budget is therefore:

`corrective_epoch_units = prior_remaining_units + verified_infrastructure_loss_units`

This mechanism exists to repair accounting distortion caused by AAU itself, not to turn runtime failure into unlimited compute.


### Branch lifecycle economics

Tree capacity is governed by the projected cost of doing useful work on a child, not by the cheap database cost of creating the child row.

For each routing decision, AAU projects a first-pass lifecycle for one additional child from the currently bound model contract and the node's current evidence/context envelope. The projected child lifecycle includes:

- child formulation;
- child provenance review;
- mechanical serialization;
- durable node creation;
- first child discovery;
- one substantive resolution attempt; and
- small semantic-transition overhead.

AAU also protects a separate completion reserve for terminal reconciliation and synthesis. The effective child capacity is:

`floor((remaining_units - completion_reserve_units) / expected_child_lifecycle_units)`

bounded by the structural maximum of 16 children.

The projection is recomputed from the live remaining semantic budget and current context before every routing decision. During child authoring it is recomputed again before every additional child, so research, retries, prior child authoring, or other charges cannot leave a stale branch allowance in force.

A node may therefore expose SPLIT only while at least one additional first-pass child lifecycle is economically supportable. Multi-child branching requires capacity for at least two. The 16-level path ceiling remains only an emergency persistence guard and is not the normal convergence rule.

The branch-economics contract is `semantic_branch_economics_v0_1`. Its component estimates are persisted into agent-visible routing state and budget-constrained split checkpoints for auditability.

This changes the meaning of tree capacity from **how many nodes can be written** to **how many additional branches can be responsibly started and given a substantive first-pass resolution attempt without consuming the protected completion reserve**.

## Semantic BLOCKED versus runtime hold

`BLOCKED` remains an agent-authored semantic outcome. It means the bound agent judged that a requirement cannot honestly be completed under the available evidence/dependencies.

A runtime cycle lock or budget exhaustion is different. It is infrastructure/resource state and MUST NOT be rewritten as the agent's substantive conclusion.

The runtime checks the durable root node before interpreting an assignment-runtime `blocked` status so a legitimate completed semantic `BLOCKED` result is preserved.

## Context acquisition

The v0.1 evidence rules remain in force:

- exact requested evidence is durably pinned;
- completed sibling evidence is routed through a compact authoritative channel;
- research/source catalogs survive ordinary context compaction;
- repeated context requests with no new observation are bounded.

v0.2 additionally charges context acquisition to the finite assignment epoch. Context retrieval cannot become a side channel for infinite execution.

## Recovery hierarchy

Recovery order is:

1. reconcile operation-level transport state;
2. resume the current durable semantic node/checkpoint;
3. allow the bound agent to reconsider, split, request context, remediate, or block;
4. use a fresh wake only as a scheduler continuation of that durable state;
5. enter terminal hold when budget or cycle invariants are reached.

A wake restart is never a substitute for node-level recovery.

## Termination property

Let the epoch start with finite budget (B), and let every newly charged execution event consume at least one positive budget unit.

Then for successful new charges:

```
B(t+1) < B(t)
```

and therefore the number of chargeable events is finite.

Idempotent replay of an already-recorded event does not charge twice, while cross-wake repetition of an unchanged durable material state is separately cycle-locked.

The allowed terminal outcomes for the execution epoch are:

```
COMPLETE | BLOCKED | BUDGET_EXHAUSTED | CYCLE_LOCK
```

where COMPLETE/BLOCKED are semantic root outcomes and BUDGET_EXHAUSTED/CYCLE_LOCK are runtime outcomes.

## Autonomy boundary

The runtime may enforce resource conservation, persistence geometry, evidence integrity, idempotency, dependency safety, and terminal recovery policy.

It does not choose:

- whether a genuinely bounded semantic requirement is atomic;
- which substantive children should exist;
- what evidence means;
- what conclusion should be reached; or
- what expertise/business/identity decision the agent should make.

The bound agent remains the author of the semantic tree. The runtime makes that tree finite, recoverable, and auditable.
