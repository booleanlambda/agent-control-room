-- AAU pre-begin stale Rabbit delivery handling v0.2
-- Applied in production as migration prebegin_stale_delivery_v2.
-- wake_not_claimable from an obsolete Rabbit delivery is transport identity
-- cleanup, not cognition failure. It must not consume the bounded retry budget.

begin;

create or replace function public.aau_bridge_handle_prebegin_failure_v0_1(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_worker_id text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_status text;
  v_count integer:=0;
  v_max integer:=5;
  v_due timestamptz:=now()+interval '1 minute';
  v_existing_due timestamptz;
  v_error text:=left(coalesce(p_error,'prebegin_failure'),3000);
  v_deterministic boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status,q.due_at,
         coalesce((q.metadata->>'prebegin_failure_count')::integer,0)
    into v_agent_id,v_status,v_existing_due,v_count
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;

  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;

  if v_error ilike '%wake_not_claimable%' then
    if v_status='queued' then
      update agent_lab.wake_queue
         set worker_id=null,claimed_at=null,started_at=null,last_error=null,
             metadata=(coalesce(metadata,'{}'::jsonb)
               -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
               -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
               ||jsonb_build_object(
                 'stale_rabbit_delivery_released_at',now(),
                 'stale_rabbit_delivery_worker',left(coalesce(p_worker_id,'unknown'),300),
                 'stale_delivery_contract','prebegin_stale_delivery_v0_2')
       where wake_request_id=p_intent_execution_id;
      return jsonb_build_object(
        'status','stale_delivery_released',
        'intent_execution_id',p_intent_execution_id,
        'agent_id',v_agent_id,
        'wake_status',v_status,
        'due_at',v_existing_due,
        'retry_budget_consumed',false,
        'contract','prebegin_stale_delivery_v0_2');
    end if;
    return jsonb_build_object(
      'status','duplicate_delivery_ignored',
      'intent_execution_id',p_intent_execution_id,
      'agent_id',v_agent_id,
      'wake_status',v_status,
      'retry_budget_consumed',false,
      'contract','prebegin_stale_delivery_v0_2');
  end if;

  v_count:=v_count+1;
  v_deterministic:=
       v_error ilike '%intent_packet_model_or_provider_missing%'
    or v_error ilike '%intentExecutionId_and_agentId_required%'
    or v_error ilike '%model_consistency_breach%';

  if not v_deterministic and v_count<v_max and v_status in ('queued','claimed','running') then
    update agent_lab.wake_queue
       set status='queued',worker_id=null,claimed_at=null,started_at=null,due_at=v_due,last_error=v_error,
           metadata=(coalesce(metadata,'{}'::jsonb)
             -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
             ||jsonb_build_object(
               'failure_class','prebegin_runtime_failure',
               'prebegin_failure_count',v_count,'prebegin_failure_max',v_max,
               'prebegin_failure_at',now(),
               'prebegin_failure_worker',left(coalesce(p_worker_id,'unknown'),300),
               'retry_scheduled',true,
               'recovery_contract','bounded_prebegin_failure_v0_1')
     where wake_request_id=p_intent_execution_id;
    update agent_lab.autonomous_lifecycle_runs
       set status='running',next_wake_at=v_due,last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_prebegin_failure_at',now(),
             'last_prebegin_failure_wake_request_id',p_intent_execution_id,
             'prebegin_failure_count',v_count,'prebegin_failure_max',v_max,
             'recovery_contract','bounded_prebegin_failure_v0_1'),
           updated_at=now()
     where agent_id=v_agent_id and status in ('starting','running','degraded');
    return jsonb_build_object(
      'status','retry_released','intent_execution_id',p_intent_execution_id,
      'agent_id',v_agent_id,'retry_scheduled',true,'count',v_count,'max',v_max,
      'due_at',v_due,'contract','bounded_prebegin_failure_v0_1');
  end if;

  update agent_lab.wake_queue
     set status='failed',completed_at=coalesce(completed_at,now()),worker_id=null,last_error=v_error,
         metadata=(coalesce(metadata,'{}'::jsonb)
           -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
           -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
           ||jsonb_build_object(
             'repair_required',true,
             'failure_class',case when v_deterministic then 'prebegin_deterministic_failure'
                                  else 'prebegin_failure_exhausted' end,
             'prebegin_failure_count',v_count,'prebegin_failure_max',v_max,
             'repair_required_at',now(),
             'recovery_contract','bounded_prebegin_failure_v0_1')
   where wake_request_id=p_intent_execution_id;
  update agent_lab.autonomous_lifecycle_runs
     set status='paused',next_wake_at=null,last_error=v_error,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'repair_required',true,
           'repair_reason',case when v_deterministic then 'prebegin_deterministic_failure'
                                else 'prebegin_failure_exhausted' end,
           'repair_required_at',now(),'failed_wake_request_id',p_intent_execution_id,
           'prebegin_failure_count',v_count,'prebegin_failure_max',v_max,
           'recovery_contract','bounded_prebegin_failure_v0_1'),
         updated_at=now()
   where agent_id=v_agent_id;
  update agent_lab.agent_existence_accounts
     set account_state='suspended',levy_enabled=false,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'suspended_reason','prebegin_runtime_failure','suspended_at',now(),
           'failed_wake_request_id',p_intent_execution_id,
           'resume_rule','restart_next_due_from_resume_time'),
         updated_at=now()
   where agent_id=v_agent_id;
  update agent_lab.state
     set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
           'system_paused',true,'awake',false,'sleeping',false,
           'wake_pending',false,'intent_pending',false,
           'repair_pause_reason','prebegin_runtime_failure',
           'failed_wake_request_id',p_intent_execution_id),
         updated_at=now()
   where agent_id=v_agent_id;
  begin
    perform agent_lab.queue_intervention_admin_message_v0_1(
      v_agent_id,p_intent_execution_id,'prebegin_runtime_failure',v_error,v_count);
  exception when others then null;
  end;
  return jsonb_build_object(
    'status','repair_required','intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,'retry_scheduled',false,'count',v_count,'max',v_max,
    'deterministic',v_deterministic,'existence_suspended',true,
    'contract','bounded_prebegin_failure_v0_1');
end;
$function$;

revoke all on function public.aau_bridge_handle_prebegin_failure_v0_1(text,uuid,text,text) from public;
grant execute on function public.aau_bridge_handle_prebegin_failure_v0_1(text,uuid,text,text) to anon,authenticated,service_role;

commit;
