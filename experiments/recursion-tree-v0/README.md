# AAU isolated recursive tree experiment v0

**Scope:** independent lab only. No writes to Supabase, AAU intent tables, agent state, existence levy, queue, or production workers. Does not resume Silas.

## Question

Can a lightweight LLM author a real recursive work tree while deterministic infrastructure (rather than another LLM) verifies tree topology and terminal classification? Do provider errors, malformed responses, and exhausted budgets change only the **execution attempt ledger**, without creating fake semantic child nodes or unlimited epochs?

## Model / phases

- Live model: `nvidia/nemotron-3.5-lightning-30b-a3b`, approximately 3B active MoE parameters, NVIDIA endpoint, thinking disabled.
- Phase 1: **4 incidents, root plus at most 2 atomic leaves, max depth 1, 9,000 token-equivalent budget**. No more than 6 model calls, 650 output tokens per call, 2 attempts per node.
- Phase 2 (prepared, not automatically invoked live): 8 incidents, depth 2, 15,000 token-equivalent units, 12 calls.
- Phase 3 (prepared, not automatically invoked live): 16 incidents, depth 3, 30,000 token-equivalent units, 24 calls.

Production model, Silas's current epoch and AAU existence levy **remain untouched**.

## Empirical baseline

Live AAU wake_queue: most recent 100 Silas Sterling completed/failed wakes: 37 completed, 63 failed. Among failed: 29 budget/cycle, 22 other, 7 provider/timeout, 4 evidence/schema, 1 scheduler/lease (message-based classification). Cancelled wakes excluded. These are **wake outcomes**, not an intrinsic model accuracy metric and not an unbiased estimate of independent node failure probabilities.

Use that exact histogram for 100 **synthetic fault injection** episodes in a deterministic scenario, not a future performance prediction. Fault mode uses explicit assumptions: one provider fault may recover on next attempt; stale wake causes no mutation; exhausted budget never auto-renews; persistent schema/protocol failures remain blocked; labels are checked by fixed deterministic reference truth. Report predicted outcomes only as *simulation conditional on those assumptions*. Treat provider token and latency measurements separately from this model.

## Decisions and deterministic authenticator

The lightweight model chooses:
- `SPLIT`: exactly two nonempty, non-overlapping, strictly smaller child ID sets that cover the parent exactly; only if above terminal cardinality and below depth ceiling.
- `ATOMIC`: return one classification per expected ID.

The deterministic authenticator verifies the tree structure and the fixed known answers for diagnostic fixtures. It cannot certify arbitrary intellectual quality or independently verify unstructured research. Unknown/malformed outputs are rejected. Failed calls or authenticator rejections consume an *attempt*, not a semantic node. A repeated rejection blocks the node after 2 attempts; it does not spawn more work.

Budget uses conservative **reserved input-estimate + maximum output** units per model call. It is intentionally an upper-bound accounting model, not actual billed token totals. Charges are never refunded in this experiment. Every event has an idempotent sequential ledger key; on restart use the saved JSON state without replenishing budget. All accepted leaf results have hashes. Child IDs never change after acceptance.

## Commands

```bash
node --test experiments/recursion-tree-v0/engine.test.mjs
cd experiments/recursion-tree-v0
node run.mjs --mode=mock --stage=1
node run.mjs --mode=stress --stage=1
NVIDIA_API_KEY=*** node run.mjs --mode=live --stage=1
```

Generated JSON includes actual tree paths, classification decisions, accepted result hashes, attempted call records, budget charges and failures. **Do not print or save API keys.**

## Promotion gate for increasing complexity

1. First show a live stage-1 accepted 3-node tree (not just a scripted test-double result).
2. Verify structural invariants, exact class labels, distinct semantic-vs-attempt ledgers, budget conservation, idempotent replay, and no new branch on malformed/truncated/504 output.
3. Run stage-1 across multiple independent seeds/case-orderings and report repeated-sample acceptance; one pass is not a reliability estimate.
4. Examine actual provider token usage and hidden thinking separately before changing the budget assumption.
5. Increase to stage 2 only after an explicit operator choice; no automatic progression. Add cross-branch dependencies and synthesis in subsequent versions **with their own deterministic checks**, rather than assuming stage 1 proves them.

## Limitations

