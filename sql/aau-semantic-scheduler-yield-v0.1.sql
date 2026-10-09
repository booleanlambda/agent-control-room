-- Semantic scheduler yield v0.2
-- Durable cognition may yield without semantic failure.
-- Provider transport recovery is isolated from semantic cycle accounting:
-- 3 local transport attempts, then 60-minute cooldown; 3 batches (9 attempts)
-- is the bounded provider-attempt ceiling.

begin;

create or replace function public.aau_bridge_continue_model_intent_execution_v0_1(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_reason text,
  p_state jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_status text;
  v_due timestamptz:=now()+interval '1 minute';
  v_count integer:=0;
  v_provider_batch_count integer:=0;
  v_provider_total_attempts integer:=0;
  v_provider boolean:=coalesce(p_state->>'failure_class','')='model_transport_transient';
  v_provider_batch_limit integer:=3;
  v_provider_attempts_per_batch integer:=3;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if p_state is null or jsonb_typeof(p_state)<>'object' then
    raise exception 'semantic_continuation_state_invalid';
  end if;

  select q.agent_id,q.status,
         coalesce((q.metadata->>'semantic_continuation_count')::integer,0),
         coalesce((q.metadata->>'provider_transport_batch_count')::integer,0)
    into v_agent_id,v_status,v_count,v_provider_batch_count
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;

  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;

  if v_status in ('completed','failed','cancelled') then
    return jsonb_build_object(
      'status','already_terminal',
      'intent_execution_id',p_intent_execution_id,
      'wake_status',v_status
    );
  end if;

  if v_provider then
    v_provider_batch_count:=v_provider_batch_count+1;
    v_provider_total_attempts:=v_provider_batch_count*v_provider_attempts_per_batch;

    if v_provider_batch_count>=v_provider_batch_limit then
      update agent_lab.wake_queue
         set status='failed',
             completed_at=coalesce(completed_at,now()),
             worker_id=null,
             last_error=left(
               'provider_transport_attempts_exhausted:'||coalesce(p_reason,'provider_transport_transient'),
               3000
             ),
             metadata=(
               coalesce(metadata,'{}'::jsonb)
               -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
               -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
             ) || jsonb_build_object(
               'failure_class','provider_transport_attempts_exhausted',
               'provider_transport_recovery_contract','provider_transport_window_v0_1',
               'provider_transport_batch_count',v_provider_batch_count,
               'provider_transport_total_attempts',v_provider_total_attempts,
               'provider_transport_attempts_per_batch',v_provider_attempts_per_batch,
               'provider_transport_batch_limit',v_provider_batch_limit,
               'provider_transport_retry_scheduled',false,
               'semantic_state_preserved',true,
               'provider_failure_not_cognition_failure',true
             )
       where wake_request_id=p_intent_execution_id
         and status in ('queued','claimed','running');

      update agent_lab.autonomous_lifecycle_runs
         set status='paused',
             next_wake_at=null,
             last_error=left(
               'provider_transport_attempts_exhausted:'||coalesce(p_reason,'provider_transport_transient'),
               3000
             ),
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'repair_required',true,
               'repair_reason','provider_transport_attempts_exhausted',
               'repair_required_at',now(),
               'failed_wake_request_id',p_intent_execution_id,
               'provider_transport_batch_count',v_provider_batch_count,
               'provider_transport_total_attempts',v_provider_total_attempts,
               'provider_transport_recovery_contract','provider_transport_window_v0_1',
               'semantic_state_preserved',true,
               'provider_failure_not_cognition_failure',true
             ),
             updated_at=now()
       where agent_id=v_agent_id;

      update agent_lab.agent_existence_accounts
         set account_state='suspended',
             levy_enabled=false,
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'suspended_reason','provider_transport_attempts_exhausted',
               'suspended_at',now(),
               'failed_wake_request_id',p_intent_execution_id,
               'provider_transport_total_attempts',v_provider_total_attempts,
               'resume_rule','explicit_operator_resume_after_provider_recovery'
             ),
             updated_at=now()
       where agent_id=v_agent_id;

      update agent_lab.state
         set state_payload=(
               coalesce(state_payload,'{}'::jsonb)
               -'semantic_continuation_pending'
               -'semantic_continuation_reason'
               -'semantic_continuation_state'
             ) || jsonb_build_object(
               'system_paused',true,
               'awake',false,
               'sleeping',false,
               'wake_pending',false,
               'intent_pending',false,
               'repair_pause_reason','provider_transport_attempts_exhausted',
               'provider_transport_recovery_pending',false,
               'provider_transport_attempts_exhausted',true,
               'provider_transport_batch_count',v_provider_batch_count,
               'provider_transport_total_attempts',v_provider_total_attempts,
               'provider_transport_recovery_wake_request_id',p_intent_execution_id,
               'provider_transport_recovery_contract','provider_transport_window_v0_1'
             ),
             updated_at=now()
       where agent_id=v_agent_id;

      return jsonb_build_object(
        'status','provider_attempts_exhausted',
        'intent_execution_id',p_intent_execution_id,
        'agent_id',v_agent_id,
        'provider_transport_batch_count',v_provider_batch_count,
        'provider_transport_total_attempts',v_provider_total_attempts,
        'retry_scheduled',false,
        'semantic_state_preserved',true,
        'provider_failure_not_cognition_failure',true,
        'contract','provider_transport_window_v0_1'
      );
    end if;

    v_due:=now()+interval '60 minutes';

    update agent_lab.wake_queue
       set status='queued',
           worker_id=null,
           claimed_at=null,
           started_at=null,
           due_at=v_due,
           completed_at=null,
           last_error=null,
           metadata=(
             coalesce(metadata,'{}'::jsonb)
             -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
           ) || jsonb_build_object(
             'provider_transport_recovery_pending',true,
             'provider_transport_recovery_contract','provider_transport_window_v0_1',
             'provider_transport_batch_count',v_provider_batch_count,
             'provider_transport_total_attempts',v_provider_total_attempts,
             'provider_transport_attempts_per_batch',v_provider_attempts_per_batch,
             'provider_transport_batch_limit',v_provider_batch_limit,
             'provider_transport_cooldown_until',v_due,
             'provider_transport_last_failure_at',now(),
             'provider_transport_last_failure_reason',left(coalesce(p_reason,''),1200),
             'provider_transport_last_failure_state',coalesce(p_state,'{}'::jsonb),
             'semantic_state_preserved',true,
             'provider_failure_not_cognition_failure',true
           )
     where wake_request_id=p_intent_execution_id
       and status in ('queued','claimed','running');

    update agent_lab.autonomous_lifecycle_runs
       set status='running',
           next_wake_at=v_due,
           last_error=null,
           metadata=(
             coalesce(metadata,'{}'::jsonb)
             -'repair_required'-'repair_reason'-'repair_required_at'
           ) || jsonb_build_object(
             'provider_transport_recovery_pending',true,
             'provider_transport_recovery_contract','provider_transport_window_v0_1',
             'provider_transport_batch_count',v_provider_batch_count,
             'provider_transport_total_attempts',v_provider_total_attempts,
             'provider_transport_cooldown_until',v_due,
             'provider_failure_not_cognition_failure',true
           ),
           updated_at=now()
     where agent_id=v_agent_id
       and status in ('starting','running','degraded','paused');

    update agent_lab.agent_existence_accounts
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'provider_cooldown_previous_account_state',
               case
                 when account_state='suspended'
                   then coalesce(nullif(metadata->>'provider_cooldown_previous_account_state',''),'current')
                 else account_state
               end,
             'provider_cooldown_sleep_started_at',now(),
             'provider_cooldown_until',v_due,
             'provider_cooldown_freezes_existence_levy',true,
             'provider_cooldown_elapsed_time_billed',false,
             'provider_cooldown_contract','provider_transport_sleep_v0_1'
           ),
           account_state='suspended',
           levy_enabled=false,
           next_due_at=null,
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.state
       set state_payload=(
             coalesce(state_payload,'{}'::jsonb)
             -'repair_pause_reason'
             -'semantic_runtime_terminal_code'
             -'semantic_runtime_terminal_at'
             -'semantic_continuation_pending'
             -'semantic_continuation_reason'
             -'semantic_continuation_state'
           ) || jsonb_build_object(
             'system_paused',false,
             'awake',false,
             'sleeping',true,
             'wake_pending',true,
             'intent_pending',true,
             'intent_pending_since',now(),
             'wake_pending_since',now(),
             'provider_transport_recovery_pending',true,
             'provider_transport_attempts_exhausted',false,
             'provider_transport_recovery_wake_request_id',p_intent_execution_id,
             'provider_transport_batch_count',v_provider_batch_count,
             'provider_transport_total_attempts',v_provider_total_attempts,
             'provider_transport_cooldown_until',v_due,
             'provider_transport_recovery_contract','provider_transport_window_v0_1',
             'provider_failure_not_cognition_failure',true
           ),
           updated_at=now()
     where agent_id=v_agent_id;

    return jsonb_build_object(
      'status','provider_cooldown',
      'intent_execution_id',p_intent_execution_id,
      'agent_id',v_agent_id,
      'due_at',v_due,
      'provider_transport_batch_count',v_provider_batch_count,
      'provider_transport_total_attempts',v_provider_total_attempts,
      'provider_transport_attempts_per_batch',v_provider_attempts_per_batch,
      'provider_transport_batch_limit',v_provider_batch_limit,
      'semantic_state_preserved',true,
      'provider_failure_not_cognition_failure',true,
      'contract','provider_transport_window_v0_1'
    );
  end if;

  update agent_lab.wake_queue
     set status='queued',
         worker_id=null,
         claimed_at=null,
         started_at=null,
         due_at=v_due,
         last_error=null,
         metadata=(
           coalesce(metadata,'{}'::jsonb)
           -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
           -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
         ) || jsonb_build_object(
           'semantic_continuation_count',v_count+1,
           'semantic_continuation_at',now(),
           'semantic_continuation_reason',left(coalesce(p_reason,''),1200),
           'semantic_continuation_state',coalesce(p_state,'{}'::jsonb),
           'semantic_continuation_contract','semantic_scheduler_yield_v0_2',
           'semantic_state_preserved',true
         )
   where wake_request_id=p_intent_execution_id
     and status in ('queued','claimed','running');

  update agent_lab.autonomous_lifecycle_runs
     set status='running',
         next_wake_at=v_due,
         last_error=null,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'last_semantic_continuation_at',now(),
           'last_semantic_continuation_wake_request_id',p_intent_execution_id,
           'semantic_continuation_contract','semantic_scheduler_yield_v0_2'
         ),
         updated_at=now()
   where agent_id=v_agent_id
     and status in ('starting','running','degraded');

  update agent_lab.state
     set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
           'wake_pending',true,
           'intent_pending',true,
           'intent_pending_since',now(),
           'wake_pending_since',now(),
           'semantic_continuation_pending',true,
           'semantic_continuation_at',now(),
           'semantic_continuation_count',v_count+1,
           'semantic_continuation_reason',left(coalesce(p_reason,''),1200),
           'semantic_continuation_state',coalesce(p_state,'{}'::jsonb)
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  return jsonb_build_object(
    'status','continued',
    'intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,
    'due_at',v_due,
    'continuation_count',v_count+1,
    'semantic_state_preserved',true,
    'contract','semantic_scheduler_yield_v0_2'
  );
