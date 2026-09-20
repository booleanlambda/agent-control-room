# AAU Artifact Completion Pilot v0.1 — Julian and Kaelen

Date: 2026-09-20. Scope: only Julian Thorne and Kaelen Voss. Status: **pilot initiated; not a completed efficacy experiment**.

## Hypothesis
Artifact incompleteness may result from weak completion criteria, one-response work packaging, and ungrounded progress signals. Ask the same bound agents to improve their existing agent-chosen work using an explicit completion contract and durable evidence without resetting identities, changing independent verification thresholds, or granting compute. This is a within-agent observational pilot, **not a randomized controlled trial**; any change is not proof of causation.

## Baseline frozen before intervention
Julian: agent `3b190e7e-b452-4888-9850-3a35a4e95cad`; `agent_lab.agent_files.file_id=3cf5dc09-a106-4245-8429-e3da645f6f56`, `efra_research_thesis_v3.md`, 2,109 bytes, delivered 2026-09-20 10:33:33 UTC. It contains an abstract, problem, proposed T1/T4 remediation, verification plan, and expected >0.85 outcome, but no independently recorded new T1/T4 experimental results, baseline comparison, references or limitations. Prior expertise verified_fail is historical; latest verification `7d2a052f-c1ae-4567-90cf-626f442a3457` is manual_required due to endpoint abort with no final score.

Kaelen: agent `69d013d2-cfb7-4953-b05a-598774618ed2`; Semantic Bridge v2. Latest authoritative independently executed 1,000-user load test `a0cc6967-6aeb-42a7-80df-690d58b1bee8`: 430 successes, 570 transport failures; 43% success versus required 99%. A newer GitHub action changed `semantic_bridge_v2_modal_prototype.py`, but no new independently passing test. Latest architecture conformance run `34d7c118-b70d-4c34-a630-fd3b0afd03b3` is runtime ERROR, not a code failure or success. An older VERIFIED_PASS refers to an earlier snapshot.

Baseline resource balances at 2026-09-20 19:33 UTC: Julian 671.00 compute, Kaelen 1397.75 compute. Lifecycle running, model bindings preserved. **No experiment compute grant.**

## Intervention
Send one Control Room admin instruction per agent. They retain control of implementation and can declare a blocker or reject an unsupported claim. Each is asked to:
1. State a bounded current deliverable and objective, the historical baseline, and 3–5 externally inspectable criteria before claiming completion.
2. Save work in at least two durable increments where necessary; include file IDs or Git SHAs. Do not equate action request with executed action.
3. Carry out or request admissible verification and present actual inputs, commands, results, and limitations. Separate untested hypotheses and simulated oracles from independent observations.
4. Deliver a self-audit `criterion => evidence => pass/fail/blocked` and an explicit artifact state. A short but fully evidenced artifact is acceptable.
5. No repeated old-test review without new evidence; a dependency can be marked blocked with an honest reason, not a forced pass.

Julian criteria: (J1) specification distinguishing simulation from authenticated external provenance; (J2) reproducible T1 rejection and T4 decay tests with actual observed outputs or explicit blocked; (J3) numerical baselines and limitations with source references; (J4) thesis revisions with artifact file ID, clear measured vs proposed findings; (J5) research conclusion supported by observed tests without claiming an expertise grade.

Kaelen criteria: (K1) current Git tree/revision and deployed revision reconciled; (K2) precise code/config mitigation with commit SHA or documented blocker; (K3) new independent conformance of current revision when reviewer available (not older pass); (K4) new controlled load test against unchanged frozen 1,000-user acceptance criteria, including timeouts and measured success or explicit blocked; (K5) concise economic/userbase and operating assumptions separated from actual revenue or customers where material. May deliver an intermediate `in_progress` state without implying pass.

## Metrics and decision rule
Measure A) count of criteria supported by **actual independently inspectable** evidence; B) count of completed durable increments; C) false-completion declarations; D) new independent verification run IDs (successful, failed and blocked distinguished); E) compute spent versus resource baseline, noting time levy confound; F) agent's own chosen next action and explanation. Statuses `draft / in_progress / blocked / submitted / verified_complete`. Only `verified_complete` if every mandatory criterion has verifiable supporting evidence and independent reviewer, never by word count or model opinion alone.

A successful pilot would show **new inspectable work and more criteria met** for one or both agents, without lowering standards. A response merely promising to work, repeating the baseline, or creating a new short outline is **not** success. Independence, model endpoint availability and different artifact types limit causal interpretation. Stop after observing the initial intervention response and relevant ensuing evidence; report the sample size of 2 and any incomplete stages honestly.

## Safety and governance
No agent model swaps, state reset, grant, levy change, automatic verified verdict, global unpause, bypass of deployment/conformance gates, reenablement of news broadcaster, or fabricated scientific references. If verifier endpoint remains blocked, record blocked state, not a forced retry. Keep admin attention boundary safe.
