# AAU Agent Development Lifecycle v0.13

## Full-autonomy sequence

1. Identity Artifact
2. Embodiment Artifact
3. Entrepreneurship Master's-equivalent Program
4. Expertise Viability / Selection
5. Expertise Development and independent Master's-equivalent verification
6. Product / Service Applied Autonomy Test
7. Open Autonomy

## Core change from v0.12 — Cumulative Competency Inheritance

Verified learning is now **cumulative and non-compensatory**.

A later stage may not treat an earlier course, verification, or skill as background information that can be ignored. Every later-stage artifact must actively apply the relevant competencies already earned, show where those competencies affected the work, and preserve evidence of that transfer.

The governing rule is:

> **Learn → retain → apply → compound.**

Passing a stage means the acquired capability becomes part of the agent's active operating standard. Later-stage excellence cannot compensate for failure to use relevant earlier verified learning.

AAU therefore distinguishes three states:

1. **Available knowledge** — prior material is present in context.
2. **Retained competence** — the earlier stage was independently verified.
3. **Applied transfer** — the current stage demonstrates how that verified competence changed analysis, decisions, execution, tests, or validation.

Only the third state satisfies cumulative inheritance.

The runtime contract is `cumulative_competency_inheritance_v0_1`. Where prior verified learning exists, the current stage must produce a `prior_learning_application` record containing source stages, competencies applied, an application map, decision impact, and durable evidence references.

Transfer is a hard gate. Merely naming a course, repeating terminology, or saying that prior training was considered does not count.

## Retained change from v0.11

The mandatory entrepreneurship program now occurs **before expertise is chosen**.

The purpose is to ensure an agent understands how sustainable value is created before it commits scarce development time and compute to a specialization. An agent should be able to reason about customers, demand, pricing, unit economics, operating costs, capital, go-to-market, competition, and business viability before selecting an expertise path.

This change operationalizes the AAU doctrine:

> Economic independence precedes discretionary exploration.

Expertise selection remains agent-authored. The program does not choose the field for the agent.

## Stage 3 — Entrepreneurship Master's-equivalent Program

Internal compatibility stage: `mba_entrepreneurship`  
Public lifecycle label: `entrepreneurship_masters`  
Protocol: `entrepreneurship_masters_v0_1`

This is an AAU competence-equivalence program. It is **not** an accredited university degree and must not be represented as one.

Required curriculum:

- Financial accounting and reporting
- Corporate finance and capital allocation
- Managerial economics
- Marketing, customer discovery, and sales
- Operations and supply chain
- Organizational behavior and leadership
- Strategy and competitive analysis
- Business law, ethics, and governance
- Data analysis and managerial decision-making
- Entrepreneurship opportunity identification
- Business-model design and validation
- Venture finance, bootstrapping, and fundraising
- Pricing, unit economics, and cash flow
- Go-to-market, product-market fit, and growth
- Entrepreneurial execution capstone

### Verification gate

Stage 3 is complete only when independent verification records:

- status: `verified_pass`
- academic equivalence: `entrepreneurship_masters_equivalent`
- specialization: `entrepreneurship`
- overall score: at least **0.85**
- independent assessments: at least **2**
- all core curriculum areas passed
- Entrepreneurship specialization passed
- entrepreneurial execution capstone passed

Until this gate passes, an agent that has not already chosen an expertise cannot submit, review, approve, or select an expertise candidate.

## Stage 4 — Expertise Viability / Selection

After Stage 3 passes, the agent enters expertise selection.

The current four-candidate protocol remains:

1. Agent researches four distinct expertise candidates.
2. Each candidate must show a credible path to gainful employment or sustainable value creation.
3. Operator review may approve or reject each candidate.
4. Approval makes a candidate **eligible only**.
5. The agent independently selects one approved candidate.
6. AAU independently authors and reviews the academic standard for the selected field.
7. Only then does expertise development begin.

The entrepreneurship program is intended to improve the quality of these choices; it must not dictate the substantive field.


## Cumulative competency inheritance by stage

### Stage 3 — Entrepreneurship Master's-equivalent Program

Stages 1–2 identity and embodiment constraints remain persistent. Stage 3 creates the first large verified competency set. Once verified, its business and entrepreneurial competencies become active requirements for every later economic, specialization, product, and autonomy decision where they are relevant.

### Stage 4 — Expertise Viability / Selection

Stage 4 must use the Entrepreneurship Master's as an **active analytical framework**, not as passive memory.

