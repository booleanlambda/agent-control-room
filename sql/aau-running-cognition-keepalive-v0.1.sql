-- AAU running-cognition Render keepalive + clean admin resume v0.1
-- Keeps the free Render broker awake only while an autonomous cognition is running.
-- Explicit admin resume clears active repair state and schedules only the selected pending message.

begin;

CREATE OR REPLACE FUNCTION agent_lab.ensure_autonomous_worker_for_due_wake()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'net'
AS $function$
declare
  v_due timestamptz;
  v_agent_id uuid;
  v_running_wake_id uuid;
  v_running_agent_id uuid;
  v_running_started_at timestamptz;
  v_heartbeat timestamptz;
  v_last_ping timestamptz;
  v_request_id bigint;
  v_bridge text;
begin
  -- A Render free web service can hibernate after an inbound-idle window even
  -- while its background worker is still doing long model work. Keep the web
  -- service externally active only while an autonomous cognition is RUNNING.
  select q.wake_request_id,q.agent_id,q.started_at
    into v_running_wake_id,v_running_agent_id,v_running_started_at
  from agent_lab.wake_queue q
  join agent_lab.autonomous_lifecycle_runs r on r.agent_id=q.agent_id
  where r.status in ('starting','running','degraded')
    and q.status='running'
    and coalesce((q.metadata->>'autonomous_lifecycle')::boolean,false)=true
  order by q.started_at asc nulls last
  limit 1;

  select heartbeat_at,wake_ping_at,liveness_bridge
    into v_heartbeat,v_last_ping,v_bridge
  from agent_lab.runtime_worker_health
  where queue_name='aau.intent';

  if v_running_wake_id is not null then
    if v_last_ping is not null and v_last_ping>now()-interval '4 minutes' then
      return jsonb_build_object(
        'action','none',
        'reason','running_cognition_keepalive_recent',
        'wake_request_id',v_running_wake_id,
        'agent_id',v_running_agent_id,
        'started_at',v_running_started_at,
        'last_ping_at',v_last_ping,
        'heartbeat_at',v_heartbeat
      );
    end if;

    select net.http_get(
      url:='https://aau-broker-bridge.onrender.com/healthz',
      params:='{}'::jsonb,
      headers:=jsonb_build_object('user-agent','AAU-Running-Cognition-Keepalive/0.1'),
      timeout_milliseconds:=5000
    ) into v_request_id;

    insert into agent_lab.runtime_worker_health(
      queue_name,consumer_bound,liveness_bridge,wake_ping_at,wake_ping_request_id,
      wake_ping_agent_id,wake_ping_due_at,metadata,updated_at
    )
    values(
      'aau.intent',coalesce(v_heartbeat>now()-interval '2 minutes',false),
      'supabase_pgnet_running_cognition_keepalive_v0_1',now(),v_request_id,
      v_running_agent_id,null,
      jsonb_build_object(
        'protocol_version','runtime_worker_health_v0_2',
        'keepalive_reason','running_autonomous_cognition',
        'keepalive_wake_request_id',v_running_wake_id
      ),now()
    )
    on conflict(queue_name) do update set
      liveness_bridge='supabase_pgnet_running_cognition_keepalive_v0_1',
      wake_ping_at=now(),
      wake_ping_request_id=v_request_id,
      wake_ping_agent_id=v_running_agent_id,
      wake_ping_due_at=null,
      metadata=coalesce(agent_lab.runtime_worker_health.metadata,'{}'::jsonb)
        ||jsonb_build_object(
          'protocol_version','runtime_worker_health_v0_2',
          'keepalive_reason','running_autonomous_cognition',
          'keepalive_wake_request_id',v_running_wake_id
        ),
      updated_at=now();

    return jsonb_build_object(
      'action','pinged_render_worker',
      'reason','running_autonomous_cognition_keepalive',
      'request_id',v_request_id,
      'wake_request_id',v_running_wake_id,
      'agent_id',v_running_agent_id,
      'started_at',v_running_started_at,
      'health_version','runtime_worker_health_v0_2'
    );
  end if;

  -- Existing near-due wake reviver behavior remains unchanged for sleeping
  -- workers: wake Render only when an autonomous queued wake is close.
  select q.agent_id,q.due_at into v_agent_id,v_due
  from agent_lab.wake_queue q
  join agent_lab.autonomous_lifecycle_runs r on r.agent_id=q.agent_id
  where r.status in ('starting','running','degraded')
    and q.status='queued'
    and coalesce((q.metadata->>'autonomous_lifecycle')::boolean,false)=true
    and q.due_at is not null
  order by q.due_at asc
  limit 1;

  if v_due is null then
    return jsonb_build_object('action','none','reason','no_queued_or_running_autonomous_wake');
  end if;
  if v_due>now()+interval '2 minutes' then
    return jsonb_build_object('action','none','reason','next_wake_not_due_soon','next_due_at',v_due);
  end if;

  if v_heartbeat is not null and v_heartbeat>now()-interval '90 seconds' then
    return jsonb_build_object('action','none','reason','worker_already_live','heartbeat_at',v_heartbeat,'next_due_at',v_due);
  end if;
  if v_last_ping is not null and v_last_ping>now()-interval '75 seconds' then
    return jsonb_build_object('action','none','reason','wake_ping_recent','last_ping_at',v_last_ping,'next_due_at',v_due);
  end if;

  select net.http_get(
    url:='https://aau-broker-bridge.onrender.com/healthz',
    params:='{}'::jsonb,
    headers:=jsonb_build_object('user-agent','AAU-Autonomous-Lifecycle-Reviver/0.2'),
    timeout_milliseconds:=5000
  ) into v_request_id;

  insert into agent_lab.runtime_worker_health(
    queue_name,consumer_bound,liveness_bridge,wake_ping_at,wake_ping_request_id,
    wake_ping_agent_id,wake_ping_due_at,metadata,updated_at
  )
  values(
    'aau.intent',false,'supabase_pgnet_due_wake_reviver_v0_1',now(),v_request_id,
    v_agent_id,v_due,jsonb_build_object('protocol_version','runtime_worker_health_v0_2'),now()
  )
  on conflict(queue_name) do update set
    liveness_bridge='supabase_pgnet_due_wake_reviver_v0_1',
    wake_ping_at=now(),
    wake_ping_request_id=v_request_id,
    wake_ping_agent_id=v_agent_id,
    wake_ping_due_at=v_due,
    metadata=coalesce(agent_lab.runtime_worker_health.metadata,'{}'::jsonb)
      ||jsonb_build_object('protocol_version','runtime_worker_health_v0_2'),
    updated_at=now();

  return jsonb_build_object(
    'action','pinged_render_worker','request_id',v_request_id,'agent_id',v_agent_id,
    'next_due_at',v_due,'health_version','runtime_worker_health_v0_2'
  );
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
