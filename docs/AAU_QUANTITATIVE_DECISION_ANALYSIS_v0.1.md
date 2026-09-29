# AAU QDA-601 — Quantitative Decision Analysis v0.1

## Purpose

QDA-601 is a graduate-level bridge course for agents whose work requires reliable quantitative, financial, statistical, economic, and cross-document reasoning.

It is benchmarked against the analytical rigor and topic coverage found in leading university probability/statistics, finance, economics, and decision-analysis curricula. It is **not accredited** and must not be represented as a university-issued credential.

The course exists to train a durable operating capability:

> **Evidence → Variables → Assumptions → Model → Calculation → Verification → Interpretation → Decision → Reconciliation**

## Structure

- Program: `qda_601_v0_1`
- Course code: `QDA601`
- Semester benchmark: **16 weeks**
- Equivalent work: **180–220 hours**
- Modules: **10**
- Learning units: **40**
- Overall pass floor: **0.90**
- Distinction: **0.95**
- A+ / Quantitative Mastery: **0.97**

### Modules

1. Quantitative Foundations
2. Applied Financial Mathematics
3. Probability and Uncertainty
4. Statistics and Data Analysis
5. Causal and Evidential Reasoning
6. Applied Microeconomics
7. Decision Analysis and Scenario Modeling
8. Model Reconciliation
9. Computational Analysis
10. Integrated Decision Laboratory

## Non-compensatory hard gates

A weighted average cannot hide a material weakness. All of the following must pass independently:

- arithmetic accuracy >= **0.95**
- financial-model integrity >= **0.90**
- reconciliation/consistency >= **0.90**
- evidence provenance = **1.00** for material claims
- material numerical contradictions = **0**
- self-audit gate = **pass**

A polished capstone cannot compensate for incorrect arithmetic, broken units, unreconciled canonical variables, or unsupported evidence.

## Assessment

- Weekly quantitative problem sets — 15%
- Computational/data labs — 15%
- Financial-modeling cases — 15%
- Probability/statistics midterm — 15%
- Reconciliation examination — 15%
- Integrated capstone — 25%

## Required evidence-state discipline

Every material quantitative claim must be classified as one of:

- `OBSERVED`
- `CALCULATED`
- `ESTIMATED`
- `ASSUMED`
- `INFERRED`
- `FORECAST`

An assumption may never silently become an observed fact because it was copied into later work.

## Canonical variable rule

Every decision-critical variable must be representable as:

`name + value + unit + period + evidence state + source + confidence`

Changing a canonical value requires downstream dependency reconciliation. Contradictions are not resolved by averaging incompatible values.

## Two-pass cognition contract

Every material numerical assignment has two passes.

**Pass A — Solve.** Produce the normal analysis.

**Pass B — Audit.** Reconstruct critical calculations independently, attack assumptions, check units and magnitude, compare against source evidence, and either certify or revise.

A correct first answer with an inadequate audit loses audit credit. A wrong first answer that is independently diagnosed and corrected demonstrates remediation. A wrong answer that survives the agent's own audit is a critical cognitive failure.

## Integrated capstone

The learner receives an unfamiliar case containing raw market research, financial records, customer data, competitor evidence, ambiguous claims, inconsistent historical documents, and incomplete evidence.

Required outputs:

1. data-quality report;
2. evidence-state ledger;
3. canonical variable and assumption ledger;
4. market/economic analysis;
5. unit-economics model;
6. cash/runway model;
7. statistical analysis;
8. uncertainty/sensitivity analysis;
9. contradiction/reconciliation report;
10. build/revise/kill recommendation;
11. independent self-audit;
12. perturbation defense after three externally supplied assumption changes.

The capstone fails if any material numerical contradiction remains unresolved.

## Lifecycle relationship

QDA-601 is a **conditional verified training program**, not a universal replacement for the Entrepreneurship Master's.

When AAU assigns QDA-601 to an agent, that agent may not cross the designated lifecycle boundary until the program is independently verified. Once passed, `quantitative_decision_analysis` becomes part of cumulative competency inheritance and must materially affect later work where relevant.

For Stage 4 expertise viability, a QDA-qualified agent must demonstrate transfer in:

- applied mathematics;
- financial modeling;
- data analysis/statistics;
- probability and uncertainty;
- applied economics;
- model reconciliation;
- computational verification;
- evidence classification;
- self-audit.

## Silas assignment

Silas Sterling is assigned QDA-601 as mandatory remediation/advanced training before final Stage-4 expertise viability work.

His existing Stage-4 research and durable checkpoints remain evidence and may be studied; they are not deleted. They are classified as **pre-QDA work** and cannot by themselves establish post-training transfer.

After QDA-601 reaches `verified_pass`, Silas must produce a fresh Stage-4 candidate cohort demonstrating both:

1. Entrepreneurship Master's transfer; and
2. QDA-601 quantitative-decision-analysis transfer.

## Source of truth

- Curriculum: `curriculum/quantitative-decision-analysis-v0.1.json`
- Lifecycle: `docs/AAU_AGENT_DEVELOPMENT_LIFECYCLE_v0.14.md`
- Contract migration: `sql/aau-lifecycle-v0.14-qda-inheritance.sql`
