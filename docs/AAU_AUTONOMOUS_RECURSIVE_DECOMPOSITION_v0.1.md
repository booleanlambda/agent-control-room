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


## Research evidence handoff

Research result ordering must never determine evidence visibility. Every unique source returned by an agent-authored research request is persisted in an immutable research batch and exposed to cognition through a compact source index. Excerpt bytes are allocated across all fetched sources under a total context budget; no fixed first-N source cutoff is allowed.

The node context maintains a cumulative `research_source_catalog` containing source IDs, titles, publishers, URLs, coverage, fetch status, hashes, and audit references across research rounds. If a full excerpt cannot remain in the bounded cognition payload, the catalog entry remains discoverable and the bound agent may request the exact listed URL again. Runtime context limits may compact text, but they must not silently erase source existence.

Source-specific context requests may resolve against the node's own research context as well as the original wake packet. Array-backed source collections support selectors by source ID, publisher, title, URL, or hash so an agent request such as a named publisher does not become `available:false` merely because the evidence is stored in an array.


## Agent-visible context acquisition resource

Context and research acquisition is a bounded mechanical resource, not a semantic decision made by the runtime. The runtime MUST NOT terminate a wake merely because a fixed number of `NEED_CONTEXT` rounds has been reached.

The bound agent receives the current context-resource state before each routing decision. The runtime tracks cumulative context/research rounds, newly discovered source observations, newly resolved local context paths, unresolved-gap persistence, request repetition, elapsed acquisition time, and the cumulative unique-source count. Continued retrieval remains available while it is making progress and remains within safety ceilings.

The runtime currently treats retrieval as exhausted when a mechanical safety condition is reached, including repeated rounds with no new observations, a materially unchanged unresolved gap across repeated rounds, repeated substantially identical requests, elapsed acquisition-time exhaustion, unique-source exhaustion, or the absolute emergency round ceiling. These are convergence/resource signals, not conclusions about the requirement.

When context acquisition becomes unavailable, `NEED_CONTEXT` is removed from the available actions and the exact exhaustion reasons are exposed to the bound agent. The runtime does not choose a replacement action. `ATOMIC` and `SPLIT` remain available when their independent mechanical budgets permit them, and `BLOCKED` becomes available so the bound agent may explicitly preserve an unresolved dependency rather than fabricate evidence.

`BLOCKED` is an agent-authored semantic outcome. A blocked child is not treated as successful completion. During synthesis, the bound agent receives each child's resolved status and decides whether the parent can still be completed from the remaining evidence or must itself become blocked. Blocked state and unresolved gaps propagate durably and must never be silently converted into a successful result.

Current mechanical safeguards are an emergency ceiling of 12 context-acquisition rounds, two consecutive no-new-observation rounds, three materially unchanged-gap rounds, two materially repeated-request rounds, 30 minutes of cumulative acquisition time, and 250 unique indexed sources. These numbers are safety ceilings rather than claims of epistemic optimality; ordinary stopping is driven by evidence progress and gap convergence.


## Durable pinned research evidence

Explicitly requested source evidence must survive ordinary node-context compaction. When the bound agent requests an exact research URL and fetched text is returned, the runtime persists that source excerpt in `agent_lab.cognition_pinned_research_evidence`, keyed by agent, assignment, node, model, and source identity.

Pinned evidence is outside the ordinary 52 KB `context_payload` budget. The persisted node context may still compact or evict research-round payloads, but pinned source excerpts remain durable and are rehydrated into the bound agent's cognition as `pinned_research_evidence` before deep discovery, atomic execution, and atomic reconciliation.

A re-fetch of an already-known URL counts as productive context acquisition when it inserts a previously unpinned excerpt or extends the durable excerpt. Progress therefore measures restored usable evidence, not merely discovery of a new URL.

Pinned evidence follows a node into a newly authored refinement child so decomposition cannot erase evidence merely by changing the node path. The evidence remains observation-level material: pinning establishes durable availability, not automatic truth or claim verification.

Current cognition loading exposes up to 16 recent pinned evidence records per node, with each excerpt bounded independently; the durable table is not subject to ordinary node-context eviction.


## Authoritative completed sibling evidence

Later child requirements depend on durable outputs from earlier resolved siblings. Those outputs MUST NOT be buried only inside the general bounded context payload.

Before deep discovery, atomic execution, and atomic reconciliation, the runtime mechanically extracts completed sibling outputs into a separate `authoritative_completed_sibling_evidence` channel. Each item carries the sibling path, resolved status, decision type, requirement, bounded artifact, handoff, and result hash. This is dependency delivery, not runtime interpretation: the bound agent still decides whether a sibling result is relevant, sufficient, comparable, or should be qualified.

Deep discovery must account for every surfaced sibling path through `inspected_sibling_paths` before its routing decision is accepted. This requirement verifies attention to available durable dependencies; it does not force acceptance of their substantive conclusions.

A bound agent MUST NOT request information solely because the original research excerpt is absent when a completed sibling output already contains the needed result. If the agent judges the sibling output insufficient, mismatched, stale, or otherwise unusable, it may still choose `NEED_CONTEXT`, but its own discovery reason must identify that substantive insufficiency.

Sibling result hashes participate in the discovery context fingerprint so a sibling's repaired or newly completed result invalidates an older routing checkpoint automatically.


## Level 1 cognitive self-remediation

