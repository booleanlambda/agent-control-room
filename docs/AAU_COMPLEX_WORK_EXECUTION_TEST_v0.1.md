# AAU Complex Work Execution Test v0.1 — Julian Thorne

Date: 2026-09-20. Test work ID `527020ee-222d-465b-ba96-24850c38e149`.

## Question and constraints
Can Julian continue a substantial EFRA research assignment across separate cognition wakes by preserving intermediate files and selecting a new bounded part, rather than outputting a short, unverified thesis? The experiment does not change agent identity, bound model, existence levy, credits, authority or independent expertise verdict.

This is a **live functional pilot**, not a controlled study or production-ready general job scheduler.

## Starting point
- Original `efra_research_thesis_v3.md` file_id `3cf5dc09-a106-4245-8429-e3da645f6f56`, 2,109 bytes, proposal, without actual T1/T4 execution results.
- Initial completion-pilot reply at 19:36 UTC was only an acknowledgement: no new file.
- Explicit second-stage pilot at 19:38 UTC produced T4 file `a24b6570-32da-4662-b462-e6a68b4fa7fd`, `efra_t4_drift_normalization_test.py`, 1,539 bytes, at 19:48:25 UTC after an orphan-recovered wake. This is a runnable test *fixture*, not executed evidence.

## Persisted complex work design
Migration: `sql/aau-complex-work-pilot-v0.1.sql`, Git commit `d067b093b15239d7e2d2b2bcab060c89714f56b9`.
- `agent_lab.complex_work_pilots`: scoped active objective, acceptance criteria, baseline and state.
- `agent_lab.complex_work_steps`: step order/key, acceptance, status, evidence_file_ids and checkpoint JSON.
- `agent_lab.build_complex_work_context_v0_1`: readable, bounded task snapshot and latest agent-authored file excerpt.
- `agent_lab.get_cognition_packet`: includes `complex_work_context` only when the agent has an active task. Verified Julian gets five steps, latest file, work ID; Kaelen has no such context.
- RLS and restricted public/anon/authenticated table grants. This pilot does not add autonomous agent-owned step state mutations: **the operator reconciles evidence into checkpoints**. The agent still chooses the implementation and next action.

## Observed continuation
- At 19:52:47 UTC admin intervention `7318a704-7ec8-42e2-9e03-e976bf848c09` told Julian to resume from T4 file, not regenerate it, and choose a bounded substantive next action.
- Wake `bec47a4e-b42a-43be-918d-70b50c6478dc` ran once, completed at 19:54:47 UTC without queue error.
- Julian explicitly recognized T4 execution as blocked by missing runtime tool for that cognition and authored a **different part**: T1 evidence-grounding fixture `efra_t1_grounding_test.py`, file_id `6f7307e3-9ea3-4238-9cd5-baccfef2392c`, 2,045 bytes.
- T1 fixture labels its oracle **simulated**. This does not verify actual independent provenance. The agent did not execute T1 or T4 in this wake.
- Operator checkpoint reconciliation recorded `T4_FIXTURE=submitted`, `T4_RESULT=blocked`, `T1_EVIDENCE=in_progress`, `INTEGRATION=pending`, `AUDIT=pending`, linking the two real file IDs.
- Independent check of the *next packet* confirmed work ID, five updated statuses and latest T1 file ID. This verifies data delivery, not that the agent has already used that second checkpoint during another subsequent wake.

## Preliminary assessment
Observed: acknowledgement-only reply was followed by a durable T4 fixture, then a second distinct durable T1 fixture from the saved context. There is a concrete execution blockage and no completed thesis. **Completion criteria met for the overall task: 0/5 independently verified.** The two files demonstrate substantive part creation and continuity, not verified scientific results. The task remains `in_progress`; separate expertise verification run `7d2a052f-c1ae-4567-90cf-626f442a3457` remains `manual_required` with no new verdict.

