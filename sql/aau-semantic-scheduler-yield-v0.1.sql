-- Semantic scheduler yield v0.1
-- A durable cognition checkpoint may yield to the scheduler without being marked failed.
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
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status,
         coalesce((q.metadata->>'semantic_continuation_count')::integer,0)
    into v_agent_id,v_status,v_count
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
           'semantic_continuation_contract','semantic_scheduler_yield_v0_1',
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
           'semantic_continuation_contract','semantic_scheduler_yield_v0_1'
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
           'semantic_continuation_at',now()
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
    'contract','semantic_scheduler_yield_v0_1'
  );
end;
$function$;

revoke all on function public.aau_bridge_continue_model_intent_execution_v0_1(text,uuid,text,jsonb)
  from public;
grant execute on function public.aau_bridge_continue_model_intent_execution_v0_1(text,uuid,text,jsonb)
  to anon,authenticated,service_role;

commit;
