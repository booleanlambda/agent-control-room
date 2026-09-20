-- AAU Knowledge Pool v0.2: sourced seed facts, per-agent uptake, and dated provenance.
-- This version does not enable news broadcasting, adjust model binding or grant expertise.
CREATE TABLE IF NOT EXISTS agent_lab.agent_knowledge_seed_links (
 agent_id uuid NOT NULL REFERENCES agent_lab.agents(agent_id) ON DELETE CASCADE,
 seed_item_id uuid NOT NULL,
 seed_package_id uuid NOT NULL REFERENCES agent_lab.knowledge_seed_packages(seed_package_id),
 component text NOT NULL CHECK (component IN ('general','peripheral')),
 first_wake_request_id uuid REFERENCES agent_lab.wake_queue(wake_request_id) ON DELETE SET NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (agent_id,seed_item_id,component)
);
CREATE INDEX IF NOT EXISTS aau_knowledge_seed_links_agent_component
 ON agent_lab.agent_knowledge_seed_links(agent_id,component);
ALTER TABLE agent_lab.knowledge_wake_updates ADD COLUMN IF NOT EXISTS source_seed_item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
ALTER TABLE agent_lab.agent_knowledge_seed_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_lab.agent_knowledge_seed_links FROM PUBLIC,anon,authenticated;
INSERT INTO agent_lab.knowledge_seed_packages(version,status,general_topics,peripheral_topics,source_manifest,factual_snapshot,metadata)
SELECT 'knowledge_pool_seed_v0_2','draft',general_topics,peripheral_topics,source_manifest,
'[{"claim":"In its July 2026 World Economic Outlook update, the IMF projected global growth of 3.0% in 2026 and 3.4% in 2027.","topic":"world_economy","item_id":"ab6ae301-2af1-48aa-8f36-310fb7b93801","component":"general","fact_kind":"dated_projection","publisher":"IMF","source_url":"https://www.imf.org/en/publications/weo/issues/2026/07/08/world-economic-outlook-update-july-2026","published_at":"2026-07-08T00:00:00Z","observation_period":"2026-2027 forecast"},{"claim":"BEA''s second estimate reported that U.S. real GDP grew at a 1.5% annual rate in Q2 2026, compared with 2.1% in Q1.","topic":"us_economy","item_id":"ab6ae301-2af1-48aa-8f36-310fb7b93802","component":"general","fact_kind":"dated_official_statistic","publisher":"BEA","source_url":"https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-2nd-quarter-2026","published_at":"2026-08-26T12:30:00Z","observation_period":"Q2 2026 second estimate"},{"claim":"BLS reported August 2026 U.S. CPI-U increased 0.4% month over month seasonally adjusted and 3.4% over the prior 12 months unadjusted.","topic":"us_inflation","item_id":"ab6ae301-2af1-48aa-8f36-310fb7b93803","component":"general","fact_kind":"dated_official_statistic","publisher":"BLS","source_url":"https://www.bls.gov/news.release/archives/cpi_09112026.htm","published_at":"2026-09-11T12:30:00Z","observation_period":"August 2026"},{"claim":"In August 2026, the U.S. gasoline CPI index increased 3.9%; BLS said this accounted for over a third of that month''s all-items CPI rise.","topic":"energy_and_consumer_prices","item_id":"ab6ae301-2af1-48aa-8f36-310fb7b93804","component":"peripheral","fact_kind":"dated_official_statistic","publisher":"BLS","source_url":"https://www.bls.gov/news.release/archives/cpi_09112026.htm","published_at":"2026-09-11T12:30:00Z","observation_period":"August 2026"},{"claim":"The IMF''s July 2026 outlook described AI-driven demand as lifting economies integrated into the global technology value chain, while energy-importing economies faced war-related pressure.","topic":"ai_economics","item_id":"ab6ae301-2af1-48aa-8f36-310fb7b93805","component":"peripheral","fact_kind":"dated_attributed_assessment","publisher":"IMF","source_url":"https://www.imf.org/en/publications/weo/issues/2026/07/08/world-economic-outlook-update-july-2026","published_at":"2026-07-08T00:00:00Z","observation_period":"July 2026 assessment"},{"claim":"BEA''s Q2 2026 GDP second estimate attributed positive contributions to U.S. consumer spending, exports, and investment, partly offset by lower government spending.","topic":"us_growth_drivers","item_id":"ab6ae301-2af1-48aa-8f36-310fb7b93806","component":"peripheral","fact_kind":"dated_official_assessment","publisher":"BEA","source_url":"https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-2nd-quarter-2026","published_at":"2026-08-26T12:30:00Z","observation_period":"Q2 2026 second estimate"}]'::jsonb,
metadata||jsonb_build_object('kind','dated_verified_initial_facts','live_values_included',true,
 'snapshot_as_of','2026-09-20','factual_snapshot_status','historical_observations_and_attributed_forecasts',
 'external_feed_reactivated',false)
