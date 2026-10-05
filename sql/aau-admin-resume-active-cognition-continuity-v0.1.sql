-- AAU admin-resume active cognition continuity v0.1
-- Prevent Start/Unpause from cancelling a healthy in-flight cognition and
-- starting a concurrent replacement against the same durable semantic tree.
begin;
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
  v_active_wake_id uuid;
  v_worker_activity_at timestamptz;
  v_reuse_active_wake boolean := false;
begin
  select * into v_agent from agent_lab.agents where agent_id=p_agent_id and status<>'archived';
  if v_agent.agent_id is null then raise exception 'agent_missing_or_archived'; end if;
  if nullif(btrim(coalesce(v_agent.primary_model_provider,'')),'') is null or nullif(btrim(coalesce(v_agent.primary_model_id,'')),'') is null then raise exception 'agent_model_binding_missing'; end if;
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

  -- Preserve a genuinely live in-flight cognition. Cancelling a RUNNING wake here
  -- can leave its provider call executing while a replacement wake starts, creating
  -- concurrent writers against the same durable semantic node.
  select q.wake_request_id
    into v_active_wake_id
  from agent_lab.wake_queue q
  where q.agent_id=p_agent_id
    and q.status in ('claimed','running')
  order by coalesce(q.started_at,q.claimed_at,q.created_at) desc
  limit 1;

  select greatest(
           coalesce(heartbeat_at,'epoch'::timestamptz),
           coalesce(wake_ping_at,'epoch'::timestamptz)
         )
    into v_worker_activity_at
  from agent_lab.runtime_worker_health
  where queue_name='aau.intent';

  v_reuse_active_wake :=
    v_active_wake_id is not null
    and v_worker_activity_at is not null
    and v_worker_activity_at > now()-interval '6 minutes';

  if v_reuse_active_wake then
    v_wake_id:=v_active_wake_id;
    update agent_lab.wake_queue
       set status='cancelled',
           completed_at=coalesce(completed_at,now()),
           last_error='superseded_by_live_admin_resume',
           metadata=coalesce(metadata,'{}'::jsonb)
             ||jsonb_build_object(
                 'cancel_reason','admin_unpause_reused_live_wake',
                 'preserved_wake_request_id',v_active_wake_id
               )
     where agent_id=p_agent_id
       and status='queued'
       and wake_request_id<>v_active_wake_id;
  else
    update agent_lab.wake_queue
       set status='cancelled',
           completed_at=coalesce(completed_at,now()),
           last_error='superseded_by_admin_unpause',
           metadata=coalesce(metadata,'{}'::jsonb)
             ||jsonb_build_object('cancel_reason','admin_unpause_clean_start')
     where agent_id=p_agent_id
       and status in ('queued','claimed','running');

    update agent_lab.wake_intents
       set status='cancelled',
           cancelled_at=now(),
           metadata=coalesce(metadata,'{}'::jsonb)
             ||jsonb_build_object('cancel_reason','admin_unpause_clean_start')
     where agent_id=p_agent_id
       and status='active';
  end if;

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
      and (
        exists (
          select 1 from agent_lab.admin_chat_messages reply
          where reply.agent_id=m.agent_id and reply.sender_kind='agent'
            and reply.reply_to_message_id=m.message_id
            and nullif(btrim(reply.content),'') is not null
        )
        or nullif(m.metadata->>'superseded_at','') is not null
        or coalesce(m.metadata->>'terminal_reason','') like 'superseded_by_%'
        or exists (
          select 1 from agent_lab.intervention_events ie_superseded
          where ie_superseded.intervention_id=nullif(m.metadata->>'intervention_id','')::uuid
            and ie_superseded.agent_id=m.agent_id
            and ie_superseded.message_id=m.message_id
            and ie_superseded.status='resolved'
            and coalesce(ie_superseded.evidence->>'resolution','') like 'superseded_by_%'
        )
      )
    )
  order by m.created_at desc limit 1;

  -- A Start/Unpause click is not an instruction to interrupt live cognition.
  -- Leave any queued admin message for the next scheduler boundary.
  if v_reuse_active_wake then
    v_message_id:=null;
  end if;

  if v_message_id is not null then v_trigger:='admin_chat'; end if;
  v_payload:=case when v_message_id is not null
    then jsonb_build_object('reason','Administrator resumed the agent with pending direct chat messages.','admin_chat_message_id',v_message_id)
    else jsonb_build_object('reason','Administrator resumed autonomous lifecycle from Agent Control Room.') end;

  if not v_reuse_active_wake then
  insert into agent_lab.wake_queue(agent_id,source_kind,trigger_type,priority,status,due_at,payload,metadata)
  values(p_agent_id,'manual',v_trigger,1,'queued',now(),v_payload,jsonb_build_object('autonomous_lifecycle',true,'operator_resume',true,'admin_chat',v_message_id is not null,'admin_chat_message_id',v_message_id,'protocol_version','next_intent_protocol_v0_1','intent_timing_version','intent_timing_v0_2','operator_control_room',true))
  returning wake_request_id into v_wake_id;
  end if;

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
  update agent_lab.runtime_config set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('current_experimental_agent_id',p_agent_id,'current_experimental_agent_label',v_agent.internal_label,'current_runtime_mode',case when v_dual_enabled then 'dual_agent_autonomous_model_serial' else 'single_agent_autonomous_model' end,'experimental_intent_loop_state','running','experimental_intent_loop_reason',null,'global_pause',true,'admin_control_version','admin_control_v0_2','intent_timing_version','intent_timing_v0_2','minimum_time_intent_delay_minutes',5),updated_at=now() where config_id=1;

  return jsonb_build_object('status','running','agent_id',p_agent_id,'wake_request_id',v_wake_id,'trigger_type',v_trigger,'pending_chat',v_message_id is not null,'dual_agent_mode',v_dual_enabled,'reused_active_wake',v_reuse_active_wake,'admin_resume_contract','admin_resume_active_wake_reuse_v0_1');
end;
$function$

commit;
