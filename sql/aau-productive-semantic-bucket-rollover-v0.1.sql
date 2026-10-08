-- AAU productive semantic bucket rollover v0.1
-- Genuine bucket exhaustion becomes a bounded epoch boundary instead of retrying
-- the same exhausted semantic budget until cycle-lock.

begin;

create or replace function public.aau_bridge_rollover_semantic_bucket_epoch_v0_1(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_runtime_id uuid,
  p_budget_bucket text,
  p_reason text default 'semantic_bucket_exhausted'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','public'
as $function$
declare
  v_wake agent_lab.wake_queue%rowtype;
  v_prev agent_lab.cognition_assignment_runtime%rowtype;
  v_next agent_lab.cognition_assignment_runtime%rowtype;
  v_rollovers integer:=0;
  v_max_rollovers integer:=2;
  v_bucket text:=lower(coalesce(p_budget_bucket,''));
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if v_bucket not in ('reasoning','verification','transport_retry','orchestration') then
    raise exception 'semantic_bucket_rollover_invalid_bucket';
  end if;

  select * into v_wake
  from agent_lab.wake_queue
  where wake_request_id=p_intent_execution_id
  for update;

  if not found then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;

  if v_wake.status not in ('claimed','running') then
    return jsonb_build_object(
      'status','not_running',
      'intent_execution_id',p_intent_execution_id,
      'wake_status',v_wake.status
    );
  end if;

  select * into v_prev
  from agent_lab.cognition_assignment_runtime
  where runtime_id=p_runtime_id
  for update;

  if not found then
    raise exception 'semantic_bucket_rollover_runtime_missing';
  end if;

  if v_prev.agent_id<>v_wake.agent_id then
    raise exception 'semantic_bucket_rollover_agent_mismatch';
  end if;

  if exists(
    select 1
    from agent_lab.cognition_assignment_runtime r
    where r.agent_id=v_prev.agent_id
      and r.assignment_key=v_prev.assignment_key
      and r.model_id=v_prev.model_id
      and r.epoch_no>v_prev.epoch_no
  ) then
    return jsonb_build_object(
      'status','superseded',
      'runtime_id',v_prev.runtime_id,
      'epoch_no',v_prev.epoch_no
    );
  end if;

  select count(*)::integer into v_rollovers
  from agent_lab.cognition_assignment_runtime r
  where r.agent_id=v_prev.agent_id
    and r.assignment_key=v_prev.assignment_key
    and r.model_id=v_prev.model_id
    and coalesce(r.metadata->>'automatic_bucket_rollover','false')='true';

  if v_rollovers>=v_max_rollovers then
    return jsonb_build_object(
      'status','denied',
      'reason','automatic_rollover_limit_exhausted',
      'rollovers_used',v_rollovers,
      'max_rollovers',v_max_rollovers,
      'runtime_id',v_prev.runtime_id,
      'epoch_no',v_prev.epoch_no
    );
  end if;

  if v_prev.material_transition_count<1 then
    return jsonb_build_object(
      'status','denied',
      'reason','no_material_progress_in_epoch',
      'runtime_id',v_prev.runtime_id,
      'epoch_no',v_prev.epoch_no,
      'material_transition_count',v_prev.material_transition_count
    );
  end if;

  if v_prev.status<>'active' then
    return jsonb_build_object(
      'status','denied',
      'reason','runtime_not_active',
      'runtime_status',v_prev.status,
      'runtime_id',v_prev.runtime_id,
      'epoch_no',v_prev.epoch_no
    );
  end if;

  update agent_lab.cognition_assignment_runtime
  set status='blocked',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'block_reason','productive_semantic_bucket_epoch_boundary',
        'exhausted_bucket',v_bucket,
        'automatic_bucket_rollover',false,
        'bucket_rollover_at',now(),
        'bucket_rollover_reason',left(coalesce(p_reason,''),500),
        'durable_cognition_preserved',true,
        'finalization_reserve_consumed_for_rollover',false
      ),
      updated_at=now()
  where runtime_id=v_prev.runtime_id
  returning * into v_prev;

  insert into agent_lab.cognition_assignment_runtime(
    agent_id,assignment_key,model_id,epoch_no,budget_quantum_tokens,
    initial_budget_units,remaining_budget_units,status,metadata
  ) values (
    v_prev.agent_id,v_prev.assignment_key,v_prev.model_id,v_prev.epoch_no+1,
    v_prev.budget_quantum_tokens,v_prev.initial_budget_units,v_prev.initial_budget_units,
    'active',
    jsonb_build_object(
      'contract','systemic_semantic_runtime_v0_2',
      'automatic_bucket_rollover',true,
      'automatic_bucket_rollover_index',v_rollovers+1,
      'rollover_bucket',v_bucket,
      'rollover_reason',left(coalesce(p_reason,''),500),
      'rolled_over_at',now(),
      'rolled_over_from_runtime_id',v_prev.runtime_id,
      'rolled_over_from_epoch_no',v_prev.epoch_no,
      'rolled_over_from_remaining_budget_units',v_prev.remaining_budget_units,
      'rolled_over_from_material_transition_count',v_prev.material_transition_count,
      'rolled_over_from_semantic_node_count',v_prev.semantic_node_count,
      'history_preserved',true,
      'durable_cognition_preserved',true,
      'finalization_reserve_consumed_for_rollover',false,
      'max_automatic_bucket_rollovers',v_max_rollovers
    )
  )
  returning * into v_next;

  return jsonb_build_object(
    'status','renewed',
    'contract','productive_semantic_bucket_rollover_v0_1',
    'agent_id',v_prev.agent_id,
    'assignment_key',v_prev.assignment_key,
    'budget_bucket',v_bucket,
    'previous_runtime_id',v_prev.runtime_id,
    'previous_epoch_no',v_prev.epoch_no,
    'previous_remaining_budget_units',v_prev.remaining_budget_units,
    'previous_material_transition_count',v_prev.material_transition_count,
    'runtime_id',v_next.runtime_id,
    'epoch_no',v_next.epoch_no,
    'initial_budget_units',v_next.initial_budget_units,
    'remaining_budget_units',v_next.remaining_budget_units,
    'rollovers_used',v_rollovers+1,
    'max_rollovers',v_max_rollovers,
    'durable_cognition_preserved',true,
    'finalization_reserve_consumed',false
  );
end;
$function$;

revoke all on function public.aau_bridge_rollover_semantic_bucket_epoch_v0_1(
  text,uuid,uuid,text,text
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_rollover_semantic_bucket_epoch_v0_1(
  text,uuid,uuid,text,text
) to anon;

commit;
