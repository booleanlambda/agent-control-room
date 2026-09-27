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
      'status','ready','contract','model_call_reservation_settlement_v0_1',
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
        'contract','model_call_reservation_settlement_v0_1',
        'requested_reservation_units',p_reserved_units
      )
    ) returning * into v_existing;
    return jsonb_build_object(
      'status','ready','contract','model_call_reservation_settlement_v0_1',
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
      'contract','model_call_reservation_settlement_v0_1','reserved_units',p_reserved_units
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
    'status','ready','contract','model_call_reservation_settlement_v0_1',
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
      'status','ready','contract','model_call_reservation_settlement_v0_1',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,'remaining_budget_units',v_runtime.remaining_budget_units,
      'settlement_event_id',v_existing.event_id,'reservation_event_id',p_reservation_event_id,
      'reserved_units',v_reservation.cost_units,'settled_units',v_existing.cost_units,
      'refund_units',coalesce((v_existing.metadata->>'refund_units')::integer,0),
      'event_outcome',v_existing.outcome,'idempotent',true
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
      'contract','model_call_reservation_settlement_v0_1',
      'reservation_event_id',p_reservation_event_id,
      'reservation_event_key',v_reservation.event_key,
      'reserved_units',v_reservation.cost_units,'settled_units',p_settled_units,
      'refund_units',v_refund,'settlement_reason',left(p_settlement_reason,240),
      'provider_status_code',p_provider_status_code,'provider_total_tokens',p_provider_total_tokens
    )
  ) returning * into v_existing;

  return jsonb_build_object(
    'status','ready','contract','model_call_reservation_settlement_v0_1',
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
