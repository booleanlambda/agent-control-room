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


## Execution-integrity fault campaign — October 16, 2026

The next experimental stage targets **provider failures, abandoned wakes,
continuation/replay and duplicate deliveries**, rather than reasoning accuracy.
This stage runs the standalone `execution-integrity.mjs` lease/inbox simulator,
NOT the production broker. No actual model requests are required.

The simulator persists immutable-ish event entries with unique IDs, finite
reserved token-equivalent charges, claim leases with fencing tokens, a durable
provider-response inbox, and commit-once semantics for semantic node acceptance.
Failures are classified as transport, permanent provider, admission throttle
or cognitive rejection; only accepted cognition can split a node. Provider
timeouts follow the separately established **3 attempts → 60-minute cooldown →
3 attempts → bounded stop** policy. Cooldowns use a simulated clock; tests do
not sleep. Status, journal, queue, leases, reservations and accepted hashes are
restored from JSON checkpoints. Real HTTP 404 stops immediately and HTTP 429
defers independently of the cognitive attempt counter.

**15 new tests** cover:
- depth-7 abandoned wake/lease expiry and bounded retry;
- depth-10 crash after response was journaled, restart, reuse of answer with
  no duplicate provider charge or semantic commit;
- distinct lease fencing tokens, stale/duplicate work deliveries;
- the 60-minute cooldown and six-timeout terminal bound;
- 504, 429 and permanent 404 transport classification;
- budget preservation, queue corruption and cognitive rejection isolation;
- all ten parent synthesis records surviving an interruption, duplicate
  response and checkpoint reload;
- the complete 2,047-node binary tree at depth 10 with transport faults
  injected at depths 0, 3, 7 and 10.

**Three additional tests** replay normalized actual Kimi K2.6 decisions and
the exact model-authored parent summary strings from GitHub Actions run
38908384102 (artifact 12048914961). With no new provider calls, both the
clean replay and the replay containing injected 504, 429, orphaned wake and
post-response crash achieve exactly the same original authenticated root:

`ec166d8915f7f54e6825e38891ae43a54b4b2d8a280d21ca1aa09096741ba483`

The third replays an interrupted parent-synthesis chain and checks recovery
without reissuing a model call. The normalized fixture preserves the semantic
decisions and original summary strings; it is *not* a second live experiment.

Validation: **57/57 deterministic tests passed** (11 original engine, 11 depth
traversability, 11 cognitive, 6 slot, 15 execution integrity, 3 recorded Kimi
replay). See GitHub Actions run 38912155651.

### Scope and limitations

The model-independent simulator demonstrates **exact-once accepted semantic
state in a single-process deterministic fault model**, NOT real concurrent
transactional exactly-once execution. A provider request that times out
without a journaled answer may still consume billed provider tokens; the
simulator conservatively debits another bounded reservation before reissue.
Provider-side idempotency support, true PostgreSQL transaction isolation,
RabbitMQ at-least-once delivery, distributed lease races, and production
worker crash-consistency remain to be tested in a subsequent integration
campaign. The synthetic charge ledger is not provider billing.

No changes to Silas's production cognition, levy, deployment or worker have
been made.


## Real two-worker concurrency and PostgreSQL/RabbitMQ integration — October 16, 2026

This is a **real** integration test with disposable PostgreSQL 16 and RabbitMQ
3.13 Docker service containers inside GitHub Actions, separate from production
Supabase, production RabbitMQ, Render, and Silas. The SQL client hard-rejects
non-loopback databases and requires a disposable `recursion_lab` DB plus
`AAU_DISPOSABLE_CI_DB=yes`. No production credentials are loaded.

**Validated in CI run 38917470653**, with artifact
`aau-real-two-worker-transaction-integrity`:

- **Four OS worker processes** were started: a worker terminated immediately
  after journaling a response, a worker forcibly terminated inside an
  uncommitted PostgreSQL semantic-commit transaction, and two actual
  concurrently running RabbitMQ consumers competing for all later tasks.
- A competing consumer committed `R.001` and then exited *before RabbitMQ
  message ACK*. Another recovered from broker redelivery. The broker's
  `redelivered` flag was observed on **3 real messages**, not inferred.
- The pre-commit crash rolled back the root's uncommitted **parent, children,
  outbox and commit-record changes** together; the previous independently
  journaled answer survived and was reused, with no second provider debit.
- PostgreSQL `SELECT ... FOR UPDATE` admitted only **one** of two
  simultaneous claimants of an isolated test root (`claimed` / `busy`).
  Expired-lease fencing rejected a stale worker's journal and semantic commit.
