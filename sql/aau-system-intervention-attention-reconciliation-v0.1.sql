-- Prevent resolved, already-answered automatic interventions from being
-- dispatched again as direct human admin messages. Keep the human reply gate.
-- Deployed 2026-09-23 following Silas MKT504 attention handoff recovery.
begin;
CREATE OR REPLACE FUNCTION agent_lab.arbitrate_attention_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  p agent_lab.attention_policies%rowtype; a agent_lab.attention_items%rowtype; v_pressure numeric; v_threshold numeric; v_sleeping boolean:=false; v_sleep_until timestamptz; v_paused boolean:=false; v_run_status text; v_running uuid; v_existing_attention_wake uuid; v_wake uuid; v_susp uuid; v_source_kind text; v_trigger text; v_payload jsonb; v_meta jsonb; v_admin_id uuid; v_file_id uuid;
begin
  select * into p from agent_lab.attention_policies where active order by created_at desc limit 1;
  if not found then return jsonb_build_object('status','no_active_policy'); end if;
  select coalesce((s.state_payload->>'sleeping')::boolean,false),nullif(s.state_payload->>'sleep_until','')::timestamptz,coalesce((s.state_payload->>'system_paused')::boolean,false) into v_sleeping,v_sleep_until,v_paused from agent_lab.state s where s.agent_id=p_agent_id;
  select status into v_run_status from agent_lab.autonomous_lifecycle_runs where agent_id=p_agent_id;
  -- Do not redispatch an already answered, independently resolved SYSTEM intervention.
  -- Automatic interventions use admin_message transport but are not new human chat.
  -- Require BOTH authoritative intervention resolution and the actual agent reply.
  update agent_lab.attention_items x
     set state='consumed',updated_at=now(),
         metadata=coalesce(x.metadata,'{}'::jsonb)||jsonb_build_object(
           'reconciliation','resolved_system_intervention_already_answered',
           'reconciled_at',now(),'agent_reply_preexisting',true)
  where x.agent_id=p_agent_id
    and x.state in ('pending','deferred')
    and x.source_type='admin_message'
    and x.attention_class='runtime_intervention'
    and x.provenance->>'origin'='automatic_runtime_intervention_v0_1'
    and x.payload->>'system_authored'='true'
    and exists (
      select 1 from agent_lab.intervention_events ie
      where ie.intervention_id=nullif(x.payload->>'intervention_id','')::uuid
        and ie.agent_id=x.agent_id and ie.status='resolved'
    )
    and exists (
      select 1 from agent_lab.admin_chat_messages reply
      where reply.agent_id=x.agent_id and reply.sender_kind='agent'
        and reply.reply_to_message_id=nullif(x.payload->>'admin_chat_message_id','')::uuid
        and nullif(btrim(reply.content),'') is not null
    );

  select x.* into a from agent_lab.attention_items x
   where x.agent_id=p_agent_id and x.state in ('pending','deferred') and x.available_at<=now() and (x.expires_at is null or x.expires_at>now())
     and not (x.source_type='world_event' and p.world_news_enabled=false)
   order by agent_lab.attention_pressure_v0_1(x.attention_item_id) desc,x.created_at asc limit 1 for update;
  if not found then return jsonb_build_object('status','nothing_pending','policy_version',p.policy_version); end if;
  v_pressure:=agent_lab.attention_pressure_v0_1(a.attention_item_id);
  v_threshold:=case when v_sleeping then p.sleep_dispatch_threshold else p.awake_dispatch_threshold end;

  -- Fixed sleep is an uninterruptible runtime-owned five-minute window.
  -- Attention continues to accumulate and be scored, but it cannot end sleep early.
  if v_sleeping and v_sleep_until is not null then
    if now() < v_sleep_until then
      update agent_lab.attention_items
         set state='deferred',
             metadata=metadata||jsonb_build_object(
               'last_arbiter_decision','fixed_sleep_defer',
               'last_arbiter_at',now(),
               'reason','fixed_five_minute_sleep_active',
               'sleep_until',v_sleep_until
             ),
             updated_at=now()
       where attention_item_id=a.attention_item_id;
      insert into agent_lab.attention_dispatches(
        agent_id,attention_item_id,decision,attention_pressure,threshold,sleeping,reason_codes,policy_version
      ) values(
        p_agent_id,a.attention_item_id,'queue',v_pressure,v_threshold,true,
        array['fixed_five_minute_sleep_active','attention_cannot_interrupt_sleep'],
        p.policy_version
      );
      return jsonb_build_object(
        'status','queued_during_fixed_sleep',
        'attention_item_id',a.attention_item_id,
        'pressure',v_pressure,
        'sleep_until',v_sleep_until,
        'sleep_duration_minutes',5
      );
    else
      return jsonb_build_object(
        'status','sleep_complete_due',
        'attention_item_id',a.attention_item_id,
        'pressure',v_pressure,
        'sleep_until',v_sleep_until
      );
    end if;
  end if;

  if v_paused or coalesce(v_run_status,'') not in ('starting','running','degraded') then
    update agent_lab.attention_items set state='deferred',metadata=metadata||jsonb_build_object('last_arbiter_decision','suppressed','last_arbiter_at',now(),'reason','system_or_lifecycle_paused'),updated_at=now() where attention_item_id=a.attention_item_id;
    insert into agent_lab.attention_dispatches(agent_id,attention_item_id,decision,attention_pressure,threshold,sleeping,reason_codes,policy_version) values(p_agent_id,a.attention_item_id,'suppressed',v_pressure,v_threshold,v_sleeping,array['system_or_lifecycle_paused'],p.policy_version);
    return jsonb_build_object('status','suppressed','attention_item_id',a.attention_item_id,'pressure',v_pressure);
  end if;

  select q.wake_request_id into v_running from agent_lab.wake_queue q where q.agent_id=p_agent_id and q.status in ('claimed','running') order by q.started_at desc nulls last,q.claimed_at desc nulls last limit 1;
  if v_running is not null then
    if a.interrupt_policy in ('boundary','mandatory_boundary') and (a.interrupt_policy='mandatory_boundary' or v_pressure>=p.boundary_interrupt_threshold) then
      update agent_lab.attention_items set state='deferred',metadata=metadata||jsonb_build_object('last_arbiter_decision','boundary_interrupt','boundary_waiting_on_wake',v_running,'last_arbiter_at',now()),updated_at=now() where attention_item_id=a.attention_item_id;
      update agent_lab.state set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object('boundary_interrupt_pending',true,'boundary_attention_item_id',a.attention_item_id,'boundary_interrupt_requested_at',now()),updated_at=now() where agent_id=p_agent_id;
      insert into agent_lab.attention_dispatches(agent_id,attention_item_id,decision,attention_pressure,threshold,sleeping,current_wake_request_id,reason_codes,policy_version) values(p_agent_id,a.attention_item_id,'boundary_interrupt',v_pressure,p.boundary_interrupt_threshold,v_sleeping,v_running,array['running_cognition_not_aborted','deliver_at_execution_boundary'],p.policy_version);
      return jsonb_build_object('status','boundary_interrupt_pending','attention_item_id',a.attention_item_id,'current_wake_request_id',v_running,'pressure',v_pressure);
    end if;
    return jsonb_build_object('status','queued_behind_running_cognition','attention_item_id',a.attention_item_id,'pressure',v_pressure);
  end if;

  select q.wake_request_id into v_existing_attention_wake
  from agent_lab.wake_queue q
  where q.agent_id=p_agent_id and q.status='queued' and coalesce((q.metadata->>'attention_arbiter')::boolean,false)=true
  order by q.created_at asc limit 1;
  if v_existing_attention_wake is not null then
    if a.source_type in ('admin_message','file') and exists(select 1 from agent_lab.wake_queue q where q.wake_request_id=v_existing_attention_wake and coalesce((q.metadata->>'admin_chat')::boolean,false)=true) then
      update agent_lab.attention_items set state='coalesced',dispatch_wake_request_id=v_existing_attention_wake,metadata=metadata||jsonb_build_object('last_arbiter_decision','coalesce','coalesced_at',now()),updated_at=now() where attention_item_id=a.attention_item_id;
      begin v_admin_id:=nullif(coalesce(a.payload->>'admin_chat_message_id',case when a.source_type='admin_message' then a.source_ref else null end),'')::uuid; exception when others then v_admin_id:=null; end;
      if v_admin_id is not null then update agent_lab.admin_chat_messages set delivery_status='scheduled',source_wake_request_id=v_existing_attention_wake,updated_at=now(),metadata=metadata||jsonb_build_object('coalesced_into_wake',v_existing_attention_wake,'attention_item_id',a.attention_item_id) where message_id=v_admin_id; end if;
      begin v_file_id:=nullif(a.payload->>'admin_file_id','')::uuid; exception when others then v_file_id:=null; end;
      if v_file_id is not null then update agent_lab.agent_files set source_wake_request_id=v_existing_attention_wake,updated_at=now() where file_id=v_file_id; end if;
      insert into agent_lab.attention_dispatches(agent_id,attention_item_id,decision,attention_pressure,threshold,sleeping,dispatch_wake_request_id,reason_codes,policy_version) values(p_agent_id,a.attention_item_id,'coalesce',v_pressure,v_threshold,v_sleeping,v_existing_attention_wake,array['existing_attention_wake','same_direct_conversation_channel'],p.policy_version);
      return jsonb_build_object('status','coalesced','attention_item_id',a.attention_item_id,'wake_request_id',v_existing_attention_wake);
    end if;
    return jsonb_build_object('status','queued_behind_dispatched_attention','attention_item_id',a.attention_item_id,'wake_request_id',v_existing_attention_wake);
  end if;

  if v_pressure<v_threshold and a.interrupt_policy<>'mandatory_boundary' then
    insert into agent_lab.attention_dispatches(agent_id,attention_item_id,decision,attention_pressure,threshold,sleeping,reason_codes,policy_version) values(p_agent_id,a.attention_item_id,'queue',v_pressure,v_threshold,v_sleeping,array[case when v_sleeping then 'below_sleep_threshold' else 'below_awake_threshold' end],p.policy_version);
    return jsonb_build_object('status','queued_below_threshold','attention_item_id',a.attention_item_id,'pressure',v_pressure,'threshold',v_threshold);
  end if;

  v_susp:=agent_lab.suspend_next_time_intent_v0_1(p_agent_id,a.attention_item_id);
  v_source_kind:=case when a.source_type in ('peer_message','world_event') then 'stimulus_bus' when a.source_type in ('system_event','resource_event','execution_retry','tool_completion') then 'system' else 'manual' end;
  v_trigger:='attention_'||a.source_type;
  v_payload:=jsonb_build_object('reason','Attention arbiter dispatched '||a.attention_class,'attention_item_id',a.attention_item_id,'attention_source_type',a.source_type,'attention_source_ref',a.source_ref)||coalesce(a.payload,'{}'::jsonb);
  v_meta:=jsonb_build_object('autonomous_lifecycle',true,'attention_arbiter',true,'attention_arbiter_version','attention_arbiter_v0_1','attention_item_id',a.attention_item_id,'attention_pressure',v_pressure,'suspension_id',v_susp,'protocol_version','next_intent_protocol_v0_1');
  if a.source_type in ('admin_message','file') then
    begin v_admin_id:=nullif(coalesce(a.payload->>'admin_chat_message_id',case when a.source_type='admin_message' then a.source_ref else null end),'')::uuid; exception when others then v_admin_id:=null; end;
    v_meta:=v_meta||jsonb_build_object('admin_chat',true,'admin_chat_message_id',v_admin_id,'operator_control_room',true);
    v_payload:=v_payload||jsonb_build_object('admin_chat_message_id',v_admin_id);
  end if;
  if a.source_type='file' then
    begin v_file_id:=nullif(coalesce(a.payload->>'admin_file_id',a.source_ref),'')::uuid; exception when others then v_file_id:=null; end;
    v_meta:=v_meta||jsonb_build_object('admin_file',true,'admin_file_id',v_file_id,'file_channel_version','agent_file_channel_v0_2');
    v_payload:=v_payload||jsonb_build_object('admin_file_id',v_file_id);
  end if;
  insert into agent_lab.wake_queue(agent_id,source_kind,trigger_type,priority,status,due_at,payload,metadata)
  values(p_agent_id,v_source_kind,v_trigger,least(1,greatest(0,v_pressure)),'queued',now(),v_payload,v_meta) returning wake_request_id into v_wake;
  update agent_lab.attention_items set state='dispatched',dispatch_wake_request_id=v_wake,metadata=metadata||jsonb_build_object('dispatched_at',now(),'suspension_id',v_susp),updated_at=now() where attention_item_id=a.attention_item_id;
  if v_admin_id is not null then update agent_lab.admin_chat_messages set delivery_status='scheduled',source_wake_request_id=v_wake,updated_at=now(),metadata=metadata||jsonb_build_object('attention_item_id',a.attention_item_id,'attention_arbiter_version','attention_arbiter_v0_1') where message_id=v_admin_id; end if;
  if v_file_id is not null then update agent_lab.agent_files set source_wake_request_id=v_wake,metadata=metadata||jsonb_build_object('attention_item_id',a.attention_item_id),updated_at=now() where file_id=v_file_id; end if;
  update agent_lab.state set state_payload=(coalesce(state_payload,'{}'::jsonb)-'boundary_interrupt_pending'-'boundary_attention_item_id')||jsonb_build_object('awake',true,'sleeping',false,'wake_pending',true,'intent_pending',true,'wake_pending_since',now(),'intent_pending_since',now(),'active_attention_item_id',a.attention_item_id,'woken_by_attention',v_sleeping),updated_at=now() where agent_id=p_agent_id;
  update agent_lab.autonomous_lifecycle_runs set status='running',next_wake_at=now(),last_error=null,updated_at=now() where agent_id=p_agent_id;
  insert into agent_lab.attention_dispatches(agent_id,attention_item_id,decision,attention_pressure,threshold,sleeping,suspension_id,dispatch_wake_request_id,reason_codes,policy_version) values(p_agent_id,a.attention_item_id,'dispatch',v_pressure,v_threshold,v_sleeping,v_susp,v_wake,array['highest_attention_pressure','execution_slot_available',case when v_susp is null then 'no_intent_suspended' else 'prior_intent_preserved' end],p.policy_version);
  return jsonb_build_object('status','dispatched','attention_item_id',a.attention_item_id,'wake_request_id',v_wake,'suspension_id',v_susp,'pressure',v_pressure,'threshold',v_threshold,'was_sleeping',v_sleeping);