The bound agent may now choose a first-class `REMEDIATE` action when it detects a recoverable inconsistency in its own durable cognitive state. This is not runtime-authored repair: the runtime exposes prior cognition, current durable evidence, completed sibling outputs, and remediation history; the agent must identify the anomaly, state its prior belief, cite contradicting evidence, diagnose the failure, choose a bounded repair, and define its own verification criterion.

A remediation episode is persisted in `agent_lab.cognition_remediation_episodes` with:
- the observed anomaly,
- the prior belief,
- contradicting evidence,
- the agent-authored diagnosis,
- the requested repair,
- pre-repair and post-repair state,
- the verification criterion,
- and the final verification result.

The initial bounded repair vocabulary is deliberately narrow:

`INVALIDATE_DISCOVERY_CHECKPOINT` supersedes the current routing/discovery checkpoint and returns the node to fresh reconsideration without changing evidence, atomic-failure counts, hard resource ceilings, or historical records.

`REFRESH_SIBLING_EVIDENCE` mechanically reloads already resolved sibling outputs into the node context, then supersedes the current discovery checkpoint. The runtime does not decide whether those sibling outputs are relevant or sufficient.

Every remediation must be verified by a separate bound-agent verification pass before the original requirement resumes. `VERIFIED` means the agent judges its own stated verification criterion satisfied. `FAILED` preserves the unsuccessful episode and allows another diagnosis while budget remains. A malformed or timed-out verification is recorded as a non-agent-authored verification failure and must never be mislabeled as successful self-remediation.

Remediation is capped at two attempts per requirement node. The repair vocabulary cannot change requirement text, fabricate evidence, erase atomic execution failures, reset hard context ceilings, rewrite completed artifacts, mutate code, deploy services, or modify unrelated nodes.

An interrupted episode is resumable. Episodes in `proposed`, `applied`, or `verifying` state are resumed at the repair/verification boundary after worker recovery rather than silently skipped.

This capability is **Level 1 cognitive self-remediation only**. It does not constitute autonomous workflow repair, source-code modification, infrastructure repair, deployment, or rollback. Those remain later maturity levels.


## Deep child formulation and durable serialization

Child authoring is substantive agent cognition and MUST NOT compete with protocol serialization for the same small completion budget.

The child-authoring pipeline is:

`SPLIT → deep child formulation → durable cognition-step checkpoint → non-thinking protocol serialization → child persistence`.

The bound agent performs child formulation with Thinking enabled and a dedicated deep completion budget. The resulting CHILD or DONE proposal is persisted in `agent_lab.cognition_step_checkpoints` under a key derived from the parent node, ordinal, requirement identity, and current discovery fingerprint. The checkpoint therefore survives wake retries while a later reconsideration with a different cognitive fingerprint produces a fresh proposal.

After the proposal is durable, the same bound model performs only mechanical JSON serialization with Thinking disabled. The serializer is not allowed to change the requirement, scope removed, completion criterion, reason, or DONE decision. Runtime equality checks reject substantive serialization drift.

If deep formulation or protocol serialization repeatedly truncates, times out, produces invalid output, or fails convergence validation, the wake MUST NOT fail merely because child authoring failed. Rejected model attempts remain durable in the cognition-rejection ledger, and the parent node receives an `agent_visible_child_authoring_failure_v0_1` state containing the failed phase, rejection reason, prior SPLIT decision, and failure count. The node returns to `pending` with `reconsider_decomposition=true`.

The subsequent route remains agent-owned. The bound agent may choose a new SPLIT strategy, another available action, or REMEDIATE when it independently diagnoses a recoverable inconsistency. The runtime does not invent the replacement child.


## Dedicated atomic cognition budgets

Atomic execution and atomic reconciliation are substantive bound-agent cognition and MUST NOT reuse the small recursive routing budget.

The production failure that motivated this rule showed a nominally bounded atomic requirement receiving only 1,800 completion tokens while Thinking was enabled. In rejected attempts, most or nearly all of that allowance was consumed by reasoning tokens, leaving insufficient visible output and causing `finish_reason=length`.

The runtime therefore provides separate deep budgets:
- atomic execution: 7,000 completion tokens,
- atomic reconciliation: 5,000 completion tokens.

These budgets do not change whether a requirement is semantically ATOMIC. The bound agent still decides that. They only prevent the control plane from starving a substantive cognition step of output capacity.

Truncated atomic responses remain rejected and durable; they are never accepted, continued from partial text, or sent for grading. A genuinely oversized requirement must still be reconsidered/decomposed by the bound agent rather than made correct by silently accepting truncation.


## Dedicated synthesis cognition budgets

Synthesis is substantive bound-agent cognition and MUST NOT reuse the small recursive routing budget.

The merge step now receives a 6,000-token deep completion budget and bounded retry. The final parent-closing synthesis receives a 7,000-token deep completion budget and bounded retry. Thinking remains enabled because both stages require semantic integration and, for final synthesis, a genuine COMPLETE versus BLOCKED judgment.

Each successful child merge remains checkpointed through the existing `synthesis_cursor` and `synthesis_accumulator`. If a later merge truncates or times out, a retry resumes at that unresolved merge rather than recomputing already persisted merges.

A truncated synthesis response remains rejected and durable. The runtime never accepts partial synthesis output, never invents the missing merge, and never changes the bound agent's COMPLETE/BLOCKED semantic decision.
