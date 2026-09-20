
-- AAU Knowledge Pool v0.1: seed, source-backed context and idempotent wake audit.
create or replace function agent_lab.ensure_agent_knowledge_pool_v0_1(p_agent_id uuid)
returns jsonb language plpgsql security invoker
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare v_seed uuid; v_actual uuid;
begin
  select seed_package_id into v_seed from agent_lab.knowledge_seed_packages
   where status='active' order by created_at desc limit 1;
  if v_seed is null then return jsonb_build_object('status','seed_unavailable'); end if;
  insert into agent_lab.agent_knowledge_pools(agent_id,seed_package_id,general_state,peripheral_state)
  select a.agent_id,v_seed,
    jsonb_build_object('initialized_at',now(),'source','seed_package','factual_claims','not_preverified'),
    jsonb_build_object('initialized_at',now(),'source','seed_package','interest_selection','agent_autonomous')
  from agent_lab.agents a where a.agent_id=p_agent_id
  on conflict(agent_id) do nothing;
  select seed_package_id into v_actual from agent_lab.agent_knowledge_pools where agent_id=p_agent_id;
  return jsonb_build_object('status',case when v_actual is not null then 'ready' else 'agent_missing' end,
    'seed_package_id',v_actual);
end;
$function$;

create or replace function agent_lab.agent_knowledge_birth_seed_v0_1()
returns trigger language plpgsql security invoker
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
begin
  perform agent_lab.ensure_agent_knowledge_pool_v0_1(new.agent_id);
  return new;
end;
$function$;
drop trigger if exists trg_aau_agent_knowledge_birth_seed_v0_1 on agent_lab.agents;
create trigger trg_aau_agent_knowledge_birth_seed_v0_1
after insert on agent_lab.agents for each row
execute function agent_lab.agent_knowledge_birth_seed_v0_1();

create or replace function agent_lab.build_knowledge_pool_context_v0_1(p_agent_id uuid)
returns jsonb language plpgsql stable security invoker
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare v_seed agent_lab.knowledge_seed_packages%rowtype;
v_general jsonb:='[]'::jsonb;v_peripheral jsonb:='[]'::jsonb;
v_last_general timestamptz;v_last_peripheral timestamptz;
begin
 select s.* into v_seed from agent_lab.agent_knowledge_pools p
 join agent_lab.knowledge_seed_packages s using(seed_package_id)
 where p.agent_id=p_agent_id;
 if v_seed.seed_package_id is null then return jsonb_build_object('status','not_seeded'); end if;
 select max(created_at) into v_last_general from agent_lab.knowledge_wake_updates
   where agent_id=p_agent_id and component='general';
 select max(created_at) into v_last_peripheral from agent_lab.knowledge_wake_updates
   where agent_id=p_agent_id and component='peripheral';

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
 return jsonb_build_object(
   'version','knowledge_pool_v0_1',
   'seed_version',v_seed.version,
   'seed_as_of',v_seed.created_at,
   'general_knowledge',jsonb_build_object('topics',v_seed.general_topics,'candidate_events',v_general,'last_checked_at',v_last_general),
   'peripheral_knowledge',jsonb_build_object('topics',v_seed.peripheral_topics,'candidate_events',v_peripheral,'last_checked_at',v_last_peripheral),
   'source_orientation',v_seed.source_manifest,
   'rules',jsonb_build_array(
     'General and Peripheral Knowledge are separate from verified expertise.',
     'Only source-backed candidate event IDs may be adopted; a source is not proof a claim is true.',
     'If you reviewed a component, return knowledge_pool_update.general / peripheral with status and chosen event_ids. No compelled interest or competence claim.',
     'If there is no new evidence, unchanged is valid; do not invent a fact. Cite authoritative source and observation date for current economic figures.',
     'A paused external news broadcaster is not authorization to reactivate it.')
 );
end;
$function$;

create or replace function agent_lab.commit_knowledge_pool_wake_v0_1(
 p_agent_id uuid,p_wake_request_id uuid,p_activity_id uuid,p_result jsonb
) returns jsonb language plpgsql security invoker
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare v_component text;v_report jsonb;v_status text;v_count integer:=0;
v_ids uuid[];v_eid uuid;v_candidates jsonb;v_context jsonb;
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
   v_report:=coalesce(p_result->'knowledge_pool_update'->v_component,'{}'::jsonb);
   if jsonb_typeof(v_report)<>'object' then v_report:='{}'::jsonb; end if;
   v_ids:='{}'::uuid[];
   v_reason:=null;
   if p_activity_id is null then
     v_status:='deferred';v_reason:='successful_cognition_activity_not_provided';
   elsif v_report='{}'::jsonb then
     v_status:=case when jsonb_array_length(v_candidates)=0 then 'unchanged' else 'deferred' end;
     if v_status='deferred' then v_reason:='agent_review_missing'; end if;
   else
     v_status:=coalesce(v_report->>'status','deferred');
     if v_status not in ('added','revised','revalidated','unchanged','stale','deferred') then
       v_status:='deferred';v_reason:='unrecognized_agent_status';
     end if;
     if jsonb_typeof(v_report->'event_ids')='array' then
       for v_eid in
        select (x->>0)::uuid from jsonb_array_elements(v_report->'event_ids') x
        where jsonb_typeof(x)='array' and jsonb_array_length(x)>0
           and (x->>0) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       loop
         if exists(select 1 from jsonb_array_elements(v_candidates) c where c->>'event_id'=v_eid::text) then
            v_ids:=array_append(v_ids,v_eid);
         end if;
       end loop;
       -- Also allow regular UUID string event_ids; never cast malformed values.
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
     if v_status in ('added','revised') and cardinality(v_ids)=0 then
        v_status:='deferred';v_reason:='no_valid_source_backed_candidate_event';
     end if;
   end if;
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
   insert into agent_lab.knowledge_wake_updates(
     agent_id,wake_request_id,component,status,source_event_ids,agent_report,metadata)
   values(p_agent_id,p_wake_request_id,v_component,v_status,v_ids,
     jsonb_build_object('agent_status',v_report->>'status','note',left(coalesce(v_report->>'note',''),800)),
     jsonb_build_object('activity_id',p_activity_id,'reason',v_reason,'protocol','knowledge_pool_v0_1',
       'candidate_count',jsonb_array_length(v_candidates),'source_backed_ids',cardinality(v_ids),
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
   v_out:=v_out||jsonb_build_object(v_component,jsonb_build_object('status',v_status,'source_event_count',cardinality(v_ids),'reason',v_reason));
 end loop;
 return v_out;
end;
$function$;

revoke all on function agent_lab.ensure_agent_knowledge_pool_v0_1(uuid) from public,anon,authenticated;
revoke all on function agent_lab.build_knowledge_pool_context_v0_1(uuid) from public,anon,authenticated;
revoke all on function agent_lab.commit_knowledge_pool_wake_v0_1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