- Error fixtures are compact derived examples, not raw Silas messages.
- Authenticator is a fully specified reference oracle on a classification exercise; success does not demonstrate ability to judge original research.
- A 30B/3B-active model is lightweight in active parameters but still remotely hosted, not on-device or offline.
- This is a new isolated engine; it does not yet measure direct production AAU worker parity.
- NVIDIA availability, rate limits and repo secret configuration must be observed in the live GitHub Actions run; no fallback from a failed live call to a deterministic test double.


## Ten-level traversable stress experiment (October 16)

A separate deterministic test-double harness now tests **both** 10 consecutive splits and
a full binary 10-level tree. This is not a live NVIDIA inference result.

| Shape | Split nodes | Leaves | Total nodes | Simulated ceiling |
|---|---:|---:|---:|---:|
| Balanced 10-level binary | 1,023 | 1,024 | 2,047 | 1,800,000 token-equivalent units |
| Spine with 10 consecutive splits | 10 | 11 | 21 | 50,000 token-equivalent units |

All node IDs are canonical (`R`, `R.001`, `R.001.002`, etc.). Every accepted
branch has two exact, disjoint, contiguous ranges. The deterministic authenticator
checks the full partition and leaf classification; every accepted leaf has a hash.
The verifier independently checks BFS and DFS reachability, parent-child round trips,
unique event IDs, committed budget, maximum depth, and absence of orphaned nodes.
Injected HTTP 504, invalid split boundaries, stale wake, low budget, corrupted parent
links, changed evidence hashes, orphan nodes, and replay are covered by tests.

Run via:

```bash
node --test experiments/recursion-tree-v0/depth10-traversability.test.mjs
cd experiments/recursion-tree-v0
node depth10-run.mjs --shape=balanced
node depth10-run.mjs --shape=spine --node=R.002.002
```

CI produces `recursion-depth10-balanced.json` and `recursion-depth10-spine.json`
alongside the existing stage-1/stress test artifacts. The companion standalone HTML
explorer is in the conversation download artifact, and supports jumps by path,
breadcrumbs, parent/child traversal, and DFS previous/next through all nodes.

**Important:** 1,024 synthetic items are created by repeating the 16 reduced
Silas diagnostic templates; they are not 1,024 distinct observed runtime failures.
The simulated token-equivalent reserve is not measured API usage. A real
lightweight model would require available NVIDIA credentials and a separate,
explicitly budget-capped campaign. No 2,047 provider calls were attempted;
Silas's real cognition state and levy are unchanged.

## Cognitive integrity adversarial campaign — stage 1

After creating a traversable 10-level tree, a **separate read-only proof audit**
certifies leaf truth against the known Silas error fixture oracle and certifies
each parent **bottom-up**, checking both direct child proof hashes, exact parent
coverage, unique provenance references, verified classification counts and
nonempty synthesis output. A parent's existence or `split` status alone never
certifies synthesis. An ancestor can be sealed only if its children are sealed.
Accepted siblings retain their independent proofs when another branch fails.

Injected attacks include:
- invalid action and malformed / explicitly incomplete split declarations at
  root and depths 3, 7 and 9 (two rejected attempts, no phantom children);
- child physically absent from a finished tree at depths 1, 5 and 10;
- empty/whitespace synthesis at depths 0, 3, 7 and 9;
- forged child digest, duplicated child provenance, false classification totals
  or incomplete synthesis references;
- incorrect leaf classification at depth 10;
- damaged execution ledger and JSON checkpoint reload.

Run:
```bash
node --test experiments/recursion-tree-v0/cognitive-integrity.test.mjs
cd experiments/recursion-tree-v0
node cognitive-integrity-run.mjs
```

CI stores `cognitive-integrity-fault-report.json` with every failure-case
rejection and the accepted root digest for the unmodified case. The report's
`certified` field is the **stronger cognitive-provenance closure**, not the
original `tree.complete` execution flag.

**Limitations:** This is a fully deterministic oracle for known diagnostic
classification fixtures and a model **test double**. The proof does not
establish that an unstructured narrative summary is true or a mathematical
argument is correct. Parent "summary" content is checked for presence and
correct provenance/counts, not semantic truth. No live model-generated
synthesis was evaluated, no provider calls were made, and this gate is not
yet installed in Silas's production runtime.


## Real NVIDIA inference campaign — October 16, 2026

