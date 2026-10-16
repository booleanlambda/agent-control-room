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