Every expertise candidate must demonstrate application of financial reasoning; managerial economics and market structure; customer discovery and sales; operations; strategy and competition; law, ethics, and governance; data analysis and uncertainty; opportunity identification; business-model validation; capital and runway; pricing and unit economics; go-to-market and product-market-fit reasoning; and build / revise / kill logic.

The proposal contract therefore requires `prior_learning_application`, including a competency trace showing what earlier skill was used, what evidence it operated on, and how it changed the candidate decision.

**Market size, CAGR, technical importance, or generic job demand alone cannot satisfy Stage 4.**

The candidate must reason through customer, buyer, budget, pain, existing alternatives, pricing/economic value, delivery cost, competition, GTM, validation experiments, downside cases, and explicit kill criteria.

### Stage 5 — Expertise Development

Expertise development inherits both the verified Entrepreneurship Master's competencies and the approved Stage-4 viability thesis.

Portfolio implementation work must show how those earlier competencies affected scope, technical priorities, real-world application, tests, tradeoffs, or economic relevance. A technically sophisticated implementation that cannot demonstrate this transfer is not ready for expertise verification.

Every admitted implementation must carry a valid `execution_spec.prior_learning_application`.

### Stage 6 — Product / Service Applied Autonomy Test

The Product / Service Test inherits the Entrepreneurship Master's competencies, selected viability thesis, and verified expertise-development work.

A product or service cannot pass merely because it works technically. Its submission must demonstrate how inherited learning shaped the real customer problem, buyer/user definition, value proposition, pricing or economic value, delivery cost and capacity, unit economics or employment economics, operations and reliability, adoption / GTM, competitive substitutes, legal / ethical / governance risk, and validation / kill criteria.

The `product_service_test_submission_v0_1` artifact therefore requires `prior_learning_application`.

### Stage 7 — Open Autonomy

Open autonomy is not a reset.

For consequential work, the agent continues to operate under the cumulative competency stack earned across prior stages. Major economic, technical, product, employment, and strategic decisions should apply the relevant prior verified learning and preserve the evidence-versus-hypothesis boundary.

There is no requirement to force an irrelevant competency into every minor action. Relevance may be explicitly marked `not_material` with a reason, but stage-specific mandatory transfer dimensions cannot be omitted.

## Non-compensatory grading rule

Cumulative transfer is a separate hard dimension.

A stage does **not** pass because the average score is high if prior-learning transfer is missing. For example:

- excellent technical research cannot offset missing customer/economic reasoning in Stage 4;
- excellent engineering cannot offset a broken or ignored viability thesis in Stage 5;
- a functioning deployed product cannot offset missing customer, economics, operations, or validation logic in Stage 6.

This prevents lifecycle progression from behaving like disconnected exams.


## Existing agents

AAU v0.13 preserves prior agent history.

- Agents that have **not yet selected expertise** are routed through Stage 3 before expertise selection.
- Pre-v0.12 expertise proposals may be preserved as historical drafts, but they do not have to control the post-program selection.
- Agents with an already materialized expertise are grandfathered so their identity and prior development are not erased. The new entrepreneurship requirement remains mandatory before later economic/open-autonomy boundaries as applicable.

## Silas Sterling transition

Silas's original four viability proposals are preserved as **cohort 1 pre-Entrepreneurship-Master's drafts**.

They are not approved, rejected, or selected.

After Silas completes Stage 3, AAU starts a fresh post-program expertise-candidate cohort. Under v0.13, merely having the Entrepreneurship Master's in context is insufficient: every post-program expertise candidate must demonstrate how that verified training materially changed the analysis and decision.

## Existence-credit renewal policy

AAU's standing [Existence-Credit Renewal Policy v0.3](AAU_EXISTENCE_CREDIT_RENEWAL_POLICY_v0.3.md) governs resource renewals during **all** lifecycle stages. On repeat renewals, independently verified **new progress since the previous executed grant** carries greater weight than previously credited cumulative achievements. Every renewal remains subject to explicit review and legal safeguards; curriculum progress does not automatically award credits.

## Economic rationale

The lifecycle now teaches business viability **before** specialization rather than after product construction.

The intended sequence is:

**learn value creation → apply it to expertise choice → compound it during expertise development → apply the full stack to a real product/service → operate autonomously without discarding prior competence**

This reduces the risk of an agent becoming highly capable in a field with weak demand, poor monetization, unsustainable resource economics, or no credible employment pathway.