The GitHub Actions `NVIDIA_API_KEY` is present and was accepted for real
`nvidia/nemotron-3.5-lightning-30b-a3b` endpoint requests (thinking disabled).
No production agent, worker, deployment or Supabase state was changed.

1. First live stage 1: five model calls; root proposed an oversized atomic
   output before correctly splitting; one child gave the wrong classifier on
   two attempts, and was correctly held. The other child completed.
   Artifact: GitHub Action run 38895377036, artifact 12046208006.
2. Prompt-contract revision on the same fixed oracle: **stage 1 passed** in
   three real calls with zero rejections and 2 authenticated leaves;
   reserve budget 2,919/9,000. GitHub Action run 38903464352,
   artifact 12046958932.
3. First live **ten consecutive splits**: 21/21 executed, 10 split decisions
   and 11/11 leaf classifications authenticated. 22 provider calls total,
   7,305 provider-reported tokens, 9,767/40,000 estimated reserve units.
   Initial parent synthesis failed because the model omitted a segment while
   copying a deeply nested child path; aggregate classification counts were
   correct. This failure was *correctly rejected* and propagated all the way
   up, without invalidating already completed leaves. Run 38903464352,
   artifact 12046809115.
4. Design revision: model returns slots `[0,1]`, summary and classification
   aggregates. The runtime, not the model, stamps trusted child path and
   SHA-256 digest references. The original parent authenticator still checks
   exact verified child evidence. Six adversarial slot tests pass in isolated
   CI.
5. Two follow-up live **slot-based** jobs were inconclusive: each made two
   calls to the NVIDIA endpoint that hit a 30s local abort before receiving
   an answer. Each run registered zero provider-reported tokens, though actual
   provider billing could differ. No node was admitted, and these must be
   categorized as transport timeout rather than cognitive invalidity.
   Runs 38904379634 and 38904379561, artifacts 12047725453 and
   12047850899.

### Experiment guard after campaign

Two temporary paid-inference PR-triggered workflow files were removed from
the experimental branch in a single commit, because GitHub pull_request
`paths` examines the cumulative PR diff and could unexpectedly repeat paid
tests on later commits. The permanent
`.github/workflows/experimental-recursion-tree.yml` runs only deterministic
regression tests on PR/push; its optional model job remains limited to
explicit manual dispatch. The real test runner and all fixtures remain
available, but no inference job will be triggered automatically.

**Conclusion:** Model-generated ten-level decompositions and terminal
classification were demonstrated. Deep identifier-copy error was demonstrated
at the first real parent synthesis. The short-slot replacement passed
deterministic tests, but no complete live ten-level synthesized root was
authenticated. Do not merge or promote this experiment as production-safe on
this evidence alone. Run multi-seed depth and synthesis trials once NVIDIA
transport stability is independently verified, and preserve bounded
transport-retry policy with no semantic re-splitting for timeouts.

## Kimi no-thinking provider comparison — 2026-10-16

The target is deliberately the same ten-level spine, leaf oracle and exact
positional child-synthesis authenticator used by Nemotron.

- Hosted Moonshot **Kimi K3 cannot turn reasoning off** (its lowest setting is
  `reasoning_effort: low`). For a true no-thinking comparison, target
  `kimi-k2.5` with `thinking: {"type":"disabled"}` on the direct Moonshot
  API or NVIDIA-hosted `moonshotai/kimi-k2.5` with
  `chat_template_kwargs: {"thinking":false}`. NVIDIA K2.6 accepts the same
  chat template parameter.
- GitHub Actions contains `NVIDIA_API_KEY`, but **not**
  `MOONSHOT_APIKEY`. The direct-Moonshot K2.5 experiment was blocked in the
  credentials preflight **before any inference** (Actions 38905981785).
- NVIDIA K2.5 gave HTTP **404 page not found** on two probe attempts and no
  tokens / tree nodes (Actions 38906230153).
- NVIDIA K2.6 gave HTTP **404 function not found for account** on two calls,
  again **no provider tokens / tree nodes** (Actions 38906432179). This is
  model-routing or provider account availability, **not cognitive performance**.
- Both paid-inference PR workflow triggers were removed after their runs;
  model-specific comparison runners remain in this directory. The direct
  Moonshot runner `live-kimi-thinking-off.mjs` requires credentials in the
  environment where it actually executes, and still enforces no
  `reasoning_content` response, max 42 calls and model-provenance attestation.
