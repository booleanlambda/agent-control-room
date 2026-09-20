# AAU Knowledge Pool v0.3 — Shared Source Refresh

Status: **Deployed and live** on 2026-09-20. The credentialed Render `aau-broker-bridge` service is live on commit `4463365c56a21cedf1f4c6de64196c6b4d56e6c5`; registered sources are configured and the first intake batch completed. The existing GDELT/NewsAPI/RSS world-news **stimulus broadcaster remains operator-paused**.

## Intent and architecture

Extend AAU's **existing** birth seed, source metadata, cognition packet, and `agent_knowledge_seed_links`. One shared Render worker fetches official public sources on a bounded schedule. A broker-token-gated RPC validates and deduplicates items into `agent_lab.knowledge_refresh_items`. If any new items are accepted, the DB creates one versioned active `knowledge_seed_packages` snapshot: the six original v0.2 birth facts plus up to 32 newest shared observations. Existing agent pool pointers migrate transactionally, without changing identities, expertise records, model bindings, resource balances or wake scheduling. Previously adopted item IDs remain in the separate per-agent uptake links, even across new packages. Existing two-component per-wake audit remains in force.

No per-agent news fetching and no new LLM request. Agents independently receive a bounded set of unadopted items on their **existing** wake, and can accept, revise, or decline them. A source fetch or package publication does not itself trigger a wake or charge cognition compute.

## Implementation

- `sql/aau-knowledge-shared-source-refresh-v0.3.sql`: narrow source registry, normalized feed items, RLS, source-host/date/size validation, duplicate-safe publication, broker-token RPCs.
- `workers/knowledge-source-refresh.js`: once at service startup and hourly thereafter; 15-second source request timeout, 2 MB maximum response, at most five RSS headlines or two annual series values per source. Fetch domain allowlisted to the configured Fed, BLS and World Bank hosts. No arbitrary web search or source-driven execution.
- `workers/broker-bridge-start.js`: starts the knowledge worker independently of the autonomous RabbitMQ consumer.
- `sql/aau-knowledge-refresh-source-backoff-v0.3.sql`: 24-hour retry backoff for HTTP 403/404, bounded backoff for other repeated failures.
- `sql/aau-knowledge-refresh-industrial-source-v0.3.sql`: separate peripheral industrial-production feed; first live ingestion still unverified.
- Existing `knowledge_pool_seed_v0_2` historical facts remain attributed and dated. An RSS headline is labeled `publisher_headline`: it proves what a publisher announced, **not** independently verified event content or a numerical release. World Bank growth values are labeled `dated_reference_statistic` with observation years and dataset update timestamp. Revisions require new source-backed records.

## Configured initial sources and measured result

| Source | Component | Poll interval | First result |
|---|---|---|---|
| Federal Reserve monetary releases RSS | General | 1 hour | 5 new source-attributed headlines ingested |
| World Bank global real GDP-growth indicator | Peripheral | 24 hours | 2 dated annual observations ingested |
| BLS latest RSS | General | 1 hour, backed off to daily on HTTP 403 | Access denied (403); no claimed ingestion |
| Federal Reserve G.17 industrial RSS | Peripheral | 24 hours | Registered after first refresh; unverified until first poll |

First source-only refresh: 2026-09-20 16:49:44 UTC. Active snapshot `knowledge_pool_refresh_20260920164944892` has 13 facts and is attached to 46 agents. Julian wake 82 at 16:52:23 UTC independently adopted four newly refreshed items (two general, two peripheral), and his total uptake increased to 10. Kaelen remains running; his adoption of this new batch was unverified at the time of this protocol update.

## Operational boundaries

This v0.3 is **not** a comprehensive live news or financial-markets service. Official economic source releases are working; Reuters/AP feed licensing and measured equity-sector performance with explicit benchmark, date and currency are **not implemented**. BLS live RSS access needs an approved reachable alternative. Fed industrial-production statistics are sector output indicators, **not** investment-sector return benchmarks. Finite snapshots can have unchanged wakes between official releases; this is expected, not fabricated learning.

Source records carry URLs, publisher, publication timestamp, observation period, and distinct observation type. The database rejects unexpected source hostnames, malformed dates, oversized batches, and missing identity. A repeated external ID has no second material effect. Publication and pool-pointer migration share a transaction with an advisory lock. Source failure never replaces the last good snapshot, and each failing source records its own error state. Check `knowledge_refresh_sources.last_success_at`, `consecutive_failures`, and `last_error` and keep the hourly Intervention Protocol informed.

## Acceptance criteria and next work

Done: direct DB rollback test validated one published observation, duplicate replay, and atomic migration to all 46 agents. Render deployment was verified live. Live Fed and World Bank sources were ingested. Julian's model wake demonstrated end-to-end knowledge uptake from refreshed items.

Pending: observe the first G.17 fetch, get an authorized accessible BLS source, expand a lawful licensed journalism feed and measured sector return series, evaluate provider-rate limits and source-item corrections, and harden future feed text against prompt-injection while keeping the source material marked as data, not instructions.
