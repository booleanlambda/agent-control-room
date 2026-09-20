# AAU manual expertise-verifier intervention · v0.1

**Trigger:** An NVIDIA authenticator/adjudicator timeout, an unusable model grade, or an expired verification lease reaches the bounded retry limit. AAU records `manual_required` and an `agent_lab.verification_intervention_alerts` row. This is **not** a competence failure or a verified result.

**Operator invocation:** The administrator sees the Control Room alert and calls ChatGPT with the exact verification run ID. This runbook is for an explicitly authorized operator action, not a scheduler. The Control Room has a read-only alert/evidence API; the private state-changing functions are not exposed to anon/authenticated.

## Read and choose a route

1. Inspect `select agent_lab.operator_verification_alerts_v0_1(25)`. Identify run ID, checkpoint stage, counts, and error.
2. Inspect `select agent_lab.operator_verification_evidence_v0_1('<RUN_ID>'::uuid)`. Require `frozen_hash_matches=true`; review exact saved tasks, saved candidate answers, existing authentication grades and adjudication grades. Do not claim a candidate result based on a narrative.
3. If the candidate answers are incomplete, **do not use the manual grading route**. An explicit operator-approved bound-candidate retry or infrastructure repair is needed.
4. If the candidate answers are complete, choose one of the two routes below. Never change the candidate's model, competence record, challenge, or answers to unblock verification.

### Route A · Authorized saved-stage worker retry

Call
`select agent_lab.operator_resume_expertise_verification_v0_1('<RUN_ID>'::uuid, '<OPERATOR_ID>', '<REASON>')`.

This atomically moves `manual_required` to `pending` after validating the frozen evidence. The existing worker reuses completed checkpoint fields, uses its approved model chain for unfinished grades, and computes the deterministic master gate. A renewed failure returns to `manual_required` immediately; it does not start another automatic loop.

### Route B · Model-assisted review in ChatGPT

Call
`select agent_lab.operator_begin_manual_grade_review_v0_1('<RUN_ID>'::uuid, '<OPERATOR_ID>', '<REASON>')`.

For each missing authenticator task, independently evaluate the **saved candidate answer** against the frozen task and its anchors. Record an evidence-supported, task-specific written justification. Score each numeric component in [0, 1]: execution, method, security, validation, communication. Supply critical, confidence [0, 1], unsupported, and the actual reviewer model identifier (different from the bound candidate model). Scores are computed by SQL using 30/20/20/15/15 weights. Record by:

```sql
select agent_lab.operator_submit_expertise_grade_v0_1(
  '<RUN_ID>'::uuid,
  '<OPERATOR_ID>',
  'authentication',
  'T2',
  '{"execution":0.8,"method":0.8,"security":0.8,"validation":0.8,"communication":0.8}'::jsonb,
  'none',0.8,false,
  '<ACTUAL_REVIEW_MODEL>',
  '<SUBSTANTIVE_EVIDENCE-BASED_JUSTIFICATION_AT_LEAST_60_CHARS>'
);
```

For a flagged authenticator grade (score 0.75–0.85 inclusive, critical error, unsupported claim, or confidence below 0.70), perform a **separate** adjudication using an independent model distinct from both the candidate and authenticator model, then submit with stage `adjudication`. Never overwrite an existing grade or adjudicate an unflagged task. A claimed model name is operator-attested, not cryptographically verified; do not invent model calls or grade evidence.

After all required grades exist:

`select agent_lab.operator_finalize_manual_grades_v0_1('<RUN_ID>'::uuid,'<OPERATOR_ID>')`.

This validates task coverage, saves provenance, and puts the run in `pending`. The verifier worker consumes those completed grades, computes the deterministic threshold, and calls the existing authorized completion endpoint. No NVIDIA model call is needed when all necessary grades are already saved.

## Guardrails and incident closure

- Only the operator may initiate the above transitions; never automatically invent grades.
- The original checkpoint hash must match at takeover. A separate candidate-evidence hash remains fixed during a manual review.
- SQL protects claim ownership, duplicate grade submissions, and duplicate manual triggers. Late workers cannot complete a run in `manual_required`.
- Final `verified_pass` or `verified_fail` requires the **existing deterministic** Master’s-equivalent gate. The final report marks `manual_review_used` and preserves the model identifiers of actual graders.
- The alert resolves on final completion. If unresolved, do not resume the agent as though the verdict passed.
- The legacy `failed` rows are retained historically; this version does not rewrite them into new alerts retroactively.
- The Control Room banner is an **in-app alert while open**, not a mobile push, email, or an automatic ChatGPT message.
