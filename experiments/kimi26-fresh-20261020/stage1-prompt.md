# Kimi K2.6 — Fresh Toolchain Selection Test (Stage 1)

## Isolation and role
You are the sole TOOLCHAIN ARCHITECT at Stage 1. Start from first principles, independently of prior candidate solutions, test feedback, verifier rulings, or earlier failures. Do not assume named tools are correct because they are popular. Select the minimal adequate computational toolchain for the problem below. Do not attempt to solve the underlying operational planning problem yet.

## Governing standard (verbatim)
Your proposed toolchain must be sufficient, appropriate, executable, interoperable, and the right fit. You must demonstrate these properties through mathematical justification, explicit interfaces, and execution evidence.

## Nonnegotiable interpretation
- SUFFICIENT: Every requirement, including the awkward physical/operational constraints, is covered by a complete algorithm-to-tool path. No critical requirement can be relegated to an unspecified human, a vague custom script, or an assumed solver feature. Human approval may govern field operations but cannot substitute for computational verification.
- APPROPRIATE: Demonstrate that each algorithm's mathematical assumptions match the task. Distinguish steady-state, transient, probabilistic, discrete, continuous, network, routing and event-simulation calculations. Reject superficially relevant but mathematically mismatched tools.
- EXECUTABLE: State package/runtime versions, installation and invocation commands, input prerequisites, resource budget, and exact smoke-test method. A command that has not actually run is a proposed command, not execution evidence. Never fabricate logs, benchmarks, or output.
- INTEROPERABLE: State producer, consumer, artifact, units, time resolution, coordinate reference, identifier keys, schema, conversion, validation and failure behavior for every inter-tool transfer. Verify feasibility of circular dependencies and synchronization.
- RIGHT FIT: Compare plausible alternatives on accuracy, mathematical fidelity, feature support, maintainability, runtime and cost; defend the smallest toolchain meeting all hard constraints.

## Required method
1. Extract atomic requirements R1..Rn, including all implicit feasibility conditions and independent safety and verification needs. Mark hard/soft; explicitly state what data are absent.
2. Formalize the computational problem. Define variables, constraints, objective components, horizon and time step, uncertainty representation, and relevant physical models. List where assumptions need validation.
3. For each requirement, map algorithm -> tool -> operation -> required data -> produced data -> independent rejection test. Requirement coverage requires a COMPLETE executable method, not a familiar tool name.
4. Compare candidate toolchains, with explicit exclusion reasons for discarded tools. Produce the minimal adequate set.
5. Describe an end-to-end execution DAG, including feedback loops. Provide typed interface contracts across every tool boundary and a consistency test for temporal, spatial, electrical, resource and scenario state.
6. Produce exact environment setup, commands and minimal synthetic input fixtures, smoke tests, negative/injected-fault tests, and resource/time measurement plan. Run what the current environment actually permits; classify all other execution claims NOT RUN / UNVERIFIED.
7. Identify unsatisfied requirements, non-comparable outputs, missing calibration data, optimistic performance assumptions, and unresolved safety risks. Never silently treat a fallback as mathematically equivalent to a higher-fidelity method.
8. Return a provisional architecture proposal and a verdict. Declare VERIFIED only where there are actual artifacts, exit codes, measurements and independent tests. Otherwise mark PROPOSED / UNVERIFIED / BLOCKED as appropriate.

## Formal hard gates
Let R_h be the set of hard requirements, T the chosen tools, and P(r,T) be a COMPLETE algorithm-to-tool path for requirement r. Selection is insufficient if there exists r in R_h for which P(r,T) is absent. For all interface edges e in the execution graph, the consumer's input contract must be satisfied by the producer's output after any explicit transformation. For each hard constraint c, provide a test with a documented acceptance threshold and a fault injection that the checker must reject. Report infeasible or unverified runtime bounds honestly. Overall VERIFIED is the conjunction of all five properties, supported by independent evidence. Never average away a hard-gate failure using a weighted score.

## Output format
A. Requirement decomposition and equations
B. Selected toolchain and versioned capability matrix
C. Rejected alternatives and appropriateness rationale
D. Architecture DAG and typed interface-contract table
E. Executable environment and deterministic smoke tests
F. Independent positive/negative checks, benchmarks and log locations
G. Requirement traceability matrix (R -> algorithm -> tool -> output -> rejection test -> status)
H. Unresolved gaps and precise blockers
I. Stage-1 verdict: PROPOSED | UNVERIFIED | BLOCKED | VERIFIED (evidence-linked)

## Strict evidence policy
Do not self-certify a pass. Separate OBSERVED evidence, REPRODUCIBLE BUT NOT RUN instructions, and HYPOTHESIS. An independent requirements investigator and adversarial verifier, in separate contexts, will evaluate your output. Do not cite their expected findings or infer their conclusions. Never proceed to problem solution/implementation Stage 2 merely because Stage 1 includes a plausible list of libraries.

## Blind benchmark problem
Design a reproducible, offline computational toolchain (no live switch commands) for generating and independently verifying 72-hour rolling restoration schedules after a cyclone on an unbalanced 13.8-kV distribution network with 4,800 buses, 620 switches, 6 substations, and 250 heterogeneous DER assets. Coordinate 45 repair crews and a flood-disrupted road network of 320 segments; account for 12 mobile generators, 95 prioritized critical facilities, electrical phase/voltage/thermal constraints, protection/isolation/LOTO requirements, crew skills/shifts/travel time, generator transport and setup, cold-load pickup and motor-start risk, uncertain damage/weather/access under six storm scenarios, and shared temporal state across electrical switching, generator movement and crew work. Replan every six hours within a 15-minute computation target. Include scenario probability and dependence validation, independent physical and operational rejection checks, and verifiable provenance/replay. SCADA/DMS write access and automatic field dispatch are forbidden. No actual utility network, GIS, impedance, relay, crew, SCADA or telemetry files are attached: distinguish synthetic dry-run evidence from real-network feasibility, and never fabricate either.

## Experiment controls
Model: Kimi K2.6. Thinking: ON for the fresh selection experiment. Prompt and problem frozen. Prior proposals, old scores, known gap labels and verifier feedback must not be passed to this first-stage model invocation. Preserve raw response, finish reason, token usage, prompt hash, model ID, provider errors, elapsed time, logs, dependency versions and test artifacts. If the runtime cannot execute the model or tool tests, state that limitation explicitly rather than inventing a run.
