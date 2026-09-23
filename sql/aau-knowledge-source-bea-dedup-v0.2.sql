-- Add independently attributed BEA economic-release headlines and keep
-- newly ingested shared-refresh items out of the birth-seed candidate path.
-- Headlines are not themselves evidence of numerical release content.
begin;
insert into agent_lab.knowledge_refresh_sources(
 source_key,publisher,endpoint,source_host,component,topic,adapter,enabled,
 poll_interval_seconds,max_items
) values (
 'bea_economic_rss','U.S. Bureau of Economic Analysis',
 'https://apps.bea.gov/rss/rss.xml','www.bea.gov',
 'general','us_economy','rss',true,3600,5
) on conflict(source_key) do nothing;

CREATE OR REPLACE FUNCTION agent_lab.build_knowledge_pool_context_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_seed agent_lab.knowledge_seed_packages%rowtype;
v_general jsonb:='[]'::jsonb;v_peripheral jsonb:='[]'::jsonb;
v_seed_general jsonb:='[]'::jsonb;v_seed_peripheral jsonb:='[]'::jsonb;
v_refresh_general jsonb:='[]'::jsonb;v_refresh_peripheral jsonb:='[]'::jsonb;
v_last_general timestamptz;v_last_peripheral timestamptz;
begin
 select s.* into v_seed from agent_lab.agent_knowledge_pools p
 join agent_lab.knowledge_seed_packages s using(seed_package_id)
 where p.agent_id=p_agent_id;
 if v_seed.seed_package_id is null then return jsonb_build_object('status','not_seeded'); end if;
 select max(created_at) into v_last_general from agent_lab.knowledge_wake_updates
   where agent_id=p_agent_id and component='general' and status<>'deferred';
 select max(created_at) into v_last_peripheral from agent_lab.knowledge_wake_updates
   where agent_id=p_agent_id and component='peripheral' and status<>'deferred';

 -- Reuse existing, externally evidenced world_events; never treat internal
 -- runtime changes, DMs, stale weather, or unsourced summaries as world facts.
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_general from (
   select w.event_id,w.title,left(coalesce(w.summary,''),450) summary,
          w.topics,w.occurred_at,r.source_url,s.source_name publisher
   from agent_lab.world_events w
   join agent_lab.world_event_sources ws on ws.event_id=w.event_id
   join agent_lab.raw_stimuli r on r.raw_stimulus_id=ws.raw_stimulus_id
   join agent_lab.stimulus_sources s on s.source_id=ws.source_id
   where w.status='active' and w.confidence>=0.7
     and w.event_type in ('weather_alert','earthquake','public_discussion')
     and r.source_url ~* '^https://'
     and w.last_observed_at>=now()-interval '7 days'
     and (w.event_type<>'weather_alert' or w.occurred_at>=now()-interval '6 hours')
     and (v_last_general is null or w.last_observed_at>v_last_general)
   order by w.global_salience desc,w.last_observed_at desc limit 4
 ) t;

 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_peripheral from (
   select w.event_id,w.title,left(coalesce(w.summary,''),450) summary,
          w.topics,w.occurred_at,r.source_url,s.source_name publisher
   from agent_lab.world_events w
   join agent_lab.world_event_sources ws on ws.event_id=w.event_id
   join agent_lab.raw_stimuli r on r.raw_stimulus_id=ws.raw_stimulus_id
   join agent_lab.stimulus_sources s on s.source_id=ws.source_id
   where w.status='active' and w.confidence>=0.7
     and w.event_type in ('weather_alert','earthquake','public_discussion')
     and r.source_url ~* '^https://'
     and w.last_observed_at>=now()-interval '7 days'
     and (w.event_type<>'weather_alert' or w.occurred_at>=now()-interval '6 hours')
     and (v_last_peripheral is null or w.last_observed_at>v_last_peripheral)
     and exists(select 1 from agent_lab.interests i where i.agent_id=p_agent_id
       and i.lifecycle_state is distinct from 'rejected'
       and exists(select 1 from unnest(w.topics) topic
         where lower(topic)=lower(i.topic)
            or lower(topic)=lower(coalesce(i.parent_domain,''))))
   order by w.global_salience desc,w.last_observed_at desc limit 3
 ) t;

 -- Source-backed dated birth facts are offered until explicitly adopted.
 select coalesce(jsonb_agg(v),'[]'::jsonb) into v_seed_general from (
    select item.value v from jsonb_array_elements(v_seed.factual_snapshot) item
    where item.value->>'component'='general'
      -- New feed items are offered only through refresh_candidates, never twice as seeds.
      and not exists (select 1 from agent_lab.knowledge_refresh_items k where k.item_id=(item.value->>'item_id')::uuid)
      and not exists(select 1 from agent_lab.agent_knowledge_seed_links l
          where l.agent_id=p_agent_id and l.seed_item_id=(item.value->>'item_id')::uuid
            and l.component='general')
    order by item.value->>'published_at' desc limit 2
 ) t;
 select coalesce(jsonb_agg(v),'[]'::jsonb) into v_seed_peripheral from (
    select item.value v from jsonb_array_elements(v_seed.factual_snapshot) item
    where item.value->>'component'='peripheral'
      and not exists (select 1 from agent_lab.knowledge_refresh_items k where k.item_id=(item.value->>'item_id')::uuid)
      and not exists(select 1 from agent_lab.agent_knowledge_seed_links l
          where l.agent_id=p_agent_id and l.seed_item_id=(item.value->>'item_id')::uuid
            and l.component='peripheral')
    order by item.value->>'published_at' desc limit 2
 ) t;
 -- Use only attributed, dated and URL-backed ingest records. Exclude items
 -- already adopted through the original seed, or through this live feed.
 -- This is source availability, not independent claim verification.
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_refresh_general from (
    select k.item_id,k.claim,k.component,k.topic,k.publisher,k.source_url,
      k.published_at,k.observation_period,k.fact_kind,
      k.metadata->>'verification' verification,k.ingested_at
    from agent_lab.knowledge_refresh_items k
    join agent_lab.knowledge_refresh_sources src on src.source_key=k.source_key
    where k.component='general' and src.enabled
      and k.source_url ~* '^https://' and nullif(btrim(k.publisher),'') is not null
      and nullif(btrim(k.claim),'') is not null
      and k.published_at between now()-interval '90 days' and now()+interval '1 day'
      and k.metadata->>'verification'='source_attribution_only'
      and not exists (select 1 from agent_lab.agent_knowledge_seed_links l
        where l.agent_id=p_agent_id and l.component='general' and l.seed_item_id=k.item_id)
      and not exists (select 1 from agent_lab.agent_knowledge_refresh_links l
        where l.agent_id=p_agent_id and l.component='general' and l.item_id=k.item_id)
    order by k.published_at desc,k.ingested_at desc,k.item_id desc limit 3
 ) t;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_refresh_peripheral from (
    select k.item_id,k.claim,k.component,k.topic,k.publisher,k.source_url,
      k.published_at,k.observation_period,k.fact_kind,
      k.metadata->>'verification' verification,k.ingested_at
    from agent_lab.knowledge_refresh_items k
    join agent_lab.knowledge_refresh_sources src on src.source_key=k.source_key
    where k.component='peripheral' and src.enabled
      and k.source_url ~* '^https://' and nullif(btrim(k.publisher),'') is not null
      and nullif(btrim(k.claim),'') is not null
      and k.published_at between now()-interval '90 days' and now()+interval '1 day'
      and k.metadata->>'verification'='source_attribution_only'
      and not exists (select 1 from agent_lab.agent_knowledge_seed_links l
        where l.agent_id=p_agent_id and l.component='peripheral' and l.seed_item_id=k.item_id)
      and not exists (select 1 from agent_lab.agent_knowledge_refresh_links l
        where l.agent_id=p_agent_id and l.component='peripheral' and l.item_id=k.item_id)
    order by k.published_at desc,k.ingested_at desc,k.item_id desc limit 3
 ) t;
 return jsonb_build_object(
   'version','knowledge_pool_v0_2_refresh_provenance',
   'seed_version',v_seed.version,
   'seed_as_of',v_seed.created_at,
   'general_knowledge',jsonb_build_object('topics',v_seed.general_topics,'candidate_events',v_general,'seed_candidates',v_seed_general,'refresh_candidates',v_refresh_general,'last_checked_at',v_last_general),
   'peripheral_knowledge',jsonb_build_object('topics',v_seed.peripheral_topics,'candidate_events',v_peripheral,'seed_candidates',v_seed_peripheral,'refresh_candidates',v_refresh_peripheral,'last_checked_at',v_last_peripheral),
   'source_orientation',case when v_last_general is null and v_last_peripheral is null then v_seed.source_manifest else '[]'::jsonb end,
   'rules',jsonb_build_array(
     'General and Peripheral Knowledge are separate from verified expertise.',
     'Only offered source-backed event, seed, or refresh IDs may be adopted; source attribution is not independent claim verification.',
     'If you reviewed a component, return knowledge_pool_update.general / peripheral with status and chosen event_ids, seed_item_ids or refresh_item_ids. No compelled interest or competence claim.',
     'If there is no new evidence, unchanged is valid; do not invent a fact. Cite authoritative source and observation date for current economic figures.',
     'For source use in an actual submitted MBA analysis, provide optional knowledge_usage entries with source_kind, item_id, component and an exact quoted excerpt. Cite the source URL in the analysis. Availability or adoption alone is not evidence of use.',
     'A paused external news broadcaster is not authorization to reactivate it.')
 );
end;
$function$
;
commit;
