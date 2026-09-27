-- AAU normal renewal must not inherit a temporary corrective epoch's reduced budget.
-- If the immediately prior epoch was corrective infrastructure compensation,
-- restore the recorded original epoch ceiling for the next normal renewal.

create or replace function agent_lab.renew_cognition_assignment_runtime_epoch(
  p_agent_id uuid,
  p_assignment_key text,
  p_reason text default 'operator_renewal'
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_prev agent_lab.cognition_assignment_runtime%rowtype;
  v_next agent_lab.cognition_assignment_runtime%rowtype;
  v_reason text:=left(coalesce(nullif(btrim(p_reason),''),'operator_renewal'),500);
  v_budget integer;
begin
  select * into v_prev
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id
    and assignment_key=p_assignment_key
  order by epoch_no desc
  limit 1
  for update;

  if not found then
    raise exception 'cognition_assignment_runtime_renewal_missing_prior_epoch';
  end if;
  if v_prev.status not in ('budget_exhausted','blocked') then
    raise exception 'cognition_assignment_runtime_renewal_requires_terminal_epoch:%',v_prev.status;
  end if;
  if v_prev.epoch_no>=1000000 then
    raise exception 'cognition_assignment_runtime_epoch_limit';
  end if;

  v_budget:=case
    when coalesce(v_prev.metadata->>'renewal_kind','')='corrective_infrastructure_compensation'
      then greatest(
        1,
        coalesce(
          nullif(v_prev.metadata->>'original_epoch_initial_budget_units','')::integer,
          v_prev.initial_budget_units
        )
      )
    else v_prev.initial_budget_units
  end;

  insert into agent_lab.cognition_assignment_runtime(
    agent_id,assignment_key,model_id,epoch_no,budget_quantum_tokens,
    initial_budget_units,remaining_budget_units,status,metadata
  ) values (
    v_prev.agent_id,v_prev.assignment_key,v_prev.model_id,v_prev.epoch_no+1,
    v_prev.budget_quantum_tokens,v_budget,v_budget,'active',
    jsonb_build_object(
      'contract','systemic_semantic_runtime_v0_2',
      'renewal_reason',v_reason,
      'renewed_at',now(),
      'renewed_from_runtime_id',v_prev.runtime_id,
      'renewed_from_epoch_no',v_prev.epoch_no,
      'renewed_from_status',v_prev.status,
      'renewed_from_remaining_budget_units',v_prev.remaining_budget_units,
      'renewed_from_initial_budget_units',v_prev.initial_budget_units,
      'canonical_renewal_budget_units',v_budget,
      'corrective_epoch_budget_inheritance_normalized',
        coalesce(v_prev.metadata->>'renewal_kind','')='corrective_infrastructure_compensation',
      'history_preserved',true
    )
  )
  returning * into v_next;

  return jsonb_build_object(
    'status','renewed',
    'agent_id',p_agent_id,
    'assignment_key',p_assignment_key,
    'runtime_id',v_next.runtime_id,
    'epoch_no',v_next.epoch_no,
    'initial_budget_units',v_next.initial_budget_units,
    'remaining_budget_units',v_next.remaining_budget_units,
    'runtime_status',v_next.status,
    'previous_runtime_id',v_prev.runtime_id,
    'previous_epoch_no',v_prev.epoch_no,
    'previous_status',v_prev.status,
    'corrective_epoch_budget_inheritance_normalized',
      coalesce(v_prev.metadata->>'renewal_kind','')='corrective_infrastructure_compensation',
    'history_preserved',true
  );
end;
$function$;

revoke all on function agent_lab.renew_cognition_assignment_runtime_epoch(uuid,text,text)
  from public,anon,authenticated;
grant execute on function agent_lab.renew_cognition_assignment_runtime_epoch(uuid,text,text)
  to service_role;
