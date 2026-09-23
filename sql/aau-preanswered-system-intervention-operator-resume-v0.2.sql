-- Prevent an already-answered, resolved automatic intervention from being
-- replayed as direct administrator chat during operator unpause. Preserve
-- strict reply requirements for genuine human messages.
begin;
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
        on ie.intervention_id=nullif(m.metadata->>'intervention_id','')::uuid
       and ie.agent_id=q.agent_id and ie.message_id=m.message_id
      where q.wake_request_id=p_wake_request_id
        and q.agent_id=v_agent_id
        and (
          coalesce((q.metadata->>'attention_arbiter')::boolean,false)=true
          or coalesce((q.metadata->>'operator_resume')::boolean,false)=true
        )
        and m.metadata->>'system_authored'='true'
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

CREATE OR REPLACE FUNCTION public.aau_control_room_admin_unpause(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_agent agent_lab.agents%rowtype;
  v_run agent_lab.autonomous_lifecycle_runs%rowtype;
  v_message_id uuid;
  v_wake_id uuid;
  v_trigger text := 'operator_resume';
  v_payload jsonb;
  v_dual_enabled boolean := false;
  v_allowlist jsonb := '[]'::jsonb;
begin
  select * into v_agent from agent_lab.agents where agent_id=p_agent_id and status<>'archived';
  if v_agent.agent_id is null then raise exception 'agent_missing_or_archived'; end if;
  if coalesce(v_agent.primary_model_provider,'')<>'nvidia_direct' or coalesce(v_agent.primary_model_id,'')='' then raise exception 'agent_not_bound_to_nvidia_direct'; end if;
  select * into v_run from agent_lab.autonomous_lifecycle_runs where agent_id=p_agent_id;
  if v_run.run_id is null then raise exception 'autonomous_lifecycle_missing'; end if;
  -- Two-agent experimental mode is an explicit, exact-ID allowlist; all
  -- other agents retain the isolated single-agent restart guard.
  select coalesce((metadata->>'dual_agent_mode_enabled')::boolean,false),
         coalesce(metadata->'dual_agent_allowlist','[]'::jsonb)
    into v_dual_enabled,v_allowlist
    from agent_lab.runtime_config where config_id=1 for update;
  if v_dual_enabled then
    if v_allowlist <> jsonb_build_array(
      '3b190e7e-b452-4888-9850-3a35a4e95cad',
      '69d013d2-cfb7-4953-b05a-598774618ed2') then
      raise exception 'dual_agent_allowlist_unexpected';
    end if;
    if not (v_allowlist @> jsonb_build_array(p_agent_id::text)) then
      raise exception 'agent_not_authorized_for_dual_mode';
    end if;
  end if;
  if exists(
    select 1 from agent_lab.autonomous_lifecycle_runs r
    where r.agent_id<>p_agent_id and r.status in ('starting','running','degraded')
      and (not v_dual_enabled or not (v_allowlist @> jsonb_build_array(r.agent_id::text)))
  ) then raise exception 'another_autonomous_agent_running'; end if;

  update agent_lab.wake_queue set status='cancelled',completed_at=coalesce(completed_at,now()),last_error='superseded_by_admin_unpause',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancel_reason','admin_unpause_clean_start') where agent_id=p_agent_id and status in ('queued','claimed','running');
  update agent_lab.wake_intents set status='cancelled',cancelled_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancel_reason','admin_unpause_clean_start') where agent_id=p_agent_id and status='active';

  select m.message_id into v_message_id from agent_lab.admin_chat_messages m
  where m.agent_id=p_agent_id and m.sender_kind='admin' and m.delivery_status in ('queued','scheduled')
    -- System interventions already resolved and answered must never become
    -- a new direct administrator chat simply because an operator resumes.
    and not (
      m.metadata->>'origin'='automatic_runtime_intervention_v0_1'
      and m.metadata->>'system_authored'='true'
      and m.metadata->>'not_human_admin'='true'
      and exists (
        select 1 from agent_lab.intervention_events ie
        where ie.intervention_id=nullif(m.metadata->>'intervention_id','')::uuid
          and ie.agent_id=m.agent_id and ie.message_id=m.message_id and ie.status='resolved'
      )
      and exists (
        select 1 from agent_lab.admin_chat_messages reply
        where reply.agent_id=m.agent_id and reply.sender_kind='agent'
          and reply.reply_to_message_id=m.message_id
          and nullif(btrim(reply.content),'') is not null
      )
    )
  order by m.created_at desc limit 1;

  if v_message_id is not null then v_trigger:='admin_chat'; end if;
  v_payload:=case when v_message_id is not null
    then jsonb_build_object('reason','Administrator resumed the agent with pending direct chat messages.','admin_chat_message_id',v_message_id)
    else jsonb_build_object('reason','Administrator resumed autonomous lifecycle from Agent Control Room.') end;

  insert into agent_lab.wake_queue(agent_id,source_kind,trigger_type,priority,status,due_at,payload,metadata)
  values(p_agent_id,'manual',v_trigger,1,'queued',now(),v_payload,jsonb_build_object('autonomous_lifecycle',true,'operator_resume',true,'admin_chat',v_message_id is not null,'admin_chat_message_id',v_message_id,'protocol_version','next_intent_protocol_v0_1','intent_timing_version','intent_timing_v0_2','operator_control_room',true))
  returning wake_request_id into v_wake_id;

  if v_message_id is not null then
    update agent_lab.admin_chat_messages
       set delivery_status='scheduled',source_wake_request_id=v_wake_id,updated_at=now()
     where message_id=v_message_id
       and agent_id=p_agent_id
       and sender_kind='admin'
       and delivery_status in ('queued','scheduled');
  end if;

  update agent_lab.autonomous_lifecycle_runs
  set status='running',next_wake_at=now(),last_error=null,
      metadata=(coalesce(metadata,'{}'::jsonb)
        -'paused_at'-'pause_reason'
        -'repair_required'-'repair_reason'-'repair_required_at'-'failed_wake_request_id')
        ||jsonb_build_object(
          'resumed_at',now(),
          'resumed_by','agent_control_room_admin',
          'admin_control_version','admin_control_v0_2',
          'last_repair_cleared_at',now(),
          'last_repair_clear_reason','explicit_admin_unpause'
        ),
      updated_at=now()
  where agent_id=p_agent_id;
  update agent_lab.state set state_payload=(coalesce(state_payload,'{}'::jsonb)-'paused_at'-'pause_reason'-'repair_pause_reason')||jsonb_build_object('system_paused',false,'awake',true,'sleeping',false,'wake_pending',true,'intent_pending',true,'between_cognition_ticks',false,'inactive_between_wakes',false,'wake_pending_since',now(),'intent_pending_since',now(),'admin_control_version','admin_control_v0_2'),updated_at=now() where agent_id=p_agent_id;
  update agent_lab.agent_existence_accounts
  set account_state='current',levy_enabled=true,next_due_at=now()+interval '1 minute',
      metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at'-'failed_wake_request_id')
        ||jsonb_build_object(
          'resumed_at',now(),
          'resume_rule','restart_next_due_from_resume_time',
          'admin_control_version','admin_control_v0_2'
        ),
      updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.operator_alerts
  set status='resolved',resolved_at=now(),last_seen_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'resolved_reason','explicit_admin_unpause_recovery',
        'resolved_at',now()
      )
  where agent_id=p_agent_id
    and alert_type='orphaned_autonomous_intent_exhausted'
    and status='open';
  update agent_lab.runtime_config set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('current_experimental_agent_id',p_agent_id,'current_experimental_agent_label',v_agent.internal_label,'current_runtime_mode',case when v_dual_enabled then 'dual_agent_autonomous_nvidia_serial' else 'single_agent_autonomous_nvidia' end,'experimental_intent_loop_state','running','experimental_intent_loop_reason',null,'global_pause',true,'admin_control_version','admin_control_v0_2','intent_timing_version','intent_timing_v0_2','minimum_time_intent_delay_minutes',5),updated_at=now() where config_id=1;

  return jsonb_build_object('status','running','agent_id',p_agent_id,'wake_request_id',v_wake_id,'trigger_type',v_trigger,'pending_chat',v_message_id is not null,'dual_agent_mode',v_dual_enabled);
end;
$function$
;
commit;
