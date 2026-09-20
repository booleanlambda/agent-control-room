-- AAU NVIDIA timeout bounded recovery v0.1
-- Applied to Supabase 2026-09-20.
-- Runtime-owned timeout handling: retry same wake at 2/4 minutes, then hold
-- after 3 failures, disable existence levy, preserve canonical agent data.
-- Does not switch the bound agent model or claim task/competence failure.
-- Operator restoration is explicit and must reconcile the failed action.

CREATE OR REPLACE FUNCTION public.aau_bridge_fail_nvidia_experimental_wake(p_bridge_token text, p_wake_request_id uuid, p_error text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_status text;
  v_status_after text;
  v_attempts integer;
  v_released boolean := false;
  v_error text := left(coalesce(p_error,'nvidia_experimental_wake_failed'),3000);
  v_statement_timeout boolean := false;
  v_nvidia_timeout boolean := false;
  v_retry_minutes integer := 5;
  v_retry_due_at timestamptz;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  -- Serialize failure transitions. Stale deliveries cannot resurrect a wake.
  select q.agent_id,q.status,q.attempts into v_agent_id,v_status,v_attempts
    from agent_lab.wake_queue q
   where q.wake_request_id=p_wake_request_id for update;
  if v_agent_id is null or v_status not in ('claimed','running') then
    return false;
  end if;

  v_statement_timeout := v_error ilike '%57014%' or v_error ilike '%statement timeout%';
  v_nvidia_timeout := v_error ~* '^nvidia_timeout_after_[0-9]+ms$';
  if v_nvidia_timeout then
    -- 2 minutes after first failure, 4 after second; stop after third.
    v_retry_minutes := case when coalesce(v_attempts,0)<=1 then 2 else 4 end;
  end if;

  v_released := agent_lab.release_wake_request(
    p_wake_request_id, v_error, v_retry_minutes,
    case when v_nvidia_timeout then 3 else 8 end
  );

  select q.status,q.due_at into v_status_after,v_retry_due_at
    from agent_lab.wake_queue q where q.wake_request_id=p_wake_request_id;

  update agent_lab.wake_queue
     set metadata=(coalesce(metadata,'{}'::jsonb)
          -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
          -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
       || case
            when v_nvidia_timeout then jsonb_build_object(
              'failure_class','nvidia_model_timeout',
              'timeout_recovery_version','nvidia_timeout_bounded_recovery_v0_1',
              'timeout_max_attempts',3,'timeout_attempts',v_attempts,
              'timeout_last_failure_at',now(),'retry_scheduled',v_status_after='queued',
              'recovery_required',v_status_after='failed',
              'model_switch_performed',false)
            when v_released and v_statement_timeout and v_status_after='queued' then
              jsonb_build_object(
                'transient_retry_class','postgres_statement_timeout',
                'transient_retry_scheduled_at',now(),
                'lifecycle_degradation_suppressed',true)
            else '{}'::jsonb
          end
   where wake_request_id=p_wake_request_id and status in ('queued','failed');

  if v_released and v_nvidia_timeout and v_status_after='queued' then
    update agent_lab.autonomous_lifecycle_runs
       set status='running',next_wake_at=v_retry_due_at,last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_transient_retry_error',v_error,
             'last_transient_retry_class','nvidia_model_timeout',
             'last_transient_retry_at',now(),
             'last_transient_retry_wake_request_id',p_wake_request_id,
             'timeout_attempts',v_attempts,'timeout_max_attempts',3,
             'timeout_recovery_version','nvidia_timeout_bounded_recovery_v0_1'),
           updated_at=now()
     where agent_id=v_agent_id and status in ('starting','running','degraded');
  elsif v_released and v_nvidia_timeout and v_status_after='failed' then
    -- Preserve cognition, artifacts, and failed wake for diagnosis; suspend
    -- scheduled cognition and the minute levy until deliberate operator recovery.
    update agent_lab.autonomous_lifecycle_runs
       set status='paused',next_wake_at=null,last_error=v_error,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'repair_required',true,'repair_reason','nvidia_timeout_exhausted',
             'repair_required_at',now(),'failed_wake_request_id',p_wake_request_id,
             'timeout_attempts',v_attempts,'timeout_max_attempts',3,
             'timeout_recovery_version','nvidia_timeout_bounded_recovery_v0_1'),
           updated_at=now()
     where agent_id=v_agent_id;
    update agent_lab.agent_existence_accounts
       set account_state='suspended',levy_enabled=false,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'suspended_reason','nvidia_timeout_exhausted','suspended_at',now(),
             'failed_wake_request_id',p_wake_request_id,
             'resume_rule','restart_next_due_from_resume_time'),
           updated_at=now()
     where agent_id=v_agent_id;
    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
             'system_paused',true,'awake',false,'sleeping',false,'intent_pending',false,
             'wake_pending',false,'repair_pause_reason','nvidia_timeout_exhausted',
             'failed_wake_request_id',p_wake_request_id),
           updated_at=now()
     where agent_id=v_agent_id;
  elsif v_released and v_statement_timeout and v_status_after='queued' then
    update agent_lab.autonomous_lifecycle_runs
       set status='running',next_wake_at=coalesce(v_retry_due_at,next_wake_at),
           last_error=null,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_transient_retry_error',v_error,
             'last_transient_retry_class','postgres_statement_timeout',
             'last_transient_retry_at',now(),
             'last_transient_retry_wake_request_id',p_wake_request_id,
             'transient_retry_does_not_degrade_lifecycle',true),
           updated_at=now()
     where agent_id=v_agent_id;
  else
    update agent_lab.autonomous_lifecycle_runs
       set status='degraded',last_error=v_error,updated_at=now()
     where agent_id=v_agent_id;
  end if;
  return v_released;
end;
$function$;
