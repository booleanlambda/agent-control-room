-- AAU Knowledge Pool v0.2: durable source-backed seed availability vs agent-authored uptake.
-- A verified source snapshot is available automatically at birth / when seed is updated;
-- its availability is not represented as an agent's belief or independently demonstrated expertise.
-- Empty/boilerplate unchanged reports with offered evidence are deferred, not successful review.
CREATE OR REPLACE FUNCTION agent_lab.ensure_agent_knowledge_pool_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_seed uuid; v_actual uuid; v_general jsonb; v_peripheral jsonb; v_version text;
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
  select p.seed_package_id,s.version,
    coalesce((select jsonb_agg(item.value->'item_id') from jsonb_array_elements(s.factual_snapshot) item
      where item.value->>'component'='general'),'[]'::jsonb),
    coalesce((select jsonb_agg(item.value->'item_id') from jsonb_array_elements(s.factual_snapshot) item
      where item.value->>'component'='peripheral'),'[]'::jsonb)
  into v_actual,v_version,v_general,v_peripheral
    from agent_lab.agent_knowledge_pools p join agent_lab.knowledge_seed_packages s using(seed_package_id)
    where p.agent_id=p_agent_id FOR UPDATE OF p;
  -- Ingest the verified shared birth seed into the agent's durable available
  -- pool. This records information availability, NOT an agent-authored belief
  -- or autonomous acceptance. The package holds the full facts/provenance.
  update agent_lab.agent_knowledge_pools p set
    general_state=p.general_state||jsonb_build_object(
      'available_seed_item_ids',v_general,'seed_package_version',v_version,
      'seed_ingestion_origin','operator_verified_source_snapshot',
      'availability_is_not_agent_uptake',true,'seed_available_at',now()),
    peripheral_state=p.peripheral_state||jsonb_build_object(
      'available_seed_item_ids',v_peripheral,'seed_package_version',v_version,
      'seed_ingestion_origin','operator_verified_source_snapshot',
      'availability_is_not_agent_uptake',true,'seed_available_at',now()),
    updated_at=now()
    where p.agent_id=p_agent_id and v_actual is not null
      and (p.general_state->'available_seed_item_ids' IS DISTINCT FROM v_general
        or p.peripheral_state->'available_seed_item_ids' IS DISTINCT FROM v_peripheral
        or p.general_state->>'seed_package_version' IS DISTINCT FROM v_version);
  return jsonb_build_object('status',case when v_actual is not null then 'ready' else 'agent_missing' end,
    'seed_package_id',v_actual,'available_general_seed_facts',jsonb_array_length(coalesce(v_general,'[]'::jsonb)),'available_peripheral_seed_facts',jsonb_array_length(coalesce(v_peripheral,'[]'::jsonb)));
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
   -- In the presence of offered evidence, an empty/boilerplate "unchanged"
   -- is an incomplete review, not a successful knowledge check. A substantive
   -- explanation of declining an item may remain unchanged.
   if v_status='unchanged'
      and jsonb_array_length(v_candidates)+jsonb_array_length(v_seed_candidates)>0
      and cardinality(v_ids)+cardinality(v_seed_ids)=0
      and (
        nullif(btrim(coalesce(v_report->>'note','')),'') is null
        or lower(coalesce(v_report->>'note','')) like '%no new%knowledge evidence provided%'
      )
    then
      v_status:='deferred';v_reason:='offered_evidence_not_substantively_reviewed';
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
       'candidate_count',jsonb_array_length(v_candidates),'seed_candidate_count',jsonb_array_length(v_seed_candidates),'offered_seed_item_ids',to_jsonb(v_offered_seed_ids),'source_backed_ids',cardinality(v_ids),'source_seed_ids',cardinality(v_seed_ids),
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
REVOKE ALL ON FUNCTION agent_lab.ensure_agent_knowledge_pool_v0_1(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION agent_lab.commit_knowledge_pool_wake_v0_1(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