FROM agent_lab.knowledge_seed_packages WHERE version='knowledge_pool_seed_v0_1'
ON CONFLICT(version) DO NOTHING;
UPDATE agent_lab.knowledge_seed_packages SET status='retired' WHERE version='knowledge_pool_seed_v0_1';
UPDATE agent_lab.knowledge_seed_packages SET status='active' WHERE version='knowledge_pool_seed_v0_2';
UPDATE agent_lab.agent_knowledge_pools p SET seed_package_id=s.seed_package_id,updated_at=now()
FROM agent_lab.knowledge_seed_packages s WHERE s.version='knowledge_pool_seed_v0_2'
 AND NOT EXISTS (SELECT 1 FROM agent_lab.agent_knowledge_event_links l WHERE l.agent_id=p.agent_id)
 AND NOT EXISTS (SELECT 1 FROM agent_lab.knowledge_wake_updates k WHERE k.agent_id=p.agent_id
   AND (k.status IN ('added','revised','revalidated') AND cardinality(k.source_event_ids)>0));

CREATE OR REPLACE FUNCTION agent_lab.build_knowledge_pool_context_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_seed agent_lab.knowledge_seed_packages%rowtype;
v_general jsonb:='[]'::jsonb;v_peripheral jsonb:='[]'::jsonb;
v_seed_general jsonb:='[]'::jsonb;v_seed_peripheral jsonb:='[]'::jsonb;
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
      and not exists(select 1 from agent_lab.agent_knowledge_seed_links l
          where l.agent_id=p_agent_id and l.seed_item_id=(item.value->>'item_id')::uuid
            and l.component='general')
    order by item.value->>'published_at' desc limit 2
 ) t;
 select coalesce(jsonb_agg(v),'[]'::jsonb) into v_seed_peripheral from (
    select item.value v from jsonb_array_elements(v_seed.factual_snapshot) item
    where item.value->>'component'='peripheral'
      and not exists(select 1 from agent_lab.agent_knowledge_seed_links l
          where l.agent_id=p_agent_id and l.seed_item_id=(item.value->>'item_id')::uuid
            and l.component='peripheral')
    order by item.value->>'published_at' desc limit 2
 ) t;
 return jsonb_build_object(
   'version','knowledge_pool_v0_1',
   'seed_version',v_seed.version,
   'seed_as_of',v_seed.created_at,
   'general_knowledge',jsonb_build_object('topics',v_seed.general_topics,'candidate_events',v_general,'seed_candidates',v_seed_general,'last_checked_at',v_last_general),
   'peripheral_knowledge',jsonb_build_object('topics',v_seed.peripheral_topics,'candidate_events',v_peripheral,'seed_candidates',v_seed_peripheral,'last_checked_at',v_last_peripheral),
   'source_orientation',case when v_last_general is null and v_last_peripheral is null then v_seed.source_manifest else '[]'::jsonb end,
   'rules',jsonb_build_array(
     'General and Peripheral Knowledge are separate from verified expertise.',
     'Only offered source-backed event IDs or dated seed IDs may be adopted; a source is not proof a claim is true.',
     'If you reviewed a component, return knowledge_pool_update.general / peripheral with status and chosen event_ids and/or seed_item_ids. No compelled interest or competence claim.',
     'If there is no new evidence, unchanged is valid; do not invent a fact. Cite authoritative source and observation date for current economic figures.',
     'A paused external news broadcaster is not authorization to reactivate it.')
 );
