-- Reopen a completed cognition assignment solely for deterministic revalidation.
-- Carries forward only unspent units; it never grants or restores consumed compute.

begin;

create or replace function public.aau_bridge_reopen_completed_cognition_for_deterministic_revalidation_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_model text,
  p_node_path text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','public','extensions'
as $function$
declare
  v_bound text;
  v_prev agent_lab.cognition_assignment_runtime%rowtype;
  v_next agent_lab.cognition_assignment_runtime%rowtype;
  v_node text:=left(coalesce(nullif(btrim(p_node_path),''),'R'),500);
  v_carry integer;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select primary_model_id into v_bound
  from agent_lab.agents
  where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'deterministic_revalidation_bound_model_mismatch';
  end if;

  if not exists(
    select 1
    from agent_lab.wake_queue
    where agent_id=p_agent_id
      and wake_request_id=p_wake_request_id
      and status in ('running','claimed')
  ) then
    raise exception 'deterministic_revalidation_wake_not_running';
  end if;

  select * into v_prev
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id
    and assignment_key=p_assignment_key
    and model_id=p_model
  order by epoch_no desc
  limit 1
  for update;

  if not found then
    raise exception 'deterministic_revalidation_prior_epoch_missing';
  end if;

  if v_prev.status='active' then
    return jsonb_build_object(
      'status','ready',
      'idempotent',true,
      'runtime_id',v_prev.runtime_id,
      'epoch_no',v_prev.epoch_no,
      'runtime_status',v_prev.status,
      'initial_budget_units',v_prev.initial_budget_units,
      'remaining_budget_units',v_prev.remaining_budget_units,
      'history_preserved',true,
      'compute_grant_units',0
    );
  end if;

  if v_prev.status<>'complete' then
    raise exception 'deterministic_revalidation_requires_completed_epoch:%',v_prev.status;
  end if;

  v_carry:=greatest(0,coalesce(v_prev.remaining_budget_units,0));
  if v_carry<1 then
    raise exception 'deterministic_revalidation_no_unspent_budget';
  end if;
  if v_prev.epoch_no>=1000000 then
    raise exception 'deterministic_revalidation_epoch_limit';
  end if;

  insert into agent_lab.cognition_assignment_runtime(
    agent_id,assignment_key,model_id,epoch_no,budget_quantum_tokens,
    initial_budget_units,remaining_budget_units,status,metadata
  ) values (
    v_prev.agent_id,v_prev.assignment_key,v_prev.model_id,v_prev.epoch_no+1,
    v_prev.budget_quantum_tokens,v_carry,v_carry,'active',
    jsonb_build_object(
      'contract','deterministic_revalidation_epoch_v0_1',
      'renewal_kind','deterministic_revalidation_unspent_carryforward',
      'revalidation_node_path',v_node,
      'renewed_at',now(),
      'renewed_from_runtime_id',v_prev.runtime_id,
      'renewed_from_epoch_no',v_prev.epoch_no,
      'renewed_from_status',v_prev.status,
      'carried_forward_remaining_budget_units',v_carry,
      'compute_grant_units',0,
      'history_preserved',true
    )
  )
  returning * into v_next;

  update agent_lab.state
  set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
        'semantic_runtime_active_runtime_id',v_next.runtime_id,
        'semantic_runtime_active_epoch',v_next.epoch_no,
        'semantic_runtime_active_assignment_key',v_next.assignment_key,
        'deterministic_revalidation_epoch',v_next.epoch_no,
        'deterministic_revalidation_node_path',v_node,
        'deterministic_revalidation_epoch_at',now()
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.autonomous_lifecycle_runs
  set metadata=(
        coalesce(metadata,'{}'::jsonb)
        -'semantic_runtime_terminal'
        -'semantic_runtime_terminal_code'
        -'semantic_runtime_failure_class'
        -'semantic_runtime_terminal_at'
        -'semantic_runtime_state'
      ) || jsonb_build_object(
        'semantic_runtime_active_runtime_id',v_next.runtime_id,
        'semantic_runtime_active_epoch',v_next.epoch_no,
        'deterministic_revalidation_epoch',v_next.epoch_no,
        'deterministic_revalidation_node_path',v_node,
        'deterministic_revalidation_epoch_at',now(),
        'deterministic_revalidation_compute_grant_units',0
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  return jsonb_build_object(
    'status','ready',
    'idempotent',false,
    'runtime_id',v_next.runtime_id,
    'epoch_no',v_next.epoch_no,
    'runtime_status',v_next.status,
    'initial_budget_units',v_next.initial_budget_units,
    'remaining_budget_units',v_next.remaining_budget_units,
    'carried_forward_remaining_budget_units',v_carry,
    'compute_grant_units',0,
    'history_preserved',true,
    'contract','deterministic_revalidation_epoch_v0_1'
  );
end
$function$;

revoke all on function public.aau_bridge_reopen_completed_cognition_for_deterministic_revalidation_v0_1(
  text,uuid,uuid,text,text,text
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_reopen_completed_cognition_for_deterministic_revalidation_v0_1(
  text,uuid,uuid,text,text,text
) to anon;

commit;
