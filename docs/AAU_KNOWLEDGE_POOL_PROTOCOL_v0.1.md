# AAU Knowledge Pool Protocol v0.1

Status: **DB schema and cognition hooks deployed and enabled** on 2026-09-20. NVIDIA worker decision-sanitizer code committed but live Render deployment **unverified**. No end-to-end completed knowledge-bearing cognition verified yet.

## Objective
Extend the **existing AAU brain** with two durable, distinct, per-agent components:
- **General Knowledge:** broad source-backed understanding, including world affairs, world and U.S. economies, economic-sector performance, institutions, science, technology, culture, and locality.
- **Peripheral Knowledge:** optional breadth and connections adjacent to the agent's own interests, work, location, and emerging exploration. Peripheral discovery does not imply a specialist competency or impose interests.

Neither component changes the **Expertise Artifact**, expertise verification, identity/model binding, or capability grants.

## Existing infrastructure reused
Use `agent_lab.world_events`, `world_event_sources`, `raw_stimuli`, `stimulus_sources`, `interests`, `beliefs`, `belief_evidence_links`, `wake_queue`, `activity_log`, and the existing `get_cognition_packet` / `apply_cognition_result_with_identity_clock` paths. No second autonomous worker, memory store, or broadcaster.

New narrowly scoped persistence:
- `knowledge_seed_packages`: versioned topics, source orientation, optional verified dated factual snapshot.
- `agent_knowledge_pools`: two durable component states linked to one versioned birth seed.
- `agent_knowledge_event_links`: per-agent source-backed observations linked to existing world-event identifiers, separately per component.
- `knowledge_wake_updates`: exactly one result per agent/wake/component (unique key).

All new tables have RLS enabled and no anon/authenticated privileges. SQL functions are invoked through the existing trusted internal path.

## Birth seed v0.1
`knowledge_pool_seed_v0_1` contains an orientation manifest of nine news, statistical and primary-filing sources (Reuters, AP, IMF, World Bank, BEA, BLS, Federal Reserve, FRED and SEC EDGAR), general/peripheral subject areas, and **no invented economic releases, market prices, or current news**. Factual snapshot is initially empty. Birth trigger seeds future agents. 46 non-archived existing agents were seeded idempotently; archived agents were not changed. The seed does not assign a personality, occupation, or specialism.

**Incomplete:** obtaining current dated macroeconomic/sector facts and verifying the source ingestion connectors. Source names/URLs alone are not a current factual knowledge feed.

## Wake contract
1. On packet assembly, ensure seed membership and prepare a bounded `knowledge_pool_context` from actual AAU source-backed world events. Exclude internal runtime messages and unsourced claims; filter old weather.
2. The model may return `knowledge_pool_update.general` and `.peripheral` as objects with `status`, `event_ids`, optional `note`. Valid statuses: `added`, `revised`, `revalidated`, `unchanged`, `stale`, `deferred`.
3. Post-cognition commit requires the existing successful cognition activity ID. Only offered, syntactically valid, source-backed event UUIDs can become knowledge event links. Unsupported `added`/`revised` becomes `deferred` with a reason. The operation is idempotent for the same wake and component.
4. If no candidate evidence exists and the model provides no report, `unchanged` is a valid audit state; if candidates exist without a review, the state is `deferred`. Neither status is proof of learning.
5. A wake that fails or is cancelled records two **deferred** update results via the existing wake_queue status transition, without committing any acquired knowledge. Deferred checks do **not** advance the source cursor.
6. Do not fetch global news twice, force a new interest, synthesize a fact to meet a quota, or infer a verified expertise score from having read a source.

The source manifest is included in the packet on initial exposure and omitted after both components have a non-deferred check, keeping recurring packets compact. Existing news/world-event broadcaster remains explicitly operator-paused and opt-in; **do not silently enable it**.

## Deployment record
- `sql/aau-knowledge-pool-core-v0.1.sql`: schema, seed and RLS.
- `sql/aau-knowledge-pool-functions-v0.1.sql`: birth trigger, bounded context, source validation and commit.
- `sql/aau-knowledge-pool-cognition-hooks-v0.1.sql`: feature-flagged packet and post-cognition wiring.
- `sql/aau-knowledge-pool-failed-wake-audit-v0.1.sql`: failed/cancelled wake handling.
- `workers/nvidia-intent-execution.js`: preserves optional structured knowledge report through decision sanitization (GitHub commit `2ed3fa6f2845bf4265f03b85dffa80361d8841a3`).
- `runtime_config.metadata.knowledge_pool_enabled=true`, version `knowledge_pool_v0_1`; worker-deployment-verification flag remains false.

## Verification and rollout
Rollback-only checks passed:
- packet includes both components when the flag is on;
- two durable per-wake results, deduplicated on replay;
- unsupported new knowledge rejected/deferred;
- genuinely source-backed offered event can be linked;
- failed wake produces two deferred records;
- after tests, no test-created rows or pretend facts were retained.
- All non-archived existing agents were seeded idempotently.

**Release gates still open:**
1. Verify that live Render uses the worker sanitizer commit.
2. Perform one real successful model wake: inspect model-generated general/peripheral reports, event links, the two unique persisted update rows, state timestamps, and absence of unintended expertise change.
3. Implement source-backed, timestamped macroeconomic and sector-performance ingestion (bounded and compatible with the opt-in broadcaster policy), then test actual current factual seeding.
4. Evaluate offer-cursor overflow for sustained high-volume feeds: the initial v0.1 context is bounded per wake and should not be presented as guaranteed complete ingestion of all source items.
5. Revisit packet size and model timeout rates before scaling beyond serial execution.

No agent was automatically resumed, re-funded, given new capabilities, or had its competence or model identity changed by this release.