end;
$function$;
CREATE OR REPLACE FUNCTION agent_lab.commit_knowledge_pool_wake_v0_1(p_agent_id uuid, p_wake_request_id uuid, p_activity_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_component text;v_report jsonb;v_status text;v_count integer:=0;
v_ids uuid[];v_eid uuid;v_candidates jsonb;v_seed_ids uuid[];v_sid uuid;v_seed_candidates jsonb;v_context jsonb;v_seed_package_id uuid;
v_out jsonb:='{}'::jsonb;v_existing text;v_reason text;
begin
 if not exists(select 1 from agent_lab.wake_queue where wake_request_id=p_wake_request_id and agent_id=p_agent_id) then
   raise exception 'knowledge_wake_agent_mismatch';
 end if;
 perform agent_lab.ensure_agent_knowledge_pool_v0_1(p_agent_id);
 v_context:=agent_lab.build_knowledge_pool_context_v0_1(p_agent_id);
 foreach v_component in array ARRAY['general','peripheral'] loop
   select status into v_existing from agent_lab.knowledge_wake_updates
    where agent_id=p_agent_id and wake_request_id=p_wake_request_id and component=v_component;
   if found then
     v_out:=v_out||jsonb_build_object(v_component,jsonb_build_object('status',v_existing,'already_recorded',true));
     continue;
   end if;
   v_candidates:=coalesce(v_context->(case when v_component='general' then 'general_knowledge' else 'peripheral_knowledge' end)->'candidate_events','[]'::jsonb);
   v_seed_candidates:=coalesce(v_context->(case when v_component='general' then 'general_knowledge' else 'peripheral_knowledge' end)->'seed_candidates','[]'::jsonb);
   v_report:=coalesce(p_result->'knowledge_pool_update'->v_component,'{}'::jsonb);
   if jsonb_typeof(v_report)<>'object' then v_report:='{}'::jsonb; end if;
   v_ids:='{}'::uuid[];v_seed_ids:='{}'::uuid[];
   v_reason:=null;
   if p_activity_id is null then
     v_status:='deferred';v_reason:='successful_cognition_activity_not_provided';
   elsif v_report='{}'::jsonb then
     v_status:=case when jsonb_array_length(v_candidates)+jsonb_array_length(v_seed_candidates)=0 then 'unchanged' else 'deferred' end;
     if v_status='deferred' then v_reason:='agent_review_missing'; end if;
   else
     v_status:=coalesce(v_report->>'status','deferred');
     if v_status not in ('added','revised','revalidated','unchanged','stale','deferred') then
       v_status:='deferred';v_reason:='unrecognized_agent_status';
     end if;
     if jsonb_typeof(v_report->'event_ids')='array' then
       -- Accept regular UUID string event IDs only; reject malformed/unlisted IDs.
       for v_eid in
        select trim(both '"' from x::text)::uuid from jsonb_array_elements(v_report->'event_ids') x
        where jsonb_typeof(x)='string'
           and trim(both '"' from x::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       loop
         if exists(select 1 from jsonb_array_elements(v_candidates) c where c->>'event_id'=v_eid::text) then
           v_ids:=array_append(v_ids,v_eid);
         end if;
       end loop;
     end if;
     select coalesce(array_agg(distinct id),'{}'::uuid[]) into v_ids from unnest(v_ids) id;

     if jsonb_typeof(v_report->'seed_item_ids')='array' then
       for v_sid in
         select trim(both '"' from x::text)::uuid
           from jsonb_array_elements(v_report->'seed_item_ids') x
          where jsonb_typeof(x)='string'
            and trim(both '"' from x::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       loop
         if exists(select 1 from jsonb_array_elements(v_seed_candidates) c
           where c->>'item_id'=v_sid::text) then
           v_seed_ids:=array_append(v_seed_ids,v_sid);
         end if;
       end loop;
     end if;
     select coalesce(array_agg(distinct id),'{}'::uuid[]) into v_seed_ids
       from unnest(v_seed_ids) id;
     if v_status in ('added','revised') and cardinality(v_ids)+cardinality(v_seed_ids)=0 then
        v_status:='deferred';v_reason:='no_valid_source_backed_candidate';
     end if;
   end if;
   -- A non-acquisition status cannot retain apparent source-adoption IDs.
   if v_status in ('unchanged','stale','deferred') then v_ids:='{}'::uuid[];v_seed_ids:='{}'::uuid[]; end if;
   if v_status in ('added','revised','revalidated') and cardinality(v_ids)>0 then
     foreach v_eid in array v_ids loop
       insert into agent_lab.agent_knowledge_event_links(
         agent_id,event_id,component,first_wake_request_id,last_wake_request_id,metadata)
       values(p_agent_id,v_eid,v_component,p_wake_request_id,p_wake_request_id,
         jsonb_build_object('source','world_events','agent_selected',true))
       on conflict(agent_id,event_id,component) do update
       set last_wake_request_id=excluded.last_wake_request_id,last_observed_at=now();
     end loop;
   end if;

   if v_status in ('added','revised','revalidated') and cardinality(v_seed_ids)>0 then
     select seed_package_id into v_seed_package_id
       from agent_lab.agent_knowledge_pools where agent_id=p_agent_id;
     foreach v_sid in array v_seed_ids loop
       insert into agent_lab.agent_knowledge_seed_links(
         agent_id,seed_item_id,seed_package_id,component,first_wake_request_id)
       values(p_agent_id,v_sid,v_seed_package_id,v_component,p_wake_request_id)
       on conflict (agent_id,seed_item_id,component) do nothing;
     end loop;
   end if;
   insert into agent_lab.knowledge_wake_updates(
     agent_id,wake_request_id,component,status,source_event_ids,source_seed_item_ids,agent_report,metadata)
   values(p_agent_id,p_wake_request_id,v_component,v_status,v_ids,v_seed_ids,
     jsonb_build_object('agent_status',v_report->>'status','note',left(coalesce(v_report->>'note',''),800)),
     jsonb_build_object('activity_id',p_activity_id,'reason',v_reason,'protocol','knowledge_pool_v0_1',
       'candidate_count',jsonb_array_length(v_candidates),'seed_candidate_count',jsonb_array_length(v_seed_candidates),'source_backed_ids',cardinality(v_ids),'source_seed_ids',cardinality(v_seed_ids),
       'not_expertise_verification',true))
   on conflict do nothing;
   update agent_lab.agent_knowledge_pools set
      general_state=case when v_component='general'
        then general_state||jsonb_build_object('last_status',v_status,'last_checked_at',now()) else general_state end,
      peripheral_state=case when v_component='peripheral'
        then peripheral_state||jsonb_build_object('last_status',v_status,'last_checked_at',now()) else peripheral_state end,
      last_general_wake_id=case when v_component='general' then p_wake_request_id else last_general_wake_id end,
      last_peripheral_wake_id=case when v_component='peripheral' then p_wake_request_id else last_peripheral_wake_id end,
      updated_at=now()
    where agent_id=p_agent_id;
   v_out:=v_out||jsonb_build_object(v_component,jsonb_build_object('status',v_status,'source_event_count',cardinality(v_ids),'source_seed_count',cardinality(v_seed_ids),'reason',v_reason));
 end loop;
 return v_out;
end;
$function$;
