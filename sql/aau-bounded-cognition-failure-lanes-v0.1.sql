-- AAU bounded cognition failure lanes v0.1
-- Applied to production as Supabase migration bounded_cognition_failure_lanes_v1.
-- Invariants:
-- 1) model-output parse/truncation rejection gets at most 3 recovery-owned retries;
-- 2) pre-begin failures get at most 5 retries, while deterministic packet/model binding faults fail immediately;
-- 3) exhausted runtime failures pause lifecycle and suspend existence levy instead of hot-looping.

begin;

create or replace function public.aau_bridge_handle_cognition_response_rejection_v0_1(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_error text,
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
  v_count integer:=0;
  v_max integer:=3;
  v_due timestamptz:=now()+interval '1 minute';
  v_error text:=left(coalesce(p_error,'cognition_response_rejected'),3000);
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select q.agent_id,q.status,
         coalesce((q.metadata->>'cognition_response_rejection_count')::integer,0)
    into v_agent_id,v_status,v_count
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;

  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;
  if v_status not in ('claimed','running') then
    return jsonb_build_object('status','not_applicable','intent_execution_id',p_intent_execution_id,'wake_status',v_status);
  end if;

  v_count:=v_count+1;
  if v_count<v_max then
    update agent_lab.wake_queue
       set status='queued',worker_id=null,claimed_at=null,started_at=null,due_at=v_due,last_error=v_error,
           metadata=(coalesce(metadata,'{}'::jsonb)
             -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
             ||jsonb_build_object(
               'failure_class','cognition_response_rejected',
               'cognition_response_rejection_count',v_count,
               'cognition_response_rejection_max',v_max,
               'cognition_response_rejection_at',now(),
               'cognition_response_rejection_state',coalesce(p_state,'{}'::jsonb),
               'retry_scheduled',true,
               'semantic_state_preserved',true,
               'recovery_contract','bounded_cognition_response_rejection_v0_1')
     where wake_request_id=p_intent_execution_id;
    update agent_lab.autonomous_lifecycle_runs
       set status='running',next_wake_at=v_due,last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_cognition_response_rejection_at',now(),
             'last_cognition_response_rejection_wake_request_id',p_intent_execution_id,
             'cognition_response_rejection_count',v_count,
             'cognition_response_rejection_max',v_max,
             'recovery_contract','bounded_cognition_response_rejection_v0_1'),
           updated_at=now()
     where agent_id=v_agent_id and status in ('starting','running','degraded');
    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
             'wake_pending',true,'intent_pending',true,
             'wake_pending_since',now(),'intent_pending_since',now(),
             'cognition_response_rejection_pending',true,
             'cognition_response_rejection_count',v_count),
           updated_at=now()
     where agent_id=v_agent_id;
    return jsonb_build_object(
      'status','retry_released','intent_execution_id',p_intent_execution_id,
      'agent_id',v_agent_id,'retry_scheduled',true,'count',v_count,'max',v_max,
      'due_at',v_due,'semantic_state_preserved',true,
      'contract','bounded_cognition_response_rejection_v0_1');
  end if;

  update agent_lab.wake_queue
     set status='failed',completed_at=coalesce(completed_at,now()),worker_id=null,last_error=v_error,
         metadata=(coalesce(metadata,'{}'::jsonb)
           -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
           -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
           ||jsonb_build_object(
             'repair_required',true,
             'failure_class','cognition_response_rejected_exhausted',
             'cognition_response_rejection_count',v_count,
             'cognition_response_rejection_max',v_max,
             'repair_required_at',now(),
             'semantic_state_preserved',true,
             'recovery_contract','bounded_cognition_response_rejection_v0_1')
   where wake_request_id=p_intent_execution_id;
  update agent_lab.autonomous_lifecycle_runs
     set status='paused',next_wake_at=null,last_error=v_error,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'repair_required',true,'repair_reason','cognition_response_rejected_exhausted',
           'repair_required_at',now(),'failed_wake_request_id',p_intent_execution_id,
           'cognition_response_rejection_count',v_count,
           'cognition_response_rejection_max',v_max,
           'recovery_contract','bounded_cognition_response_rejection_v0_1'),
         updated_at=now()
   where agent_id=v_agent_id;
  update agent_lab.agent_existence_accounts
     set account_state='suspended',levy_enabled=false,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'suspended_reason','cognition_response_rejected_exhausted','suspended_at',now(),
           'failed_wake_request_id',p_intent_execution_id,
           'resume_rule','restart_next_due_from_resume_time'),
         updated_at=now()
   where agent_id=v_agent_id;
  update agent_lab.state
     set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
           'system_paused',true,'awake',false,'sleeping',false,
           'wake_pending',false,'intent_pending',false,
           'repair_pause_reason','cognition_response_rejected_exhausted',
           'failed_wake_request_id',p_intent_execution_id),
         updated_at=now()
   where agent_id=v_agent_id;
  begin
    perform agent_lab.queue_intervention_admin_message_v0_1(
      v_agent_id,p_intent_execution_id,'cognition_response_rejected',v_error,v_count);
  exception when others then null;
  end;
  return jsonb_build_object(
    'status','repair_required','intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,'retry_scheduled',false,'count',v_count,'max',v_max,
    'existence_suspended',true,'semantic_state_preserved',true,
    'contract','bounded_cognition_response_rejection_v0_1');
end;
$function$;

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
  v_error text:=left(coalesce(p_error,'prebegin_failure'),3000);
  v_deterministic boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select q.agent_id,q.status,
         coalesce((q.metadata->>'prebegin_failure_count')::integer,0)
    into v_agent_id,v_status,v_count
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;
  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
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

revoke all on function public.aau_bridge_handle_cognition_response_rejection_v0_1(text,uuid,text,jsonb) from public;
grant execute on function public.aau_bridge_handle_cognition_response_rejection_v0_1(text,uuid,text,jsonb) to anon,authenticated,service_role;
revoke all on function public.aau_bridge_handle_prebegin_failure_v0_1(text,uuid,text,text) from public;
grant execute on function public.aau_bridge_handle_prebegin_failure_v0_1(text,uuid,text,text) to anon,authenticated,service_role;

commit;
