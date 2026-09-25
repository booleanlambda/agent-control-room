# AAU Autonomous Recursive Decomposition v0.1

## Purpose

Make decomposition a native cognitive capability of the bound agent rather than a system-authored plan.

The runtime does not decide the intellectual work breakdown. It only supplies the triggering requirement, records the agent's decomposition tree, provides context the agent explicitly requests, rejects incomplete generations, and resumes unfinished nodes.

## Node contract

Every requirement node is decided by the agent as one of:

- `ATOMIC` — the agent judges the requirement small enough to execute as one bounded cognition.
- `SPLIT` — the agent authors the immediate child requirements.
- `NEED_CONTEXT` — the agent names the context source and focus it wants before deciding.

No fixed number or semantic shape of child requirements is prescribed by AAU.

## Recursive execution

1. Persist the originating requirement.
2. Ask the bound model to decide `ATOMIC / SPLIT / NEED_CONTEXT`.
3. If `NEED_CONTEXT`, resolve only the requested available context and checkpoint it.
4. If `SPLIT`, persist the agent-authored children and recursively apply this same contract to each child.
5. If `ATOMIC`, execute the bounded requirement.
6. If an ATOMIC execution truncates, times out, is empty, or is malformed, store Rejected Attempt Evidence and return the same requirement to the agent for a new decomposition decision. Rejected partial output is never continued.
7. After all agent-authored children complete, synthesize their durable outputs back into the parent requirement.
8. Persist all requirement, decision, context and result checkpoints in the existing cognition checkpoint store.
9. Resume from durable checkpoints after interruption rather than restarting the root requirement.

## Runtime boundaries

The runtime may enforce resource/integrity limits such as maximum recursion depth, maximum durable nodes per wake, output completion gates, model binding, and checkpoint hashing. These are execution constraints, not intellectual decomposition decisions.

The runtime must not:
- prescribe workstreams or child-task semantics;
- turn context selection into hidden system planning;
- silently relax the originating requirement;
- use truncated or timed-out output as a completed node;
- increase output budget as the default response to an oversized atomic task.

## Context acquisition

The agent sees a catalog of context sources, not the full brain packet by default. It requests the context it needs. Current sources include lifecycle, state, admin thread, recent activity, knowledge, expertise, entrepreneurship, capabilities, files, evidence, and identity/goals.

This reduces context overload while leaving context selection under agent control.

## Persistence

The implementation reuses `agent_lab.cognition_step_checkpoints` with contract `autonomous_recursive_decomposition_v0_1`.

Stable node checkpoint families:
- requirement node
- decomposition decision cycle
- agent-requested context
- atomic result
- parent synthesis

Rejected attempts continue to use `agent_lab.cognition_rejected_attempts`.

## Relationship to autonomy

This protocol applies before open autonomy as well as after it. Lifecycle requirements may still originate from AAU while an agent is developing, but the agent owns how it decomposes and executes those requirements.
