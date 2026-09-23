-- AAU knowledge refresh / evidence-linked usage v0.2
-- Private agent_lab schema. This is an auditable snapshot of the SQL
-- already deployed and tested via rollback-only test fixtures.
-- The source publisher and published-at metadata must be retained. Source
-- attribution is NOT independent factual verification; adoption is NOT use.
begin;
create table if not exists agent_lab.agent_knowledge_refresh_links (
 agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
 item_id uuid not null references agent_lab.knowledge_refresh_items(item_id),
 component text not null check (component in ('general','peripheral')),
 first_wake_request_id uuid not null references agent_lab.wake_queue(wake_request_id),
 adopted_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb,
 primary key(agent_id,item_id,component)
);
create index if not exists agent_knowledge_refresh_links_recent_idx on agent_lab.agent_knowledge_refresh_links(agent_id,adopted_at desc);
alter table agent_lab.agent_knowledge_refresh_links enable row level security;
revoke all on agent_lab.agent_knowledge_refresh_links from public,anon,authenticated;
alter table agent_lab.knowledge_wake_updates add column if not exists source_refresh_item_ids uuid[] not null default '{}'::uuid[];
create table if not exists agent_lab.agent_knowledge_usage_links (
 usage_id uuid primary key default gen_random_uuid(),
 agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
 activity_id uuid not null references agent_lab.activity_log(activity_id),
 wake_request_id uuid not null references agent_lab.wake_queue(wake_request_id),
 unit_progress_id uuid not null references agent_lab.entrepreneurship_unit_progress(progress_id),
 source_kind text not null check (source_kind in ('seed','refresh')),
 item_id uuid not null,
 component text not null check (component in ('general','peripheral')),
 evidence_excerpt text not null check (char_length(evidence_excerpt) between 24 and 450),
 source_url text not null check (source_url ~ '^https://'),
 created_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb,
 unique(activity_id,source_kind,item_id,component)
);
create index if not exists agent_knowledge_usage_links_agent_recent_idx on agent_lab.agent_knowledge_usage_links(agent_id,created_at desc);
alter table agent_lab.agent_knowledge_usage_links enable row level security;
revoke all on agent_lab.agent_knowledge_usage_links from public,anon,authenticated;
CREATE OR REPLACE FUNCTION agent_lab.record_knowledge_usage_v0_1(p_agent_id uuid, p_wake_request_id uuid, p_activity_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
 v_entry jsonb;v_kind text;v_component text;v_item uuid;v_excerpt text;
 v_url text;v_claim text;v_analysis text;v_progress uuid;v_count int:=0;v_attempted int:=0;
begin
 if p_activity_id is null then return jsonb_build_object('recorded',0,'reason','no_activity'); end if;
 if not exists(select 1 from agent_lab.activity_log
   where activity_id=p_activity_id and agent_id=p_agent_id) then
   raise exception 'knowledge_usage_activity_agent_mismatch';
 end if;
 select progress_id,submission->>'analysis' into v_progress,v_analysis
 from agent_lab.entrepreneurship_unit_progress
 where agent_id=p_agent_id and source_activity_id=p_activity_id
   and submitted_at is not null and status in ('submitted','verified_pass','verified_fail')
 order by submitted_at desc limit 1;
 if v_progress is null or nullif(btrim(v_analysis),'') is null then
   return jsonb_build_object('recorded',0,'reason','no_submitted_analysis_for_activity');
 end if;
 if jsonb_typeof(p_result->'knowledge_usage')<>'array' then
   return jsonb_build_object('recorded',0,'reason','no_explicit_usage');
 end if;
 for v_entry in select value from jsonb_array_elements(p_result->'knowledge_usage') limit 6 loop
   v_attempted:=v_attempted+1;
   v_kind:=v_entry->>'source_kind';v_component:=v_entry->>'component';
   v_excerpt:=nullif(btrim(coalesce(v_entry->>'evidence_excerpt','')),'');
   if v_kind not in ('seed','refresh') or v_component not in ('general','peripheral')
      or v_excerpt is null or char_length(v_excerpt) not between 24 and 450
      or coalesce(v_entry->>'item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   then continue; end if;
   v_item:=(v_entry->>'item_id')::uuid;v_url:=null;v_claim:=null;
   if v_kind='refresh' then
     select k.source_url,k.claim into v_url,v_claim
     from agent_lab.knowledge_refresh_items k
     join agent_lab.agent_knowledge_refresh_links l
       on l.agent_id=p_agent_id and l.item_id=k.item_id and l.component=v_component
     where k.item_id=v_item and k.component=v_component;
   else
     select x.value->>'source_url',x.value->>'claim' into v_url,v_claim
     from agent_lab.agent_knowledge_seed_links l
     join agent_lab.knowledge_seed_packages s on s.seed_package_id=l.seed_package_id
     cross join lateral jsonb_array_elements(s.factual_snapshot) x
     where l.agent_id=p_agent_id and l.component=v_component
       and l.seed_item_id=v_item and x.value->>'item_id'=v_item::text
     limit 1;
   end if;
   -- An agent-supplied claim of use is not enough: require an actual submitted
   -- analysis containing both the exact excerpt and the source's original URL.
   if v_url is null or v_url !~ '^https://' or v_claim is null
      or position(v_excerpt in v_analysis)=0 or position(v_url in v_analysis)=0
   then continue; end if;
   insert into agent_lab.agent_knowledge_usage_links(
    agent_id,activity_id,wake_request_id,unit_progress_id,source_kind,item_id,
    component,evidence_excerpt,source_url,metadata
   ) values (
    p_agent_id,p_activity_id,p_wake_request_id,v_progress,v_kind,v_item,
    v_component,v_excerpt,v_url,
    jsonb_build_object('evidence_level','explicit_source_citation_in_submitted_analysis',
      'claim_accuracy_not_independently_verified',true,'report_version','knowledge_usage_v0_1')
   ) on conflict(activity_id,source_kind,item_id,component) do nothing;
   if found then v_count:=v_count+1; end if;
 end loop;
 return jsonb_build_object('recorded',v_count,'reported',v_attempted,
   'evidence_contract','submitted_analysis_exact_excerpt_and_source_url_v0_1');
end;
$function$;

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
 -- Use only attributed, dated and URL-backed ingest records. Exclude items
 -- already adopted through the original seed, or through this live feed.
 -- This is source availability, not independent claim verification.
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into v_refresh_general from (
    select k.item_id,k.claim,k.component,k.topic,k.publisher,k.source_url,
      k.published_at,k.observation_period,k.fact_kind,
      k.metadata->>'verification' verification,
      k.metadata->>'date_semantics' date_semantics,k.ingested_at
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
      k.metadata->>'verification' verification,
      k.metadata->>'date_semantics' date_semantics,k.ingested_at
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
$function$;

CREATE OR REPLACE FUNCTION agent_lab.commit_knowledge_pool_wake_v0_1(p_agent_id uuid, p_wake_request_id uuid, p_activity_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_component text;v_report jsonb;v_status text;v_count integer:=0;
v_ids uuid[];v_eid uuid;v_candidates jsonb;v_seed_ids uuid[];v_sid uuid;v_seed_candidates jsonb;v_context jsonb;v_seed_package_id uuid;
v_out jsonb:='{}'::jsonb;v_existing text;v_reason text;v_offered_seed_ids uuid[];
v_refresh_candidates jsonb;v_refresh_ids uuid[];v_rid uuid;v_offered_refresh_ids uuid[];v_usage jsonb:='{}'::jsonb;
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
   select coalesce(array_agg((item.value->>'item_id')::uuid),'{}'::uuid[]) into v_offered_seed_ids
     from jsonb_array_elements(v_seed_candidates) item;
   v_refresh_candidates:=coalesce(v_context->(case when v_component='general' then 'general_knowledge' else 'peripheral_knowledge' end)->'refresh_candidates','[]'::jsonb);
   select coalesce(array_agg((item.value->>'item_id')::uuid),'{}'::uuid[]) into v_offered_refresh_ids
     from jsonb_array_elements(v_refresh_candidates) item;
   v_report:=coalesce(p_result->'knowledge_pool_update'->v_component,'{}'::jsonb);
   if jsonb_typeof(v_report)<>'object' then v_report:='{}'::jsonb; end if;
   v_ids:='{}'::uuid[];v_seed_ids:='{}'::uuid[];v_refresh_ids:='{}'::uuid[];
   v_reason:=null;
   if p_activity_id is null then
     v_status:='deferred';v_reason:='successful_cognition_activity_not_provided';
   elsif v_report='{}'::jsonb then
     v_status:=case when jsonb_array_length(v_candidates)+jsonb_array_length(v_seed_candidates)+jsonb_array_length(v_refresh_candidates)=0 then 'unchanged' else 'deferred' end;
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
     -- Match the exact model-selected UUID strings against this wake's offer.
     -- A set-based join avoids accidentally accepting unoffered IDs.
     select coalesce(array_agg(distinct x.item_id::uuid),'{}'::uuid[])
       into v_refresh_ids
     from jsonb_array_elements_text(
       case when jsonb_typeof(v_report->'refresh_item_ids')='array'
         then v_report->'refresh_item_ids' else '[]'::jsonb end
     ) x(item_id)
     join jsonb_array_elements(v_refresh_candidates) c on c->>'item_id'=x.item_id
     where x.item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
     if v_status in ('added','revised') and cardinality(v_ids)+cardinality(v_seed_ids)+cardinality(v_refresh_ids)=0 then
        v_status:='deferred';v_reason:='no_valid_source_backed_candidate';
     end if;
   end if;
   -- In the presence of offered evidence, an empty/boilerplate "unchanged"
   -- is an incomplete review, not a successful knowledge check. A substantive
   -- explanation of declining an item may remain unchanged.
   if v_status='unchanged'
      and jsonb_array_length(v_candidates)+jsonb_array_length(v_seed_candidates)+jsonb_array_length(v_refresh_candidates)>0
      and cardinality(v_ids)+cardinality(v_seed_ids)+cardinality(v_refresh_ids)=0
      and (
        nullif(btrim(coalesce(v_report->>'note','')),'') is null
        or lower(coalesce(v_report->>'note','')) like '%no new%knowledge evidence provided%'
      )
    then
      v_status:='deferred';v_reason:='offered_evidence_not_substantively_reviewed';
   end if;
   -- A non-acquisition status cannot retain apparent source-adoption IDs.
   if v_status in ('unchanged','stale','deferred') then v_ids:='{}'::uuid[];v_seed_ids:='{}'::uuid[];v_refresh_ids:='{}'::uuid[]; end if;
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
   if v_status in ('added','revised','revalidated') and cardinality(v_refresh_ids)>0 then
     foreach v_rid in array v_refresh_ids loop
       insert into agent_lab.agent_knowledge_refresh_links(
         agent_id,item_id,component,first_wake_request_id,metadata
       ) values(p_agent_id,v_rid,v_component,p_wake_request_id,
         jsonb_build_object('source','knowledge_refresh_items','agent_selected',true,
           'verification','source_attribution_only'))
       on conflict(agent_id,item_id,component) do nothing;
     end loop;
   end if;
   insert into agent_lab.knowledge_wake_updates(
     agent_id,wake_request_id,component,status,source_event_ids,source_seed_item_ids,source_refresh_item_ids,agent_report,metadata)
   values(p_agent_id,p_wake_request_id,v_component,v_status,v_ids,v_seed_ids,v_refresh_ids,
     jsonb_build_object('agent_status',v_report->>'status','note',left(coalesce(v_report->>'note',''),800)),
     jsonb_build_object('activity_id',p_activity_id,'reason',v_reason,'protocol','knowledge_pool_v0_2_refresh_provenance',
       'candidate_count',jsonb_array_length(v_candidates),'seed_candidate_count',jsonb_array_length(v_seed_candidates),
       'refresh_candidate_count',jsonb_array_length(v_refresh_candidates),'offered_refresh_item_ids',to_jsonb(v_offered_refresh_ids),'offered_seed_item_ids',to_jsonb(v_offered_seed_ids),'source_backed_ids',cardinality(v_ids),'source_seed_ids',cardinality(v_seed_ids),'source_refresh_ids',cardinality(v_refresh_ids),
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
   v_out:=v_out||jsonb_build_object(v_component,jsonb_build_object('status',v_status,'source_event_count',cardinality(v_ids),'source_seed_count',cardinality(v_seed_ids),'source_refresh_count',cardinality(v_refresh_ids),'reason',v_reason));
 end loop;
 v_usage:=agent_lab.record_knowledge_usage_v0_1(p_agent_id,p_wake_request_id,p_activity_id,p_result);
 return v_out||jsonb_build_object('documented_usage',v_usage);
end;
$function$;
revoke all on function agent_lab.record_knowledge_usage_v0_1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
commit;
-- Test fixtures were inserted and rolled back. Never seed economic claims
-- as a side effect of this migration. When the feed has no new item, the
-- agent's unchanged status remains valid.


-- knowledge_pool_adopted_context_v0_2
-- Re-expose a bounded set of already adopted source-backed items so uptake can
-- affect later cognition; source attribution remains distinct from factual verification.
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
v_adopted_general jsonb:='[]'::jsonb;v_adopted_peripheral jsonb:='[]'::jsonb;
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
      k.metadata->>'verification' verification,
      k.metadata->>'date_semantics' date_semantics,k.ingested_at
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
      k.metadata->>'verification' verification,
      k.metadata->>'date_semantics' date_semantics,k.ingested_at
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
 -- Keep a bounded, source-backed view of knowledge the agent already adopted.
 -- This makes uptake reusable across later wakes without pretending that
 -- source attribution independently proves the claim.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.adopted_at desc,t.published_at desc),'[]'::jsonb)
 into v_adopted_general from (
   select * from (
     select 'refresh'::text source_kind,k.item_id,k.claim,k.topic,k.publisher,k.source_url,
       k.published_at,k.observation_period,k.fact_kind,l.adopted_at
     from agent_lab.agent_knowledge_refresh_links l
     join agent_lab.knowledge_refresh_items k on k.item_id=l.item_id
     where l.agent_id=p_agent_id and l.component='general'
     union all
     select 'seed'::text source_kind,l.seed_item_id item_id,
       x.value->>'claim' claim,x.value->>'topic' topic,x.value->>'publisher' publisher,
       x.value->>'source_url' source_url,nullif(x.value->>'published_at','')::timestamptz published_at,
       x.value->>'observation_period' observation_period,x.value->>'fact_kind' fact_kind,l.observed_at adopted_at
     from agent_lab.agent_knowledge_seed_links l
     join agent_lab.knowledge_seed_packages s on s.seed_package_id=l.seed_package_id
     cross join lateral jsonb_array_elements(s.factual_snapshot) x
     where l.agent_id=p_agent_id and l.component='general'
       and x.value->>'item_id'=l.seed_item_id::text
   ) u order by adopted_at desc,published_at desc nulls last limit 8
 ) t;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.adopted_at desc,t.published_at desc),'[]'::jsonb)
 into v_adopted_peripheral from (
   select * from (
     select 'refresh'::text source_kind,k.item_id,k.claim,k.topic,k.publisher,k.source_url,
       k.published_at,k.observation_period,k.fact_kind,l.adopted_at
     from agent_lab.agent_knowledge_refresh_links l
     join agent_lab.knowledge_refresh_items k on k.item_id=l.item_id
     where l.agent_id=p_agent_id and l.component='peripheral'
     union all
     select 'seed'::text source_kind,l.seed_item_id item_id,
       x.value->>'claim' claim,x.value->>'topic' topic,x.value->>'publisher' publisher,
       x.value->>'source_url' source_url,nullif(x.value->>'published_at','')::timestamptz published_at,
       x.value->>'observation_period' observation_period,x.value->>'fact_kind' fact_kind,l.observed_at adopted_at
     from agent_lab.agent_knowledge_seed_links l
     join agent_lab.knowledge_seed_packages s on s.seed_package_id=l.seed_package_id
     cross join lateral jsonb_array_elements(s.factual_snapshot) x
     where l.agent_id=p_agent_id and l.component='peripheral'
       and x.value->>'item_id'=l.seed_item_id::text
   ) u order by adopted_at desc,published_at desc nulls last limit 5
 ) t;
 return jsonb_build_object(
   'version','knowledge_pool_v0_2_refresh_provenance',
   'seed_version',v_seed.version,
   'seed_as_of',v_seed.created_at,
   'general_knowledge',jsonb_build_object('topics',v_seed.general_topics,'candidate_events',v_general,'seed_candidates',v_seed_general,'refresh_candidates',v_refresh_general,'adopted_items',v_adopted_general,'last_checked_at',v_last_general),
   'peripheral_knowledge',jsonb_build_object('topics',v_seed.peripheral_topics,'candidate_events',v_peripheral,'seed_candidates',v_seed_peripheral,'refresh_candidates',v_refresh_peripheral,'adopted_items',v_adopted_peripheral,'last_checked_at',v_last_peripheral),
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


-- Keep failed/cancelled wake bookkeeping on the same v0.2 protocol label.
CREATE OR REPLACE FUNCTION agent_lab.mark_knowledge_wake_interrupted_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_enabled boolean:=false;
begin
 if new.status not in ('failed','cancelled') or new.status is not distinct from old.status then
   return new;
 end if;
 select coalesce((metadata->>'knowledge_pool_enabled')::boolean,false) into v_enabled
 from agent_lab.runtime_config where config_id=1;
 if not v_enabled then return new; end if;
 insert into agent_lab.knowledge_wake_updates(
    agent_id,wake_request_id,component,status,agent_report,metadata)
 select new.agent_id,new.wake_request_id,component,'deferred','{}'::jsonb,
  jsonb_build_object('protocol','knowledge_pool_v0_2_refresh_provenance',
    'reason','wake_not_completed','wake_status',new.status,
    'error',left(coalesce(new.last_error,''),350),'not_expertise_verification',true)
 from unnest(ARRAY['general','peripheral']) component
 where exists(select 1 from agent_lab.agent_knowledge_pools p where p.agent_id=new.agent_id)
 on conflict(agent_id,wake_request_id,component) do nothing;
 return new;
end;
$function$
;


-- Provenance join indexes required by Supabase performance advisor.
create index if not exists agent_knowledge_refresh_links_item_idx
  on agent_lab.agent_knowledge_refresh_links(item_id);
create index if not exists agent_knowledge_refresh_links_wake_idx
  on agent_lab.agent_knowledge_refresh_links(first_wake_request_id);
create index if not exists agent_knowledge_usage_links_unit_idx
  on agent_lab.agent_knowledge_usage_links(unit_progress_id);
create index if not exists agent_knowledge_usage_links_wake_idx
  on agent_lab.agent_knowledge_usage_links(wake_request_id);
create index if not exists knowledge_wake_updates_wake_idx
  on agent_lab.knowledge_wake_updates(wake_request_id);