end;
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.apply_cognition_result_with_identity_clock(p_wake_request_id uuid, p_result jsonb, p_runtime jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_applied jsonb; v_agent_id uuid; v_activity_id uuid; v_cognition_run_id uuid; v_embodiment_result jsonb; v_existence_credit_result jsonb; v_expertise_requests jsonb:='[]'::jsonb; v_expertise_result jsonb; v_application_result jsonb; v_lifecycle_result jsonb; v_file_result jsonb; v_attention_result jsonb; v_knowledge_result jsonb:='{}'::jsonb; v_knowledge_enabled boolean:=false; v_stage text; v_req jsonb; v_complete_count integer:=0; v_runtime jsonb; v_result jsonb; v_admin_chat boolean:=false; v_attention_interrupt boolean:=false; v_preanswered_system_intervention boolean:=false;
begin
  select coalesce((metadata->>'knowledge_pool_enabled')::boolean,false)
    into v_knowledge_enabled from agent_lab.runtime_config where config_id=1;
  v_result:=coalesce(p_result,'{}'::jsonb); v_runtime:=coalesce(p_runtime,'{}'::jsonb)||jsonb_build_object('compute_cost',0,'research_cost',0,'economic_cost_policy','existence_time_only_v0_1','wake_cognition_compute_charge',0,'wake_cognition_research_charge',0);
  select q.agent_id,coalesce((q.metadata->>'admin_chat')::boolean,false),coalesce((q.metadata->>'attention_arbiter')::boolean,false) into v_agent_id,v_admin_chat,v_attention_interrupt from agent_lab.wake_queue q where q.wake_request_id=p_wake_request_id;
  -- A resolved, already-answered automatic intervention is not a fresh
  -- human administrator message. Every actual human chat still requires reply.
  if v_admin_chat then
    select exists (
      select 1
      from agent_lab.wake_queue q
      join agent_lab.admin_chat_messages m
        on m.message_id=nullif(q.payload->>'admin_chat_message_id','')::uuid
       and m.agent_id=q.agent_id
      join agent_lab.intervention_events ie
        on ie.intervention_id=nullif(q.payload->>'intervention_id','')::uuid
       and ie.agent_id=q.agent_id and ie.message_id=m.message_id
      where q.wake_request_id=p_wake_request_id
        and q.agent_id=v_agent_id
        and coalesce((q.metadata->>'attention_arbiter')::boolean,false)=true
        and q.payload->>'system_authored'='true'
        and m.metadata->>'origin'='automatic_runtime_intervention_v0_1'
        and m.metadata->>'not_human_admin'='true'
        and ie.status='resolved'
        and exists (
          select 1 from agent_lab.admin_chat_messages reply
          where reply.agent_id=q.agent_id and reply.sender_kind='agent'
            and reply.reply_to_message_id=m.message_id
            and nullif(btrim(reply.content),'') is not null
        )
    ) into v_preanswered_system_intervention;
    if not v_preanswered_system_intervention then
      if nullif(btrim(coalesce(v_result->'outbound_message'->>'message','')),'') is null then
        raise exception 'ADMIN_CHAT_REPLY_REQUIRED: direct administrator chat wakes must return a nonempty outbound_message.message';
      end if;
      v_result:=jsonb_set(v_result,'{outbound_message,target_agent_id}',to_jsonb('admin_control_room'::text),true);
    end if;
  end if;
  if v_agent_id is not null then
    v_stage:=agent_lab.current_mandatory_lifecycle_stage(v_agent_id); v_expertise_requests:=agent_lab.extract_expertise_artifact_initiations(v_result);
    if not v_attention_interrupt and v_stage='expertise_artifact'
      and exists(
        select 1 from agent_lab.expertise_economic_proposals ep
        where ep.agent_id=v_agent_id and ep.status='approved'
      ) then
      if jsonb_typeof(v_expertise_requests)='array' then for v_req in select value from jsonb_array_elements(v_expertise_requests) loop if nullif(trim(coalesce(v_req->>'domain','')),'') is not null and nullif(trim(coalesce(v_req->>'target_standard','')),'') is not null and jsonb_typeof(v_req->'scope')='object' and v_req->'scope'<>'{}'::jsonb and jsonb_typeof(v_req->'competencies')='array' and jsonb_array_length(v_req->'competencies')>0 and jsonb_typeof(v_req->'evidence_requirements')='object' and v_req->'evidence_requirements'<>'{}'::jsonb and jsonb_typeof(v_req->'verification_plan')='object' and v_req->'verification_plan'<>'{}'::jsonb and coalesce((agent_lab.validate_expertise_application_v0_1(v_req->'intended_application',v_req->'economic_viability')->>'ok')::boolean,false) then v_complete_count:=v_complete_count+1; end if; end loop; end if;
      if v_complete_count=0 then raise exception 'MANDATORY_EXPERTISE_ARTIFACT_INCOMPLETE: Stage 3 requires associations[] with origin=expertise_artifact_initiation_v0_1 and nonempty domain,target_standard,scope,competencies,evidence_requirements,verification_plan,intended_application,economic_viability under expertise_application_v0_1'; end if;
    end if;
  end if;
  v_applied:=agent_lab.apply_cognition_result_with_identity_clock_pre_embodiment_v0_1(p_wake_request_id,v_result,v_runtime);
  v_agent_id:=nullif(v_applied->>'agent_id','')::uuid; v_activity_id:=nullif(v_applied->>'activity_id','')::uuid; v_cognition_run_id:=nullif(v_applied->>'cognition_run_id','')::uuid;
  if v_agent_id is not null then
    v_existence_credit_result:=agent_lab.apply_existence_credit_request_decision(v_agent_id,v_activity_id,p_wake_request_id,v_result);
    v_embodiment_result:=agent_lab.apply_embodiment_development_update(v_agent_id,v_activity_id,v_cognition_run_id,p_wake_request_id,coalesce(v_result->'embodiment_update','{}'::jsonb));
    v_expertise_result:=agent_lab.apply_expertise_artifact_initiations(v_agent_id,p_wake_request_id,v_activity_id,v_expertise_requests);
    v_application_result:=agent_lab.apply_expertise_application_updates_v0_1(v_agent_id,v_activity_id,coalesce(v_result->'associations','[]'::jsonb));
    v_file_result:=agent_lab.register_agent_file_outputs_v0_1(v_agent_id,v_activity_id,v_cognition_run_id,p_wake_request_id,coalesce(v_result->'associations','[]'::jsonb));
    v_lifecycle_result:=agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
    v_attention_result:=agent_lab.finalize_attention_after_cognition_v0_1(v_agent_id,p_wake_request_id,v_result);
    if v_knowledge_enabled then
      v_knowledge_result:=agent_lab.commit_knowledge_pool_wake_v0_1(
        v_agent_id,p_wake_request_id,v_activity_id,v_result
      );
    end if;
  else
    v_existence_credit_result:=jsonb_build_object('status','skipped','reason','agent_id_missing'); v_embodiment_result:=jsonb_build_object('status','skipped','reason','agent_id_missing'); v_expertise_result:=jsonb_build_object('applied',0,'results','[]'::jsonb,'reason','agent_id_missing'); v_application_result:=jsonb_build_object('updated',0,'results','[]'::jsonb); v_file_result:=jsonb_build_object('created',0,'files','[]'::jsonb); v_lifecycle_result:=jsonb_build_object('enrolled',false,'reason','agent_id_missing'); v_attention_result:=jsonb_build_object('status','skipped','reason','agent_id_missing');
  end if;
  return coalesce(v_applied,'{}'::jsonb)||jsonb_build_object('existence_credit_request',coalesce(v_existence_credit_result,'{}'::jsonb),'existence_credit_runtime_version','existence_credit_v0_1','embodiment_development',coalesce(v_embodiment_result,'{}'::jsonb),'embodiment_runtime_version','embodiment_runtime_v0_1','expertise_artifact_initiation',coalesce(v_expertise_result,'{}'::jsonb),'expertise_artifact_runtime_version','expertise_artifact_initiation_v0_1','expertise_application_updates',coalesce(v_application_result,'{}'::jsonb),'expertise_application_contract_version','expertise_application_v0_1','agent_file_outputs',coalesce(v_file_result,'{}'::jsonb),'file_channel_version','agent_file_channel_v0_1','attention_arbiter',coalesce(v_attention_result,'{}'::jsonb),'attention_arbiter_version','attention_arbiter_v0_1','attention_interrupt_lifecycle_exemption',v_attention_interrupt,'admin_chat_reply_gate','admin_chat_reply_required_v0_2','mandatory_lifecycle',coalesce(v_lifecycle_result,'{}'::jsonb),'mandatory_lifecycle_refresh_version','post_cognition_refresh_v0_2','economic_cost_policy','existence_time_only_v0_1','wake_cognition_compute_charge',0,'knowledge_pool_update',v_knowledge_result,'knowledge_pool_version',case when v_knowledge_enabled then 'knowledge_pool_v0_1' else 'disabled' end);
end;
$function$
;
commit;
