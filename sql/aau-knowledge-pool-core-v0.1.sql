
-- AAU Knowledge Pool v0.1: targeted extension of the existing source, belief,
-- interest, expertise and cognition infrastructure. No new worker or news bus.
create table if not exists agent_lab.knowledge_seed_packages (
  seed_package_id uuid primary key default extensions.gen_random_uuid(),
  version text not null unique,
  status text not null default 'draft' check (status in ('draft','active','retired')),
  general_topics jsonb not null default '[]'::jsonb check (jsonb_typeof(general_topics)='array'),
  peripheral_topics jsonb not null default '[]'::jsonb check (jsonb_typeof(peripheral_topics)='array'),
  source_manifest jsonb not null default '[]'::jsonb check (jsonb_typeof(source_manifest)='array'),
  factual_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(factual_snapshot)='array'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists aau_one_active_knowledge_seed_v0_1
 on agent_lab.knowledge_seed_packages(status) where status='active';

create table if not exists agent_lab.agent_knowledge_pools (
  agent_id uuid primary key references agent_lab.agents(agent_id) on delete cascade,
  seed_package_id uuid not null references agent_lab.knowledge_seed_packages(seed_package_id),
  general_state jsonb not null default '{}'::jsonb,
  peripheral_state jsonb not null default '{}'::jsonb,
  last_general_wake_id uuid references agent_lab.wake_queue(wake_request_id) on delete set null,
  last_peripheral_wake_id uuid references agent_lab.wake_queue(wake_request_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_lab.knowledge_wake_updates (
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  wake_request_id uuid not null references agent_lab.wake_queue(wake_request_id) on delete cascade,
  component text not null check (component in ('general','peripheral')),
  status text not null check (status in ('added','revised','revalidated','unchanged','stale','deferred')),
  source_event_ids uuid[] not null default '{}'::uuid[],
  agent_report jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(agent_id,wake_request_id,component)
);
create index if not exists aau_knowledge_wake_by_agent_time_v0_1
 on agent_lab.knowledge_wake_updates(agent_id,created_at desc);

create table if not exists agent_lab.agent_knowledge_event_links (
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  event_id uuid not null references agent_lab.world_events(event_id) on delete cascade,
  component text not null check(component in ('general','peripheral')),
  first_wake_request_id uuid references agent_lab.wake_queue(wake_request_id) on delete set null,
  last_wake_request_id uuid references agent_lab.wake_queue(wake_request_id) on delete set null,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key(agent_id,event_id,component)
);

alter table agent_lab.knowledge_seed_packages enable row level security;
alter table agent_lab.agent_knowledge_pools enable row level security;
alter table agent_lab.knowledge_wake_updates enable row level security;
alter table agent_lab.agent_knowledge_event_links enable row level security;
revoke all on agent_lab.knowledge_seed_packages from public,anon,authenticated;
revoke all on agent_lab.agent_knowledge_pools from public,anon,authenticated;
revoke all on agent_lab.knowledge_wake_updates from public,anon,authenticated;
revoke all on agent_lab.agent_knowledge_event_links from public,anon,authenticated;

insert into agent_lab.knowledge_seed_packages(
 version,status,general_topics,peripheral_topics,source_manifest,factual_snapshot,metadata
) values (
 'knowledge_pool_seed_v0_1','active',
 '["world_geography","world_economy","us_economy","inflation_and_rates","employment","trade_and_energy","sector_performance","science_and_technology","public_health","history_and_institutions","culture","local_regional_context"]'::jsonb,
 '["adjacent_disciplines","emerging_technology","markets_and_opportunities","arts_and_culture","environment","public_health","community_and_local_topics","agent_discovered_topics"]'::jsonb,
 '[
 {"publisher":"Reuters","url":"https://www.reuters.com/","kind":"news_reporting","cadence":"event_driven"},
 {"publisher":"Associated Press","url":"https://apnews.com/","kind":"news_reporting","cadence":"event_driven"},
 {"publisher":"IMF","url":"https://www.imf.org/en/Publications/WEO","kind":"primary_statistical","scope":"global_economy"},
 {"publisher":"World Bank","url":"https://data.worldbank.org/","kind":"primary_statistical","scope":"global_economy"},
 {"publisher":"BEA","url":"https://www.bea.gov/data","kind":"primary_statistical","scope":"us_economy"},
 {"publisher":"BLS","url":"https://www.bls.gov/","kind":"primary_statistical","scope":"us_inflation_and_labor"},
 {"publisher":"Federal Reserve","url":"https://www.federalreserve.gov/","kind":"primary_policy","scope":"us_monetary_policy"},
 {"publisher":"FRED","url":"https://fred.stlouisfed.org/","kind":"statistical_aggregator","scope":"economic_series"},
 {"publisher":"SEC EDGAR","url":"https://www.sec.gov/edgar/search/","kind":"primary_filing","scope":"us_public_companies"}
 ]'::jsonb,
 '[]'::jsonb,
 jsonb_build_object('kind','source_and_topic_orientation_only',
   'live_values_included',false,'current_news_included',false,
   'source_registry_reference','agent_lab.stimulus_sources',
   'event_evidence_reference','agent_lab.world_events / world_event_sources / raw_stimuli',
   'subscription_policy','do_not_reactivate_paused_broadcaster',
   'expertise_separation','knowledge_items_do_not_grant_expertise')
) on conflict(version) do nothing;
