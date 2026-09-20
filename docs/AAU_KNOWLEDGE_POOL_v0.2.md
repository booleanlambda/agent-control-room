# AAU Knowledge Pool v0.2 — Initial Source-Backed Seed Fix

Status (2026-09-20): database schema, factual seed, packet, and commit functions deployed; NVIDIA decision sanitizer deployed live on Render commit `26aa823b2a83e78297edf4cbf7b02c55ad5db19c`. First post-deployment model uptake remains subject to verification against durable rows.

## Why v0.1 did not acquire knowledge
`knowledge_pool_seed_v0_1` contained topic labels and a publisher manifest but an empty `factual_snapshot`. With the existing news broadcaster deliberately paused, `build_knowledge_pool_context_v0_1` offered zero qualifying `candidate_events`. Successful wakes therefore truthfully returned `unchanged`; per-wake audits alone did not imply learning. An earlier `get_cognition_packet` contract also mentioned only `event_ids`, so it needed to explicitly include `seed_item_ids`.

## What v0.2 changes
- `knowledge_pool_seed_v0_2` is an active immutable-by-convention source-backed dated snapshot with six concise facts, three general and three peripheral, from IMF, BEA and BLS primary sources. Every item has an exact UUID, topic, scope, publisher, URL, publication time, observed period and kind (statistic, projection, attributed assessment).
- The 46 existing non-archived agent seed pointers moved to v0.2 only because no source-backed knowledge had yet been adopted; the original v0.1 package is retired. Future births receive v0.2. Identity, expertise, memory, worker model and resource balances are unchanged.
- Context delivers at most two not-yet-adopted `seed_candidates` per component, alongside the existing source-backed `candidate_events`.
- The model can report `knowledge_pool_update.general/peripheral.seed_item_ids`; the deployed sanitizer preserves these IDs. DB commit accepts **only exact offered IDs**, records `source_seed_item_ids` in `knowledge_wake_updates`, and normalizes adoption in `agent_knowledge_seed_links`. Reprocessing one wake is idempotent. A seed fact marked unchanged, stale or deferred is not claimed as adopted.
- A successful review may legitimately return unchanged; repeated unchanged despite available items must be reported rather than converted into manufactured learning. The agent may decline irrelevant peripheral topics. Expertise verification is unaffected.
- The hourly Intervention Protocol reports failures of uptake and exhausted finite seed. The paused public news broadcaster remains off.

## Source caveat
These are **dated observations and forecasts**, not a live economy ticker. Statistics must retain their observation period and release date; forecasts remain forecasts. A shared opt-in-compatible ingestion/refresher for current news, sector performance and primary economic releases is still required after this finite seed.

## Verification
Rollback-only SQL tests passed: valid source-backed general/peripheral uptake, replay idempotency, candidate removal upon acceptance, and rejection of unoffered item IDs. The live packet query confirmed `knowledge_pool_seed_v0_2` and two factual candidates for each component. A successful model wake that persisted uptake is the outstanding end-to-end criterion; do not equate Render's successful deployment with an agent's learning.

Implementation: `sql/aau-knowledge-pool-dated-seed-uptake-v0.2.sql`, `sql/aau-knowledge-pool-cognition-contract-v0.2.sql`, and `workers/nvidia-intent-execution.js`.
