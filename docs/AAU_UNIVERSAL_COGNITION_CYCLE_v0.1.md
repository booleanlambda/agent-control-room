# AAU Universal Cognition Cycle v0.1

Effective scope: all AAU agents using the core NVIDIA intent-execution worker; expertise candidate answers additionally inherit the completion gate.

## Contract

For substantial or multi-step work:

1. **Thinking ON.** Deep cognition uses the agent's existing bound model with thinking enabled. No model swap is introduced.
2. **Immutable task charter.** Freeze the goal, authoritative inputs, mandatory constraints, acceptance criteria, and forbidden relaxations before solving.
3. **Bounded decomposition.** The model creates 2–8 bounded steps by default (runtime accepts up to 12). Each step is solved independently and persisted before another step may rely on it.
4. **Durable step checkpoints.** Completed plan, bounded steps, and synthesis are saved in `agent_lab.cognition_step_checkpoints`, keyed by agent, stable assignment key, step, and bound model.
5. **Strict completion gate.** A generation is complete only when the provider reports `finish_reason="stop"` and returns non-empty content. Truncation, timeout, empty output, malformed JSON, or other incomplete output is rejected.
6. **Rejected Attempt Evidence.** Rejections are recorded in `agent_lab.cognition_rejected_attempts` as metadata/hashes only. Hidden reasoning and rejected raw content are not stored. Every rejection is `NOT_ELIGIBLE_FOR_CONTINUATION`.
7. **Retry by bounding, not budget inflation.** A bounded step may be retried from scratch with a stricter scope/completion instruction without increasing the existing output budget. Partial text is never continued as if complete.
8. **Final reconciliation.** Completed steps are reconciled against the original charter, constraints, arithmetic/units, and unresolved issues. If all options fail a mandatory constraint, the agent must report no feasible option rather than select a least-worst option.
9. **Adversarial review.** A separate complete critic pass may correct the synthesis. If the critic itself is rejected, the already completed synthesis remains authoritative; rejected critic text never replaces it.
10. **Grading boundary.** Expertise candidate responses must pass the same completion gate before reaching the authenticator. Authenticator/adjudicator responses must also finish with `stop` before a grade can be parsed.

Routine low-complexity wakes may remain in fast structured mode, but their model output is still subject to the universal completion gate. Complexity signals and high-rigor lifecycle stages route into the bounded deep cycle.

## Integrity properties

- Model binding is preserved.
- Agent lifecycle, grades, resources and credentials are not changed by this protocol itself.
- A completed checkpoint is hash-verified before reuse.
- Legacy deep checkpoints are not reused as universal-cycle evidence unless their metadata declares `universal_cognition_cycle_v0_1`.
- The existing 24-hour deep checkpoint overwrite guard remains for universal checkpoints; legacy contracts may be superseded immediately during migration.
