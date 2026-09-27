-- AAU semantic runtime corrective resume v0.3
-- Creates a bounded corrective epoch after a terminal budget hold.
-- It carries forward only genuinely unspent units and adds only an explicitly
-- authorized infrastructure-loss compensation. Provider-policy losses are not refunded.

create or replace function agent_lab.corrective_resume_cognition_assignment_runtime_epoch(
  p_agent_id uuid,
  p_assignment_key text,
  p_compensation_units integer,
  p_reason text default 'operator_corrective_runtime_compensation'
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab','public','extensions'
as $function$
declare
  v_prev agent_lab.cognition_assignment_runtime%rowtype;
  v_next agent_lab.cognition_assignment_runtime%rowtype;
  v_reason text:=left(coalesce(nullif(btrim(p_reason),''),'operator_corrective_runtime_compensation'),500);
  v_new_budget integer;
  v_resume jsonb;
begin
  if p_compensation_units is null or p_compensation_units not between 1 and 10000000 then
    raise exception 'corrective_semantic_runtime_invalid_compensation';
  end if;

  select * into v_prev
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id
    and assignment_key=p_assignment_key
  order by epoch_no desc
  limit 1
  for update;

  if not found then
    raise exception 'corrective_semantic_runtime_missing_prior_epoch';
  end if;
  if v_prev.status<>'budget_exhausted' then
    raise exception 'corrective_semantic_runtime_requires_budget_exhausted_epoch:%',v_prev.status;
  end if;
  if v_prev.epoch_no>=1000000 then
    raise exception 'corrective_semantic_runtime_epoch_limit';
  end if;

  v_new_budget:=v_prev.remaining_budget_units+p_compensation_units;
  if v_new_budget>v_prev.initial_budget_units then
    raise exception 'corrective_semantic_runtime_exceeds_original_epoch_ceiling:%>%',v_new_budget,v_prev.initial_budget_units;
  end if;

  insert into agent_lab.cognition_assignment_runtime(
    agent_id,assignment_key,model_id,epoch_no,budget_quantum_tokens,
    initial_budget_units,remaining_budget_units,status,metadata
  ) values (
    v_prev.agent_id,v_prev.assignment_key,v_prev.model_id,v_prev.epoch_no+1,
    v_prev.budget_quantum_tokens,v_new_budget,v_new_budget,'active',
    jsonb_build_object(
      'contract','systemic_semantic_runtime_v0_3_corrective_resume',
      'renewal_kind','corrective_infrastructure_compensation',
      'renewal_reason',v_reason,
      'renewed_at',now(),
      'renewed_from_runtime_id',v_prev.runtime_id,
      'renewed_from_epoch_no',v_prev.epoch_no,
      'renewed_from_status',v_prev.status,
      'carried_forward_remaining_budget_units',v_prev.remaining_budget_units,
      'corrective_compensation_units',p_compensation_units,
      'corrective_epoch_budget_units',v_new_budget,
      'original_epoch_initial_budget_units',v_prev.initial_budget_units,
      'provider_policy_failures_refunded',false,
      'history_preserved',true
    )
  )
  returning * into v_next;

  -- Existing control-room resume remains the canonical scheduler/existence
  -- transition. If it fails, this transaction rolls back the corrective epoch.
  v_resume:=public.aau_control_room_admin_unpause(p_agent_id);

  -- The older resume function predates semantic-runtime terminal metadata.
  -- Clear only stale hold markers after a new ACTIVE epoch exists.
  update agent_lab.state
     set state_payload=(
           coalesce(state_payload,'{}'::jsonb)
           -'repair_pause_reason'
           -'semantic_runtime_terminal_code'
           -'semantic_runtime_terminal_at'
         ) || jsonb_build_object(
           'semantic_runtime_corrective_resume',true,
           'semantic_runtime_active_epoch',v_next.epoch_no,
           'semantic_runtime_corrective_resume_at',now()
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
           -'preserve_semantic_runtime_epoch'
         ) || jsonb_build_object(
           'semantic_runtime_corrective_resume',true,
           'semantic_runtime_active_epoch',v_next.epoch_no,
           'semantic_runtime_corrective_compensation_units',p_compensation_units,
           'semantic_runtime_corrective_resume_at',now()
         ),
         updated_at=now()
   where agent_id=p_agent_id;

  update agent_lab.agent_existence_accounts
     set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'semantic_runtime_corrective_resume',true,
           'semantic_runtime_active_epoch',v_next.epoch_no,
           'semantic_runtime_corrective_resume_at',now()
         ),
         updated_at=now()
   where agent_id=p_agent_id;

  return jsonb_build_object(
    'status','correctively_resumed',
    'agent_id',p_agent_id,
    'assignment_key',p_assignment_key,
    'runtime_id',v_next.runtime_id,
    'epoch_no',v_next.epoch_no,
    'carried_forward_remaining_budget_units',v_prev.remaining_budget_units,
    'corrective_compensation_units',p_compensation_units,
    'initial_budget_units',v_next.initial_budget_units,
    'remaining_budget_units',v_next.remaining_budget_units,
    'runtime_status',v_next.status,
    'previous_runtime_id',v_prev.runtime_id,
    'previous_epoch_no',v_prev.epoch_no,
    'previous_status',v_prev.status,
    'provider_policy_failures_refunded',false,
    'history_preserved',true,
    'resume_result',v_resume,
    'contract','systemic_semantic_runtime_v0_3_corrective_resume'
  );
end;
$function$;

revoke all on function agent_lab.corrective_resume_cognition_assignment_runtime_epoch(uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function agent_lab.corrective_resume_cognition_assignment_runtime_epoch(uuid,text,integer,text)
  to service_role;
