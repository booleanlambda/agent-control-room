
-- AAU single-execution claim guards v0.1
-- Skip paused agents and prevent claim/arming races for agents already executing.

create or replace function agent_lab.claim_next_wake(
  p_worker_id text default 'wake_executor'::text
)
returns table(
  wake_request_id uuid,
  agent_id uuid,
  wake_intent_id uuid,
  source_kind text,
  trigger_type text,
  trigger_event_id uuid,
  priority numeric,
  due_at timestamptz,
  payload jsonb,
  attempts integer,
  created_at timestamptz
)
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
begin
  return query
  update agent_lab.wake_queue q
     set status='claimed',
         claimed_at=now(),
         worker_id=coalesce(p_worker_id,'wake_executor'),
         attempts=q.attempts+1
   where q.wake_request_id=(
     select q2.wake_request_id
     from agent_lab.wake_queue q2
     join agent_lab.state s on s.agent_id=q2.agent_id
     where q2.status='queued'
       and (q2.due_at is null or q2.due_at<=now())
       and coalesce((s.state_payload->>'system_paused')::boolean,false)=false
       and not exists (
         select 1
         from agent_lab.wake_queue active
         where active.agent_id=q2.agent_id
           and active.status in ('claimed','running')
       )
       and (
         not coalesce((s.state_payload->>'sleeping')::boolean,false)
         or q2.trigger_type in ('sleep_complete','lifecycle_start')
       )
     order by q2.priority desc,q2.created_at asc
     for update of q2 skip locked
     limit 1
   )
  returning q.wake_request_id,q.agent_id,q.wake_intent_id,
            q.source_kind,q.trigger_type,q.trigger_event_id,
            q.priority,q.due_at,q.payload,q.attempts,q.created_at;
end;
$function$;

create or replace function public.aau_bridge_claim_unarmed_autonomous_intents(
  p_bridge_token text,
  p_worker_id text,
  p_limit integer
)
returns table(
  intent_execution_id uuid,
  agent_id uuid,
  run_id uuid,
  execute_at timestamptz,
  priority numeric,
  payload jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  return query
  with c as (
    select q.wake_request_id
    from agent_lab.wake_queue q
    join agent_lab.autonomous_lifecycle_runs r on r.agent_id=q.agent_id
    join agent_lab.state s on s.agent_id=q.agent_id
    where q.status='queued'
      and r.status in ('starting','running','degraded')
      and coalesce((s.state_payload->>'system_paused')::boolean,false)=false
      and coalesce((q.metadata->>'autonomous_lifecycle')::boolean,false)=true
      and coalesce(nullif(q.metadata->>'rabbit_transport',''),'aau.intent')='aau.intent'
      and q.metadata->>'rabbit_armed_at' is null
      and (
        q.metadata->>'rabbit_arm_claimed_at' is null
        or (q.metadata->>'rabbit_arm_claimed_at')::timestamptz < now()-interval '120 seconds'
      )
      and not exists (
        select 1
        from agent_lab.wake_queue active
        where active.agent_id=q.agent_id
          and active.status in ('claimed','running')
      )
      and q.wake_request_id=(
        select q0.wake_request_id
        from agent_lab.wake_queue q0
        where q0.agent_id=q.agent_id
          and q0.status='queued'
          and coalesce((q0.metadata->>'autonomous_lifecycle')::boolean,false)=true
          and coalesce(nullif(q0.metadata->>'rabbit_transport',''),'aau.intent')='aau.intent'
          and q0.metadata->>'rabbit_armed_at' is null
        order by q0.due_at asc nulls first,q0.priority desc,q0.created_at asc
        limit 1
      )
    order by q.due_at asc nulls first,q.priority desc,q.created_at asc
    limit greatest(1,least(coalesce(p_limit,12),50))
    for update of q skip locked
  ), u as (
    update agent_lab.wake_queue q
       set metadata=coalesce(q.metadata,'{}'::jsonb)||jsonb_build_object(
         'rabbit_arm_claimed_at',now(),
         'rabbit_arm_claimed_by',left(coalesce(p_worker_id,'unknown'),300),
         'rabbit_transport','aau.intent',
         'protocol_version',coalesce(q.metadata->>'protocol_version','next_intent_protocol_v0_1'),
         'single_execution_claim_guard','single_execution_claim_guard_v0_1'
       )
      from c
     where q.wake_request_id=c.wake_request_id
    returning q.*
  )
  select u.wake_request_id,u.agent_id,r.run_id,u.due_at,u.priority,u.payload
  from u join agent_lab.autonomous_lifecycle_runs r on r.agent_id=u.agent_id;
end;
$function$;

create or replace function public.aau_bridge_claim_unarmed_autonomous_wakes(
  p_bridge_token text,
  p_worker_id text,
  p_limit integer default 12
)
returns table(
  wake_request_id uuid,
  agent_id uuid,
  run_id uuid,
  due_at timestamptz,
  priority numeric,
  payload jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  return query
  with c as (
    select q.wake_request_id
    from agent_lab.wake_queue q
    join agent_lab.autonomous_lifecycle_runs r on r.agent_id=q.agent_id
    join agent_lab.state s on s.agent_id=q.agent_id
    where q.status='queued'
      and r.status in ('starting','running','degraded')
      and coalesce((s.state_payload->>'system_paused')::boolean,false)=false
      and coalesce((q.metadata->>'autonomous_lifecycle')::boolean,false)=true
      and q.metadata->>'rabbit_armed_at' is null
      and (
        q.metadata->>'rabbit_arm_claimed_at' is null
        or (q.metadata->>'rabbit_arm_claimed_at')::timestamptz < now()-interval '120 seconds'
      )
      and not exists (
        select 1
        from agent_lab.wake_queue active
        where active.agent_id=q.agent_id
          and active.status in ('claimed','running')
      )
      and q.wake_request_id=(
        select q0.wake_request_id
        from agent_lab.wake_queue q0
        where q0.agent_id=q.agent_id
          and q0.status='queued'
          and coalesce((q0.metadata->>'autonomous_lifecycle')::boolean,false)=true
          and q0.metadata->>'rabbit_armed_at' is null
        order by q0.due_at asc nulls first,q0.priority desc,q0.created_at asc
        limit 1
      )
    order by q.due_at asc nulls first,q.priority desc,q.created_at asc
    limit greatest(1,least(coalesce(p_limit,12),50))
    for update of q skip locked
  ), u as (
    update agent_lab.wake_queue q
       set metadata=coalesce(q.metadata,'{}'::jsonb)||jsonb_build_object(
         'rabbit_arm_claimed_at',now(),
         'rabbit_arm_claimed_by',left(coalesce(p_worker_id,'unknown'),300),
         'single_execution_claim_guard','single_execution_claim_guard_v0_1'
       )
      from c
     where q.wake_request_id=c.wake_request_id
    returning q.*
  )
  select u.wake_request_id,u.agent_id,r.run_id,u.due_at,u.priority,u.payload
  from u join agent_lab.autonomous_lifecycle_runs r on r.agent_id=u.agent_id;
end;
$function$;
