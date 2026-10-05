-- AAU runtime execution invariants v0.2
-- Canonical production hardening for wake ownership and pause-safe model-call accounting.

create unique index if not exists wake_queue_one_executing_per_agent_idx
  on agent_lab.wake_queue(agent_id)
  where status in ('claimed','running');

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
  v_active_worker_id text;
  v_health_worker_id text;
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
  select q.wake_request_id,q.worker_id
    into v_active_wake_id,v_active_worker_id
  from agent_lab.wake_queue q
  where q.agent_id=p_agent_id
    and q.status in ('claimed','running')
  order by coalesce(q.started_at,q.claimed_at,q.created_at) desc
  limit 1;

  select worker_id,greatest(
           coalesce(heartbeat_at,'epoch'::timestamptz),
           coalesce(wake_ping_at,'epoch'::timestamptz)
         )
    into v_health_worker_id,v_worker_activity_at
  from agent_lab.runtime_worker_health
  where queue_name='aau.intent';

  v_reuse_active_wake :=
    v_active_wake_id is not null
    and nullif(v_active_worker_id,'') is not null
    and v_health_worker_id is not distinct from v_active_worker_id
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
          'admin_control_version','admin_control_v0_3',
          'last_repair_cleared_at',now(),
          'last_repair_clear_reason','explicit_admin_unpause'
        ),
      updated_at=now()
  where agent_id=p_agent_id;
  update agent_lab.state set state_payload=(coalesce(state_payload,'{}'::jsonb)-'paused_at'-'pause_reason'-'repair_pause_reason'-'failed_wake_request_id'-'wake_pending_since'-'intent_pending_since')||jsonb_build_object('system_paused',false,'awake',true,'sleeping',false,'wake_pending',true,'intent_pending',true,'between_cognition_ticks',false,'inactive_between_wakes',false,'wake_pending_since',now(),'intent_pending_since',now(),'admin_control_version','admin_control_v0_3'),updated_at=now() where agent_id=p_agent_id;
  update agent_lab.agent_existence_accounts
  set account_state='current',levy_enabled=true,next_due_at=now()+interval '1 minute',
      metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at'-'failed_wake_request_id')
        ||jsonb_build_object(
          'resumed_at',now(),
          'resume_rule','restart_next_due_from_resume_time',
          'admin_control_version','admin_control_v0_3'
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
  update agent_lab.runtime_config set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('current_experimental_agent_id',p_agent_id,'current_experimental_agent_label',v_agent.internal_label,'current_runtime_mode',case when v_dual_enabled then 'dual_agent_autonomous_model_serial' else 'single_agent_autonomous_model' end,'experimental_intent_loop_state','running','experimental_intent_loop_reason',null,'global_pause',true,'admin_control_version','admin_control_v0_3','intent_timing_version','intent_timing_v0_2','minimum_time_intent_delay_minutes',5),updated_at=now() where config_id=1;

  return jsonb_build_object('status','running','agent_id',p_agent_id,'wake_request_id',v_wake_id,'trigger_type',v_trigger,'pending_chat',v_message_id is not null,'dual_agent_mode',v_dual_enabled,'reused_active_wake',v_reuse_active_wake,'admin_resume_contract','admin_resume_owner_bound_active_wake_reuse_v0_2');
end;
$function$;

-- AAU semantic model-call reservation/settlement v0.1
-- Reserve worst-case semantic compute before transport, then settle to provider-observed usage.
-- Explicit HTTP failures with no reported usage release the reservation.
-- Timeouts / connection-loss with unknown usage settle conservatively at the full reservation.

alter table agent_lab.cognition_runtime_events
  drop constraint if exists cognition_runtime_events_outcome_check;

alter table agent_lab.cognition_runtime_events
  add constraint cognition_runtime_events_outcome_check
  check (outcome in ('charged','budget_exhausted','reserved','settled','released'));

create or replace function public.aau_bridge_reserve_semantic_model_call_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_model text,
  p_epoch_no integer,
  p_event_key text,
  p_event_fingerprint text,
  p_reserved_units integer,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','public'
as $function$
declare
  v_bound text;
  v_runtime agent_lab.cognition_assignment_runtime%rowtype;
  v_existing agent_lab.cognition_runtime_events%rowtype;
  v_before integer;
  v_after integer;
  v_repeat integer:=0;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select primary_model_id into v_bound from agent_lab.agents where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'semantic_model_reservation_bound_model_mismatch';
  end if;
  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or p_epoch_no not between 1 and 1000000
     or length(coalesce(p_event_key,'')) not between 1 and 240
     or p_reserved_units not between 1 and 1000000 then
    raise exception 'semantic_model_reservation_invalid_identity_or_units';
  end if;
  if p_event_fingerprint is not null
     and (length(p_event_fingerprint)<>64 or p_event_fingerprint !~ '^[0-9a-f]{64}$') then
    raise exception 'semantic_model_reservation_invalid_fingerprint';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object'
     or octet_length(p_metadata::text)>16000 then
    raise exception 'semantic_model_reservation_invalid_metadata';
  end if;

  select * into v_runtime
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id and assignment_key=p_assignment_key
    and model_id=p_model and epoch_no=p_epoch_no
  for update;
  if not found then raise exception 'semantic_model_reservation_runtime_missing'; end if;

  if not exists(
    select 1
    from agent_lab.wake_queue q
    join agent_lab.autonomous_lifecycle_runs r on r.agent_id=q.agent_id
    where q.wake_request_id=p_wake_request_id
      and q.agent_id=p_agent_id
      and q.status in ('claimed','running')
      and r.status in ('starting','running','degraded')
  ) then
    raise exception 'semantic_model_reservation_wake_not_running';
  end if;

  select * into v_existing
  from agent_lab.cognition_runtime_events
  where runtime_id=v_runtime.runtime_id and event_key=p_event_key;

  if found then
    if v_existing.event_kind<>'model_call_reservation'
       or v_existing.cost_units<>p_reserved_units then
      raise exception 'semantic_model_reservation_event_key_conflict';
    end if;
    if p_event_fingerprint is not null then
      select count(*)::integer into v_repeat
      from agent_lab.cognition_runtime_events
      where runtime_id=v_runtime.runtime_id
        and event_fingerprint=p_event_fingerprint
        and event_kind='model_call_reservation';
    end if;
    return jsonb_build_object(
      'status','ready','contract','model_call_reservation_settlement_v0_2_pause_barrier',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,'remaining_budget_units',v_runtime.remaining_budget_units,
      'reservation_event_id',v_existing.event_id,'reservation_event_key',v_existing.event_key,
      'reserved_units',v_existing.cost_units,'event_outcome',v_existing.outcome,
      'fingerprint_repeat_count',v_repeat,'idempotent',true,
      'available',v_existing.outcome='reserved'
    );
  end if;

  v_before:=v_runtime.remaining_budget_units;
  if v_runtime.status<>'active' or v_before<p_reserved_units then
    update agent_lab.cognition_assignment_runtime
       set status='budget_exhausted',updated_at=now()
     where runtime_id=v_runtime.runtime_id returning * into v_runtime;
    insert into agent_lab.cognition_runtime_events(
      runtime_id,agent_id,wake_request_id,assignment_key,model_id,epoch_no,
      node_path,event_key,event_kind,event_fingerprint,cost_units,
      budget_before,budget_after,outcome,metadata
    ) values (
      v_runtime.runtime_id,p_agent_id,p_wake_request_id,p_assignment_key,p_model,p_epoch_no,
      null,p_event_key,'model_call_reservation',p_event_fingerprint,0,
      v_before,v_before,'budget_exhausted',
      coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
        'contract','model_call_reservation_settlement_v0_2_pause_barrier',
        'requested_reservation_units',p_reserved_units
      )
    ) returning * into v_existing;
    return jsonb_build_object(
      'status','ready','contract','model_call_reservation_settlement_v0_2_pause_barrier',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status','budget_exhausted','remaining_budget_units',v_before,
      'reservation_event_id',v_existing.event_id,'reservation_event_key',v_existing.event_key,
      'reserved_units',0,'event_outcome','budget_exhausted',
      'fingerprint_repeat_count',0,'idempotent',false,'available',false
    );
  end if;

  v_after:=v_before-p_reserved_units;
  update agent_lab.cognition_assignment_runtime
     set remaining_budget_units=v_after,transition_count=transition_count+1,updated_at=now()
   where runtime_id=v_runtime.runtime_id returning * into v_runtime;

  insert into agent_lab.cognition_runtime_events(
    runtime_id,agent_id,wake_request_id,assignment_key,model_id,epoch_no,
    node_path,event_key,event_kind,event_fingerprint,cost_units,
    budget_before,budget_after,outcome,metadata
  ) values (
    v_runtime.runtime_id,p_agent_id,p_wake_request_id,p_assignment_key,p_model,p_epoch_no,
    null,p_event_key,'model_call_reservation',p_event_fingerprint,p_reserved_units,
    v_before,v_after,'reserved',
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'contract','model_call_reservation_settlement_v0_2_pause_barrier','reserved_units',p_reserved_units
    )
  ) returning * into v_existing;

  if p_event_fingerprint is not null then
    select count(*)::integer into v_repeat
    from agent_lab.cognition_runtime_events
    where runtime_id=v_runtime.runtime_id
      and event_fingerprint=p_event_fingerprint
      and event_kind='model_call_reservation';
  end if;

  return jsonb_build_object(
    'status','ready','contract','model_call_reservation_settlement_v0_2_pause_barrier',
    'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
    'runtime_status',v_runtime.status,'remaining_budget_units',v_runtime.remaining_budget_units,
    'reservation_event_id',v_existing.event_id,'reservation_event_key',v_existing.event_key,
    'reserved_units',p_reserved_units,'event_outcome','reserved',
    'fingerprint_repeat_count',v_repeat,'idempotent',false,'available',true
  );