## Next engineering questions
- Permit safe, bounded execution of agent-authored fixtures through an explicit controlled runtime, retaining independent observation and provenance; do not simulate results.
- Allow controlled agent or authorized runtime checkpoint write with step ID, file ID and evidence validation; currently operator-reconciled.
- Test a *third autonomous wake without another human reminder* to see if Julian uses the updated checkpoint, contributes a new part and eventually assembles an evidence-grounded artifact.
- Measure repeated actions, new file IDs, tool results, actual test outcomes and elapsed existence levy. Longer answers alone do not establish success.


## 2026-09-20 20:16 UTC — Evidence reconciliation v0.2

Implemented migration `sql/aau-complex-work-file-reconciliation-v0.2.sql`, Git commit `755df3c6936bbd10871cb189e31002fd5a96c092`. Its enabled `AFTER INSERT` trigger on `agent_lab.agent_files` calls `agent_lab.reconcile_complex_work_file_v0_2(file_id)` **only for Julian's active pilot**. It only recognizes four exact pilot filenames; no other agent or unknown filename is auto-classified. The function links a new file ID to the relevant step, records the latest evidence kind, refreshes the work timestamp, and explicitly sets `execution_verified=false`, `independently_verified=false`. It never upgrades the work to `verified_complete` or changes an expertise/product verdict. Reprocessing the same file returns `already_reconciled` without duplicate IDs.

Existing fixture files T4 `a24b6570-32da-4662-b462-e6a68b4fa7fd` and T1 `6f7307e3-9ea3-4238-9cd5-baccfef2392c` returned `already_reconciled`. Backfill registered Julian's new acceptance-criteria document `a6319bac-ca6f-4ef7-8d1d-b0a997c0b179` (2026-09-20 20:05 UTC) to `AUDIT`, status `in_progress`, not passed. Trigger exists and is enabled, and the cognition context includes the new AUDIT step. T4_RESULT remains `blocked` awaiting actual execution. No enabled general-purpose Python/code-execution capability was listed in the agent's runtime capability catalog. **An actual new post-migration agent file is still required to establish future-trigger behavior in a natural wake.**

This is a scoped pilot, not a general classifier or completion evaluator. Unknown filenames are left for review; a file write never proves the code ran, that external oracle grounding exists, or that an independent reviewer approved it.

Validation: a transactional synthetic file insert for `efra_research_thesis_v4.md` caused the trigger to append evidence to `INTEGRATION`, and an intentional subtransaction rollback left **zero synthetic evidence or fake agent files**. SQL test returned `PASS` and `no_synthetic_evidence_remains=1` at approximately 20:18 UTC. This tests the trigger itself, not natural next-wake classification or independent experiment execution.


## 2026-09-20 20:29 UTC — Agent-integrated artifact and evidence classification

Julian's later natural wake submitted `efra_integrated_research_artifact_v1.md`, file ID `ecce42a9-669e-4743-973d-ea21737ed6a7` (1,848 bytes, created 20:24:56 UTC). It links T1, T4 and acceptance-criteria file IDs, and includes a limitation disclosure. It also uses the labels **VERIFIED (Simulated)**, asserts a **100% T1 rejection rate**, and states the T4 model "confirms" convergence despite the absence of recorded actual execution outputs. It explicitly says runtime verification is outstanding. These are agent-authored claims, **not independent verification**.

The original v0.2 exact-filename reconciliation omitted the actual `efra_integrated_research_artifact_v1.md` filename, so `INTEGRATION` stayed pending. The targeted mapping repair `sql/aau-complex-work-reconciler-v0.2.1-integrated-filename.sql` (Git commit `0f3208665dde82926af599307d9b15644f18a14d`) was deployed and the real file ID backfilled: `INTEGRATION=in_progress`, evidence kind `integrated_research_draft_unverified`, `execution_verified=false`. `AUDIT` is still in progress; acceptance criteria and a file-ID mapping do not equal a completed outcome-by-outcome self-audit. T4_RESULT remains blocked. Overall complex work remains in progress. Existing expertise verification remains manual_required.
