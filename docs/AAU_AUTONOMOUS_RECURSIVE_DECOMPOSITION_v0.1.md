# AAU Autonomous Recursive Decomposition v0.1

## Principle

AAU does not author an agent's intellectual decomposition.

A cognition starts from the actual triggering requirement:
- direct administrator requirement;
- agent-authored intent;
- attention item;
- lifecycle requirement when no more specific trigger exists; or
- agent-authored current focus as a fallback.

The bound agent decides recursively whether each requirement is:

- `ATOMIC` — complete it as one bounded cognition;
- `SPLIT` — author child requirements itself; or
- `NEED_CONTEXT` — request specific stored context and/or external research.

The runtime never prescribes a number of intellectual steps or their subject-matter structure.

## Runtime responsibilities

The runtime is limited to:
- identifying the triggering requirement;
- exposing a shallow index of available stored context without injecting it; oversized branches are navigated recursively by agent-requested child paths;
- executing exact context/research requests authored by the agent;
- persisting the requirement tree;
- routing child nodes;
- enforcing completion integrity;
- checkpointing/resuming, including across worker replacement without a wall-clock kill while the worker heartbeat is fresh;
- routing compact durable results from already-completed siblings into later siblings when they share a parent;
- enforcing mechanical compute/depth/size bounds;
- hashing and provenance.

Mechanical limits are resource limits, not task design:
- maximum branching depth: 12;
- maximum consecutive one-child refinements: 12;
- maximum children at one node: 16;
- maximum context rounds per node: 4.

## Recursive protocol

For every node:

1. The bound agent receives the node requirement, already-requested context, and a context index.
2. It returns only `ATOMIC`, `SPLIT`, or `NEED_CONTEXT`.
3. `SPLIT`: the agent authors exactly one next child at a time. It declares `DONE` when its child set covers the parent. No runtime-prescribed child count exists; a single genuinely narrower child is valid.
4. Each child enters the same protocol recursively.
5. `NEED_CONTEXT`: the agent chooses exact stored context paths and/or web research queries/known URLs. The runtime fetches only those requested inputs.
6. `ATOMIC`: the agent executes the node. It may reclassify itself to `SPLIT` or `NEED_CONTEXT` if execution reveals the node is not actually bounded.
7. A truncated/timeout/malformed response is rejected. Rejected content is not a node result.
8. If an atomic execution is rejected as incomplete, the node returns to agent decision with an explicit notice that the previous atomic attempt exceeded the completion bound.
9. Completed children are synthesized bottom-up by the same bound model. Synthesis is checkpointed incrementally.

## Persistence

`agent_lab.cognition_requirement_nodes` stores:
- stable assignment key;
- node path and parent;
- agent-authored requirement;
- decision;
- requested context;
- result artifact and hashes;
- model binding;
- source and latest wake IDs;
- status and timestamps.

Direct table reads are disabled for Data API roles. The broker uses the token-guarded RPC
`aau_bridge_cognition_requirement_node_v0_1`.

## Autonomy boundary

The runtime may enforce external facts, permissions, resource ceilings, and AAU lifecycle/governance requirements. It does not decide:
- what child requirements should exist;
- the order of intellectual subproblems;
- the substantive expertise field;
- business assumptions the agent is free to choose;
- what conclusions the evidence should support.

The agent owns those decisions.

## Routing versus substantive reasoning

ATOMIC / SPLIT / NEED_CONTEXT discovery is substantive agent cognition. It uses the **same bound model with Thinking ON**, just like child authoring, atomic execution, reconciliation, and bottom-up synthesis.

Routing uses a two-stage protocol:

1. **Deep discovery checkpoint.** The agent interprets the requirement, assesses evidence and unresolved gaps, and chooses its action with Thinking ON. That result is durably checkpointed on the requirement node before routing proceeds.
2. **Protocol commit.** A small same-model structured-output call serializes the already-checkpointed decision with thinking disabled. It may not reconsider or alter the durable discovery decision. If serialization fails, retries reuse the same discovery checkpoint rather than rerunning discovery.

The runtime does not choose or reinterpret the substantive decision; it supplies durable state, enforces mechanical availability/resource constraints, validates response integrity, and persists/routes the agent-authored result.

Pure runtime operations such as queueing, persistence, checkpoint recovery, transport retry, schema validation, deterministic resource limits, and protocol serialization remain non-cognitive.

## Recovery and sibling handoff

A fresh worker heartbeat is authoritative evidence that a long recursive cognition is still alive; duration alone is not an orphan condition. Both legacy deep-cognition checkpoints and `cognition_requirement_nodes` are valid durable resume state.

When children execute sequentially, a later child receives a compact runtime-routed `completed_sibling_results` context containing only durable completed sibling outputs. This is dependency plumbing, not runtime-authored reasoning: the agent still decides how to use those results and whether more context or research is required.


## Convergence accounting

Structural depth is charged only when a node branches into multiple child requirements. A one-child split is treated as a refinement and does not consume branching depth, because a refinement may be necessary after a rejected oversized atomic attempt. Consecutive one-child refinements have their own bounded resource counter so a chain of paraphrases cannot recurse indefinitely. This keeps the runtime neutral about intellectual structure while still enforcing finite execution.

The structural-depth ceiling is an agent-visible mechanical constraint, not a semantic fallback. At the ceiling, the runtime does not throw merely because the agent needs another cognition step. Multi-child branching becomes unavailable; if refinement budget remains, the agent may still choose SPLIT knowing it can author exactly one genuinely narrower refinement child. Otherwise SPLIT is removed from the available actions. The runtime never chooses the replacement action for the agent.
