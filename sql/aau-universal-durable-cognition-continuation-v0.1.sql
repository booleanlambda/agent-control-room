-- AAU Universal Durable Cognition Continuation v0.1
-- Durable continuation holds and bounded provider retry policy.
-- Applied to Supabase on 2026-09-27.

create or replace function public.aau_bridge_hold_cognition_admission_v0_1(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_error text,
  p_admission jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_status text;
  v_error text:=left(coalesce(p_error,'cognition_admission_deferred'),3000);
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if p_admission is null or jsonb_typeof(p_admission)<>'object'
     or octet_length(p_admission::text)>16000 then
    raise exception 'cognition_admission_payload_invalid';
  end if;

  select q.agent_id,q.status into v_agent_id,v_status
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;

  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;

  if v_status in ('claimed','running','queued') then
    update agent_lab.wake_queue
       set status='failed',
           completed_at=coalesce(completed_at,now()),
           worker_id=null,
           last_error=v_error,
           metadata=(coalesce(metadata,'{}'::jsonb)
             -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
             ||jsonb_build_object(
               'failure_class','cognition_admission_deferred',
               'cognition_admission_contract','cognition_resource_admission_v0_1',
               'cognition_admission_deferred_at',now(),
               'cognition_admission',p_admission,
               'retry_scheduled',false,
               'semantic_state_preserved',true
             )
     where wake_request_id=p_intent_execution_id;
  end if;

  update agent_lab.autonomous_lifecycle_runs
     set status='paused',
         next_wake_at=null,
         last_error=v_error,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'repair_required',false,
           'pause_reason','cognition_admission_deferred',
           'cognition_admission_contract','cognition_resource_admission_v0_1',
           'cognition_admission',p_admission,
           'semantic_state_preserved',true,
           'cognition_admission_deferred_at',now()
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  update agent_lab.agent_existence_accounts
     set account_state='suspended',
         levy_enabled=false,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'suspended_reason','cognition_admission_deferred',
           'suspended_at',now(),
           'resume_rule','explicit_resource_or_operator_resume'
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  update agent_lab.state
     set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
           'system_paused',true,
           'awake',false,
           'sleeping',false,
           'intent_pending',false,
           'wake_pending',false,
           'repair_pause_reason','cognition_admission_deferred',
           'cognition_admission',p_admission
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  return jsonb_build_object(
    'status','admission_deferred',
    'intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,
    'retry_scheduled',false,
    'semantic_state_preserved',true,
    'admission',p_admission
  );
end;
$function$;

create or replace function public.aau_bridge_hold_cognition_runtime_fault_v0_1(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_status text;
  v_error text:=left(coalesce(p_error,'cognition_runtime_fault'),3000);
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status into v_agent_id,v_status
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;

  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;

  if v_status in ('claimed','running','queued') then
    update agent_lab.wake_queue
       set status='failed',
           completed_at=coalesce(completed_at,now()),
           worker_id=null,
           last_error=v_error,
           metadata=(coalesce(metadata,'{}'::jsonb)
             -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
             ||jsonb_build_object(
               'failure_class','cognition_runtime_fault',
               'runtime_fault_contract','universal_durable_cognition_continuation_v0_1',
               'runtime_fault_at',now(),
               'retry_scheduled',false,
               'semantic_state_preserved',true,
               'repair_required',true
             )
     where wake_request_id=p_intent_execution_id;
  end if;

  update agent_lab.autonomous_lifecycle_runs
     set status='paused',
         next_wake_at=null,
         last_error=v_error,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'repair_required',true,
           'repair_reason','cognition_runtime_fault',
           'repair_required_at',now(),
           'failed_wake_request_id',p_intent_execution_id,
           'runtime_fault_contract','universal_durable_cognition_continuation_v0_1',
           'semantic_state_preserved',true
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  update agent_lab.agent_existence_accounts
     set account_state='suspended',
         levy_enabled=false,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'suspended_reason','cognition_runtime_fault',
           'suspended_at',now(),
           'failed_wake_request_id',p_intent_execution_id,
           'resume_rule','repair_then_explicit_resume'
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  update agent_lab.state
     set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
           'system_paused',true,
           'awake',false,
           'sleeping',false,
           'intent_pending',false,
           'wake_pending',false,
           'repair_pause_reason','cognition_runtime_fault',
           'failed_wake_request_id',p_intent_execution_id
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  return jsonb_build_object(
    'status','runtime_fault_held',
    'intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,
    'retry_scheduled',false,
    'semantic_state_preserved',true
  );
end;
$function$;

create or replace function public.aau_bridge_fail_nvidia_provider_transient_v0_1(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_status text;
  v_attempts integer;
  v_after_status text;
  v_due_at timestamptz;
  v_released boolean:=false;
  v_error text:=left(coalesce(p_error,'nvidia_provider_transient'),3000);
  v_retry_minutes integer;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status,q.attempts
    into v_agent_id,v_status,v_attempts
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;

  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;

  if v_status not in ('claimed','running') then
    return jsonb_build_object(
      'status','not_released',
      'intent_execution_id',p_intent_execution_id,
      'agent_id',v_agent_id,
      'wake_status',v_status
    );
  end if;

  v_retry_minutes:=case when coalesce(v_attempts,0)<=1 then 2 else 4 end;
  v_released:=agent_lab.release_wake_request(
    p_intent_execution_id,v_error,v_retry_minutes,3
  );

  select q.status,q.due_at into v_after_status,v_due_at
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;

  update agent_lab.wake_queue
     set metadata=(coalesce(metadata,'{}'::jsonb)
       -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
       -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
       ||jsonb_build_object(
         'failure_class','nvidia_provider_transient',
         'provider_transient_recovery_version','nvidia_provider_transient_bounded_v0_1',
         'provider_transient_max_attempts',3,
         'provider_transient_attempts',v_attempts,
         'provider_transient_last_failure_at',now(),
         'retry_scheduled',v_after_status='queued',
         'recovery_required',v_after_status='failed',
         'model_switch_performed',false
       )
   where wake_request_id=p_intent_execution_id
     and status in ('queued','failed');

  if v_released and v_after_status='queued' then
    update agent_lab.autonomous_lifecycle_runs
       set status='running',
           next_wake_at=v_due_at,
           last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_transient_retry_error',v_error,
             'last_transient_retry_class','nvidia_provider_transient',
             'last_transient_retry_at',now(),
             'last_transient_retry_wake_request_id',p_intent_execution_id,
             'provider_transient_attempts',v_attempts,
             'provider_transient_max_attempts',3,
             'provider_transient_recovery_version','nvidia_provider_transient_bounded_v0_1'
           ),
           updated_at=now()
     where agent_id=v_agent_id
       and status in ('starting','running','degraded');
  elsif v_released and v_after_status='failed' then
    update agent_lab.autonomous_lifecycle_runs
       set status='paused',
           next_wake_at=null,
           last_error=v_error,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'repair_required',true,
             'repair_reason','nvidia_provider_transient_exhausted',
             'repair_required_at',now(),
             'failed_wake_request_id',p_intent_execution_id,
             'provider_transient_attempts',v_attempts,
             'provider_transient_max_attempts',3,
             'provider_transient_recovery_version','nvidia_provider_transient_bounded_v0_1'
           ),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.agent_existence_accounts
       set account_state='suspended',
           levy_enabled=false,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'suspended_reason','nvidia_provider_transient_exhausted',
             'suspended_at',now(),
             'failed_wake_request_id',p_intent_execution_id,
             'resume_rule','restart_next_due_from_resume_time'
           ),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
             'system_paused',true,
             'awake',false,
             'sleeping',false,
             'intent_pending',false,
             'wake_pending',false,
             'repair_pause_reason','nvidia_provider_transient_exhausted',
             'failed_wake_request_id',p_intent_execution_id
           ),
           updated_at=now()
     where agent_id=v_agent_id;
  end if;

  return jsonb_build_object(
    'status',case
      when not v_released then 'not_released'
      when v_after_status='queued' then 'retry_released'
      when v_after_status='failed' then 'repair_required'
      else 'not_released'
    end,
    'intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,
    'failure_class','nvidia_provider_transient',
    'retry_scheduled',v_released and v_after_status='queued',
    'existence_suspended',v_released and v_after_status='failed',
    'max_attempts',3
  );
end;
$function$;

revoke all on function public.aau_bridge_hold_cognition_admission_v0_1(text,uuid,text,jsonb)
  from public,authenticated;
revoke all on function public.aau_bridge_hold_cognition_runtime_fault_v0_1(text,uuid,text)
  from public,authenticated;
revoke all on function public.aau_bridge_fail_nvidia_provider_transient_v0_1(text,uuid,text)
  from public,authenticated;

grant execute on function public.aau_bridge_hold_cognition_admission_v0_1(text,uuid,text,jsonb)
  to anon,service_role;
grant execute on function public.aau_bridge_hold_cognition_runtime_fault_v0_1(text,uuid,text)
  to anon,service_role;
grant execute on function public.aau_bridge_fail_nvidia_provider_transient_v0_1(text,uuid,text)
  to anon,service_role;
