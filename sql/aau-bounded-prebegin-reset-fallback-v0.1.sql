-- AAU bounded pre-begin reset fallback v0.1
-- Applied in production as migration bounded_prebegin_reset_fallback_v1.
-- When the primary pre-begin recovery handler itself is unavailable, reset-arm
-- may retry only twice; the third fallback attempt fails the wake and enters
-- explicit repair hold. Ordinary reset-arm callers are unchanged.

begin;

create or replace function public.aau_bridge_reset_autonomous_wake_arm(
  p_bridge_token text,
  p_wake_request_id uuid,
  p_worker_id text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_status text;
  v_count integer:=0;
  v_max integer:=3;
  v_prebegin_fallback boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  v_prebegin_fallback :=
    coalesce(p_error,'') like 'prebegin_recovery_handler_unavailable:%';

  if not v_prebegin_fallback then
    update agent_lab.wake_queue
       set metadata=(coalesce(metadata,'{}'::jsonb)
         -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
         -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue')
         ||jsonb_build_object(
           'rabbit_reset_at',now(),
           'rabbit_reset_by',left(coalesce(p_worker_id,'unknown'),300),
           'rabbit_reset_error',left(coalesce(p_error,''),1200))
     where wake_request_id=p_wake_request_id and status='queued';
    return found;
  end if;

  select q.agent_id,q.status,
         coalesce((q.metadata->>'prebegin_reset_fallback_count')::integer,0)
    into v_agent_id,v_status,v_count
  from agent_lab.wake_queue q
  where q.wake_request_id=p_wake_request_id
  for update;

  if v_agent_id is null then return false; end if;
  if v_status<>'queued' then return false; end if;

  v_count:=v_count+1;

  if v_count<v_max then
    update agent_lab.wake_queue
       set metadata=(coalesce(metadata,'{}'::jsonb)
         -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
         -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue')
         ||jsonb_build_object(
           'prebegin_reset_fallback_count',v_count,
           'prebegin_reset_fallback_max',v_max,
           'prebegin_reset_fallback_at',now(),
           'prebegin_reset_fallback_worker',left(coalesce(p_worker_id,'unknown'),300),
           'failure_class','prebegin_recovery_handler_unavailable',
           'retry_scheduled',true,
           'recovery_contract','bounded_prebegin_reset_fallback_v0_1')
     where wake_request_id=p_wake_request_id and status='queued';
    return found;
  end if;

  update agent_lab.wake_queue
     set status='failed',completed_at=coalesce(completed_at,now()),worker_id=null,
         last_error=left(coalesce(p_error,'prebegin_recovery_handler_unavailable'),2000),
         metadata=(coalesce(metadata,'{}'::jsonb)
           -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
           -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue')
           ||jsonb_build_object(
             'repair_required',true,
             'failure_class','prebegin_reset_fallback_exhausted',
             'prebegin_reset_fallback_count',v_count,
             'prebegin_reset_fallback_max',v_max,
             'repair_required_at',now(),
             'recovery_contract','bounded_prebegin_reset_fallback_v0_1')
   where wake_request_id=p_wake_request_id and status='queued';

  update agent_lab.autonomous_lifecycle_runs
     set status='paused',next_wake_at=null,
         last_error=left(coalesce(p_error,'prebegin_recovery_handler_unavailable'),2000),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'repair_required',true,
           'repair_reason','prebegin_reset_fallback_exhausted',
           'repair_required_at',now(),
           'failed_wake_request_id',p_wake_request_id,
           'prebegin_reset_fallback_count',v_count,
           'prebegin_reset_fallback_max',v_max,
           'recovery_contract','bounded_prebegin_reset_fallback_v0_1'),
         updated_at=now()
   where agent_id=v_agent_id;

  update agent_lab.agent_existence_accounts
     set account_state='suspended',levy_enabled=false,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'suspended_reason','prebegin_reset_fallback_exhausted',
           'suspended_at',now(),
           'failed_wake_request_id',p_wake_request_id,
           'resume_rule','restart_next_due_from_resume_time'),
         updated_at=now()
   where agent_id=v_agent_id;

  update agent_lab.state
     set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
           'system_paused',true,'awake',false,'sleeping',false,
           'wake_pending',false,'intent_pending',false,
           'repair_pause_reason','prebegin_reset_fallback_exhausted',
           'failed_wake_request_id',p_wake_request_id),
         updated_at=now()
   where agent_id=v_agent_id;

  return true;
end;
$function$;


-- The non-legacy intent-arm reset is deliberately a thin alias to the same
-- bounded implementation above. This keeps legacy wake and non-legacy intent
-- paths under one durable counter/status guard and prevents audit drift where
-- the wrapper is omitted from the evidence packet.
create or replace function public.aau_bridge_reset_autonomous_intent_arm(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_worker_id text,
  p_error text
)
returns boolean
language sql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
  select public.aau_bridge_reset_autonomous_wake_arm(
    p_bridge_token,
    p_intent_execution_id,
    p_worker_id,
    p_error
  );
$function$;

commit;
