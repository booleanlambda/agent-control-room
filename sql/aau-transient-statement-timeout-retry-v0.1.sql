-- AAU transient statement-timeout lifecycle handling v0.1
-- A successfully requeued PostgreSQL 57014 / statement-timeout wake is a
-- transient retry condition, not a degraded lifecycle.

create or replace function public.aau_bridge_fail_nvidia_experimental_wake(
  p_bridge_token text,
  p_wake_request_id uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public','agent_lab'
as $$
declare
  v_agent_id uuid;
  v_status text;
  v_released boolean := false;
  v_error text := left(coalesce(p_error,'nvidia_experimental_wake_failed'),3000);
  v_retryable_statement_timeout boolean := false;
  v_retry_due_at timestamptz;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select agent_id,status
    into v_agent_id,v_status
  from agent_lab.wake_queue
  where wake_request_id=p_wake_request_id;

  if v_agent_id is null then
    return false;
  end if;

  if v_status not in ('claimed','running') then
    return false;
  end if;

  v_retryable_statement_timeout :=
       v_error ilike '%57014%'
    or v_error ilike '%statement timeout%';

  v_released := agent_lab.release_wake_request(
    p_wake_request_id,
    v_error,
    5,
    8
  );

  update agent_lab.wake_queue
     set metadata=coalesce(metadata,'{}'::jsonb)
       -'rabbit_armed_at'
       -'rabbit_armed_by'
       -'rabbit_message_id'
       -'rabbit_delay_queue'
       -'rabbit_arm_claimed_at'
       -'rabbit_arm_claimed_by'
       || case
            when v_released and v_retryable_statement_timeout then
              jsonb_build_object(
                'transient_retry_class','postgres_statement_timeout',
                'transient_retry_scheduled_at',now(),
                'lifecycle_degradation_suppressed',true
              )
            else '{}'::jsonb
          end
   where wake_request_id=p_wake_request_id
     and status='queued';

  select due_at into v_retry_due_at
  from agent_lab.wake_queue
  where wake_request_id=p_wake_request_id;

  if v_released and v_retryable_statement_timeout then
    update agent_lab.autonomous_lifecycle_runs
       set status='running',
           next_wake_at=coalesce(v_retry_due_at,next_wake_at),
           last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_transient_retry_error',v_error,
             'last_transient_retry_class','postgres_statement_timeout',
             'last_transient_retry_at',now(),
             'last_transient_retry_wake_request_id',p_wake_request_id,
             'transient_retry_does_not_degrade_lifecycle',true
           ),
           updated_at=now()
     where agent_id=v_agent_id;
  else
    update agent_lab.autonomous_lifecycle_runs
       set status='degraded',
           last_error=v_error,
           updated_at=now()
     where agent_id=v_agent_id;
  end if;

  return v_released;
end
$$;