- Fixed an experiment-only anti-pattern: HTTP 400/401/403/404/422 missing-model
  or request errors fail permanently after one call, while genuine provider
  504s remain bounded-retryable; two new deterministic regression tests verify
  this. The fix does not modify production workers.

**Conclusion:** The hypothesis that deterministic node/provenance management
should be model-independent is supported by the existing cross-provider
simulations, but *Kimi's live correctness* remains unmeasured. To get a clean
Kimi no-thinking outcome, make the already-configured Moonshot credential
available to the isolated runner (e.g. `MOONSHOT_APIKEY` in GitHub Actions
repository secrets) and re-execute the direct provider test with the
`thinking: {"type":"disabled"}` switch. Never expose credentials in artifacts,
chat, or source files. No production Silas state was touched.


## Verified live Kimi K2.6 thinking-off experiment (October 16, 2026)

**This section supersedes the earlier Kimi credential-blocked report.** The
new GitHub Actions `MOONSHOT_API_KEY` is accepted by the official endpoint
`api.moonshot.ai`. A read-only `GET /v1/models` returned exactly four models:
`kimi-k2.6`, `kimi-k3`, `kimi-k2.7-code-highspeed`, and
`kimi-k2.7-code`. `kimi-k2.5` was **not offered** to this account; attempting
it produced `resource_not_found_error` (run 38907655682).

The real `kimi-k2.6` probe with `thinking: {"type":"disabled"}` succeeded:
the requested JSON came back, finish_reason=stop, no reasoning_content.
Initial unpaced model recursion returned two valid decisions (a root split,
then an atomic leaf) before provider HTTP 429. The response identified the
account limit as **3 requests/minute**. The 429 was **transport/admission**,
not cognitive invalidity (run 38907988264).

A final isolated attempt paced requests **23 seconds apart** with an initial
65-second cooldown. All model calls used Kimi K2.6 non-thinking via direct
Moonshot, with the *unchanged deterministic* split, atomic leaf and child-slot
provenance authenticators.

**Verified outcome (Actions run 38908384102, artifact 12048914961):**

| Actual property | Verified |
|---|---:|
| Fully executed depth-ten nested spine | Yes |
| Accepted tree nodes | 21/21 |
| Model-proposed semantic splits | 10 |
| Deterministically authenticated terminal leaves | 11/11 |
| Model-authored bottom-up parent syntheses | 10/10 |
| Cognitively authenticated root | Yes |
| Invalid or blocked nodes | 0 |
| Real provider model calls | 31 (21 node + 10 synthesis) |
| Provider-reported token usage | 9,134 |
| Synthetic reservation units consumed | 9,767/40,000 |
| Provider latency summed over requests | 50.653 seconds |
| Thinking flag | `{"type":"disabled"}` |
| Provider reported `reasoning_content` | Absent |

Root proof SHA-256:
`ec166d8915f7f54e6825e38891ae43a54b4b2d8a280d21ca1aa09096741ba483`.

The ten parent claims were generated by Kimi; the deterministic runtime
used child **slots** `[0,1]` to stamp full canonical child paths and hashes.
The model supplied summaries and count aggregates. The root's accepted
aggregate was budget=3, provider=2, cognition=3, evidence=2, scheduler=1,
unknown=0; it covered exactly 11 terminal cases.

**Comparison with Nemotron:** Nemotron previously completed 10 splits and
11 leaves in a real run but failed first parent synthesis due to a copied
long identifier, before the slot-based interface was introduced. The Kimi
success uses the *revised* slot interface, so this is **not a controlled
head-to-head test of the models**. It demonstrates the contract can be
implemented without hard-coding correctness to a particular model.

**Limitations:** these 11 diagnostic leaves are synthetic cases based on a
small number of real Silas error templates; the split boundary was specified
directly in each prompt. The deterministic authenticator validates node
shape, exact oracle labels, provenance, reference count aggregation and
nonempty synthesis, but cannot certify arbitrary mathematical proofs or
unstructured claims. Token units are estimated reservations, not money or
actual billed tokens. The rate-limit pacing dominates wall-clock elapsed
time, so elapsed time is not inference latency.

The once-only paid-inference workflow was deleted from the experimental PR
after dispatch. The isolated source remains available, and the production
Silas agent was never started. **No experiment is approved for production
merge simply because this constrained test passed.**