- **21/21 accepted node commits**, comprising 10 splits and 11 leaves;
  **21 durable response records** and **21 unique model-equivalent debits**.
  Both healthy concurrent workers actually committed nodes. No duplicate
  semantic commit/child/outbox entry; total synthetic debit **12,600/55,000**.
- **10/10 persisted parent synthesis proofs**; exact restored root SHA:
  `ec166d8915f7f54e6825e38891ae43a54b4b2d8a280d21ca1aa09096741ba483`.
  This matches the prior **live Kimi K2.6 thinking-off** run.
- Test source files: `pg-rabbit-contract.mjs`, `pg-rabbit-worker.mjs`,
  `pg-rabbit-integration.mjs`; persistent, deterministic, non-paid CI gate:
  `.github/workflows/experimental-postgres-rabbit-integrity.yml`.

The test replays the exact verified Kimi decisions and model-authored
summaries. **No new LLM calls were made**; the 21 `providerCalls` in the
disposable SQL run are synthetic debit reservations (one per original
model-equivalent node), not 21 actual new provider requests. This is an
integration test for distributed execution integrity, not comparative
reasoning accuracy or provider-side billing idempotency.

### Remaining work before any production change

Test more than two workers, network partitions where the broker and DB
disagree, delayed ACK beyond lease expiry, injected PostgreSQL unavailability,
RabbitMQ reconnection/leader failover, cross-machine replay of durable
checkpoints, and substantive mathematics/research with independent verifiers.
The CI containers were disposable and the RabbitMQ queue was non-durable
because the test targets worker and DB transaction recovery, not *broker
node persistence*. No claims of exactly-once provider billing or
production-grade correctness are warranted from this test alone.

Production's existing **Systemic Runtime Tree CI** continues to fail
independently. PR #45 remains draft and unmerged.


## Disposable service-restart and network fault campaign — October 16, 2026

**Run:** [GitHub Actions 38930823935](https://github.com/booleanlambda/agent-control-room/actions/runs/38930823935)
(artifact `aau-broker-restart-postgres-outage-tcp-partition`).

This stage uses **actual PostgreSQL 16 and RabbitMQ 3.13 Docker containers**
on a disposable GitHub Actions runner. The code refuses non-loopback or
non-lab database addresses and verifies the exact Docker container image
before issuing any stop/restart command. Production Supabase, Render,
RabbitMQ, Silas, and their credentials remain untouched.

The campaign injects these separate failures before recovering a full
10-level, 21-node Kimi-derived tree:

1. A root task is delivered to a **durable RabbitMQ queue**, with persistent
   message delivery mode, and the entire RabbitMQ container is restarted.
   The root message is still present after reconnection.
2. A live worker receives the root, validates and durably journals its
   known-good model answer to PostgreSQL, then its actual forwarded TCP
   connection to RabbitMQ is severed using a temporary local TCP proxy.
   The worker disconnects; the database's response journal is preserved.
3. PostgreSQL itself is stopped. A real SQL query fails during the outage.
   PostgreSQL is then restarted and a new client pool reconnects. The
   previously journaled answer, one original debit and no accepted root
   commit are confirmed intact.
4. Two independent replacement worker processes consume actual RabbitMQ
   messages, reconcile pending work from PostgreSQL's transactional outbox,
   retry eligible work under lease fencing, and finish the entire tree.
   The broker records a genuine redelivery. Both replacement workers
   commit accepted nodes.

**Measured result:** pass. The durable queue survived restart; one active
TCP connection was cut; the PostgreSQL outage was observed; 21/21 nodes,
10/10 parent proofs and 11/11 leaves were accepted. There are precisely
21 response journals and 21 synthetic debits, totaling **12,600/55,000**.
The authenticated root remains exactly the original real Kimi K2.6
thinking-off proof:

`ec166d8915f7f54e6825e38891ae43a54b4b2d8a280d21ca1aa09096741ba483`.

**Source:** `pg-rabbit-resilience.mjs`, plus the deliberately scoped
durable-queue and worker-fault controls in `pg-rabbit-worker.mjs).
The stable CI workflow is
`.github/workflows/experimental-postgres-rabbit-resilience.yml`.
These tests replay earlier recorded Kimi decisions and parent summaries;
**zero new model API calls**, and budget debits represent synthetic
reservations, not provider billing.

**Precise limitations:** The broker restarts while the original persistent
task is *queued*, not while it is being processed; the later TCP cut occurs
*during* active processing. This is a real single-worker TCP interruption,
not a distributed multi-host network partition. PostgreSQL is restarted as
the same Docker container with its existing data volume, not failed over
to a replica. The test uses a single RabbitMQ node, not a quorum queue or
broker cluster. It does not establish recovery from simultaneous multi-node
partitions, provider billing idempotence, or production service reliability.
No production deployment is authorized by this isolated pass.
