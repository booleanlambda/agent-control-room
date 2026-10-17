# Unseen self-authored Python benchmark (Kimi K2.6)

## Experimental question

Can a non-thinking model **design and implement algorithms**, rather than
select a precoded exact-answer tool, and have its code generalize to
**held-out** instances not revealed in the model conversation?

This test is deliberately separate from production Silas. It runs in a
disposable GitHub Actions job, not Render or Supabase. Live model
inference is bounded to 14 chat requests, no automatic retries, with
a ceiling of 56,000 provider-reported tokens and a 16-minute program
deadline. A one-shot GitHub Actions trigger is removed after
the single submission.

## Three domains, six instances

1. **Factory job/machine assignment:** machine eligibility, capacity
   limitations, per-job costs, machine activation fees, and costs for
   changing machines between consecutive jobs. Model must return minimum
   integer cost and a complete assignment.
2. **Directed route with constrained battery:** directed graph
   energy requirements, edge tolls, limited battery capacity, optional
   per-unit charging at several stations, terminal battery threshold.
   Model must return minimum monetary cost, a concrete node path, and
   per-node charging plan.
3. **Diophantine number theory:** nonnegative integer triples satisfying
   a linear equation, modular quadratic congruence, and total bound.
   Model must return count of feasible triples, minimum quadratic score,
   and lexicographically minimal optimizer.

For each domain a **visible** instance is supplied to Kimi. A
**different withheld** test of the same input schema is used as
generalization/anti-hardcoding evidence. The hidden input and both
oracle results are absent from all model prompts, and hidden test outputs
are withheld from tool feedback.

## Capability and threat boundaries

- The model controls whether to plan, write executable Python, revise
  once, or submit a final method/proof summary. No decomposition
  structure is supplied. The only calculation tool executes
  **model-authored** Python, rather than wrapping a preprogrammed
  optimization API.
- Python reads one JSON request from stdin and prints one JSON answer
  to stdout. Independent JavaScript oracles are used **after**
  execution to assess feasibility and optimality.
- Docker execution uses Python 3.12 Alpine; `--network none`, a
  read-only container filesystem, user ID 65534, all Linux capabilities
  dropped, no-new-privileges, strict memory/pid/CPU quotas, a maximum
  eight seconds per test, and exactly one read-only bind mount of the
  submitted Python file. No provider credentials or user
  filesystem data enters the sandbox.
- The model sees only the **public** Python result and validation.
  Its code is independently executed on the unseen input without
  any held-out-result feedback. An answer is counted correct only
  when both public and hidden results are numerically optimal and
  provide a valid witness.
- This does not formally verify arbitrary natural-language proof
  claims, detect every possible overfit, or establish general coding
  proficiency from three examples. A tool-assisted Python outcome
  is evidence of model-authored algorithm design, not wholly
  unaided mental arithmetic.

## Artifacts

- `unseen-python-benchmarks.mjs`: problem descriptions,
  public/hidden instances, independent oracles, validators.
- `unseen-python-benchmarks.test.mjs`: 13 deterministic tests.
- `unseen-python-sandbox.mjs`: ephemeral hermetic Python runner.
- `unseen-python-live.mjs`: bounded non-thinking Kimi client
  and failure/cognition attribution.
- `unseen-python-kimi-report.json` (GitHub Actions artifact):
  actual model tokens, calls, Kimi-authored code and plan, tool
  execution results and held-out grader judgments.

Production integration remains **BLOCKED** while the independent
`Systemic Runtime Tree CI` fails. No new production agent wake or
deployment is authorized by this benchmark.