end;
$function$;

create or replace function public.aau_bridge_clear_model_provider_transport_recovery_v0_1(
  p_bridge_token text,
  p_intent_execution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_agent_id uuid;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id into v_agent_id
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;

  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;

  update agent_lab.wake_queue
     set metadata=coalesce(metadata,'{}'::jsonb)
       -'provider_transport_recovery_pending'
       -'provider_transport_recovery_contract'
       -'provider_transport_batch_count'
       -'provider_transport_total_attempts'
       -'provider_transport_attempts_per_batch'
       -'provider_transport_batch_limit'
       -'provider_transport_cooldown_until'
       -'provider_transport_last_failure_at'
       -'provider_transport_last_failure_reason'
       -'provider_transport_last_failure_state'
       -'provider_failure_not_cognition_failure'
   where wake_request_id=p_intent_execution_id;

  update agent_lab.autonomous_lifecycle_runs
     set metadata=coalesce(metadata,'{}'::jsonb)
       -'provider_transport_recovery_pending'
       -'provider_transport_recovery_contract'
       -'provider_transport_batch_count'
       -'provider_transport_total_attempts'
       -'provider_transport_cooldown_until'
       -'provider_failure_not_cognition_failure',
         updated_at=now()
   where agent_id=v_agent_id;

  update agent_lab.state
     set state_payload=(
           coalesce(state_payload,'{}'::jsonb)
           -'provider_transport_recovery_pending'
           -'provider_transport_attempts_exhausted'
           -'provider_transport_recovery_wake_request_id'
           -'provider_transport_batch_count'
           -'provider_transport_total_attempts'
           -'provider_transport_cooldown_until'
           -'provider_transport_recovery_contract'
           -'provider_failure_not_cognition_failure'
         ) || jsonb_build_object(
           'provider_transport_last_recovered_at',now()
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  return jsonb_build_object(
    'status','cleared',
    'intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,
    'contract','provider_transport_window_v0_1'
  );
end;
$function$;

revoke all on function public.aau_bridge_continue_model_intent_execution_v0_1(text,uuid,text,jsonb)
  from public;
grant execute on function public.aau_bridge_continue_model_intent_execution_v0_1(text,uuid,text,jsonb)
  to anon,authenticated,service_role;

revoke all on function public.aau_bridge_clear_model_provider_transport_recovery_v0_1(text,uuid)
  from public;
grant execute on function public.aau_bridge_clear_model_provider_transport_recovery_v0_1(text,uuid)
  to anon,authenticated,service_role;

commit;
