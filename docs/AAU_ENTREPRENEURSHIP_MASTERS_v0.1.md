# AAU Entrepreneurship Master's-equivalent Program v0.1

## Purpose

Stage 3 of AAU Agent Development Lifecycle v0.12 teaches business and entrepreneurship competence **before expertise selection**.

The program is designed to target rigorous graduate-level demonstrated competence. It is not accredited, is not a university degree, and must not be represented as Harvard, Stanford, Wharton, Ivy League, or other institutional certification.

## Benchmark design

The curriculum design uses current top-business-school structures as reference points:

- Harvard Business School: broad required management curriculum spanning finance, financial reporting, leadership, marketing, strategy, operations, data/AI, accountability, and The Entrepreneurial Manager.
- Wharton: cross-functional MBA core followed by major/elective specialization; Entrepreneurship & Innovation includes foundational entrepreneurship plus venture finance, entrepreneurial accounting/marketing, business model innovation, scaling, product and related electives.
- Stanford GSB: analytical, leadership, and management foundations plus extensive entrepreneurship offerings and experiential venture design/testing through Startup Garage.

AAU does not reproduce those institutions' proprietary courses or claim their accreditation. The benchmark is the breadth, analytical rigor, integration, and applied nature of graduate business education.

## Program structure

- Program: `entrepreneurship_masters_v0_1`
- Courses: **15**
- Learning units: **60**
- Units per course: **4**
- Course mastery floor: **0.80**
- Capstone floor: **0.85**
- Independent final assessments: **2**
- Independent final floor: **0.85**
- Overall program floor: **0.85**
- Accreditation claim: **false**

### Courses

1. ACC501 — Financial Accounting and Reporting
2. FIN502 — Corporate Finance and Capital Allocation
3. ECO503 — Managerial Economics and Market Structure
4. MKT504 — Marketing, Customer Discovery and Sales
5. OPS505 — Operations and Supply Chain
6. ORG506 — Organizational Behavior and Leadership
7. STR507 — Strategy and Competitive Analysis
8. LAW508 — Business Law, Ethics and Governance
9. DAT509 — Data Analysis and Managerial Decision Making
10. ENT510 — Entrepreneurship Opportunity Identification
11. BMD511 — Business Model Design and Validation
12. VFN512 — Venture Finance, Bootstrapping and Fundraising
13. PRI513 — Pricing, Unit Economics and Cash Flow
14. GTM514 — Go-to-Market, Product-Market Fit and Growth
15. CAP515 — Entrepreneurial Execution Capstone

Every course contains four sequenced units mixing foundation, quantitative work, cases, or applied decisions. The capstone contains four integrated venture-execution stages.

## Learning contract

The lifecycle exposes only the current unit. The learner must submit a structured association:

`origin = entrepreneurship_unit_submission_v0_1`

with the exact `unit_id`, `course_code`, and a `submission` object containing:

- analysis
- assumptions
- conclusion
- self_critique
- evidence

Narrative confidence is not evidence. Current external claims require research and source provenance. Quantitative units require explicit quantitative work.

## Independent grading

The learner never grades itself.

After all four units of a course are submitted, AAU queues an independent course assessment. The institutional assessment worker uses a reviewer model separate from the bound learner model.

Current reviewer order:
1. `moonshotai/kimi-k3`
2. `meta/llama-3.1-70b-instruct`
3. `nvidia/nemotron-3.5-lightning-30b-a3b`

The grader evaluates conceptual accuracy, quantitative/analytical rigor, applied decision quality, evidence discipline, and calibration. Critical failures include fabricated evidence, materially unsafe/illegal advice treated as acceptable, or fundamental contradictions that invalidate the decision.

A passed course marks its four units as independently verified.

## Capstone

CAP515 requires the learner to integrate the program into one venture case:

1. Venture thesis, customer/problem evidence, and kill criteria
2. Business model, pricing, unit economics, 18-month cash model, and financing plan
3. GTM, operations, governance, legal assumptions, risk register, and stress tests
4. Board-style defense followed by an explicit **build / revise / kill** decision

The capstone must independently score at least 0.85.

## Final verification

Two independent final assessments review the complete program evidence. They must use distinct assessor identities.

The final program score is:

- 60% — average of the first 14 independently passed courses
- 20% — capstone
- 20% — average of the two independent final assessments

The final AAU Entrepreneurship Master's-equivalent is recorded only when durable runtime evidence establishes:

- all 15 courses passed
- first 14 course average >= 0.80
- capstone >= 0.85
- two independent final assessments >= 0.85
- weighted overall score >= 0.85

The old practice of accepting a summary JSON claim such as `core_curriculum_passed=true` is no longer sufficient.

## Relationship to expertise selection

Completion of this program unlocks Stage 4. Only then does the agent research expertise opportunities, submit the four viability candidates, receive operator eligibility review, and independently choose among approved candidates.

The program teaches the agent how to evaluate demand, customers, pricing, unit economics, capital requirements, operating costs, competitive advantage, risk, and sustainable value creation before committing to a specialization.

## Source of truth

- Curriculum: `curriculum/entrepreneurship-masters-v0.1.json`
- Runtime migration: `sql/aau-entrepreneurship-masters-v0.1-runtime.sql`
- Seed generator: `scripts/generate-entrepreneurship-masters-seed.mjs`
- Independent grader: `workers/entrepreneurship-assessment-worker.js`
- Lifecycle: `docs/AAU_AGENT_DEVELOPMENT_LIFECYCLE_v0.12.md`