end;
$function$;

create or replace function public.aau_bridge_settle_semantic_model_call_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_assignment_key text,
  p_model text,
  p_epoch_no integer,
  p_reservation_event_id uuid,
  p_settled_units integer,
  p_settlement_reason text,
  p_provider_status_code integer default null,
  p_provider_total_tokens integer default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','public'
as $function$
declare
  v_bound text;
  v_runtime agent_lab.cognition_assignment_runtime%rowtype;
  v_reservation agent_lab.cognition_runtime_events%rowtype;
  v_existing agent_lab.cognition_runtime_events%rowtype;
  v_settlement_key text;
  v_before integer;
  v_after integer;
  v_refund integer;
  v_outcome text;
  v_wake_status text;
  v_lifecycle_status text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select primary_model_id into v_bound from agent_lab.agents where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'semantic_model_settlement_bound_model_mismatch';
  end if;
  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or p_epoch_no not between 1 and 1000000
     or p_reservation_event_id is null
     or p_settled_units<0 or p_settled_units>1000000
     or length(coalesce(p_settlement_reason,'')) not between 1 and 240 then
    raise exception 'semantic_model_settlement_invalid_input';
  end if;
  if p_provider_status_code is not null and p_provider_status_code not between 100 and 599 then
    raise exception 'semantic_model_settlement_invalid_provider_status';
  end if;
  if p_provider_total_tokens is not null and p_provider_total_tokens<0 then
    raise exception 'semantic_model_settlement_invalid_provider_tokens';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object'
     or octet_length(p_metadata::text)>16000 then
    raise exception 'semantic_model_settlement_invalid_metadata';
  end if;

  select * into v_runtime
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id and assignment_key=p_assignment_key
    and model_id=p_model and epoch_no=p_epoch_no
  for update;
  if not found then raise exception 'semantic_model_settlement_runtime_missing'; end if;

  select * into v_reservation
  from agent_lab.cognition_runtime_events
  where event_id=p_reservation_event_id and runtime_id=v_runtime.runtime_id
  for update;
  if not found or v_reservation.event_kind<>'model_call_reservation'
     or v_reservation.outcome<>'reserved' then
    raise exception 'semantic_model_settlement_reservation_invalid';
  end if;
  if p_settled_units>v_reservation.cost_units then
    raise exception 'semantic_model_settlement_exceeds_reservation';
  end if;

  v_settlement_key:='modelsettle:'||p_reservation_event_id::text;
  select * into v_existing
  from agent_lab.cognition_runtime_events
  where runtime_id=v_runtime.runtime_id and event_key=v_settlement_key;
  if found then
    return jsonb_build_object(
      'status',coalesce(v_existing.metadata->>'settlement_status','ready'),
      'contract','model_call_reservation_settlement_v0_2_pause_barrier',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,'remaining_budget_units',v_runtime.remaining_budget_units,
      'settlement_event_id',v_existing.event_id,'reservation_event_id',p_reservation_event_id,
      'reserved_units',v_reservation.cost_units,
      'settled_units',coalesce((v_existing.metadata->>'reported_settled_units')::integer,v_existing.cost_units),
      'refund_units',coalesce((v_existing.metadata->>'refund_units')::integer,0),
      'event_outcome',v_existing.outcome,'idempotent',true
    );
  end if;

  select q.status,r.status
    into v_wake_status,v_lifecycle_status
  from agent_lab.wake_queue q
  left join agent_lab.autonomous_lifecycle_runs r on r.agent_id=q.agent_id
  where q.wake_request_id=v_reservation.wake_request_id
    and q.agent_id=p_agent_id;

  if coalesce(v_wake_status,'') not in ('claimed','running')
     or coalesce(v_lifecycle_status,'') not in ('starting','running','degraded') then
    v_before:=v_runtime.remaining_budget_units;
    insert into agent_lab.cognition_runtime_events(
      runtime_id,agent_id,wake_request_id,assignment_key,model_id,epoch_no,
      node_path,event_key,event_kind,event_fingerprint,cost_units,
      budget_before,budget_after,outcome,metadata
    ) values (
      v_runtime.runtime_id,p_agent_id,v_reservation.wake_request_id,p_assignment_key,p_model,p_epoch_no,
      v_reservation.node_path,v_settlement_key,'model_call_settlement',
      v_reservation.event_fingerprint,p_settled_units,
      v_before,v_before,'settled',
      coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
        'contract','model_call_reservation_settlement_v0_2_pause_barrier',
        'settlement_status','obsolete_wake_audit_only',
        'reservation_event_id',p_reservation_event_id,
        'reservation_event_key',v_reservation.event_key,
        'reserved_units',v_reservation.cost_units,
        'reported_settled_units',p_settled_units,
        'refund_units',0,
        'suppressed_refund_units',greatest(0,v_reservation.cost_units-p_settled_units),
        'settlement_reason',left(p_settlement_reason,240),
        'provider_status_code',p_provider_status_code,
        'provider_total_tokens',p_provider_total_tokens,
        'wake_status',v_wake_status,
        'lifecycle_status',v_lifecycle_status,
        'authoritative_runtime_mutation',false,
        'pause_epoch_barrier',true
      )
    ) returning * into v_existing;

    return jsonb_build_object(
      'status','obsolete_wake_audit_only',
      'contract','model_call_reservation_settlement_v0_2_pause_barrier',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,'remaining_budget_units',v_runtime.remaining_budget_units,
      'settlement_event_id',v_existing.event_id,'reservation_event_id',p_reservation_event_id,
      'reserved_units',v_reservation.cost_units,'settled_units',p_settled_units,
      'refund_units',0,'event_outcome','settled','idempotent',false,
      'authoritative_runtime_mutation',false
    );
  end if;

  v_refund:=v_reservation.cost_units-p_settled_units;
  v_before:=v_runtime.remaining_budget_units;
  v_after:=least(v_runtime.initial_budget_units,v_before+v_refund);
  v_outcome:=case when p_settled_units=0 then 'released' else 'settled' end;

  update agent_lab.cognition_assignment_runtime
     set remaining_budget_units=v_after,updated_at=now()
   where runtime_id=v_runtime.runtime_id returning * into v_runtime;

  insert into agent_lab.cognition_runtime_events(
    runtime_id,agent_id,wake_request_id,assignment_key,model_id,epoch_no,
    node_path,event_key,event_kind,event_fingerprint,cost_units,
    budget_before,budget_after,outcome,metadata
  ) values (
    v_runtime.runtime_id,p_agent_id,v_reservation.wake_request_id,p_assignment_key,p_model,p_epoch_no,
    v_reservation.node_path,v_settlement_key,'model_call_settlement',
    v_reservation.event_fingerprint,p_settled_units,
    v_before,v_after,v_outcome,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'contract','model_call_reservation_settlement_v0_2_pause_barrier',
      'reservation_event_id',p_reservation_event_id,
      'reservation_event_key',v_reservation.event_key,
      'reserved_units',v_reservation.cost_units,'settled_units',p_settled_units,
      'refund_units',v_refund,'settlement_reason',left(p_settlement_reason,240),
      'provider_status_code',p_provider_status_code,'provider_total_tokens',p_provider_total_tokens
    )
  ) returning * into v_existing;

  return jsonb_build_object(
    'status','ready','contract','model_call_reservation_settlement_v0_2_pause_barrier',
    'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
    'runtime_status',v_runtime.status,'remaining_budget_units',v_runtime.remaining_budget_units,
    'settlement_event_id',v_existing.event_id,'reservation_event_id',p_reservation_event_id,
    'reserved_units',v_reservation.cost_units,'settled_units',p_settled_units,
    'refund_units',v_refund,'event_outcome',v_outcome,'idempotent',false
  );
end;
$function$;

revoke all on function public.aau_bridge_reserve_semantic_model_call_v0_1(
  text,uuid,uuid,text,text,integer,text,text,integer,jsonb
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_reserve_semantic_model_call_v0_1(
  text,uuid,uuid,text,text,integer,text,text,integer,jsonb
) to anon;

revoke all on function public.aau_bridge_settle_semantic_model_call_v0_1(
  text,uuid,text,text,integer,uuid,integer,text,integer,integer,jsonb
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_settle_semantic_model_call_v0_1(
  text,uuid,text,text,integer,uuid,integer,text,integer,integer,jsonb
) to anon;

-- Applied epoch-7 reconciliation:
-- 295 units restored: 262 from explicit HTTP failures with zero reported tokens,
-- plus 33 from successful calls settling below their conservative reservation.
-- Ambiguous timeout/interrupted calls were deliberately not refunded.

