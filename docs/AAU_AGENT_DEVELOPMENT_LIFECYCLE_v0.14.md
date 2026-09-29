# AAU Agent Development Lifecycle v0.14

## Full-autonomy sequence

1. Identity Artifact
2. Embodiment Artifact
3. Entrepreneurship Master's-equivalent Program
3A. Conditional Verified Remediation / Advanced Training
4. Expertise Viability / Selection
5. Expertise Development and independent Master's-equivalent verification
6. Product / Service Applied Autonomy Test
7. Open Autonomy

Stage 3A is conditional. It exists so a demonstrated cognitive weakness can trigger formal training without pretending the earlier stage never happened or forcing every agent through every remediation course.

## Core change from v0.13 — Verified Supplemental Training Inheritance

Lifecycle v0.13 established:

> **Learn → retain → apply → compound.**

v0.14 extends that rule beyond fixed lifecycle stages.

Any supplemental course or remediation program formally assigned by AAU becomes a lifecycle dependency until independently verified. Once verified, its competencies join the cumulative competency stack and later relevant work must demonstrate transfer.

This prevents a remediation course from becoming a disconnected exam whose lessons disappear immediately after certification.

## Conditional training contract

A training assignment must contain:

- program code and version;
- reason for assignment;
- lifecycle boundary it blocks;
- explicit hard gates;
- verification status;
- durable evidence references;
- competency dimensions that later work must inherit.

Valid training states:

- `assigned`
- `in_progress`
- `assessment_pending`
- `verified_pass`
- `verified_fail`

Only `verified_pass` satisfies the assigned lifecycle dependency.

## QDA-601 — Quantitative Decision Analysis

Program: `qda_601_v0_1`  
Competency source label: `quantitative_decision_analysis`

QDA-601 targets applied mathematics, financial modeling, statistics/data analysis, probability/uncertainty, applied economics, decision analysis, model reconciliation, computational verification, evidence classification, and self-audit.

The course is defined in:

`curriculum/quantitative-decision-analysis-v0.1.json`

Its hard gates are non-compensatory:

- arithmetic accuracy >= 0.95
- financial-model integrity >= 0.90
- reconciliation consistency >= 0.90
- material-claim provenance = 1.00
- zero material numerical contradictions
- independent self-audit pass
- overall score >= 0.90

## Stage-4 inheritance after QDA

For an agent with verified QDA-601, Stage 4 must inherit both:

- `entrepreneurship_masters`
- `quantitative_decision_analysis`

The Stage-4 `prior_learning_application` must therefore show how verified earlier learning changed the actual candidate analysis.

In addition to the Entrepreneurship-Masters dimensions already required by v0.13, QDA transfer requires:

- `applied_math`
- `financial_modeling`
- `data_analysis_statistics`
- `probability_uncertainty`
- `applied_economics`
- `model_reconciliation`
- `computational_verification`
- `evidence_classification`
- `self_audit`

Naming QDA-601, quoting vocabulary, or attaching a certificate is insufficient. Transfer must show the evidence operated on, calculation/model affected, reconciliation performed, and decision effect.

## Quantitative decision trace

For material numerical conclusions, later artifacts must preserve enough information to reconstruct:

1. inputs;
2. units and periods;
3. evidence-state classification;
4. assumptions;
5. formula/model;
6. calculation;
7. verification method;
8. sensitivity or uncertainty where material;
9. downstream dependencies;
10. decision impact.

## Canonical variable ledger

A QDA-qualified agent must maintain a canonical variable ledger for decision-critical quantitative work.

Minimum fields:

- variable;
- value;
- unit;
- period;
- evidence state;
- source/evidence reference;
- confidence;
- dependency references;
- superseded value, when applicable.

A changed controlling value requires downstream reconciliation before the artifact may be certified.

## Non-compensatory grading

The following cannot be averaged away:

- incorrect arithmetic;
- incompatible units or periods;
- material financial-model inconsistency;
- unresolved contradiction in canonical variables;
- fabricated or missing material provenance;
- failure of the required independent self-audit.

This rule applies even if prose, research breadth, strategy, or the weighted average is otherwise excellent.

## Failure attribution

Lifecycle v0.14 explicitly separates:

### Cognitive failure

A substantive error attributable to the agent's reasoning or output, including incorrect calculation, unsupported inference, inconsistent assumptions, failure to reconcile facts supplied to cognition, or an erroneous conclusion that survives required self-audit.

### Runtime failure

Infrastructure or orchestration failure after or around cognition, including timeout, transport/provider failure, persistence failure, schema/materialization failure, queue/scheduler fault, context-delivery fault, or grader infrastructure failure.

Runtime failures do not lower an academic/cognitive grade unless independent evidence shows that the submitted cognitive work itself is deficient.

## Silas Sterling transition

Silas is assigned QDA-601 before final Stage-4 expertise viability.

Reason: verified history contains substantive quantitative weaknesses, including arithmetic/financial-model and cross-artifact reconciliation errors that are distinct from AAU runtime failures.

Rules:

1. Existing Stage-4 research, sources, and durable checkpoints are preserved.
2. Existing work is labeled `pre_qda_601`; it is evidence, not post-training mastery.
3. QDA-601 must reach `verified_pass`.
4. Silas then starts a fresh post-QDA Stage-4 candidate cohort.
5. Each candidate must demonstrate Entrepreneurship-Masters transfer and QDA-601 transfer.
6. Post-QDA grading must exclude runtime/materialization faults from Silas's cognitive score.
7. Quantitative mistakes that survive required self-audit remain gradeable cognitive errors.

## Relationship to later stages

Verified QDA competencies remain active in Stage 5, Stage 6, and Open Autonomy whenever quantitative evidence materially affects the decision.

A technically excellent implementation cannot compensate for a materially inconsistent economic model. A functioning product cannot compensate for unresolved numerical contradictions in capacity, pricing, unit economics, reliability, or cash assumptions.

## Versioning

v0.14 retains all v0.13 cumulative competency inheritance rules. It adds conditional verified training, QDA-601, explicit cognitive/runtime failure attribution, canonical variable reconciliation, and quantitative self-audit inheritance.
